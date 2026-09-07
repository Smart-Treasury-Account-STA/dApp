import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Postgres double at the `@/lib/db` seam -- see the equivalent in
 * `treasuryRegistry/store.test.ts`. Reproduces the composite-key conflict on
 * INSERT and the optimistic `version` check on UPDATE, which is what the
 * compound-key and idempotency assertions below actually exercise.
 */
const dbState = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));

vi.mock("@/lib/db", () => ({
  toIsoString: (value: unknown) =>
    value instanceof Date ? value.toISOString() : String(value),
  query: vi.fn(async (text: string, params: unknown[] = []) => {
    const find = (smartAccountId: unknown, intentId: unknown) =>
      dbState.rows.find(
        (row) => row.smart_account_id === smartAccountId && row.intent_id === intentId,
      );

    if (text.includes("INSERT INTO relayer_jobs")) {
      const [smart_account_id, intent_id, start_ledger, end_ledger, max_executions, note] =
        params as [string, string, number, number, number, string];
      // ON CONFLICT (smart_account_id, intent_id) DO NOTHING.
      if (find(smart_account_id, intent_id)) return [];
      const now = new Date();
      const row = {
        smart_account_id,
        intent_id,
        child_sequence: 1,
        start_ledger,
        end_ledger,
        max_executions,
        execution_count: 0,
        status: "scheduled",
        note,
        tx_hash: null,
        created_at: now,
        updated_at: now,
        version: 0,
      };
      dbState.rows.push(row);
      return [row];
    }

    if (text.includes("UPDATE relayer_jobs")) {
      const [smart_account_id, intent_id] = params as [string, string];
      const row = find(smart_account_id, intent_id);
      const expectedVersion = params[10];
      // The optimistic guard: a writer holding a stale version updates no row.
      if (!row || row.version !== expectedVersion) return [];
      Object.assign(row, {
        child_sequence: params[2],
        start_ledger: params[3],
        end_ledger: params[4],
        max_executions: params[5],
        execution_count: params[6],
        status: params[7],
        note: params[8],
        tx_hash: params[9],
        updated_at: new Date(),
        version: (row.version as number) + 1,
      });
      return [row];
    }

    // Reads return detached copies, as a real driver does. Handing back the
    // stored object would let the caller observe a concurrent writer's change
    // through the row it already read, which is exactly what the optimistic
    // version check exists to detect -- the double must not paper over it.
    if (text.includes("WHERE smart_account_id = $1 AND intent_id = $2")) {
      const row = find(params[0], params[1]);
      return row ? [{ ...row }] : [];
    }

    if (text.includes("WHERE smart_account_id = $1")) {
      return dbState.rows
        .filter((row) => row.smart_account_id === params[0])
        .map((row) => ({ ...row }));
    }

    return dbState.rows.map((row) => ({ ...row }));
  }),
}));

import {
  createRelayerJob,
  getRelayerJob,
  updateRelayerJob,
  validateRelayerJobInput,
} from "@/lib/relayer/store";

const SMART_ACCOUNT_ID = "CD6GY4UUTNPW4TUV7LDL5SELN4BBHJG4KDDT3W6G23DY6XCGM75MULMQ";
const SMART_ACCOUNT_ID_2 = "CB4KZJ3I4XANE6GWPAMXCNXQ34PTQWPXVKFBBMLNKV25GAOXQC7RQUMS";

const validInput = {
  smartAccountId: SMART_ACCOUNT_ID,
  intentId: "a".repeat(64),
  startLedger: 100,
  endLedger: 200,
  maxExecutions: 1,
};

describe("validateRelayerJobInput", () => {
  it("accepts a well formed input", () => {
    expect(() => validateRelayerJobInput(validInput)).not.toThrow();
  });

  it("rejects a malformed smartAccountId", () => {
    expect(() =>
      validateRelayerJobInput({ ...validInput, smartAccountId: "not-a-contract" }),
    ).toThrow(/smartAccountId/);
  });

  it("accepts a 0x prefixed intent id", () => {
    expect(() =>
      validateRelayerJobInput({ ...validInput, intentId: `0x${"b".repeat(64)}` }),
    ).not.toThrow();
  });

  it("rejects an intent id that is not 32 bytes", () => {
    expect(() =>
      validateRelayerJobInput({ ...validInput, intentId: "abc" }),
    ).toThrow("Intent ID must be 32 bytes encoded as 64 hex characters.");
  });

  it("rejects a non integer ledger bound", () => {
    expect(() =>
      validateRelayerJobInput({ ...validInput, startLedger: 1.5 }),
    ).toThrow("startLedger must be a non-negative safe integer.");
  });

  it("rejects maxExecutions below one", () => {
    expect(() =>
      validateRelayerJobInput({ ...validInput, maxExecutions: 0 }),
    ).toThrow("maxExecutions must be at least 1.");
  });

  it("rejects an inverted ledger window", () => {
    expect(() =>
      validateRelayerJobInput({ ...validInput, startLedger: 300 }),
    ).toThrow("startLedger must be lower than endLedger.");
  });
});

describe("createRelayerJob / getRelayerJob — compound (smartAccountId, intentId) key", () => {
  beforeEach(() => {
    dbState.rows = [];
  });

  it("does not collide when two different treasuries schedule the same intentId", async () => {
    const jobA = await createRelayerJob(validInput);
    const jobB = await createRelayerJob({ ...validInput, smartAccountId: SMART_ACCOUNT_ID_2 });

    expect(jobA.smartAccountId).toBe(SMART_ACCOUNT_ID);
    expect(jobB.smartAccountId).toBe(SMART_ACCOUNT_ID_2);
    expect(await getRelayerJob(SMART_ACCOUNT_ID, validInput.intentId)).toEqual(jobA);
    expect(await getRelayerJob(SMART_ACCOUNT_ID_2, validInput.intentId)).toEqual(jobB);
  });

  it("is idempotent per (smartAccountId, intentId), not per intentId alone", async () => {
    const first = await createRelayerJob(validInput);
    const second = await createRelayerJob(validInput);
    expect(second).toEqual(first);
  });

  it("getRelayerJob returns null for the right intentId under the wrong smartAccountId", async () => {
    await createRelayerJob(validInput);
    expect(await getRelayerJob(SMART_ACCOUNT_ID_2, validInput.intentId)).toBeNull();
  });
});

describe("updateRelayerJob — optimistic concurrency", () => {
  beforeEach(() => {
    dbState.rows = [];
  });

  it("re-applies the mutation instead of overwriting a writer that committed first", async () => {
    // The lost update this replaced a per-process write queue to prevent: two
    // relayer runs on two serverless instances both read executionCount 0 and
    // both write 1, so one execution vanishes from the count.
    await createRelayerJob(validInput);

    let calls = 0;
    const updated = await updateRelayerJob(SMART_ACCOUNT_ID, validInput.intentId, (current) => {
      calls += 1;
      if (calls === 1) {
        // Another writer commits between our SELECT and our UPDATE: it bumps
        // the count and the version, so our UPDATE matches no row.
        const row = dbState.rows[0];
        row.execution_count = 1;
        row.version = (row.version as number) + 1;
      }
      return { ...current, executionCount: current.executionCount + 1 };
    });

    expect(calls).toBe(2);
    // 2, not 1: the retry incremented the *winner's* count rather than
    // clobbering it back down with a value read before that write.
    expect(updated.executionCount).toBe(2);
  });

  it("gives up rather than looping forever when it never wins", async () => {
    await createRelayerJob(validInput);

    await expect(
      updateRelayerJob(SMART_ACCOUNT_ID, validInput.intentId, (current) => {
        const row = dbState.rows[0];
        row.version = (row.version as number) + 1;
        return current;
      }),
    ).rejects.toThrow(/modified concurrently/);
  });

  it("throws when the job does not exist", async () => {
    await expect(
      updateRelayerJob(SMART_ACCOUNT_ID, validInput.intentId, (current) => current),
    ).rejects.toThrow("Relayer job not found.");
  });
});
