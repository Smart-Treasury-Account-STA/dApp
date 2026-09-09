import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import type { Database } from '@/lib/db'
import { treasuries } from '@/lib/db/schema'
import { createTestDatabase } from '@/lib/db/testing'
import {
  TreasuryConflictError,
  createTreasury,
  getTreasury,
  listTreasuries,
  listTreasuriesByOwner,
  toContractSet,
  validateCreateTreasuryInput,
} from '@/lib/treasuryRegistry/store'
import type { CreateTreasuryInput } from '@/lib/treasuryRegistry/types'

/**
 * These tests run against PGlite -- a real Postgres, in-process -- migrated
 * from the same files that migrate production.
 *
 * They used to run against a hand-written double that matched on SQL text.
 * That proved the store's logic but not its SQL, so the SQL was checked once
 * by hand against Neon and the check deleted, leaving CI blind to schema
 * drift. Only `getDb` is replaced here; every statement below is really
 * planned and executed by Postgres.
 */
const harness = vi.hoisted(() => ({ db: null as unknown as Database }))

vi.mock('@/lib/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/db')>()),
  getDb: () => harness.db,
}))

// StrKey validates a real base32 checksum, not just the leading character,
// so a synthetic "C" + padding string fails validation.
const CONTRACTS = {
  SMART: 'CD6GY4UUTNPW4TUV7LDL5SELN4BBHJG4KDDT3W6G23DY6XCGM75MULMQ',
  SMART2: 'CB4KZJ3I4XANE6GWPAMXCNXQ34PTQWPXVKFBBMLNKV25GAOXQC7RQUMS',
  A: 'CCOP7NRMST5K6TL7FBDMX25LDEPW3DSFBOGBIKVFIDNAAZY7GBMVP3M4',
  B: 'CAFIATSIZQSBILZJWVT4PVDXPVITJHLP6LPAVKDRHCA7I7XPZSLTRPUS',
  C: 'CCHC4YKVYS3CAZUOUYWYTEMQ6TZDW75WB2BGENUC2CDWDX5RH7NMKZWU',
  POLICY: 'CBRYGIR3ORDW5LE6J7AVPSKRNTMRUYHD6FVPHQMJGPQLQ5FQUZ2U6GFH',
  INTENT: 'CBQA7UI7QN6RN4IZT7WPDHWTK2OO7J4FH2KMCVJGKMKVFGDURD63UQ7U',
  RECOVERY: 'CAQQTRRYNXIQGFVNCTMTBJDXW3PN7O44KPT7GWCCE4FRKTOHDBCWGUZO',
  XFER: 'CC5FSUNWBNH3EIEELHO3A4ZPJZRAZCVMFNP3PVXO2YBWDNNLTFLWBVHC',
  SPLIT: 'CDHTNPBXUMPCKUJ76HQ767MDRD4IVRRH4H5DOF4JUOO36QKSV4GXFRMR',
  STA: 'CCOUVA654JH2V6B7LNTKHJP5DF3QA553RS2IIWXSGPDFH2N3QILIVU5L',
} as const

const ACCOUNTS = {
  OWNER: 'GCWFJKLE45TMVZS42TMIYKAORKGBWE74753YPOSCC5ESJR2G2UMBXBDB',
  OWNER1: 'GDU3LDGZOCJIB6MIKQWK5AICFFEWVC2FJ2BDEVXG37XXSKWIZ7OXVCAS',
  OWNER2: 'GDXVIRLSBDKT7EZM2RM3FH26W3TPF77IJ7GZBA5IOA6ZJBTW26NNO3AV',
  DIFFERENT: 'GAK3XILRBYBMBOCZMSLL2CLR6WPQLEIOC6ZCYYPTE4OIAX3PCFFO2YMU',
  NOBODY: 'GBR3Q5ZGBZC5IIUAWMNDXNMWWTISFRNVKCIOO5L7U44GOZJMOVR467VM',
  EXEC: 'GBFOESUTANPJZVQUZVKC5YCS4FB6AE5SX2R3JEDRK5JHKR22JXV4VNIV',
} as const

function input(
  overrides: Partial<CreateTreasuryInput> = {}
): CreateTreasuryInput {
  return {
    smartAccountId: CONTRACTS.SMART,
    policyEngineId: CONTRACTS.POLICY,
    intentRegistryId: CONTRACTS.INTENT,
    recoveryManagerId: CONTRACTS.RECOVERY,
    transferAdapterId: CONTRACTS.XFER,
    splitAdapterId: CONTRACTS.SPLIT,
    ownerAddress: ACCOUNTS.OWNER,
    executorAddress: ACCOUNTS.EXEC,
    deployTxHash: 'a'.repeat(64),
    ...overrides,
  }
}

let close: () => Promise<void>

beforeAll(async () => {
  const { db, client } = await createTestDatabase()
  harness.db = db
  close = () => client.close()
})

afterAll(async () => {
  await close()
})

beforeEach(async () => {
  await harness.db.delete(treasuries)
})

describe('validateCreateTreasuryInput', () => {
  it('accepts a well formed input', () => {
    expect(() => validateCreateTreasuryInput(input())).not.toThrow()
  })

  it('rejects a malformed contract id', () => {
    expect(() =>
      validateCreateTreasuryInput(input({ smartAccountId: 'not-a-contract' }))
    ).toThrow(/smartAccountId/)
  })

  it('rejects a malformed owner address', () => {
    expect(() =>
      validateCreateTreasuryInput(input({ ownerAddress: 'not-an-account' }))
    ).toThrow(/ownerAddress/)
  })

  it('rejects a malformed deploy tx hash', () => {
    expect(() =>
      validateCreateTreasuryInput(input({ deployTxHash: 'short' }))
    ).toThrow(/deployTxHash/)
  })
})

describe('createTreasury', () => {
  it('persists a new record and returns it', async () => {
    const record = await createTreasury(input())
    expect(record.smartAccountId).toBe(CONTRACTS.SMART)
    expect(record.createdAt).toBeTruthy()

    const stored = await getTreasury(CONTRACTS.SMART)
    expect(stored).toEqual(record)
  })

  it('exposes createdAt as an ISO string, not the Date the driver returns', async () => {
    const record = await createTreasury(input())
    expect(typeof record.createdAt).toBe('string')
    expect(new Date(record.createdAt).toISOString()).toBe(record.createdAt)
  })

  it('is idempotent by smartAccountId — an identical second create returns the original record unchanged', async () => {
    const first = await createTreasury(input())
    const second = await createTreasury(input())

    expect(second).toEqual(first)
    const all = await listTreasuries()
    expect(all).toHaveLength(1)
  })

  it('rejects a second claim for an already-registered smartAccountId whose fields disagree with the stored record', async () => {
    // A silent idempotent-return here would let a fabricated second claim win
    // a race against the legitimate deployer's own registration and stick
    // around undetected -- this must reject loudly instead.
    await createTreasury(input())
    await expect(
      createTreasury(input({ ownerAddress: ACCOUNTS.DIFFERENT }))
    ).rejects.toThrow(TreasuryConflictError)

    const stored = await getTreasury(CONTRACTS.SMART)
    expect(stored?.ownerAddress).toBe(ACCOUNTS.OWNER)
  })

  it('lets the primary key, not the application, pick the winner of a concurrent registration', async () => {
    // Both calls are in flight before either completes, which is the shape
    // two serverless instances produce. Exactly one row may exist afterwards.
    const results = await Promise.allSettled([
      createTreasury(input()),
      createTreasury(input()),
    ])

    expect(results.every((result) => result.status === 'fulfilled')).toBe(true)
    expect(await listTreasuries()).toHaveLength(1)
  })

  it('does not collide across two different treasuries', async () => {
    await createTreasury(input())
    await createTreasury(input({ smartAccountId: CONTRACTS.SMART2 }))

    const all = await listTreasuries()
    expect(all).toHaveLength(2)
  })
})

describe('listTreasuriesByOwner', () => {
  it('returns only treasuries owned by the given address', async () => {
    await createTreasury(
      input({ smartAccountId: CONTRACTS.A, ownerAddress: ACCOUNTS.OWNER1 })
    )
    await createTreasury(
      input({ smartAccountId: CONTRACTS.B, ownerAddress: ACCOUNTS.OWNER2 })
    )
    await createTreasury(
      input({ smartAccountId: CONTRACTS.C, ownerAddress: ACCOUNTS.OWNER1 })
    )

    const owner1Treasuries = await listTreasuriesByOwner(ACCOUNTS.OWNER1)
    expect(owner1Treasuries.map((t) => t.smartAccountId).sort()).toEqual(
      [CONTRACTS.A, CONTRACTS.C].sort()
    )
  })

  it('returns an empty list for an owner with no treasuries', async () => {
    await createTreasury(input())
    expect(await listTreasuriesByOwner(ACCOUNTS.NOBODY)).toEqual([])
  })
})

describe('toContractSet', () => {
  it("maps a record's *Id fields to ContractSet's field names, and takes staAsset separately", async () => {
    const record = await createTreasury(input())
    const contracts = toContractSet(record, CONTRACTS.STA)

    expect(contracts).toEqual({
      smartAccount: record.smartAccountId,
      policyEngine: record.policyEngineId,
      intentRegistry: record.intentRegistryId,
      recoveryManager: record.recoveryManagerId,
      transferAdapter: record.transferAdapterId,
      splitAdapter: record.splitAdapterId,
      staAsset: CONTRACTS.STA,
    })
  })
})
