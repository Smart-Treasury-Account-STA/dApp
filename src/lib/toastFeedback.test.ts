import { describe, expect, it } from 'vitest'

import { buildToastFeedback } from './toastFeedback'

const EXPLORER = 'https://stellar.expert/explorer/testnet'

describe('buildToastFeedback', () => {
  it('maps a successful result to a success toast with no action', () => {
    const feedback = buildToastFeedback(
      {
        ok: true,
        title: 'Payment confirmed',
        detail: 'Transaction status: SUCCESS',
      },
      EXPLORER
    )

    expect(feedback).toEqual({
      kind: 'success',
      title: 'Payment confirmed',
      description: 'Transaction status: SUCCESS',
      explorerUrl: null,
    })
  })

  it('maps a failed result to an error toast', () => {
    const feedback = buildToastFeedback(
      {
        ok: false,
        title: 'Schedule submission failed',
        detail: 'Nonce has already been used.',
      },
      EXPLORER
    )

    expect(feedback.kind).toBe('error')
  })

  it('builds an explorer link from the transaction hash, not just a flag', () => {
    const feedback = buildToastFeedback(
      { ok: true, title: 'Payment confirmed', detail: '…', txHash: 'abc123' },
      EXPLORER
    )

    expect(feedback.explorerUrl).toBe(`${EXPLORER}/tx/abc123`)
  })

  it("folds the diagnostic's first line into the description without losing it", () => {
    // The diagnostic used to be the only place a HostError's real cause was
    // visible (the header Notice panel's <code> block). Dropping the panel
    // must not silently drop that information from the UI.
    const feedback = buildToastFeedback(
      {
        ok: false,
        title: 'Policy check could not run',
        detail: 'The request could not be encoded for the contract.',
        diagnostic:
          'HostError: Error(Object, InvalidInput)\n  0: [Diagnostic Event] …',
      },
      EXPLORER
    )

    expect(feedback.description).toBe(
      'The request could not be encoded for the contract.\nHostError: Error(Object, InvalidInput)'
    )
  })

  it('shows a still-pending submission as a warning, neither success nor failure', () => {
    // Rendering it green claims a confirmation the network has not given;
    // rendering it red claims a failure that did not happen.
    const feedback = buildToastFeedback(
      {
        ok: true,
        pending: true,
        title: 'Schedule submitted',
        detail: 'Still pending on the network.',
        txHash: 'abc123',
      },
      EXPLORER
    )

    expect(feedback.kind).toBe('warning')
    expect(feedback.explorerUrl).toBe(`${EXPLORER}/tx/abc123`)
  })

  it('shows a wallet prompt awaiting the signer as a warning', () => {
    // The signer has been asked and has not answered. Nothing is signed,
    // nothing is submitted, and the toast that follows it -- confirmed,
    // still pending, or failed -- is the one that settles the matter.
    const feedback = buildToastFeedback(
      {
        ok: true,
        pending: true,
        title: 'Wallet approval requested',
        detail: 'Approve the authorization entry, then the envelope.',
      },
      EXPLORER
    )

    expect(feedback.kind).toBe('warning')
  })

  it('keeps a passing simulation green', () => {
    // A simulation reports on itself: asked to check, it checked, and it
    // answered. Nothing about it is unresolved, so it is not a warning.
    const feedback = buildToastFeedback(
      {
        ok: true,
        title: 'Policy simulation passed',
        detail: 'Asset, destination, amount and version are accepted.',
      },
      EXPLORER
    )

    expect(feedback.kind).toBe('success')
  })

  it('reports a failure as an error even when it is flagged pending', () => {
    // `pending` narrows a success; it must never soften a failure into a
    // warning, whatever order the fields arrive in.
    const feedback = buildToastFeedback(
      {
        ok: false,
        pending: true,
        title: 'Transfer rejected by the contract',
        detail: 'Policy rejected the destination.',
      },
      EXPLORER
    )

    expect(feedback.kind).toBe('error')
  })

  it('keeps the description to just the detail when there is no diagnostic', () => {
    const feedback = buildToastFeedback(
      {
        ok: true,
        title: 'Wallet connected',
        detail: 'GABC…XYZ is connected on Stellar testnet.',
      },
      EXPLORER
    )

    expect(feedback.description).toBe(
      'GABC…XYZ is connected on Stellar testnet.'
    )
  })
})
