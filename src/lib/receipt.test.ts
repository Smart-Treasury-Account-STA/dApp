import { Address, xdr } from '@stellar/stellar-sdk'
import { describe, expect, it } from 'vitest'

import { truncateAddress } from './format'
import { describeReceipt } from './receipt'

const LABELS = {
  confirmedTitle: 'Scheduled payment created',
  submittedTitle: 'Schedule submitted',
}

const ASSET = 'CCOUVA654JH2V6B7LNTKHJP5DF3QA553RS2IIWXSGPDFH2N3QILIVU5L'
const DESTINATION = 'GAK3XILRBYBMBOCZMSLL2CLR6WPQLEIOC6ZCYYPTE4OIAX3PCFFO2YMU'

/** A real TransferPaid (`pay_ok`) contract event, matching what
 * execute_transfer_payment actually emits on-chain. */
function transferPaidEvent() {
  const dataMap = xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('amount'),
      val: xdr.ScVal.scvI128(
        new xdr.Int128Parts({
          hi: xdr.Int64.fromString('0'),
          lo: xdr.Uint64.fromString('5000000'),
        })
      ),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('nonce'),
      val: xdr.ScVal.scvU64(xdr.Uint64.fromString('42')),
    }),
  ])
  return new xdr.ContractEvent({
    ext: new xdr.ExtensionPoint(0),
    contractId: null,
    type: xdr.ContractEventType.contract(),
    body: new xdr.ContractEventBody(
      0,
      new xdr.ContractEventV0({
        topics: [
          xdr.ScVal.scvSymbol('pay_ok'),
          new Address(ASSET).toScVal(),
          new Address(DESTINATION).toScVal(),
        ],
        data: dataMap,
      })
    ),
  })
}

describe('describeReceipt', () => {
  it('reports a confirmed transaction as a success', () => {
    const result = describeReceipt({ hash: 'abc', status: 'SUCCESS' }, LABELS)

    expect(result.ok).toBe(true)
    expect(result.pending).toBeFalsy()
    expect(result.title).toBe('Scheduled payment created')
  })

  it('reports a failed transaction as a failure', () => {
    const result = describeReceipt({ hash: 'abc', status: 'FAILED' }, LABELS)

    expect(result.ok).toBe(false)
    expect(result.pending).toBeFalsy()
  })

  it('does not call a still-pending transaction a failure', () => {
    // Polling gives up after a bounded wait, but the network has not rejected
    // anything at that point. A schedule shown in red as "failed" was actually
    // confirmed on-chain two minutes later, and the operator had been told the
    // opposite.
    const result = describeReceipt({ hash: 'abc', status: 'PENDING' }, LABELS)

    expect(result.ok).toBe(true)
  })

  it('marks a still-pending transaction as pending, not confirmed', () => {
    const result = describeReceipt({ hash: 'abc', status: 'PENDING' }, LABELS)

    expect(result.pending).toBe(true)
    expect(result.title).toBe('Schedule submitted')
  })

  it('tells the operator the pending result is not final', () => {
    const result = describeReceipt({ hash: 'abc', status: 'PENDING' }, LABELS)

    expect(result.detail).toMatch(/still|may still confirm/i)
  })

  it('keeps the hash on every outcome so the transaction stays traceable', () => {
    for (const status of ['SUCCESS', 'FAILED', 'PENDING']) {
      expect(describeReceipt({ hash: 'abc', status }, LABELS).txHash).toBe(
        'abc'
      )
    }
  })

  it('summarizes a decoded TransferPaid event into the SUCCESS detail line', () => {
    const result = describeReceipt(
      { hash: 'abc', status: 'SUCCESS', events: [transferPaidEvent()] },
      LABELS
    )

    expect(result.detail).toContain('Paid 5000000')
    // Truncated, not full: a 56-character strkey is unbreakable text, and two
    // of them in one sentence overflowed every surface that shows this line
    // -- the relayer job card and the toast. The explorer link carries the
    // full value.
    expect(result.detail).toContain(truncateAddress(ASSET))
    expect(result.detail).toContain(truncateAddress(DESTINATION))
    expect(result.detail).not.toContain(ASSET)
  })

  it('falls back to the plain status line when there are no events to summarize', () => {
    const result = describeReceipt(
      { hash: 'abc', status: 'SUCCESS', events: [] },
      LABELS
    )

    expect(result.detail).toBe('Transaction status: SUCCESS')
  })

  it('falls back to the plain status line when events is absent entirely', () => {
    const result = describeReceipt({ hash: 'abc', status: 'SUCCESS' }, LABELS)

    expect(result.detail).toBe('Transaction status: SUCCESS')
  })
})
