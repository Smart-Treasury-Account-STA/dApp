import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { hasValidRelayerSession, requireRelayerAdmin } from '@/lib/relayer/auth'
import {
  OPERATOR_SUBJECT,
  RELAYER_SESSION_COOKIE,
  createSessionValue,
} from '@/lib/relayer/session'

const adminToken = 'correct-horse-battery-staple'

function request(init: { cookie?: string; token?: string } = {}) {
  const headers = new Headers()
  if (init.cookie) headers.set('cookie', init.cookie)
  if (init.token) headers.set('x-relayer-token', init.token)
  return new Request('https://example.test/api/relayer/jobs', { headers })
}

describe('requireRelayerAdmin', () => {
  beforeEach(() => {
    process.env.RELAYER_ADMIN_TOKEN = adminToken
  })

  afterEach(() => {
    delete process.env.RELAYER_ADMIN_TOKEN
  })

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

  it('passes with a valid session cookie', () => {
    const value = createSessionValue(adminToken)
    expect(() =>
      requireRelayerAdmin(
        request({ cookie: `${RELAYER_SESSION_COOKIE}=${value}` })
      )
    ).not.toThrow()
  })

  it('throws with an expired session cookie', () => {
    const now = Math.floor(Date.now() / 1000)
    const value = createSessionValue(
      adminToken,
      OPERATOR_SUBJECT,
      now - 60 * 60 * 24
    )
    expect(() =>
      requireRelayerAdmin(
        request({ cookie: `${RELAYER_SESSION_COOKIE}=${value}` })
      )
    ).toThrow('Unauthorized relayer request.')
  })

  it('parses the session cookie out from among other unrelated cookies', () => {
    const value = createSessionValue(adminToken)
    expect(() =>
      requireRelayerAdmin(
        request({
          cookie: `foo=bar; ${RELAYER_SESSION_COOKIE}=${value}; baz=qux`,
        })
      )
    ).not.toThrow()
  })

  it('throws when neither header nor cookie is present', () => {
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

describe('hasValidRelayerSession', () => {
  beforeEach(() => {
    process.env.RELAYER_ADMIN_TOKEN = adminToken
  })

  afterEach(() => {
    delete process.env.RELAYER_ADMIN_TOKEN
  })

  it('reports a live session cookie', () => {
    const value = createSessionValue(adminToken)
    expect(
      hasValidRelayerSession(
        request({ cookie: `${RELAYER_SESSION_COOKIE}=${value}` })
      )
    ).toBe(true)
  })

  it('reports no session when the cookie is absent', () => {
    expect(hasValidRelayerSession(request())).toBe(false)
  })

  it('reports no session for an expired cookie', () => {
    const now = Math.floor(Date.now() / 1000)
    const value = createSessionValue(
      adminToken,
      OPERATOR_SUBJECT,
      now - 60 * 60 * 24
    )
    expect(
      hasValidRelayerSession(
        request({ cookie: `${RELAYER_SESSION_COOKIE}=${value}` })
      )
    ).toBe(false)
  })

  it('ignores the header token — this answers about the browser session only', () => {
    // The CLI's `x-relayer-token` authorizes a mutation but is not a session;
    // reporting it as one would make the console claim an unlock that no
    // subsequent browser request can reproduce.
    expect(hasValidRelayerSession(request({ token: adminToken }))).toBe(false)
  })

  it('reports no session when the server has no admin token configured', () => {
    delete process.env.RELAYER_ADMIN_TOKEN
    const value = createSessionValue(adminToken)
    expect(
      hasValidRelayerSession(
        request({ cookie: `${RELAYER_SESSION_COOKIE}=${value}` })
      )
    ).toBe(false)
  })
})
