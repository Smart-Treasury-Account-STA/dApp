import { describe, expect, it, vi } from 'vitest'

vi.mock('@/config', () => ({
  STELLAR_CONFIG: {
    defaultDestination:
      'GAK3XILRBYBMBOCZMSLL2CLR6WPQLEIOC6ZCYYPTE4OIAX3PCFFO2YMU',
  },
}))

const { simulationSourceAddress } = await import('@/lib/simulationSource')

const WALLET = 'GCWFJKLE45TMVZS42TMIYKAORKGBWE74753YPOSCC5ESJR2G2UMBXBDB'

describe('simulationSourceAddress', () => {
  it('simulates from the connected wallet when there is one', () => {
    expect(simulationSourceAddress(WALLET)).toBe(WALLET)
  })

  it('falls back to the configured destination before a wallet connects', () => {
    // The probes are usable without connecting, which is the point of the
    // fallback -- the simulated transaction still needs some source account.
    expect(simulationSourceAddress(null)).toBe(
      'GAK3XILRBYBMBOCZMSLL2CLR6WPQLEIOC6ZCYYPTE4OIAX3PCFFO2YMU'
    )
  })
})
