import type { rpc } from '@stellar/stellar-sdk'
import { describe, expect, it, vi } from 'vitest'

import { inclusionFee } from '@/lib/inclusionFee'

function serverReporting(p99: string) {
  return {
    getFeeStats: vi.fn(async () => ({ sorobanInclusionFee: { p99 } })),
  } as unknown as rpc.Server
}

describe('inclusionFee', () => {
  it('bids a multiple of what the network is currently charging', async () => {
    // 200 stroops was every percentile on mainnet the day the 100-stroop bid
    // started failing.
    expect(await inclusionFee(serverReporting('200'))).toBe('2000')
  })

  it('never bids below the floor, however quiet the network claims to be', async () => {
    // An RPC with nothing recent to report answers "0" percentiles rather
    // than an error; taking that at face value would hand back a bid the
    // network rejects the moment traffic resumes.
    expect(await inclusionFee(serverReporting('0'))).toBe('2000')
    expect(await inclusionFee(serverReporting('1'))).toBe('2000')
  })

  it('refuses to bid more than the cap, whatever the RPC reports', async () => {
    // The bid is spent from the user's own balance, so a surge -- or a
    // malfunctioning RPC -- must not be able to escalate it without bound.
    expect(await inclusionFee(serverReporting('99999999'))).toBe('100000')
  })

  it('falls back to the floor when the RPC has no fee stats to give', async () => {
    const unsupported = {
      getFeeStats: vi.fn(async () => {
        throw new Error('method not found')
      }),
    } as unknown as rpc.Server

    expect(await inclusionFee(unsupported)).toBe('2000')
  })

  it('falls back to the floor rather than NaN on an unparseable percentile', async () => {
    expect(await inclusionFee(serverReporting('not-a-number'))).toBe('2000')
  })
})
