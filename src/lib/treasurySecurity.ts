import type { ContextRule } from "@/types";

export type WeakestRuleSummary = {
  weakestUnanimousRule: { id: number; name: string; requiredSigners: number } | null;
  policyGatedRuleIds: number[];
};

export type AuthorizingPath = {
  /** Rules the connected wallet is a readable signer on. */
  rules: ContextRule[];
  /** A rule this wallet can satisfy by itself: no policy, and it is the
   * only signer. Non-null means one wallet signature is provably enough. */
  soleSignerRule: ContextRule | null;
  /** Rules the wallet is on whose real threshold this dApp cannot read. */
  policyGatedRules: ContextRule[];
  /** Rules the wallet is on that require every one of two or more signers. */
  unanimousMultiSignerRules: ContextRule[];
  /** True only when a rejection is certain: the wallet is on at least one
   * readable rule, none of them is satisfiable by this wallet alone, and
   * none of them defers to a policy that might still accept one signature. */
  blocked: boolean;
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

/**
 * Which rule the connected wallet will actually authorize a smart_account
 * write through, and whether one signature can satisfy it.
 *
 * `computeWeakestRule` above answers "how exposed is this treasury"; this
 * answers the operator's own question, "will the thing I am about to sign
 * work". They are different rules: the treasury's weakest rule may belong to
 * somebody else entirely.
 *
 * This exists because nothing else in the write pipeline can catch the
 * mismatch. Simulation cannot check authorization, so a wallet whose only
 * rule needs two co-signatures sails through stage -> simulate -> confirm and
 * is rejected on-chain only after the operator has signed -- which is exactly
 * how the testnet rule 0 / rule 1 lockout was discovered.
 *
 * Two deliberate asymmetries, both erring toward silence:
 *
 * - Membership is read from `signerAddresses`, a best-effort regex scrape
 *   that misses non-`G` signers (`Signer::Delegated(C...)`). A wallet that
 *   does not appear is therefore *unknown*, never "cannot sign" -- so an
 *   empty `rules` leaves `blocked` false rather than blocking a wallet that
 *   can in fact authorize.
 * - A policy-gated rule could carry a 1-of-N threshold that one signature
 *   satisfies. That threshold is not readable here (no threshold-policy
 *   contract is deployed in this system), so such a rule makes the outcome
 *   uncertain, never certainly-failing.
 *
 * Requirement counts come from `signerCount`, the contract-enforced number,
 * for the same reason `computeWeakestRule` uses it.
 */
export function findAuthorizingPath(
  rules: ContextRule[],
  connectedAddress: string | null,
): AuthorizingPath {
  if (!connectedAddress) {
    return {
      rules: [],
      soleSignerRule: null,
      policyGatedRules: [],
      unanimousMultiSignerRules: [],
      blocked: false,
    };
  }

  const walletRules = rules.filter((rule) => rule.signerAddresses.includes(connectedAddress));
  const soleSignerRule =
    walletRules.find((rule) => rule.policyCount === 0 && rule.signerCount === 1) ?? null;
  const policyGatedRules = walletRules.filter((rule) => rule.policyCount > 0);
  const unanimousMultiSignerRules = walletRules.filter(
    (rule) => rule.policyCount === 0 && rule.signerCount > 1,
  );

  return {
    rules: walletRules,
    soleSignerRule,
    policyGatedRules,
    unanimousMultiSignerRules,
    blocked:
      walletRules.length > 0 && soleSignerRule === null && policyGatedRules.length === 0,
  };
}
