import { describe, expect, it } from 'vitest'

import {
  EXECUTING_LEASE_MS,
  RELAYER_JOBS_POLL_MS,
  isExecutingLeaseExpired,
  isRelayerJobInFlight,
  isTerminalRelayerJob,
  relayerJobsPollInterval,
} from './jobStatus'
import type { RelayerJobRecord } from './types'

function job(status: RelayerJobRecord['status']) {
  return { status }
}

describe('isTerminalRelayerJob', () => {
  it('treats the two states the executor refuses to act on as terminal', () => {
    expect(isTerminalRelayerJob(job('blocked'))).toBe(true)
    expect(isTerminalRelayerJob(job('executed'))).toBe(true)
  })

  it('leaves every in-flight state actionable', () => {
    expect(isTerminalRelayerJob(job('scheduled'))).toBe(false)
    expect(isTerminalRelayerJob(job('ready'))).toBe(false)
    expect(isTerminalRelayerJob(job('failed'))).toBe(false)
  })

  it('leaves `executing` actionable', () => {
    // A run that crashed between marking the job and submitting leaves this
    // status behind. Treating it as terminal would strand the job with no way
    // to retry it from the console.
    expect(isTerminalRelayerJob(job('executing'))).toBe(false)
  })
})

describe('isExecutingLeaseExpired / isRelayerJobInFlight', () => {
  const NOW = Date.parse('2026-09-11T12:00:00.000Z')

  function executingSince(msAgo: number) {
    return {
      status: 'executing' as const,
      updatedAt: new Date(NOW - msAgo).toISOString(),
    }
  }

  it('treats an `executing` job inside its lease as in flight', () => {
    const job = executingSince(60_000)
    expect(isExecutingLeaseExpired(job, NOW)).toBe(false)
    expect(isRelayerJobInFlight(job, NOW)).toBe(true)
  })

  it('releases an `executing` job once its lease has expired', () => {
    // The crashed-run case: the job must become actionable again, not stay
    // locked behind a run that is never coming back.
    const job = executingSince(EXECUTING_LEASE_MS)
    expect(isExecutingLeaseExpired(job, NOW)).toBe(true)
    expect(isRelayerJobInFlight(job, NOW)).toBe(false)
  })

  it('treats an unparseable timestamp as an expired lease', () => {
    const job = { status: 'executing' as const, updatedAt: 'not a date' }
    expect(isExecutingLeaseExpired(job, NOW)).toBe(true)
    expect(isRelayerJobInFlight(job, NOW)).toBe(false)
  })

  it('never reports a job in any other status as in flight', () => {
    const updatedAt = new Date(NOW).toISOString()
    for (const status of [
      'scheduled',
      'ready',
      'executed',
      'blocked',
      'failed',
    ] as const) {
      expect(isRelayerJobInFlight({ status, updatedAt }, NOW)).toBe(false)
      expect(isExecutingLeaseExpired({ status, updatedAt }, NOW)).toBe(false)
    }
  })
})

describe('relayerJobsPollInterval', () => {
  it('polls while any job can still change', () => {
    // The scheduled run moves jobs server-side; without polling the console
    // shows `scheduled` until a reload.
    expect(relayerJobsPollInterval([job('executed'), job('scheduled')])).toBe(
      RELAYER_JOBS_POLL_MS
    )
    expect(relayerJobsPollInterval([job('executing')])).toBe(
      RELAYER_JOBS_POLL_MS
    )
    expect(relayerJobsPollInterval([job('failed')])).toBe(RELAYER_JOBS_POLL_MS)
  })

  it('stops once every job is terminal', () => {
    expect(relayerJobsPollInterval([job('executed'), job('blocked')])).toBe(
      false
    )
  })

  it('does not poll an empty or not-yet-loaded list', () => {
    // A new job only appears through this console's own queue, which
    // invalidates the list itself.
    expect(relayerJobsPollInterval([])).toBe(false)
    expect(relayerJobsPollInterval(undefined)).toBe(false)
  })
})
