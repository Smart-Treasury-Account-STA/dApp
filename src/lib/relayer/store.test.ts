import { beforeEach, describe, expect, it, vi } from "vitest";

const fsState = vi.hoisted(() => ({ file: null as string | null }));

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(async () => undefined),
  readFile: vi.fn(async () => {
    if (fsState.file === null) {
      const error = new Error("ENOENT") as NodeJS.ErrnoException;
      error.code = "ENOENT";
      throw error;
    }
    return fsState.file;
  }),
  writeFile: vi.fn(async (_path: string, contents: string) => {
    fsState.file = contents;
  }),
  rename: vi.fn(async () => undefined),
}));

import {
  createRelayerJob,
  getRelayerJob,
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
    fsState.file = null;
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
