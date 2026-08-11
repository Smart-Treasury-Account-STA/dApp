import { describe, expect, it } from "vitest";

import { validateRelayerJobInput } from "@/lib/relayer/store";

const validInput = {
  intentId: "a".repeat(64),
  startLedger: 100,
  endLedger: 200,
  maxExecutions: 1,
};

describe("validateRelayerJobInput", () => {
  it("accepts a well formed input", () => {
    expect(() => validateRelayerJobInput(validInput)).not.toThrow();
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
