import type { RelayerJobRecord } from '@/lib/relayer/types'

/** The store's canonical spelling of an intent id: 64 lowercase hex, no `0x`. */
export function normalizeIntentId(intentId: string) {
  return intentId.replace(/^0x/i, '').toLowerCase()
}

/**
 * The relayer job for each intent that has one, keyed by normalized id.
 *
 * Every job counts, whatever its status: a job's identity is
 * `(smartAccountId, intentId)` and the store is idempotent on it, so once an
 * intent has a job a second "queue" changes nothing and only confuses. The
 * console uses this to disable the button and say why, instead of letting a
 * click round-trip to the server for the same answer.
 */
export function indexJobsByIntent(
  jobs: readonly RelayerJobRecord[]
): Map<string, RelayerJobRecord> {
  const byIntent = new Map<string, RelayerJobRecord>()
  for (const job of jobs) {
    byIntent.set(normalizeIntentId(job.intentId), job)
  }
  return byIntent
}
