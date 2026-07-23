import type { ContextRule, ExecutionStep, PaymentDraft, WalletState } from "@/types";

export type SmartAccountAuthPlan = {
  rootInvocation: string;
  contextRuleIds: number[];
  nonce: string;
  expirationLedgers: number;
  requiredDelegatedSigners: string[];
  steps: ExecutionStep[];
};

export function selectDefaultRule(rules: ContextRule[]) {
  return (
    rules.find((rule) => rule.contextType.toLowerCase().includes("default")) ??
    rules[0] ??
    null
  );
}

export function buildTransferAuthPlan(
  draft: PaymentDraft,
  wallet: WalletState,
  rules: ContextRule[],
): SmartAccountAuthPlan {
  const selectedRule = selectDefaultRule(rules);
  const requiredDelegatedSigners = selectedRule?.signerAddresses ?? [];
  const walletCanApprove =
    Boolean(wallet.address) &&
    (requiredDelegatedSigners.length === 0 ||
      requiredDelegatedSigners.includes(wallet.address ?? ""));

  return {
    rootInvocation:
      "smart_account.execute_transfer_payment(asset, destination, amount, nonce, expected_policy_version)",
    contextRuleIds: selectedRule ? [selectedRule.id] : [],
    nonce: draft.nonce,
    expirationLedgers: 100,
    requiredDelegatedSigners,
    steps: [
      {
        label: "Root auth payload",
        state: selectedRule ? "complete" : "blocked",
        detail: selectedRule
          ? `Entry A uses context rule ${selectedRule.id} and embeds an AuthPayload map.`
          : "No context rule was loaded from smart_account.",
      },
      {
        label: "Delegated signer digest",
        state: walletCanApprove ? "active" : "blocked",
        detail: walletCanApprove
          ? "Entry B signs sha256(signature_payload || context_rule_ids_xdr) for __check_auth."
          : "Connected wallet is not listed as a delegated signer for the selected rule.",
      },
      {
        label: "Prepared transaction",
        state: "pending",
        detail:
          "Attach Entry A plus one signed Entry B per required delegated signer before prepareTransaction.",
      },
      {
        label: "Submit and track",
        state: "pending",
        detail:
          "Poll getTransaction and resolve status from pay_ok / intent / exec events.",
      },
    ],
  };
}
