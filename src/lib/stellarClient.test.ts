import { xdr } from '@stellar/stellar-sdk'
import { describe, expect, it, vi } from 'vitest'

// stellarClient reads the deployment's configuration at module scope. The
// helper under test never touches it, so a stand-in is enough to import the
// module without a configured environment.
vi.mock('@/config', () => ({
  STELLAR_CONFIG: {
    rpcUrl: 'https://rpc.invalid',
    networkPassphrase: 'Test SDF Network ; September 2015',
    contracts: {},
  },
  NETWORK: { id: 'testnet', name: 'testnet', label: 'Stellar testnet' },
}))

const { describeSubmissionRejection } = await import('@/lib/stellarClient')

function rejection(result: xdr.TransactionResultResult) {
  return new xdr.TransactionResult({
    feeCharged: xdr.Int64.fromString('100'),
    result,
    ext: new xdr.TransactionResultExt(0),
  })
}

describe('describeSubmissionRejection', () => {
  it('names the result code the network rejected the transaction with', () => {
    expect(
      describeSubmissionRejection(
        rejection(xdr.TransactionResultResult.txBadAuth())
      )
    ).toBe('txBadAuth')
  })

  it('tells the fee case apart from the balance case', () => {
    // These two are the pair that "Submission failed: ERROR" used to hide,
    // and they call for opposite responses: raise the fee, or fund the
    // account.
    expect(
      describeSubmissionRejection(
        rejection(xdr.TransactionResultResult.txInsufficientFee())
      )
    ).toBe('txInsufficientFee')
    expect(
      describeSubmissionRejection(
        rejection(xdr.TransactionResultResult.txInsufficientBalance())
      )
    ).toBe('txInsufficientBalance')
  })

  it('reads a result that arrived as base64, the way the RPC sends it', () => {
    const encoded = rejection(
      xdr.TransactionResultResult.txSorobanInvalid()
    ).toXDR('base64')

    expect(
      describeSubmissionRejection(
        xdr.TransactionResult.fromXDR(encoded, 'base64')
      )
    ).toBe('txSorobanInvalid')
  })

  it('says the code is missing rather than inventing one', () => {
    // The RPC schema marks errorResult optional, and a server with
    // diagnostics disabled can answer ERROR without it.
    expect(describeSubmissionRejection(undefined)).toBe(
      'ERROR (the RPC gave no result code)'
    )
  })
})
