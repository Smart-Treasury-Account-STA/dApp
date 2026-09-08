import { describe, expect, it } from "vitest";

import {
  classifyProbeFailure,
  findAmountCap,
  isWholePaymentReason,
  probePolicy,
} from "./policyProbe";
import type { ProbeInput } from "@/types";

/**
 * Stands in for the deployed policy engine. Mirrors validate_policy's real
 * check order: version, amount > 0, operation, asset (enabled then cap),
 * recipient. Rejects with the same message shape the RPC returns.
 */
function fakeEngine({
  cap = 10_000_000n,
  version = 1,
  allowedOperation = "transfer",
  allowedAsset = "ASSET_OK",
  allowedRecipient = "DEST_OK",
}: {
  cap?: bigint;
  version?: number;
  allowedOperation?: string;
  allowedAsset?: string;
  allowedRecipient?: string;
} = {}) {
  return async (input: ProbeInput) => {
    const fail = (code: number) => {
      throw new Error(`HostError: Error(Contract, #${code})`);
    };
    if (input.expectedVersion !== version) fail(2006);
    if (BigInt(input.amount) <= 0n) fail(2002);
    if (input.operation !== allowedOperation) fail(2008);
    if (input.asset !== allowedAsset) fail(2003);
    if (BigInt(input.amount) > cap) fail(2005);
    if (input.destination !== allowedRecipient) fail(2004);
  };
}

const base: Omit<ProbeInput, "amount"> = {
  asset: "ASSET_OK",
  destination: "DEST_OK",
  operation: "transfer",
  expectedVersion: 1,
};

describe("classifyProbeFailure", () => {
  it("maps each contract code to the dimension it rejected", () => {
    expect(classifyProbeFailure("Error(Contract, #2008)")).toEqual({
      allowed: false,
      reason: "operation",
      code: 2008,
    });
    expect(classifyProbeFailure("Error(Contract, #2003)")).toEqual({
      allowed: false,
      reason: "asset",
      code: 2003,
    });
    expect(classifyProbeFailure("Error(Contract, #2005)")).toEqual({
      allowed: false,
      reason: "amount",
      code: 2005,
    });
    expect(classifyProbeFailure("Error(Contract, #2004)")).toEqual({
      allowed: false,
      reason: "recipient",
      code: 2004,
    });
    expect(classifyProbeFailure("Error(Contract, #2006)")).toEqual({
      allowed: false,
      reason: "version",
      code: 2006,
    });
  });

  it("reports an unrecognised failure as unknown rather than guessing", () => {
    expect(classifyProbeFailure("Bad union switch: 1")).toEqual({
      allowed: false,
      reason: "unknown",
    });
  });
});

describe("isWholePaymentReason", () => {
  it("treats the per-recipient dimensions as belonging to that recipient", () => {
    expect(isWholePaymentReason("recipient")).toBe(false);
    expect(isWholePaymentReason("amount")).toBe(false);
  });

  it("treats asset, operation and version as belonging to the whole payment", () => {
    // A split checks policy once per recipient, so these surface on whichever
    // recipient happens to be first -- blaming that entry sends the operator
    // to edit an address that was never the problem.
    expect(isWholePaymentReason("asset")).toBe(true);
    expect(isWholePaymentReason("operation")).toBe(true);
    expect(isWholePaymentReason("version")).toBe(true);
  });

  it("does not blame a recipient for a code it could not classify", () => {
    expect(isWholePaymentReason("unknown")).toBe(true);
  });
});

describe("probePolicy", () => {
  it("reports allowed when the engine accepts", async () => {
    const verdict = await probePolicy(fakeEngine(), { ...base, amount: "1" });
    expect(verdict).toEqual({ allowed: true });
  });

  it("reports the rejected dimension", async () => {
    const verdict = await probePolicy(fakeEngine(), {
      ...base,
      destination: "DEST_BAD",
      amount: "1",
    });
    expect(verdict).toEqual({ allowed: false, reason: "recipient", code: 2004 });
  });
});

describe("findAmountCap", () => {
  it("finds the exact cap", async () => {
    const cap = await findAmountCap(fakeEngine({ cap: 10_000_000n }), base);
    expect(cap).toBe(10_000_000n);
  });

  it("finds a cap that is not a round number", async () => {
    const cap = await findAmountCap(fakeEngine({ cap: 7_654_321n }), base);
    expect(cap).toBe(7_654_321n);
  });

  it("returns null when the asset is rejected for a reason other than the cap", async () => {
    const cap = await findAmountCap(fakeEngine({ allowedAsset: "OTHER" }), base);
    expect(cap).toBeNull();
  });

  it("ignores the recipient, which validate_policy checks after the cap", async () => {
    const cap = await findAmountCap(fakeEngine({ cap: 500n }), {
      ...base,
      destination: "DEST_BAD",
    });
    expect(cap).toBe(500n);
  });
});
