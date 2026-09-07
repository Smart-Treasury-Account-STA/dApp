import type { ContextRule } from "@/types";

export type WeakestRuleSummary = {
  weakestUnanimousRule: { id: number; name: string; requiredSigners: number } | null;
  policyGatedRuleIds: number[];
};

/**
 * A treasury's real security ceiling is its weakest independent context
 * rule, not its strongest -- satisfying any one rule authorizes any
 * smart_account-gated action, including creating further rules (see
 * DAPP_DEVELOPER_QA.md Part 1 §5, Part 2). This surfaces that number.
 *
 * A rule with no policy attached requires every one of its signers
 * (unanimous) -- see `get_validated_context_by_id` in the pinned
 * `stellar-accounts` crate, verified live earlier this session. That's a
 * precise, knowable requirement from `ContextRule` alone. A rule with a
 * policy attached defers to that policy's own `enforce()` for how many
 * signers actually suffice, which this dApp cannot read generically (no
 * deployed threshold-policy contract exists yet -- see this plan's Global
 * Constraints) -- policy-gated rules are listed separately rather than
 * guessed at, so a rule that merely *looks* weak (one policy) never wins
 * the "weakest" comparison against a rule whose exact requirement is known.
 */
export function computeWeakestRule(rules: ContextRule[]): WeakestRuleSummary {
  const unanimousRules = rules.filter((rule) => rule.policyCount === 0);
  const policyGatedRuleIds = rules
    .filter((rule) => rule.policyCount > 0)
    .map((rule) => rule.id);

  if (unanimousRules.length === 0) {
    return { weakestUnanimousRule: null, policyGatedRuleIds };
  }

  const weakest = unanimousRules.reduce((min, rule) =>
    rule.signerCount < min.signerCount ? rule : min,
  );

  return {
    weakestUnanimousRule: {
      id: weakest.id,
      name: weakest.name,
      requiredSigners: weakest.signerCount,
    },
    policyGatedRuleIds,
  };
}
