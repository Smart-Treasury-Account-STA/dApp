import { describe, expect, it } from 'vitest'

import type { ContextRule } from '@/types'

import { computeWeakestRule, findAuthorizingPath } from './treasurySecurity'

const WALLET = 'GB2KHXT4RZBQFPLXK7IGVCUZDSVE6M6HL2AS4JZQ2GHJZ4XZQ7PIEQ4T'
const OTHER = 'GAK3XILRBYBMBOCZMSLL2CLR6WPQLEIOC6ZCYYPTE4OIAX3PCFFO2YMU'

function rule(overrides: Partial<ContextRule> & { id: number }): ContextRule {
  return {
    name: `rule-${overrides.id}`,
    contextType: 'Default',
    signerCount: 1,
    signerAddresses: ['GSIGNER'],
    policyCount: 0,
    ...overrides,
  }
}

describe('computeWeakestRule', () => {
  it('picks the no-policy rule requiring the fewest signers', () => {
    const rules = [
      rule({ id: 0, signerCount: 3, signerAddresses: ['A', 'B', 'C'] }),
      rule({ id: 1, signerCount: 1, signerAddresses: ['D'] }),
      rule({ id: 2, signerCount: 2, signerAddresses: ['E', 'F'] }),
    ]

    const summary = computeWeakestRule(rules)

    expect(summary.weakestUnanimousRule).toEqual({
      id: 1,
      name: 'rule-1',
      requiredSigners: 1,
    })
  })

  it('excludes policy-gated rules from the unanimous comparison and lists them separately', () => {
    const rules = [
      rule({ id: 0, signerCount: 3, signerAddresses: ['A', 'B', 'C'] }),
      rule({ id: 1, signerCount: 1, signerAddresses: ['D'], policyCount: 1 }),
    ]

    const summary = computeWeakestRule(rules)

    // Rule 1 has fewer signers but an unknown real threshold -- it must
    // not silently win the "weakest" comparison against a rule whose
    // requirement is exactly known.
    expect(summary.weakestUnanimousRule).toEqual({
      id: 0,
      name: 'rule-0',
      requiredSigners: 3,
    })
    expect(summary.policyGatedRuleIds).toEqual([1])
  })

  it('uses signerCount, not signerAddresses.length, so an unreadable signer set is not treated as zero signers', () => {
    const rules = [
      rule({
        id: 0,
        signerCount: 5,
        signerAddresses: ['A', 'B', 'C', 'D', 'E'],
      }),
      // Simulates a rule with a non-`G` (e.g. Signer::Delegated contract
      // address) signer that the best-effort regex scrape in stellarClient.ts
      // could not read -- signerAddresses is empty, but the rule genuinely
      // has 3 signers per signerCount, the contract-enforced source of truth.
      rule({ id: 1, signerCount: 3, signerAddresses: [] }),
    ]

    const summary = computeWeakestRule(rules)

    // Must report the real requirement (3), not 0 from the empty address list.
    expect(summary.weakestUnanimousRule).toEqual({
      id: 1,
      name: 'rule-1',
      requiredSigners: 3,
    })
  })

  it('returns null for weakestUnanimousRule when every rule is policy-gated', () => {
    const rules = [
      rule({ id: 0, policyCount: 1 }),
      rule({ id: 1, policyCount: 2 }),
    ]

    const summary = computeWeakestRule(rules)

    expect(summary.weakestUnanimousRule).toBeNull()
    expect(summary.policyGatedRuleIds).toEqual([0, 1])
  })

  it('returns null and no policy-gated rules for an empty rule set', () => {
    expect(computeWeakestRule([])).toEqual({
      weakestUnanimousRule: null,
      policyGatedRuleIds: [],
    })
  })
})

describe('findAuthorizingPath', () => {
  it('finds the rule this wallet can satisfy alone', () => {
    const rules = [
      rule({ id: 0, signerCount: 1, signerAddresses: [OTHER] }),
      rule({ id: 1, signerCount: 1, signerAddresses: [WALLET] }),
    ]

    const path = findAuthorizingPath(rules, WALLET)

    expect(path.soleSignerRule?.id).toBe(1)
    expect(path.rules.map((r) => r.id)).toEqual([1])
    expect(path.blocked).toBe(false)
  })

  it('reports no sole-signer rule when every rule this wallet is on needs co-signers', () => {
    // Exactly the testnet lockout: the wallet's only rule gained a second
    // signer, so the contract now requires both, and this dApp submits one.
    const rules = [
      rule({ id: 0, signerCount: 1, signerAddresses: [OTHER] }),
      rule({ id: 1, signerCount: 2, signerAddresses: [WALLET, OTHER] }),
    ]

    const path = findAuthorizingPath(rules, WALLET)

    expect(path.soleSignerRule).toBeNull()
    expect(path.unanimousMultiSignerRules.map((r) => r.id)).toEqual([1])
    expect(path.policyGatedRules).toEqual([])
    expect(path.blocked).toBe(true)
  })

  it('does not claim a rejection is certain when a policy could still accept one signature', () => {
    const rules = [
      rule({
        id: 0,
        signerCount: 3,
        signerAddresses: [WALLET],
        policyCount: 1,
      }),
    ]

    const path = findAuthorizingPath(rules, WALLET)

    expect(path.soleSignerRule).toBeNull()
    expect(path.policyGatedRules.map((r) => r.id)).toEqual([0])
    // A 1-of-3 threshold policy would make this succeed. The threshold is not
    // readable here, so this is uncertain, not blocked.
    expect(path.blocked).toBe(false)
  })

  it('stays silent when the wallet is on no readable rule at all', () => {
    // signerAddresses is a best-effort scrape that misses non-`G` signers, so
    // "not found" means unknown, never "this wallet cannot sign" -- claiming a
    // certain failure here would block a wallet that can in fact authorize.
    const rules = [rule({ id: 0, signerCount: 2, signerAddresses: [] })]

    const path = findAuthorizingPath(rules, WALLET)

    expect(path.rules).toEqual([])
    expect(path.soleSignerRule).toBeNull()
    expect(path.blocked).toBe(false)
  })

  it('stays silent with no connected address', () => {
    const path = findAuthorizingPath([rule({ id: 0 })], null)

    expect(path.rules).toEqual([])
    expect(path.blocked).toBe(false)
  })

  it('prefers a satisfiable rule over a blocking one when the wallet is on both', () => {
    const rules = [
      rule({ id: 0, signerCount: 2, signerAddresses: [WALLET, OTHER] }),
      rule({ id: 1, signerCount: 1, signerAddresses: [WALLET] }),
    ]

    const path = findAuthorizingPath(rules, WALLET)

    expect(path.soleSignerRule?.id).toBe(1)
    expect(path.blocked).toBe(false)
  })
})
