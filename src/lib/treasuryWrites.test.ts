import { describe, expect, it } from "vitest";
import { xdr } from "@stellar/stellar-sdk";

import { STELLAR_CONFIG } from "@/config";
import {
  addGuardianOperation,
  addSignerOperation,
  bumpVersionOperation,
  removeSignerOperation,
  setAssetRuleOperation,
  setOperationAllowedOperation,
  setRecipientAllowedOperation,
} from "./treasuryWrites";

const SIGNER = "GAK3XILRBYBMBOCZMSLL2CLR6WPQLEIOC6ZCYYPTE4OIAX3PCFFO2YMU";
const ASSET = "CCOUVA654JH2V6B7LNTKHJP5DF3QA553RS2IIWXSGPDFH2N3QILIVU5L";

describe("smart_account write descriptors", () => {
  it("routes add_signer through the custom-account strategy", () => {
    const op = addSignerOperation({ contextRuleId: 0, signerAddress: SIGNER });

    expect(op.contractId).toBe(STELLAR_CONFIG.contracts.smartAccount);
    expect(op.functionName).toBe("add_signer");
    expect(op.strategy).toBe("custom-account");
    expect(op.args).toHaveLength(2);
  });

  it("removes a signer by its numeric id, not its address", () => {
    const op = removeSignerOperation({ contextRuleId: 0, signerId: 3 });

    expect(op.functionName).toBe("remove_signer");
    expect(op.args.map((arg: xdr.ScVal) => arg.u32())).toEqual([0, 3]);
  });
});

describe("policy_engine write descriptors", () => {
  it("routes policy writes through the source-account strategy", () => {
    const op = setRecipientAllowedOperation({ recipient: SIGNER, allowed: true });

    expect(op.contractId).toBe(STELLAR_CONFIG.contracts.policyEngine);
    expect(op.functionName).toBe("set_recipient_allowed");
    expect(op.strategy).toBe("source-account");
  });

  it("encodes the AssetRule struct with sorted map keys", () => {
    const op = setAssetRuleOperation({
      asset: ASSET,
      enabled: true,
      maxSingleTransfer: "10000000",
    });

    const rule = op.args[1] as xdr.ScVal;
    const keys = (rule.map() ?? []).map((entry: xdr.ScMapEntry) =>
      entry.key().sym().toString(),
    );
    expect(keys).toEqual(["enabled", "max_single_transfer"]);
  });

  it("carries the operation symbol and the allowed flag", () => {
    const op = setOperationAllowedOperation({ operation: "transfer", allowed: false });

    expect(op.args[0].sym().toString()).toBe("transfer");
    expect(op.args[1].b()).toBe(false);
  });

  it("bumps to the requested version", () => {
    const op = bumpVersionOperation({ nextVersion: 2 });

    expect(op.functionName).toBe("bump_version");
    expect(op.args[0].u32()).toBe(2);
  });
});

describe("recovery_manager write descriptors", () => {
  it("routes add_guardian through the source-account strategy, targeting recoveryManager not smartAccount", () => {
    const op = addGuardianOperation({ guardian: SIGNER });

    expect(op.contractId).toBe(STELLAR_CONFIG.contracts.recoveryManager);
    expect(op.functionName).toBe("add_guardian");
    expect(op.strategy).toBe("source-account");
    expect(op.args).toHaveLength(1);
  });

  it("respects a per-treasury contracts override, like every other write descriptor", () => {
    const customRecoveryManager = "CB4KZJ3I4XANE6GWPAMXCNXQ34PTQWPXVKFBBMLNKV25GAOXQC7RQUMS";
    const op = addGuardianOperation({
      guardian: SIGNER,
      contracts: { ...STELLAR_CONFIG.contracts, recoveryManager: customRecoveryManager },
    });

    expect(op.contractId).toBe(customRecoveryManager);
  });
});

describe("summaries", () => {
  it("states what will change, for the confirmation step", () => {
    expect(bumpVersionOperation({ nextVersion: 2 }).summary).toContain("2");
    expect(
      setOperationAllowedOperation({ operation: "transfer", allowed: false }).summary,
    ).toMatch(/disable/i);
  });
});
