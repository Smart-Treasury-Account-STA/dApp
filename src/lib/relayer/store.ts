import { StrKey } from '@stellar/stellar-sdk'

import { query, toIsoString } from '@/lib/db'
import type {
  CreateRelayerJobInput,
  RelayerJobRecord,
} from '@/lib/relayer/types'

const INTENT_ID_PATTERN = /^(0x)?[0-9a-fA-F]{64}$/

const COLUMNS = `smart_account_id, intent_id, child_sequence, start_ledger, end_ledger,
    max_executions, execution_count, status, note, tx_hash, created_at, updated_at`

/** How many times `updateRelayerJob` retries a lost optimistic-version race
 * before giving up. Each retry re-reads and re-applies the caller's mutation,
 * so a retry is only needed when another writer committed in between; more
 * than a couple of those in a row means real contention, not a hiccup. */
const UPDATE_RETRIES = 5

type RelayerJobRow = {
  smart_account_id: string
  intent_id: string
  child_sequence: number
  start_ledger: number
  end_ledger: number
  max_executions: number
  execution_count: number
  status: RelayerJobRecord['status']
  note: string
  tx_hash: string | null
  created_at: unknown
  updated_at: unknown
}

function toRecord(row: RelayerJobRow): RelayerJobRecord {
  return {
    smartAccountId: row.smart_account_id,
    intentId: row.intent_id,
    childSequence: row.child_sequence,
    startLedger: row.start_ledger,
    endLedger: row.end_ledger,
    maxExecutions: row.max_executions,
    executionCount: row.execution_count,
    status: row.status,
    note: row.note,
    // `txHash` is optional on the record, and was simply absent from the JSON
    // before there was a database -- a NULL column must stay absent, not
    // become `undefined`-valued or `null`, so the API JSON is byte-identical.
    ...(row.tx_hash === null ? {} : { txHash: row.tx_hash }),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
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
  const rows = await query<RelayerJobRow>(
    `SELECT ${COLUMNS} FROM relayer_jobs ORDER BY updated_at DESC`
  )
  return rows.map(toRecord)
}

export async function listRelayerJobsForTreasury(smartAccountId: string) {
  const rows = await query<RelayerJobRow>(
    `SELECT ${COLUMNS} FROM relayer_jobs WHERE smart_account_id = $1 ORDER BY updated_at DESC`,
    [smartAccountId]
  )
  return rows.map(toRecord)
}

export async function getRelayerJob(smartAccountId: string, intentId: string) {
  const rows = await query<RelayerJobRow>(
    `SELECT ${COLUMNS} FROM relayer_jobs WHERE smart_account_id = $1 AND intent_id = $2`,
    [smartAccountId, normalizeIntentId(intentId)]
  )
  return rows.length > 0 ? toRecord(rows[0]) : null
}

export async function createRelayerJob(input: CreateRelayerJobInput) {
  validateRelayerJobInput(input)

  // Idempotent by (smartAccountId, intentId), as before -- the composite
  // primary key now enforces it, so a duplicate POST cannot create a second
  // job even from two instances at once.
  const inserted = await query<RelayerJobRow>(
    `INSERT INTO relayer_jobs (${COLUMNS})
     VALUES ($1, $2, 1, $3, $4, $5, 0, 'scheduled', $6, NULL, now(), now())
     ON CONFLICT (smart_account_id, intent_id) DO NOTHING
     RETURNING ${COLUMNS}`,
    [
      input.smartAccountId,
      normalizeIntentId(input.intentId),
      input.startLedger,
      input.endLedger,
      input.maxExecutions,
      'Queued for executor-gated scheduled payment execution.',
    ]
  )

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
 * The callback signature is unchanged, but the read-modify-write underneath it
 * is now guarded by an optimistic `version` column rather than a per-process
 * write queue. That queue only ever serialized writers inside one Node
 * process; two relayer runs on two serverless instances could both read
 * `executionCount: 0` and both write `1`, losing an execution. Here the
 * `UPDATE` matches on the version it read, so a writer that was overtaken
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
  const normalizedIntentId = normalizeIntentId(intentId)

  for (let attempt = 0; attempt < UPDATE_RETRIES; attempt += 1) {
    const current = await query<RelayerJobRow & { version: number }>(
      `SELECT ${COLUMNS}, version FROM relayer_jobs
       WHERE smart_account_id = $1 AND intent_id = $2`,
      [smartAccountId, normalizedIntentId]
    )
    if (current.length === 0) {
      throw new Error('Relayer job not found.')
    }

    const updated = update({
      ...toRecord(current[0]),
      updatedAt: new Date().toISOString(),
    })

    const written = await query<RelayerJobRow>(
      `UPDATE relayer_jobs
       SET child_sequence = $3, start_ledger = $4, end_ledger = $5, max_executions = $6,
           execution_count = $7, status = $8, note = $9, tx_hash = $10,
           updated_at = now(), version = version + 1
       WHERE smart_account_id = $1 AND intent_id = $2 AND version = $11
       RETURNING ${COLUMNS}`,
      [
        smartAccountId,
        normalizedIntentId,
        updated.childSequence,
        updated.startLedger,
        updated.endLedger,
        updated.maxExecutions,
        updated.executionCount,
        updated.status,
        updated.note,
        updated.txHash ?? null,
        current[0].version,
      ]
    )

    if (written.length > 0) {
      return toRecord(written[0])
    }
  }

  throw new Error(
    `Relayer job ${jobKey(smartAccountId, intentId)} was modified concurrently ${UPDATE_RETRIES} times running; giving up rather than looping.`
  )
}
