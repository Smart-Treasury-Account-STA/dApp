import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { TreasuryRecord } from '@/lib/treasuryRegistry/types'
import { verifyTreasuryRegistration } from '@/lib/treasuryRegistry/verify'

const loadSmartAccountLinksMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/stellarClient', () => ({
  loadSmartAccountLinks: loadSmartAccountLinksMock,
}))

const SMART_ACCOUNT_ID =
  'CD6GY4UUTNPW4TUV7LDL5SELN4BBHJG4KDDT3W6G23DY6XCGM75MULMQ'
const OWNER = 'GCWFJKLE45TMVZS42TMIYKAORKGBWE74753YPOSCC5ESJR2G2UMBXBDB'
const SOMEONE_ELSE = 'GDU3LDGZOCJIB6MIKQWK5AICFFEWVC2FJ2BDEVXG37XXSKWIZ7OXVCAS'
const IMPOSTOR = 'CB4KZJ3I4XANE6GWPAMXCNXQ34PTQWPXVKFBBMLNKV25GAOXQC7RQUMS'

const ONCHAIN = {
  policyEngine: 'CCOP7NRMST5K6TL7FBDMX25LDEPW3DSFBOGBIKVFIDNAAZY7GBMVP3M4',
  intentRegistry: 'CAFIATSIZQSBILZJWVT4PVDXPVITJHLP6LPAVKDRHCA7I7XPZSLTRPUS',
  recoveryManager: 'CCHC4YKVYS3CAZUOUYWYTEMQ6TZDW75WB2BGENUC2CDWDX5RH7NMKZWU',
  transferAdapter: 'CBRYGIR3ORDW5LE6J7AVPSKRNTMRUYHD6FVPHQMJGPQLQ5FQUZ2U6GFH',
  splitAdapter: 'CBQA7UI7QN6RN4IZT7WPDHWTK2OO7J4FH2KMCVJGKMKVFGDURD63UQ7U',
} as const

/** What the smart_account's instance storage actually says. */
function links(overrides: Record<string, string | null> = {}) {
  return { owner: OWNER, ...ONCHAIN, ...overrides }
}

/** What a caller claims. Matches the chain unless a test says otherwise. */
function record(overrides: Partial<TreasuryRecord> = {}): TreasuryRecord {
  return {
    smartAccountId: SMART_ACCOUNT_ID,
    policyEngineId: ONCHAIN.policyEngine,
    intentRegistryId: ONCHAIN.intentRegistry,
    recoveryManagerId: ONCHAIN.recoveryManager,
    transferAdapterId: ONCHAIN.transferAdapter,
    splitAdapterId: ONCHAIN.splitAdapter,
    ownerAddress: OWNER,
    executorAddress: 'GBFOESUTANPJZVQUZVKC5YCS4FB6AE5SX2R3JEDRK5JHKR22JXV4VNIV',
    deployTxHash: 'a'.repeat(64),
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

beforeEach(() => {
  loadSmartAccountLinksMock.mockReset()
})

describe('verifyTreasuryRegistration', () => {
  it("resolves when every claimed address matches the smart account's instance storage", async () => {
    loadSmartAccountLinksMock.mockResolvedValue(links())
    await expect(verifyTreasuryRegistration(record())).resolves.toBeUndefined()
    expect(loadSmartAccountLinksMock).toHaveBeenCalledWith(SMART_ACCOUNT_ID)
  })

  it('throws when the on-chain owner does not match the claimed owner', async () => {
    loadSmartAccountLinksMock.mockResolvedValue(links({ owner: SOMEONE_ELSE }))
    await expect(verifyTreasuryRegistration(record())).rejects.toThrow(
      /could not be verified/i
    )
  })

  it('throws when there is no contract instance at the claimed address', async () => {
    loadSmartAccountLinksMock.mockResolvedValue(null)
    await expect(verifyTreasuryRegistration(record())).rejects.toThrow(
      /no contract instance exists/i
    )
  })

  // The attack this verification exists to stop: a deploy transaction is
  // public, so a real owner and smart_account address are knowable by anyone
  // watching the ledger. Passing the owner check while substituting a
  // contract the dApp will later *call* must not be enough.
  it.each([
    ['policy engine', { policyEngineId: IMPOSTOR }],
    ['intent registry', { intentRegistryId: IMPOSTOR }],
    ['recovery manager', { recoveryManagerId: IMPOSTOR }],
    ['transfer adapter', { transferAdapterId: IMPOSTOR }],
    ['split adapter', { splitAdapterId: IMPOSTOR }],
  ])(
    'rejects a claim with a fabricated %s even when the owner is genuine',
    async (label, claim) => {
      loadSmartAccountLinksMock.mockResolvedValue(links())

      const failure = verifyTreasuryRegistration(record(claim))

      await expect(failure).rejects.toThrow(/could not be verified/i)
      await expect(failure).rejects.toThrow(new RegExp(label, 'i'))
    }
  )

  it('treats an absent on-chain address as a mismatch rather than a match', async () => {
    // A contract that is not a smart_account, or one whose storage layout
    // changed, reads back as `null` -- which must never satisfy a claim.
    loadSmartAccountLinksMock.mockResolvedValue(links({ policyEngine: null }))
    await expect(verifyTreasuryRegistration(record())).rejects.toThrow(
      /policy engine is unset/i
    )
  })

  it('reports every mismatching field at once, not just the first', async () => {
    loadSmartAccountLinksMock.mockResolvedValue(links())

    const failure = verifyTreasuryRegistration(
      record({ policyEngineId: IMPOSTOR, splitAdapterId: IMPOSTOR })
    )

    await expect(failure).rejects.toThrow(/policy engine/i)
    await expect(failure).rejects.toThrow(/split adapter/i)
  })

  it('ignores executorAddress and deployTxHash, which the chain cannot confirm here', async () => {
    // Neither is an address this dApp calls: the executor lives in the intent
    // registry's storage, and the deploy tx hash leaves the RPC's history
    // after about a week. Documented as out of scope, so a claim that differs
    // on them still passes.
    loadSmartAccountLinksMock.mockResolvedValue(links())
    await expect(
      verifyTreasuryRegistration(
        record({ executorAddress: SOMEONE_ELSE, deployTxHash: 'b'.repeat(64) })
      )
    ).resolves.toBeUndefined()
  })
})
