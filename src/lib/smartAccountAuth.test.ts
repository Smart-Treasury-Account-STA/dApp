import { describe, expect, it } from "vitest";

import { buildTransferAuthPlan, selectRuleForSigner } from "./smartAccountAuth";
import type { ContextRule, PaymentDraft, WalletState } from "@/types";

const DEPLOYER = "GCWFJKLE45TMVZS42TMIYKAORKGBWE74753YPOSCC5ESJR2G2UMBXBDB";
const DEV = "GB2KHXT4JHCUZW5I3ILKEJMIAHPIKT5AKNSUCWUILNMQHIXRAOL5EQ4T";

function rule(id: number, name: string, signerAddresses: string[]): ContextRule {
  return {
    id,
    name,
    // Every rule the treasury carries today is a Default rule; the context
    // type does not distinguish them.
    contextType: "Default",
    signerCount: signerAddresses.length,
    signerAddresses,
    policyCount: 0,
  };
}

/** The live testnet treasury as of 2026-08-11. */
const liveRules = [
  rule(0, "root", [DEPLOYER]),
  rule(1, "dapp_dev_test", [DEV]),
];

describe("selectRuleForSigner", () => {
  it("picks the rule that actually lists the connected signer", () => {
    expect(selectRuleForSigner(liveRules, DEV)?.id).toBe(1);
    expect(selectRuleForSigner(liveRules, DEPLOYER)?.id).toBe(0);
  });

  it("falls back to the first rule when the signer is in none of them", () => {
    expect(selectRuleForSigner(liveRules, "GUNKNOWN")?.id).toBe(0);
  });

  it("falls back to the first rule when no wallet is connected", () => {
    expect(selectRuleForSigner(liveRules, null)?.id).toBe(0);
  });

  it("returns null when the account carries no rules", () => {
    expect(selectRuleForSigner([], DEV)).toBeNull();
  });

  it("prefers a matching rule even when it is not first", () => {
    const rules = [rule(0, "root", [DEPLOYER]), rule(7, "ops", [DEV])];
    expect(selectRuleForSigner(rules, DEV)?.id).toBe(7);
  });
});

describe("buildTransferAuthPlan", () => {
  const draft: PaymentDraft = {
    asset: "CCOUVA654JH2V6B7LNTKHJP5DF3QA553RS2IIWXSGPDFH2N3QILIVU5L",
    destination: "GAK3XILRBYBMBOCZMSLL2CLR6WPQLEIOC6ZCYYPTE4OIAX3PCFFO2YMU",
    amount: "5000000",
    nonce: "42",
    expectedPolicyVersion: 1,
  };

  function wallet(address: string | null): WalletState {
    return { address, walletName: "freighter", connected: address !== null };
  }

  it("plans against the connected signer's own rule, not merely the first one", () => {
    const plan = buildTransferAuthPlan(draft, wallet(DEV), liveRules);

    expect(plan.contextRuleIds).toEqual([1]);
    expect(plan.requiredDelegatedSigners).toEqual([DEV]);
    expect(plan.steps[1].state).toBe("active");
  });

  it("blocks the signer step when the wallet is in no rule", () => {
    const plan = buildTransferAuthPlan(draft, wallet("GUNKNOWN"), liveRules);

    expect(plan.steps[1].state).toBe("blocked");
  });
});
