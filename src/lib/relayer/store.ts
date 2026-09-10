import { StrKey } from '@stellar/stellar-sdk'
import { and, desc, eq, sql } from 'drizzle-orm'

import { getDb, toIsoString } from '@/lib/db'
import { relayerJobs } from '@/lib/db/schema'
import type {
  CreateRelayerJobInput,
  RelayerJobRecord,
} from '@/lib/relayer/types'

const INTENT_ID_PATTERN = /^(0x)?[0-9a-fA-F]{64}$/

/** How many times `updateRelayerJob` retries a lost optimistic-version race
 * before giving up. Each retry re-reads and re-applies the caller's mutation,
 * so a retry is only needed when another writer committed in between; more
 * than a couple of those in a row means real contention, not a hiccup. */
const UPDATE_RETRIES = 5

type RelayerJobRow = typeof relayerJobs.$inferSelect

function toRecord(row: RelayerJobRow): RelayerJobRecord {
  const { createdAt, updatedAt, txHash, version: _version, ...rest } = row
  return {
    ...rest,
    // `txHash` is optional on the record, and was simply absent from the JSON
    // before there was a database -- a NULL column must stay absent, not
    // become `undefined`-valued or `null`, so the API JSON is byte-identical.
    ...(txHash === null ? {} : { txHash }),
    createdAt: toIsoString(createdAt),
    updatedAt: toIsoString(updatedAt),
  }
}

function normalizeIntentId(intentId: string) {
  return intentId.replace(/^0x/i, '').toLowerCase()
}

// A job's real identity is (smartAccountId, intentId), not intentId alone
// -- two different treasuries could otherwise pick colliding random intent
// ids, which a single-key model would silently merge.
function jobKey(smartAccountId: string, intentId: string) {
  return `${smartAccountId}:${normalizeIntentId(intentId)}`
}

/** The composite primary key, as a reusable predicate. */
function jobMatches(smartAccountId: string, normalizedIntentId: string) {
  return and(
    eq(relayerJobs.smartAccountId, smartAccountId),
    eq(relayerJobs.intentId, normalizedIntentId)
  )
}

function assertSafeInteger(name: string, value: number) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer.`)
  }
}

export function validateRelayerJobInput(input: CreateRelayerJobInput) {
  if (!StrKey.isValidContract(input.smartAccountId)) {
    throw new Error(
      'smartAccountId must be a Stellar contract id starting with C.'
    )
  }
  if (!INTENT_ID_PATTERN.test(input.intentId)) {
    throw new Error('Intent ID must be 32 bytes encoded as 64 hex characters.')
  }

  assertSafeInteger('startLedger', input.startLedger)
  assertSafeInteger('endLedger', input.endLedger)
  assertSafeInteger('maxExecutions', input.maxExecutions)

  if (input.maxExecutions < 1) {
    throw new Error('maxExecutions must be at least 1.')
  }
  if (input.startLedger >= input.endLedger) {
    throw new Error('startLedger must be lower than endLedger.')
  }
}

export async function listRelayerJobs() {
  const rows = await getDb()
    .select()
    .from(relayerJobs)
    .orderBy(desc(relayerJobs.updatedAt))
  return rows.map(toRecord)
}

export async function listRelayerJobsForTreasury(smartAccountId: string) {
  const rows = await getDb()
    .select()
    .from(relayerJobs)
    .where(eq(relayerJobs.smartAccountId, smartAccountId))
    .orderBy(desc(relayerJobs.updatedAt))
  return rows.map(toRecord)
}

export async function getRelayerJob(smartAccountId: string, intentId: string) {
  const rows = await getDb()
    .select()
    .from(relayerJobs)
    .where(jobMatches(smartAccountId, normalizeIntentId(intentId)))
  return rows.length > 0 ? toRecord(rows[0]) : null
}

export async function createRelayerJob(input: CreateRelayerJobInput) {
  validateRelayerJobInput(input)

  // Idempotent by (smartAccountId, intentId), as before -- the composite
  // primary key now enforces it, so a duplicate POST cannot create a second
  // job even from two instances at once.
  const inserted = await getDb()
    .insert(relayerJobs)
    .values({
      smartAccountId: input.smartAccountId,
      intentId: normalizeIntentId(input.intentId),
      childSequence: 1,
      startLedger: input.startLedger,
      endLedger: input.endLedger,
      maxExecutions: input.maxExecutions,
      executionCount: 0,
      status: 'scheduled',
      note: 'Queued for executor-gated scheduled payment execution.',
      txHash: null,
    })
    .onConflictDoNothing({
      target: [relayerJobs.smartAccountId, relayerJobs.intentId],
    })
    .returning()

  if (inserted.length > 0) {
    return toRecord(inserted[0])
  }

  const existing = await getRelayerJob(input.smartAccountId, input.intentId)
  if (!existing) {
    throw new Error(
      `Relayer job ${jobKey(input.smartAccountId, input.intentId)} could not be created or read back.`
    )
  }
  return existing
}

/**
 * Applies `update` to a job and persists the result.
 *
 * The read-modify-write is guarded by an optimistic `version` column rather
 * than a per-process write queue. That queue only ever serialized writers
 * inside one Node process; two relayer runs on two serverless instances could
 * both read `executionCount: 0` and both write `1`, losing an execution. Here
 * the UPDATE matches on the version it read, so a writer that was overtaken
 * updates no row, re-reads, and re-applies its mutation to the winner's state.
 *
 * `update` must therefore be free of side effects: it can run more than once.
 * Every current caller (`relayer/executor.ts`) is a pure object spread.
 */
export async function updateRelayerJob(
  smartAccountId: string,
  intentId: string,
  update: (job: RelayerJobRecord) => RelayerJobRecord
) {
  const { job } = await tryUpdateRelayerJob(smartAccountId, intentId, update)
  return job
}

/**
 * `updateRelayerJob`, except that `update` may decline by returning `null`:
 * nothing is written, and the job comes back as the store holds it.
 *
 * The decision is made on the state the write would replace, re-read on
 * every lost version race, so a condition checked here holds at the moment
 * of the write. That is what makes it a claim: of two runs that both read a
 * job as `scheduled` and both try to mark it `executing`, the second re-reads
 * the first one's `executing` and declines. A condition checked on a copy
 * read earlier would let both through.
 */
export async function tryUpdateRelayerJob(
  smartAccountId: string,
  intentId: string,
  update: (job: RelayerJobRecord) => RelayerJobRecord | null
): Promise<{ job: RelayerJobRecord; applied: boolean }> {
  const normalizedIntentId = normalizeIntentId(intentId)

  for (let attempt = 0; attempt < UPDATE_RETRIES; attempt += 1) {
    const current = await getDb()
      .select()
      .from(relayerJobs)
      .where(jobMatches(smartAccountId, normalizedIntentId))
    if (current.length === 0) {
      throw new Error('Relayer job not found.')
    }

    // The stored `updatedAt`, not a fresh one: a condition may be about how
    // long the job has sat in its state (the executing lease). The write
    // stamps its own `now()` regardless.
    const updated = update(toRecord(current[0]))
    if (updated === null) {
      return { job: toRecord(current[0]), applied: false }
    }

    const written = await getDb()
      .update(relayerJobs)
      .set({
        childSequence: updated.childSequence,
        startLedger: updated.startLedger,
        endLedger: updated.endLedger,
        maxExecutions: updated.maxExecutions,
        executionCount: updated.executionCount,
        status: updated.status,
        note: updated.note,
        txHash: updated.txHash ?? null,
        updatedAt: sql`now()`,
        version: sql`${relayerJobs.version} + 1`,
      })
      .where(
        and(
          jobMatches(smartAccountId, normalizedIntentId),
          eq(relayerJobs.version, current[0].version)
        )
      )
      .returning()

    if (written.length > 0) {
      return { job: toRecord(written[0]), applied: true }
    }
  }

  throw new Error(
    `Relayer job ${jobKey(smartAccountId, intentId)} was modified concurrently ${UPDATE_RETRIES} times running; giving up rather than looping.`
  )
}
