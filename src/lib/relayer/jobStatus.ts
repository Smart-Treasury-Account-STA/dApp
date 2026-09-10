import type { RelayerJobRecord } from '@/lib/relayer/types'

/**
 * Whether a relayer job has reached a state it will never leave.
 *
 * `blocked` and `executed` are the two the executor refuses to act on: it
 * restates them and returns. Everything else is a step in a run that can be
 * retried — including `executing`, which a crashed run can leave behind and
 * which must therefore stay actionable rather than trapping the job forever.
 *
 * Shared with the console so a terminal job's Execute button is disabled
 * rather than round-tripping to a server that will only tell it the same
 * thing back. Kept in its own module, free of Node and database imports, so
 * `executeRelayerJob` and the browser can hold the same definition.
 */
export function isTerminalRelayerJob(
  job: Pick<RelayerJobRecord, 'status'>
): boolean {
  return job.status === 'blocked' || job.status === 'executed'
}

/**
 * How long a job may sit in `executing` before a later run is allowed to
 * take it back.
 *
 * `executing` is written before the executor transaction is submitted and
 * only replaced once its outcome is known, so a run that dies in between --
 * a function timeout mid-poll, a crashed process -- leaves the job in that
 * state with nobody coming back for it. The lease bounds that: after it
 * expires the job is due again, and `executeRelayerJob` settles whatever the
 * interrupted run left behind before doing anything new.
 *
 * Five minutes is longer than everything an in-flight run can legitimately
 * take: the executor transaction carries `setTimeout(120)`, so two minutes
 * after submission it can no longer be included; the poll lasts 20 x 1.5 s;
 * the rest is margin for a slow RPC. A lease shorter than the transaction
 * timeout would let a second run resubmit while the first transaction could
 * still land -- harmless on chain (the contract refuses a consumed child
 * sequence) but a wasted fee and a confusing job note.
 */
export const EXECUTING_LEASE_MS = 5 * 60 * 1000

export function isExecutingLeaseExpired(
  job: Pick<RelayerJobRecord, 'status' | 'updatedAt'>,
  now = Date.now()
): boolean {
  if (job.status !== 'executing') return false
  const since = Date.parse(job.updatedAt)
  // An unparseable timestamp cannot prove the lease is live; treating it as
  // expired errs on the side of retrying, which the on-chain checks make safe.
  return !Number.isFinite(since) || now - since >= EXECUTING_LEASE_MS
}

/**
 * Whether some run is executing this job right now: `executing`, inside its
 * lease.
 *
 * Nothing else may act on such a job -- not the scheduled run, not the
 * console's Execute. A second run would find the child not yet consumed
 * (the first transaction is still pending), submit its own, and have it
 * refused on chain; worse, recording that refusal could overwrite the
 * first run's outcome. Shared with the console for the same reason as
 * `isTerminalRelayerJob`.
 */
export function isRelayerJobInFlight(
  job: Pick<RelayerJobRecord, 'status' | 'updatedAt'>,
  now = Date.now()
): boolean {
  return job.status === 'executing' && !isExecutingLeaseExpired(job, now)
}

/** How often the console re-reads the relayer jobs while one can change. */
export const RELAYER_JOBS_POLL_MS = 10_000

/**
 * The console's refetch interval for a treasury's relayer jobs: poll while
 * any job is not terminal, stop once none can change any more.
 *
 * Jobs move server-side -- the scheduled run executes them with nobody
 * looking -- so without this the console keeps showing `scheduled` until a
 * reload. An empty list is not polled: a job only appears through the
 * console's own queue, which invalidates the list itself.
 */
export function relayerJobsPollInterval(
  jobs: readonly Pick<RelayerJobRecord, 'status'>[] | undefined
): number | false {
  return jobs?.some((job) => !isTerminalRelayerJob(job))
    ? RELAYER_JOBS_POLL_MS
    : false
}
