/**
 * Listing a treasury's scheduled payments, which `intent_registry` cannot do
 * on its own.
 *
 * The registry stores each intent under `DataKey::Intent(id)` and exposes
 * only `get_intent(id)` — there is no enumeration entrypoint, and Soroban RPC
 * cannot scan a contract's storage without being told every key in advance.
 * The set of ids therefore has to come from somewhere else: `create_intent`
 * publishes `IntentCreated` with the id as a topic, so the contract's event
 * stream is the only place that set exists at all.
 *
 * State still comes from `get_intent`. An event only says an intent was
 * created once; it never says whether it was cancelled or executed since, and
 * reconstructing that from `cancel`/`exec` events would re-derive what the
 * registry already stores authoritatively.
 *
 * The cost of that source is a horizon: RPC keeps events for a rolling window
 * (~7 days on testnet, `getHealth().oldestLedger`), so an intent created
 * before that window drops out of this list while remaining perfectly valid
 * on-chain and executable by the relayer.
 */

/** The `IntentCreated` topic — `#[contractevent(topics = ["intent"])]`. */
const INTENT_CREATED_TOPIC = 'intent'

const INTENT_ID_BYTES = 32

export type ScheduledIntentRecord = {
  intentId: string
  asset: string | null
  destination: string | null
  amount: bigint | null
  startLedger: number | null
  endLedger: number | null
  maxExecutions: number | null
  executionCount: number | null
  policyVersion: number | null
  cancelled: boolean
  /**
   * True when `get_intent` could not be read back for this id. The row is
   * still listed: an id that exists on-chain but cannot be decoded is a
   * different thing from one that was never created, and dropping it would
   * hide a scheduled payment that may still execute.
   */
  unreadable: boolean
}

export type IntentStatus =
  'unknown' | 'cancelled' | 'exhausted' | 'expired' | 'pending' | 'active'

/** One decoded contract event — only its natively-decoded topics matter here. */
export type IntentEvent = { topics: unknown[] }

function toIntentId(topic: unknown): string | null {
  if (!(topic instanceof Uint8Array) || topic.length !== INTENT_ID_BYTES)
    return null
  return Array.from(topic, (byte) => byte.toString(16).padStart(2, '0')).join(
    ''
  )
}

/**
 * The ids of every intent created on a registry, oldest first.
 *
 * Deduplicated because the same id can legitimately appear more than once in
 * a paginated scan, and lowercased to match `makeIntentId`'s output — the
 * cancel form feeds these straight back through `bytesN32ScVal`.
 */
export function collectIntentIds(events: IntentEvent[]): string[] {
  const ids: string[] = []
  const seen = new Set<string>()

  for (const event of events) {
    if (event.topics[0] !== INTENT_CREATED_TOPIC) continue
    const id = toIntentId(event.topics[1])
    if (id === null || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }

  return ids
}

/**
 * Why an intent will or will not run, ordered so the answer names the reason
 * that actually decides it.
 *
 * Cancellation outranks the window because a cancelled intent past its end
 * ledger is not "expired" — it was stopped. Exhaustion outranks expiry for
 * the same reason: having used its last execution is why it will never run
 * again, the window closing afterwards is incidental. A record whose fields
 * could not be decoded reads as `active`, never as dead: telling an operator
 * a live payment is finished is the more expensive mistake.
 */
export function describeIntentStatus(
  record: ScheduledIntentRecord,
  latestLedger: number
): IntentStatus {
  if (record.unreadable) return 'unknown'
  if (record.cancelled) return 'cancelled'

  const { executionCount, maxExecutions, startLedger, endLedger } = record
  if (
    executionCount !== null &&
    maxExecutions !== null &&
    maxExecutions > 0 &&
    executionCount >= maxExecutions
  ) {
    return 'exhausted'
  }

  if (endLedger !== null && endLedger > 0 && latestLedger > endLedger)
    return 'expired'
  if (startLedger !== null && latestLedger < startLedger) return 'pending'

  return 'active'
}
