import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { mayQueueForTreasury } from '@/lib/auth/treasuryAccess'
import {
  readRelayerSessionSubject,
  requireRelayerAdmin,
  requireTreasuryAccess,
} from '@/lib/relayer/auth'
import {
  RELAYER_SESSION_COOKIE,
  createSessionValue,
} from '@/lib/relayer/session'

vi.mock('@/lib/auth/treasuryAccess', () => ({
  mayQueueForTreasury: vi.fn(),
}))

const adminToken = 'correct-horse-battery-staple'
const SMART = 'CD6GY4UUTNPW4TUV7LDL5SELN4BBHJG4KDDT3W6G23DY6XCGM75MULMQ'
const SIGNER = 'GCWFJKLE45TMVZS42TMIYKAORKGBWE74753YPOSCC5ESJR2G2UMBXBDB'

function request(init: { cookie?: string; token?: string } = {}) {
  const headers = new Headers()
  if (init.cookie) headers.set('cookie', init.cookie)
  if (init.token) headers.set('x-relayer-token', init.token)
  return new Request('https://example.test/api/relayer/jobs', { headers })
}

function sessionCookie(subject = SIGNER, now?: number) {
  return `${RELAYER_SESSION_COOKIE}=${createSessionValue(adminToken, subject, now)}`
}

beforeEach(() => {
  process.env.RELAYER_ADMIN_TOKEN = adminToken
  vi.mocked(mayQueueForTreasury).mockReset()
})

afterEach(() => {
  delete process.env.RELAYER_ADMIN_TOKEN
})

describe('requireRelayerAdmin', () => {
  it('passes with a valid header token', () => {
    expect(() =>
      requireRelayerAdmin(request({ token: adminToken }))
    ).not.toThrow()
  })

  it('throws with a wrong header token', () => {
    expect(() =>
      requireRelayerAdmin(request({ token: 'wrong-token' }))
    ).toThrow('Unauthorized relayer request.')
  })

  it('does not accept a wallet session — the header is the only operator credential', () => {
    // Running the batch and listing every treasury's jobs are not scoped to
    // one treasury; a signer of one treasury must not reach into them.
    expect(() =>
      requireRelayerAdmin(request({ cookie: sessionCookie() }))
    ).toThrow('Unauthorized relayer request.')
  })

  it('throws when no header is present', () => {
    expect(() => requireRelayerAdmin(request())).toThrow(
      'Unauthorized relayer request.'
    )
  })

  it('throws when RELAYER_ADMIN_TOKEN is not configured', () => {
    delete process.env.RELAYER_ADMIN_TOKEN
    expect(() => requireRelayerAdmin(request({ token: adminToken }))).toThrow(
      'RELAYER_ADMIN_TOKEN must be configured before mutating relayer jobs.'
    )
  })
})

describe('readRelayerSessionSubject', () => {
  it('reports the address of a live session cookie', () => {
    expect(
      readRelayerSessionSubject(request({ cookie: sessionCookie() }))
    ).toBe(SIGNER)
  })

  it('parses the session cookie out from among other unrelated cookies', () => {
    expect(
      readRelayerSessionSubject(
        request({ cookie: `foo=bar; ${sessionCookie()}; baz=qux` })
      )
    ).toBe(SIGNER)
  })

  it('reports no session when the cookie is absent', () => {
    expect(readRelayerSessionSubject(request())).toBeNull()
  })

  it('reports no session for an expired cookie', () => {
    const now = Math.floor(Date.now() / 1000)
    expect(
      readRelayerSessionSubject(
        request({ cookie: sessionCookie(SIGNER, now - 60 * 60 * 24) })
      )
    ).toBeNull()
  })

  it('ignores the header token — this answers about the browser session only', () => {
    // The CLI's `x-relayer-token` authorizes a call but is not a session and
    // names no address; reporting it as one would make the console skip a
    // signature the server would then demand.
    expect(readRelayerSessionSubject(request({ token: adminToken }))).toBeNull()
  })

  it('reports no session when the server has no admin token configured', () => {
    const cookie = sessionCookie()
    delete process.env.RELAYER_ADMIN_TOKEN
    expect(readRelayerSessionSubject(request({ cookie }))).toBeNull()
  })
})

describe('requireTreasuryAccess', () => {
  it('lets the operator through without consulting the chain', async () => {
    // The CLI is an operator action; it is not scoped to one treasury and
    // must not depend on a signer lookup.
    await expect(
      requireTreasuryAccess(request({ token: adminToken }), SMART)
    ).resolves.toBeUndefined()
    expect(mayQueueForTreasury).not.toHaveBeenCalled()
  })

  it('lets a wallet session through for a treasury it signs for', async () => {
    vi.mocked(mayQueueForTreasury).mockResolvedValue(true)

    await expect(
      requireTreasuryAccess(request({ cookie: sessionCookie() }), SMART)
    ).resolves.toBeUndefined()
    expect(mayQueueForTreasury).toHaveBeenCalledWith(SIGNER, SMART)
  })

  it('refuses a wallet session for a treasury it does not sign for', async () => {
    // The hole this closes: before, any holder of the shared token could act
    // on any treasury.
    vi.mocked(mayQueueForTreasury).mockResolvedValue(false)

    await expect(
      requireTreasuryAccess(request({ cookie: sessionCookie() }), SMART)
    ).rejects.toThrow(/Unauthorized/)
  })

  it('refuses a request with no credentials at all', async () => {
    await expect(requireTreasuryAccess(request(), SMART)).rejects.toThrow(
      /Unauthorized/
    )
  })
})
