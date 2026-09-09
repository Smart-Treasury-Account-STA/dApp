import { describe, expect, it } from 'vitest'

import type { ContextRule } from '@/types'

import {
  isSelfRemoval,
  ruleRemovalBlock,
  signerRemovalBlock,
  validateAssetRuleDraft,
  validateContextRuleDraft,
  validateDestinationDraft,
  validateGuardianDraft,
  validateOperationDraft,
  validateSignerDraft,
  validateVersionBump,
} from './writeDrafts'

const SIGNER = 'GAK3XILRBYBMBOCZMSLL2CLR6WPQLEIOC6ZCYYPTE4OIAX3PCFFO2YMU'
const OTHER = 'GCWFJKLE45TMVZS42TMIYKAORKGBWE74753YPOSCC5ESJR2G2UMBXBDB'
const ASSET = 'CCOUVA654JH2V6B7LNTKHJP5DF3QA553RS2IIWXSGPDFH2N3QILIVU5L'

function rule(signerAddresses: string[]): ContextRule {
  return {
    id: 0,
    name: 'root',
    contextType: 'Default',
    signerCount: signerAddresses.length,
    signerAddresses,
    policyCount: 0,
  }
}

function ruleWithId(id: number): ContextRule {
  return {
    id,
    name: `rule-${id}`,
    contextType: 'Default',
    signerCount: 1,
    signerAddresses: [SIGNER],
    policyCount: 0,
  }
}

describe('validateSignerDraft', () => {
  it('accepts a valid account address', () => {
    expect(() => validateSignerDraft({ signerAddress: SIGNER })).not.toThrow()
  })

  it('rejects a malformed address', () => {
    expect(() =>
      validateSignerDraft({ signerAddress: 'not-an-address' })
    ).toThrow(/valid Stellar/i)
  })
})

describe('validateContextRuleDraft', () => {
  it('accepts a reasonable name and a valid signer address', () => {
    expect(() =>
      validateContextRuleDraft({ name: 'backup', signerAddress: SIGNER })
    ).not.toThrow()
  })

  it('rejects an empty name', () => {
    expect(() =>
      validateContextRuleDraft({ name: '', signerAddress: SIGNER })
    ).toThrow(/name/i)
  })

  it('rejects a name over 100 characters', () => {
    expect(() =>
      validateContextRuleDraft({ name: 'x'.repeat(101), signerAddress: SIGNER })
    ).toThrow(/name/i)
  })

  it('rejects an invalid signer address', () => {
    expect(() =>
      validateContextRuleDraft({
        name: 'backup',
        signerAddress: 'not-an-address',
      })
    ).toThrow(/signer/i)
  })
})

describe('validateGuardianDraft', () => {
  it('accepts a valid account address', () => {
    expect(() => validateGuardianDraft({ guardian: SIGNER })).not.toThrow()
  })

  it('rejects a malformed address', () => {
    expect(() => validateGuardianDraft({ guardian: 'not-an-address' })).toThrow(
      /valid Stellar/i
    )
  })
})

describe('validateAssetRuleDraft', () => {
  it('accepts an enabled rule with a positive cap', () => {
    expect(() =>
      validateAssetRuleDraft({
        asset: ASSET,
        enabled: true,
        maxSingleTransfer: '10',
      })
    ).not.toThrow()
  })

  it('rejects an enabled rule with a non-positive cap, which the contract also rejects', () => {
    expect(() =>
      validateAssetRuleDraft({
        asset: ASSET,
        enabled: true,
        maxSingleTransfer: '0',
      })
    ).toThrow(/positive/i)
  })

  it('allows a zero cap when the rule is being disabled', () => {
    expect(() =>
      validateAssetRuleDraft({
        asset: ASSET,
        enabled: false,
        maxSingleTransfer: '0',
      })
    ).not.toThrow()
  })
})

describe('validateDestinationDraft', () => {
  it('rejects a malformed destination', () => {
    expect(() =>
      validateDestinationDraft({ destination: 'nope', allowed: true })
    ).toThrow(/valid Stellar/i)
  })
})

describe('validateOperationDraft', () => {
  it('accepts a short symbol', () => {
    expect(() =>
      validateOperationDraft({ operation: 'transfer', allowed: true })
    ).not.toThrow()
  })

  it('rejects an operation longer than a Soroban symbol allows', () => {
    expect(() =>
      validateOperationDraft({ operation: 'a'.repeat(33), allowed: true })
    ).toThrow(/32 characters/i)
  })

  it('rejects characters Soroban symbols cannot carry', () => {
    expect(() =>
      validateOperationDraft({ operation: 'trans-fer', allowed: true })
    ).toThrow(/letters, digits/i)
  })
})

describe('validateVersionBump', () => {
  it('requires the next version to be strictly greater, as the contract does', () => {
    expect(() =>
      validateVersionBump({ currentVersion: 2, nextVersion: 2 })
    ).toThrow(/greater/i)
    expect(() =>
      validateVersionBump({ currentVersion: 2, nextVersion: 1 })
    ).toThrow(/greater/i)
    expect(() =>
      validateVersionBump({ currentVersion: 2, nextVersion: 3 })
    ).not.toThrow()
  })
})

describe('signerRemovalBlock', () => {
  it('blocks removing the only signer, which would brick the treasury', () => {
    expect(signerRemovalBlock(rule([SIGNER]), 0)).toMatch(/only signer/i)
  })

  it('permits removal when another signer remains', () => {
    expect(signerRemovalBlock(rule([SIGNER, OTHER]), 0)).toBeNull()
  })
})

describe('ruleRemovalBlock', () => {
  it('blocks removing the only context rule, which would brick the treasury', () => {
    expect(ruleRemovalBlock([ruleWithId(0)], 0)).toMatch(/only context rule/i)
  })

  it('permits removal when another rule remains', () => {
    expect(ruleRemovalBlock([ruleWithId(0), ruleWithId(1)], 0)).toBeNull()
  })

  it("rejects a rule id that isn't part of this treasury", () => {
    expect(ruleRemovalBlock([ruleWithId(0), ruleWithId(1)], 5)).toMatch(
      /not part/i
    )
  })
})

describe('isSelfRemoval', () => {
  it('detects that the operator is removing their own key', () => {
    expect(isSelfRemoval(rule([SIGNER, OTHER]), 0, SIGNER)).toBe(true)
    expect(isSelfRemoval(rule([SIGNER, OTHER]), 1, SIGNER)).toBe(false)
  })

  it('is false when no wallet is connected', () => {
    expect(isSelfRemoval(rule([SIGNER]), 0, null)).toBe(false)
  })
})
