import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ContextRule } from '@/types'

const SMART = 'CD6GY4UUTNPW4TUV7LDL5SELN4BBHJG4KDDT3W6G23DY6XCGM75MULMQ'
const ADAPTER = 'CBRYGIR3ORDW5LE6J7AVPSKRNTMRUYHD6FVPHQMJGPQLQ5FQUZ2U6GFH'
const OWNER = 'GCWFJKLE45TMVZS42TMIYKAORKGBWE74753YPOSCC5ESJR2G2UMBXBDB'
const CO_SIGNER = 'GDU3LDGZOCJIB6MIKQWK5AICFFEWVC2FJ2BDEVXG37XXSKWIZ7OXVCAS'
const STRANGER = 'GAK3XILRBYBMBOCZMSLL2CLR6WPQLEIOC6ZCYYPTE4OIAX3PCFFO2YMU'

const loadContextRulesMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/stellarClient', () => ({
  loadContextRules: loadContextRulesMock,
}))
vi.mock('@/config', () => ({
  STELLAR_CONFIG: {
    defaultDestination: STRANGER,
    contracts: { smartAccount: SMART },
  },
}))

const { loadTreasurySigners } = await import('@/lib/auth/treasuryAccess')

function rule(overrides: Partial<ContextRule>): ContextRule {
  return {
    id: 0,
    name: 'root',
    contextType: 'Default',
    signerCount: 1,
    signerAddresses: [OWNER],
    policyCount: 0,
    ...overrides,
  }
}

const contracts = { smartAccount: SMART } as never

beforeEach(() => {
  vi.clearAllMocks()
})

describe('loadTreasurySigners', () => {
  it('collects the signers of a Default rule', async () => {
    loadContextRulesMock.mockResolvedValue([
      rule({ signerAddresses: [OWNER, CO_SIGNER] }),
    ])
    const signers = await loadTreasurySigners(contracts)
    expect([...signers].sort()).toEqual([OWNER, CO_SIGNER].sort())
  })

  it('counts a rule scoped to this smart_account', async () => {
    loadContextRulesMock.mockResolvedValue([
      rule({
        id: 1,
        contextType: `CallContract,${SMART}`,
        signerAddresses: [CO_SIGNER],
      }),
    ])
    expect((await loadTreasurySigners(contracts)).has(CO_SIGNER)).toBe(true)
  })

  it('skips a rule scoped to some other contract', async () => {
    // A signer on the transfer adapter's rule cannot authorize
    // create_scheduled_payment, so they cannot queue one either.
    loadContextRulesMock.mockResolvedValue([
      rule({
        id: 1,
        contextType: `CallContract,${ADAPTER}`,
        signerAddresses: [STRANGER],
      }),
    ])
    expect((await loadTreasurySigners(contracts)).has(STRANGER)).toBe(false)
  })

  it('skips an expired rule', async () => {
    loadContextRulesMock.mockResolvedValue([
      rule({ signerAddresses: [CO_SIGNER], validUntil: 1_000 }),
    ])
    expect((await loadTreasurySigners(contracts, 2_000)).size).toBe(0)
  })

  it('keeps a rule that has not expired yet', async () => {
    loadContextRulesMock.mockResolvedValue([
      rule({ signerAddresses: [CO_SIGNER], validUntil: 5_000 }),
    ])
    expect((await loadTreasurySigners(contracts, 2_000)).has(CO_SIGNER)).toBe(
      true
    )
  })

  it('returns an empty set rather than everyone when there are no rules', async () => {
    loadContextRulesMock.mockResolvedValue([])
    expect((await loadTreasurySigners(contracts)).size).toBe(0)
  })
})
