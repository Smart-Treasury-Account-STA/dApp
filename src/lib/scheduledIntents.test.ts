import { describe, expect, it } from "vitest";

import { collectIntentIds, describeIntentStatus } from "./scheduledIntents";
import type { ScheduledIntentRecord } from "./scheduledIntents";

const ID_A = "7190e1933e72dfd205765518e5b1b535b0e08240c3bd2d0b0e67bb115cf3f033";
const ID_B = "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20";

function bytes(hex: string) {
  return Uint8Array.from(hex.match(/../g)!.map((pair) => Number.parseInt(pair, 16)));
}

function record(overrides: Partial<ScheduledIntentRecord> = {}): ScheduledIntentRecord {
  return {
    intentId: ID_A,
    asset: "CCOUVA654JH2V6B7LNTKHJP5DF3QA553RS2IIWXSGPDFH2N3QILIVU5L",
    destination: "GAK3XILRBYBMBOCZMSLL2CLR6WPQLEIOC6ZCYYPTE4OIAX3PCFFO2YMU",
    amount: 1000n,
    startLedger: 100,
    endLedger: 200,
    maxExecutions: 3,
    executionCount: 0,
    policyVersion: 1,
    cancelled: false,
    unreadable: false,
    ...overrides,
  };
}

describe("collectIntentIds", () => {
  it("reads the id out of an IntentCreated topic pair", () => {
    expect(collectIntentIds([{ topics: ["intent", bytes(ID_A)] }])).toEqual([ID_A]);
  });

  it("ignores the registry's other events", () => {
    // `init`, `execset`, `cancel` and `exec` share the same contract stream.
    // Only `intent` announces an id that did not exist before.
    const ids = collectIntentIds([
      { topics: ["init", "CCMPGTBAXHQX37QTXP2NGYFGL7NHG4CXQDJP43CWL3EQ5FVC36JODUDL"] },
      { topics: ["execset", "GDWFIF3EMTDOUHV5UIKDARJU4ZI2TFGE6YBWHS4RDSCLZ7RVQO4XG3HV"] },
      { topics: ["intent", bytes(ID_A)] },
      { topics: ["cancel", bytes(ID_A)] },
      { topics: ["exec", bytes(ID_A)] },
    ]);

    expect(ids).toEqual([ID_A]);
  });

  it("keeps one entry per id, in first-seen order", () => {
    const ids = collectIntentIds([
      { topics: ["intent", bytes(ID_B)] },
      { topics: ["intent", bytes(ID_A)] },
      { topics: ["intent", bytes(ID_B)] },
    ]);

    expect(ids).toEqual([ID_B, ID_A]);
  });

  it("normalizes to lowercase hex, matching what makeIntentId emits", () => {
    // The row's cancel button feeds this id straight back into
    // `bytesN32ScVal`, so it has to be the same shape the form produces.
    expect(collectIntentIds([{ topics: ["intent", bytes(ID_A.toUpperCase())] }])).toEqual([ID_A]);
  });

  it("skips topics that are not a 32-byte id", () => {
    const ids = collectIntentIds([
      { topics: ["intent"] },
      { topics: ["intent", bytes("0102030405")] },
      { topics: ["intent", "not-bytes"] },
      { topics: [] },
    ]);

    expect(ids).toEqual([]);
  });
});

describe("describeIntentStatus", () => {
  it("reports an unreadable intent as unknown rather than guessing", () => {
    expect(describeIntentStatus(record({ unreadable: true }), 150)).toBe("unknown");
  });

  it("reports cancellation before anything else", () => {
    // A cancelled intent inside its window is still cancelled, and a cancelled
    // one past its window should not read as merely expired.
    expect(describeIntentStatus(record({ cancelled: true }), 150)).toBe("cancelled");
    expect(describeIntentStatus(record({ cancelled: true }), 900)).toBe("cancelled");
  });

  it("reports an exhausted intent before an expired one", () => {
    // "Used up" is the reason it will never run again; the window closing
    // afterwards is incidental.
    expect(
      describeIntentStatus(record({ executionCount: 3, maxExecutions: 3 }), 900),
    ).toBe("exhausted");
  });

  it("reports a window that has closed", () => {
    expect(describeIntentStatus(record(), 201)).toBe("expired");
  });

  it("treats the end ledger itself as still inside the window", () => {
    expect(describeIntentStatus(record(), 200)).toBe("active");
  });

  it("reports a window that has not opened", () => {
    expect(describeIntentStatus(record(), 99)).toBe("pending");
    expect(describeIntentStatus(record(), 100)).toBe("active");
  });

  it("is active inside the window with executions left", () => {
    expect(describeIntentStatus(record({ executionCount: 1, maxExecutions: 3 }), 150)).toBe(
      "active",
    );
  });

  it("does not read a missing window as expired", () => {
    // A record whose fields could not be decoded must not claim the intent is
    // dead -- that would tell an operator to stop watching a live payment.
    expect(
      describeIntentStatus(record({ startLedger: null, endLedger: null }), 150),
    ).toBe("active");
  });
});
