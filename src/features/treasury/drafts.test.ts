import { describe, expect, it } from 'vitest'

import {
  computeLedgerWindow,
  validatePaymentDraft,
  validateScheduleDraft,
  validateSplitDraft,
} from '@/features/treasury/drafts'

const contract = 'CB4KZJ3I4XANE6GWPAMXCNXQ34PTQWPXVKFBBMLNKV25GAOXQC7RQUMS'
const account = 'GAK3XILRBYBMBOCZMSLL2CLR6WPQLEIOC6ZCYYPTE4OIAX3PCFFO2YMU'
const account2 = 'GDU3LDGZOCJIB6MIKQWK5AICFFEWVC2FJ2BDEVXG37XXSKWIZ7OXVCAS'

const payment = {
  asset: contract,
  destination: account,
  amount: '5000000',
  nonce: '42',
  expectedPolicyVersion: 1,
}

const split = {
  asset: contract,
  destinations: [
    { destination: account, amount: '2000000' },
    { destination: account2, amount: '3000000' },
  ],
  nonce: '42',
  expectedPolicyVersion: 1,
}

const schedule = {
  ...payment,
  intentId: 'c'.repeat(64),
  startLedger: '100',
  endLedger: '200',
  maxExecutions: '3',
}

describe('validatePaymentDraft', () => {
  it('accepts a valid draft', () => {
    expect(() => validatePaymentDraft(payment)).not.toThrow()
  })

  it('rejects a malformed asset', () => {
    expect(() => validatePaymentDraft({ ...payment, asset: 'nope' })).toThrow(
      /Asset contract/
    )
  })

  it('rejects a zero amount', () => {
    expect(() => validatePaymentDraft({ ...payment, amount: '0' })).toThrow(
      /Amount/
    )
  })

  it('rejects a fractional amount', () => {
    expect(() => validatePaymentDraft({ ...payment, amount: '1.5' })).toThrow(
      /Amount/
    )
  })
})

describe('validateScheduleDraft', () => {
  it('accepts a valid draft', () => {
    expect(() => validateScheduleDraft(schedule)).not.toThrow()
  })

  it('rejects a short intent id', () => {
    expect(() =>
      validateScheduleDraft({ ...schedule, intentId: 'abc' })
    ).toThrow(/32 bytes/)
  })

  it('rejects an inverted window', () => {
    expect(() =>
      validateScheduleDraft({ ...schedule, startLedger: '500' })
    ).toThrow(/lower than/)
  })

  it('rejects maxExecutions below one', () => {
    expect(() =>
      validateScheduleDraft({ ...schedule, maxExecutions: '0' })
    ).toThrow(/at least 1/)
  })

  it('accepts a draft with no intervalLedgers set (defaults to one-shot)', () => {
    expect(() => validateScheduleDraft(schedule)).not.toThrow()
  })

  it('accepts a valid intervalLedgers value', () => {
    expect(() =>
      validateScheduleDraft({ ...schedule, intervalLedgers: '17280' })
    ).not.toThrow()
  })

  it('rejects a malformed intervalLedgers value', () => {
    expect(() =>
      validateScheduleDraft({ ...schedule, intervalLedgers: '-1' })
    ).toThrow(/Interval ledgers/)
  })
})

describe('validateSplitDraft', () => {
  it('accepts a valid draft', () => {
    expect(() => validateSplitDraft(split)).not.toThrow()
  })

  it('rejects a malformed asset', () => {
    expect(() => validateSplitDraft({ ...split, asset: 'nope' })).toThrow(
      /Asset contract/
    )
  })

  it('rejects a single destination — use a plain payment instead', () => {
    expect(() =>
      validateSplitDraft({ ...split, destinations: [split.destinations[0]] })
    ).toThrow(/at least two destinations/)
  })

  it('rejects a malformed destination address', () => {
    expect(() =>
      validateSplitDraft({
        ...split,
        destinations: [
          { destination: 'nope', amount: '1' },
          split.destinations[1],
        ],
      })
    ).toThrow(/Destination 1/)
  })

  it('rejects a zero or negative destination amount', () => {
    expect(() =>
      validateSplitDraft({
        ...split,
        destinations: [
          { destination: account, amount: '0' },
          split.destinations[1],
        ],
      })
    ).toThrow(/Amount 1/)
  })

  it("rejects duplicate destination addresses — matches the contract's own DuplicateRecipient check", () => {
    expect(() =>
      validateSplitDraft({
        ...split,
        destinations: [
          { destination: account, amount: '1000000' },
          { destination: account, amount: '2000000' },
        ],
      })
    ).toThrow(/distinct addresses/)
  })

  it('rejects an invalid nonce', () => {
    expect(() => validateSplitDraft({ ...split, nonce: '0' })).toThrow(/Nonce/)
  })
})

describe('computeLedgerWindow', () => {
  it('starts about two minutes ahead and lasts an hour by default', () => {
    expect(computeLedgerWindow(1_000)).toEqual({
      startLedger: 1_024,
      endLedger: 1_744,
    })
  })

  it('honours explicit bounds', () => {
    expect(
      computeLedgerWindow(1_000, { startDelaySeconds: 0, durationSeconds: 50 })
    ).toEqual({ startLedger: 1_000, endLedger: 1_010 })
  })
})
