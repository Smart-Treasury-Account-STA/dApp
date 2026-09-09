import { StrKey } from '@stellar/stellar-sdk'
import { desc, eq } from 'drizzle-orm'

import { getDb, toIsoString } from '@/lib/db'
import { treasuries } from '@/lib/db/schema'
import type {
  CreateTreasuryInput,
  TreasuryRecord,
} from '@/lib/treasuryRegistry/types'

export { toContractSet } from '@/lib/treasuryRegistry/types'

const TX_HASH_PATTERN = /^[0-9a-fA-F]{64}$/

type TreasuryRow = typeof treasuries.$inferSelect

/** The row is already camelCase through Drizzle; only `createdAt` needs
 * converting, because the API has exposed ISO strings since before there was
 * a database. */
function toRecord(row: TreasuryRow): TreasuryRecord {
  const { createdAt, ...rest } = row
  return { ...rest, createdAt: toIsoString(createdAt) }
}

export function validateCreateTreasuryInput(input: CreateTreasuryInput) {
  const contractFields: Array<[string, string]> = [
    ['smartAccountId', input.smartAccountId],
    ['policyEngineId', input.policyEngineId],
    ['intentRegistryId', input.intentRegistryId],
    ['recoveryManagerId', input.recoveryManagerId],
    ['transferAdapterId', input.transferAdapterId],
    ['splitAdapterId', input.splitAdapterId],
  ]
  for (const [label, value] of contractFields) {
    if (!StrKey.isValidContract(value)) {
      throw new Error(`${label} must be a Stellar contract id starting with C.`)
    }
  }

  const addressFields: Array<[string, string]> = [
    ['ownerAddress', input.ownerAddress],
    ['executorAddress', input.executorAddress],
  ]
  for (const [label, value] of addressFields) {
    if (!StrKey.isValidEd25519PublicKey(value)) {
      throw new Error(`${label} must be a Stellar account id starting with G.`)
    }
  }

  if (!TX_HASH_PATTERN.test(input.deployTxHash)) {
    throw new Error('deployTxHash must be a 64-character hex transaction hash.')
  }
}

export async function listTreasuries() {
  const rows = await getDb()
    .select()
    .from(treasuries)
    .orderBy(desc(treasuries.createdAt))
  return rows.map(toRecord)
}

export async function listTreasuriesByOwner(ownerAddress: string) {
  const rows = await getDb()
    .select()
    .from(treasuries)
    .where(eq(treasuries.ownerAddress, ownerAddress))
    .orderBy(desc(treasuries.createdAt))
  return rows.map(toRecord)
}

export async function getTreasury(smartAccountId: string) {
  const rows = await getDb()
    .select()
    .from(treasuries)
    .where(eq(treasuries.smartAccountId, smartAccountId))
  return rows.length > 0 ? toRecord(rows[0]) : null
}

/**
 * Thrown when a second registration attempt for an already-registered
 * `smartAccountId` disagrees with the stored record on any field.
 *
 * This is a consistency check, no longer a security boundary.
 * `verifyTreasuryRegistration` (the endpoint's access control) now compares
 * every claimed address against the smart_account's own instance storage
 * before a row is ever written, so a fabricated sub-contract set is rejected
 * there rather than having to be out-raced here. Earlier revisions could not:
 * they checked only `get_owner()`, and a deploy transaction is public, so
 * anyone could pass that check while supplying invented sub-contracts.
 *
 * It still earns its place. Two claims can disagree without either being
 * fabricated -- a treasury re-wired between registrations, say -- and
 * silently returning the first-registered record (the ordinary
 * idempotent-create pattern used elsewhere in this codebase, e.g.
 * relayer/store.ts) would hide that the stored contract set no longer
 * matches the chain. Rejecting the disagreement makes it visible.
 */
export class TreasuryConflictError extends Error {
  constructor(smartAccountId: string) {
    super(
      `A treasury is already registered for ${smartAccountId} with different contract addresses than this request claims.`
    )
    this.name = 'TreasuryConflictError'
  }
}

function recordsMatch(a: TreasuryRecord, b: CreateTreasuryInput): boolean {
  return (
    a.policyEngineId === b.policyEngineId &&
    a.intentRegistryId === b.intentRegistryId &&
    a.recoveryManagerId === b.recoveryManagerId &&
    a.transferAdapterId === b.transferAdapterId &&
    a.splitAdapterId === b.splitAdapterId &&
    a.ownerAddress === b.ownerAddress &&
    a.executorAddress === b.executorAddress &&
    // A given smart_account address only ever gets deployed once (its
    // address is deterministic from caller+salt, and a second
    // deploy_account targeting the same derived address fails on-chain) --
    // any legitimate re-registration of the same treasury carries the same
    // deployTxHash every time, so a mismatch here is as much a signal of a
    // fabricated claim as the fields above.
    a.deployTxHash === b.deployTxHash
  )
}

export async function createTreasury(input: CreateTreasuryInput) {
  validateCreateTreasuryInput(input)

  // `onConflictDoNothing` is what closes the registration race the class doc
  // above describes: the primary key decides a single winner inside one
  // statement, so a fabricated claim and the legitimate deployer's own call
  // can no longer both believe they wrote the row. An empty result means this
  // caller lost -- read the winner and let `recordsMatch` decide whether that
  // is an ordinary idempotent retry or a genuine disagreement.
  const inserted = await getDb()
    .insert(treasuries)
    .values(input)
    .onConflictDoNothing({ target: treasuries.smartAccountId })
    .returning()

  if (inserted.length > 0) {
    return toRecord(inserted[0])
  }

  const existing = await getTreasury(input.smartAccountId)
  if (!existing) {
    // The row existed for the INSERT and is gone for this SELECT: only a
    // concurrent delete does that, and nothing in this app deletes treasuries.
    throw new Error(
      `Treasury ${input.smartAccountId} could not be registered or read back.`
    )
  }
  if (!recordsMatch(existing, input)) {
    throw new TreasuryConflictError(input.smartAccountId)
  }
  return existing
}
