/**
 * Wall-clock estimates for ledger numbers.
 *
 * A scheduled payment's window is expressed in ledgers, which says nothing to
 * an operator deciding whether a payment already missed its slot. Stellar has
 * no ledger-to-timestamp index a client can query, so the only conversion
 * available is a projection from one known close time at the rate the network
 * targets — {@link LEDGER_CLOSE_SECONDS}. That rate is a target, not a
 * guarantee, so everything here is an estimate and drifts further the further
 * the projection reaches; the UI says so wherever it shows one.
 *
 * The inverse direction (a duration into a ledger offset) lives in
 * `@/features/treasury/drafts` as `computeLedgerWindow`.
 *
 * Like `@/lib/constants`, this deliberately imports no config, so it stays
 * usable from pure modules and their tests.
 */
import { LEDGER_CLOSE_SECONDS } from '@/lib/constants'

/** A ledger whose close time is known, projected from in both directions. */
export type LedgerClock = {
  referenceLedger: number
  /** Unix seconds, as `getHealth` reports `latestLedgerCloseTime`. */
  referenceCloseTime: number
}

const SECONDS_PER_MINUTE = 60
const SECONDS_PER_HOUR = 3_600
const SECONDS_PER_DAY = 86_400

/**
 * The estimated close time of `ledger`, or null when there is nothing to
 * project from.
 *
 * Null rather than a fallback date: a missing ledger rendered as the epoch
 * would read as a real, very expired window.
 */
export function estimateLedgerTime(
  ledger: number | null,
  clock: LedgerClock
): Date | null {
  if (ledger === null || !Number.isFinite(ledger) || ledger <= 0) return null
  if (!clock.referenceLedger || !clock.referenceCloseTime) return null

  const seconds =
    clock.referenceCloseTime +
    (ledger - clock.referenceLedger) * LEDGER_CLOSE_SECONDS
  return new Date(seconds * 1000)
}

/**
 * The first ledger expected to close at or after `at` — the inverse of
 * {@link estimateLedgerTime}.
 *
 * Rounds up on purpose. A moment one second past a close already belongs to
 * the next ledger, and rounding down would open a window earlier, or close it
 * later, than the operator picked.
 *
 * Callers must build `clock` from a freshly read ledger. A cached one drifts,
 * and the ledger this returns is what gets signed.
 */
export function ledgerForTime(at: Date, clock: LedgerClock): number | null {
  const time = at.getTime()
  if (!Number.isFinite(time)) return null
  if (!clock.referenceLedger || !clock.referenceCloseTime) return null

  const offset = Math.ceil(
    (time / 1000 - clock.referenceCloseTime) / LEDGER_CLOSE_SECONDS
  )
  return Math.max(1, clock.referenceLedger + offset)
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * A date as `<input type="datetime-local">` wants it: `YYYY-MM-DDTHH:mm`, in
 * the viewer's own timezone.
 *
 * Built from the local getters rather than sliced off `toISOString()`, which
 * is UTC — the input parses its value as local time, so an ISO slice would
 * shift the displayed moment by the timezone offset.
 */
export function toDatetimeLocalValue(at: Date): string {
  return [
    `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`,
    `${pad(at.getHours())}:${pad(at.getMinutes())}`,
  ].join('T')
}

/** The date a `datetime-local` input holds, or null when it holds nothing
 * usable — the field is empty while being typed into. */
export function fromDatetimeLocalValue(value: string): Date | null {
  if (!value) return null
  const at = new Date(value)
  return Number.isFinite(at.getTime()) ? at : null
}

function formatDuration(seconds: number): string {
  if (seconds >= SECONDS_PER_DAY) {
    const days = Math.floor(seconds / SECONDS_PER_DAY)
    return `${days}d ${Math.floor((seconds % SECONDS_PER_DAY) / SECONDS_PER_HOUR)}h`
  }
  if (seconds >= SECONDS_PER_HOUR) {
    const hours = Math.floor(seconds / SECONDS_PER_HOUR)
    return `${hours}h ${Math.floor((seconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE)}m`
  }
  return `${Math.floor(seconds / SECONDS_PER_MINUTE)}m`
}

/**
 * How far `ledger` sits from the clock's reference, phrased relative to it.
 *
 * Anything inside a minute collapses to "now" — at
 * {@link LEDGER_CLOSE_SECONDS}s per ledger the estimate cannot resolve finer
 * than that, and "in 0m" would claim a precision this projection does not
 * have.
 */
export function describeLedgerOffset(
  ledger: number | null,
  clock: LedgerClock
): string {
  if (ledger === null || !clock.referenceLedger) return ''

  const seconds = (ledger - clock.referenceLedger) * LEDGER_CLOSE_SECONDS
  const magnitude = Math.abs(seconds)
  if (magnitude < SECONDS_PER_MINUTE) return 'now'

  return seconds > 0
    ? `in ${formatDuration(magnitude)}`
    : `${formatDuration(magnitude)} ago`
}

/**
 * The RPC's event retention window in whole days, or null when it reported
 * none.
 *
 * Rounded up so a window that exists never reads as zero days — the number is
 * used to tell an operator how far back a listing can see, and "0 days" would
 * say the feature is useless rather than short.
 */
export function retentionDays(
  retentionLedgers: number | undefined
): number | null {
  if (!retentionLedgers || retentionLedgers <= 0) return null
  return Math.max(
    1,
    Math.round((retentionLedgers * LEDGER_CLOSE_SECONDS) / SECONDS_PER_DAY)
  )
}
