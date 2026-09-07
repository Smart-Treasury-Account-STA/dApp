import { describe, expect, it } from "vitest";

import { computeWeakestRule } from "./treasurySecurity";
import type { ContextRule } from "@/types";

function rule(overrides: Partial<ContextRule> & { id: number }): ContextRule {
  return {
    name: `rule-${overrides.id}`,
    contextType: "Default",
    signerCount: 1,
    signerAddresses: ["GSIGNER"],
    policyCount: 0,
    ...overrides,
  };
}

describe("computeWeakestRule", () => {
  it("picks the no-policy rule requiring the fewest signers", () => {
    const rules = [
      rule({ id: 0, signerCount: 3, signerAddresses: ["A", "B", "C"] }),
      rule({ id: 1, signerCount: 1, signerAddresses: ["D"] }),
      rule({ id: 2, signerCount: 2, signerAddresses: ["E", "F"] }),
    ];

    const summary = computeWeakestRule(rules);

    expect(summary.weakestUnanimousRule).toEqual({ id: 1, name: "rule-1", requiredSigners: 1 });
  });

  it("excludes policy-gated rules from the unanimous comparison and lists them separately", () => {
    const rules = [
      rule({ id: 0, signerCount: 3, signerAddresses: ["A", "B", "C"] }),
      rule({ id: 1, signerCount: 1, signerAddresses: ["D"], policyCount: 1 }),
    ];

    const summary = computeWeakestRule(rules);

    // Rule 1 has fewer signers but an unknown real threshold -- it must
    // not silently win the "weakest" comparison against a rule whose
    // requirement is exactly known.
    expect(summary.weakestUnanimousRule).toEqual({ id: 0, name: "rule-0", requiredSigners: 3 });
    expect(summary.policyGatedRuleIds).toEqual([1]);
  });

  it("uses signerCount, not signerAddresses.length, so an unreadable signer set is not treated as zero signers", () => {
    const rules = [
      rule({ id: 0, signerCount: 5, signerAddresses: ["A", "B", "C", "D", "E"] }),
      // Simulates a rule with a non-`G` (e.g. Signer::Delegated contract
      // address) signer that the best-effort regex scrape in stellarClient.ts
      // could not read -- signerAddresses is empty, but the rule genuinely
      // has 3 signers per signerCount, the contract-enforced source of truth.
      rule({ id: 1, signerCount: 3, signerAddresses: [] }),
    ];

    const summary = computeWeakestRule(rules);

    // Must report the real requirement (3), not 0 from the empty address list.
    expect(summary.weakestUnanimousRule).toEqual({ id: 1, name: "rule-1", requiredSigners: 3 });
  });

  it("returns null for weakestUnanimousRule when every rule is policy-gated", () => {
    const rules = [rule({ id: 0, policyCount: 1 }), rule({ id: 1, policyCount: 2 })];

    const summary = computeWeakestRule(rules);

    expect(summary.weakestUnanimousRule).toBeNull();
    expect(summary.policyGatedRuleIds).toEqual([0, 1]);
  });

  it("returns null and no policy-gated rules for an empty rule set", () => {
    expect(computeWeakestRule([])).toEqual({
      weakestUnanimousRule: null,
      policyGatedRuleIds: [],
    });
  });
});
