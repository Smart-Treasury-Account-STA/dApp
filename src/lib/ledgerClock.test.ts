import { describe, expect, it } from 'vitest'

import {
  describeLedgerOffset,
  estimateLedgerTime,
  fromDatetimeLocalValue,
  ledgerForTime,
  retentionDays,
  toDatetimeLocalValue,
} from './ledgerClock'
import type { LedgerClock } from './ledgerClock'

// 2026-09-08T12:00:00Z at ledger 4_569_000.
const clock: LedgerClock = {
  referenceLedger: 4_569_000,
  referenceCloseTime: 1_788_868_800,
}

describe('estimateLedgerTime', () => {
  it('returns the reference time for the reference ledger', () => {
    expect(estimateLedgerTime(clock.referenceLedger, clock)?.getTime()).toBe(
      1_788_868_800_000
    )
  })

  it('projects forward at the ledger close rate', () => {
    // +720 ledgers is the schedule form's default one-hour window.
    expect(estimateLedgerTime(4_569_720, clock)?.getTime()).toBe(
      (1_788_868_800 + 3_600) * 1000
    )
  })

  it('projects backward for a ledger already closed', () => {
    expect(estimateLedgerTime(4_568_880, clock)?.getTime()).toBe(
      (1_788_868_800 - 600) * 1000
    )
  })

  it('returns null for an unknown ledger rather than the epoch', () => {
    // A record whose window could not be decoded must not render as 1970.
    expect(estimateLedgerTime(null, clock)).toBeNull()
  })

  it('returns null when the clock itself has no reference yet', () => {
    expect(
      estimateLedgerTime(4_569_000, {
        referenceLedger: 0,
        referenceCloseTime: 0,
      })
    ).toBeNull()
  })
})

describe('describeLedgerOffset', () => {
  it('says how far ahead a future ledger is', () => {
    expect(describeLedgerOffset(4_569_720, clock)).toBe('in 1h 0m')
    expect(describeLedgerOffset(4_569_060, clock)).toBe('in 5m')
  })

  it('says how far back a past ledger is', () => {
    expect(describeLedgerOffset(4_568_280, clock)).toBe('1h 0m ago')
    expect(describeLedgerOffset(4_568_940, clock)).toBe('5m ago')
  })

  it('collapses anything inside a minute to now', () => {
    expect(describeLedgerOffset(clock.referenceLedger, clock)).toBe('now')
    expect(describeLedgerOffset(clock.referenceLedger + 11, clock)).toBe('now')
  })

  it('keeps days readable rather than rolling into hundreds of hours', () => {
    expect(
      describeLedgerOffset(clock.referenceLedger + 2 * 17_280, clock)
    ).toBe('in 2d 0h')
  })

  it('says nothing for an unknown ledger', () => {
    expect(describeLedgerOffset(null, clock)).toBe('')
  })
})

describe('ledgerForTime', () => {
  it('is the inverse of estimateLedgerTime at the reference', () => {
    const at = estimateLedgerTime(clock.referenceLedger, clock) as Date
    expect(ledgerForTime(at, clock)).toBe(clock.referenceLedger)
  })

  it('round-trips a ledger that lands on a close boundary', () => {
    const at = estimateLedgerTime(4_569_720, clock) as Date
    expect(ledgerForTime(at, clock)).toBe(4_569_720)
  })

  it('rounds up, so the chosen moment is inside the window rather than before it', () => {
    // One second past a close is already the next ledger's territory: a start
    // rounded down would open the window earlier than the operator picked.
    const at = new Date((clock.referenceCloseTime + 1) * 1000)
    expect(ledgerForTime(at, clock)).toBe(clock.referenceLedger + 1)
  })

  it('projects backward for a moment already past', () => {
    const at = new Date((clock.referenceCloseTime - 600) * 1000)
    expect(ledgerForTime(at, clock)).toBe(clock.referenceLedger - 120)
  })

  it('returns null for an unusable date or clock', () => {
    expect(ledgerForTime(new Date(Number.NaN), clock)).toBeNull()
    expect(
      ledgerForTime(new Date(), { referenceLedger: 0, referenceCloseTime: 0 })
    ).toBeNull()
  })
})

describe('datetime-local round trip', () => {
  it('formats in local time, not UTC', () => {
    // `new Date(value)` parses a datetime-local string as local time, so
    // slicing `toISOString()` would shift the field by the timezone offset.
    const at = new Date(2026, 8, 8, 15, 34)
    expect(toDatetimeLocalValue(at)).toBe('2026-09-08T15:34')
  })

  it('pads every component to a fixed width', () => {
    expect(toDatetimeLocalValue(new Date(2026, 0, 2, 3, 4))).toBe(
      '2026-01-02T03:04'
    )
  })

  it("round-trips through the input's own value format", () => {
    const at = new Date(2026, 8, 8, 15, 34)
    expect(fromDatetimeLocalValue(toDatetimeLocalValue(at))?.getTime()).toBe(
      at.getTime()
    )
  })

  it('rejects an empty or malformed value', () => {
    expect(fromDatetimeLocalValue('')).toBeNull()
    expect(fromDatetimeLocalValue('not a date')).toBeNull()
  })
})

describe('retentionDays', () => {
  it("converts the RPC's retention window into whole days", () => {
    // 120,960 ledgers is what testnet reports today.
    expect(retentionDays(120_960)).toBe(7)
  })

  it('never reports zero days for a window that exists', () => {
    expect(retentionDays(100)).toBe(1)
  })

  it('falls back to null when the RPC reported no window', () => {
    expect(retentionDays(0)).toBeNull()
    expect(retentionDays(undefined)).toBeNull()
  })
})
