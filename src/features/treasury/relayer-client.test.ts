import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ensureRelayerSession,
  openWalletRelayerSession,
} from '@/features/treasury/relayer-client'

vi.mock('@/lib/basePath', () => ({ apiUrl: (path: string) => path }))

const ADDRESS = 'GCWFJKLE45TMVZS42TMIYKAORKGBWE74753YPOSCC5ESJR2G2UMBXBDB'

function json(body: unknown, ok = true) {
  return { ok, json: async () => body } as Response
}

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('openWalletRelayerSession', () => {
  it('signs the challenge the server issued, and sends both back', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ challenge: 'sta-auth:G...:1:ab.cd' }))
      .mockResolvedValueOnce(json({ ok: true }))
    const sign = vi.fn(async () => 'c2lnbmF0dXJl')

    await openWalletRelayerSession(ADDRESS, sign)

    expect(sign).toHaveBeenCalledWith('sta-auth:G...:1:ab.cd')
    const [, init] = fetchMock.mock.calls[1]
    expect(JSON.parse(init.body)).toEqual({
      challenge: 'sta-auth:G...:1:ab.cd',
      signedMessage: 'c2lnbmF0dXJl',
    })
  })

  it('never asks the wallet to sign when the challenge was refused', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'nope' }, false))
    const sign = vi.fn()

    await expect(openWalletRelayerSession(ADDRESS, sign)).rejects.toThrow(
      /nope/
    )
    expect(sign).not.toHaveBeenCalled()
  })

  it('reports a rejected signature rather than reporting success', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ challenge: 'ch' }))
      .mockResolvedValueOnce(json({ error: 'bad' }, false))

    await expect(
      openWalletRelayerSession(ADDRESS, async () => 'sig')
    ).rejects.toThrow(/signature was not accepted/)
  })
})

describe('ensureRelayerSession', () => {
  it('does not prompt the wallet when a session is already open', async () => {
    // The operator who unlocked the panel, or a wallet returning inside its
    // session, must not be asked to sign again on every queue.
    fetchMock.mockResolvedValueOnce(json({ active: true, subject: 'operator' }))
    const sign = vi.fn()

    const state = await ensureRelayerSession(ADDRESS, sign)

    expect(sign).not.toHaveBeenCalled()
    expect(state.subject).toBe('operator')
  })

  it('opens one, once, when there is no session', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ active: false, subject: null }))
      .mockResolvedValueOnce(json({ challenge: 'ch' }))
      .mockResolvedValueOnce(json({ ok: true }))
      .mockResolvedValueOnce(json({ active: true, subject: ADDRESS }))
    const sign = vi.fn(async () => 'sig')

    const state = await ensureRelayerSession(ADDRESS, sign)

    expect(sign).toHaveBeenCalledTimes(1)
    expect(state.subject).toBe(ADDRESS)
  })

  it('reports no session rather than throwing when the probe cannot reach the server', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'))
    fetchMock.mockResolvedValueOnce(json({ error: 'x' }, false))

    await expect(
      ensureRelayerSession(ADDRESS, async () => 'sig')
    ).rejects.toThrow(/Could not start wallet authentication|x/)
  })
})
