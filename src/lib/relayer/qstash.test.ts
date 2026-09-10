import { createHash, createHmac, randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { requireRelayerTrigger } from '@/lib/relayer/qstash'

const currentKey = 'sig_current_0123456789abcdef0123456789abcdef'
const nextKey = 'sig_next_fedcba9876543210fedcba9876543210ff'
const strangerKey = 'sig_stranger_00112233445566778899aabbccddeeff'
const adminToken = 'correct-horse-battery-staple'
const runUrl = 'https://sta-dapp.vercel.app/app/api/relayer/run'

function base64url(input: string) {
  return Buffer.from(input).toString('base64url')
}

/**
 * What QStash puts in `Upstash-Signature`: an HS256 JWT issued by "Upstash"
 * whose subject is the destination URL and whose `body` claim is the
 * base64url SHA-256 of the raw request body.
 */
function mintSignature(options: {
  key: string
  body: string
  url?: string
  now?: number
}) {
  const now = options.now ?? Math.floor(Date.now() / 1000)
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = base64url(
    JSON.stringify({
      iss: 'Upstash',
      sub: options.url ?? runUrl,
      iat: now,
      nbf: now,
      exp: now + 300,
      jti: randomUUID(),
      body: createHash('sha256').update(options.body).digest('base64url'),
    })
  )
  const mac = createHmac('sha256', options.key)
    .update(`${header}.${payload}`)
    .digest('base64url')
  return `${header}.${payload}.${mac}`
}

function request(init: { signature?: string; token?: string } = {}) {
  const headers = new Headers()
  if (init.signature) headers.set('upstash-signature', init.signature)
  if (init.token) headers.set('x-relayer-token', init.token)
  return new Request(runUrl, { method: 'POST', headers })
}

describe('requireRelayerTrigger', () => {
  beforeEach(() => {
    process.env.RELAYER_ADMIN_TOKEN = adminToken
    process.env.QSTASH_CURRENT_SIGNING_KEY = currentKey
    process.env.QSTASH_NEXT_SIGNING_KEY = nextKey
    delete process.env.QSTASH_RELAYER_RUN_URL
  })

  afterEach(() => {
    delete process.env.RELAYER_ADMIN_TOKEN
    delete process.env.QSTASH_CURRENT_SIGNING_KEY
    delete process.env.QSTASH_NEXT_SIGNING_KEY
    delete process.env.QSTASH_RELAYER_RUN_URL
  })

  it('accepts a request QStash signed with the current key', async () => {
    const body = ''
    const signature = mintSignature({ key: currentKey, body })

    await expect(
      requireRelayerTrigger(request({ signature }), body)
    ).resolves.toBe('qstash')
  })

  it('accepts a signature made with the next key during rotation', async () => {
    const body = ''
    const signature = mintSignature({ key: nextKey, body })

    await expect(
      requireRelayerTrigger(request({ signature }), body)
    ).resolves.toBe('qstash')
  })

  it('rejects a signature made with an unknown key', async () => {
    const body = ''
    const signature = mintSignature({ key: strangerKey, body })

    await expect(
      requireRelayerTrigger(request({ signature }), body)
    ).rejects.toThrow('Unauthorized relayer request.')
  })

  it('rejects a signature whose body hash does not match the received body', async () => {
    const signature = mintSignature({ key: currentKey, body: '{"limit":50}' })

    await expect(
      requireRelayerTrigger(request({ signature }), '')
    ).rejects.toThrow('Unauthorized relayer request.')
  })

  it('rejects an expired signature', async () => {
    const body = ''
    const signature = mintSignature({
      key: currentKey,
      body,
      now: Math.floor(Date.now() / 1000) - 3600,
    })

    await expect(
      requireRelayerTrigger(request({ signature }), body)
    ).rejects.toThrow('Unauthorized relayer request.')
  })

  it('rejects a signature for another destination when the run URL is pinned', async () => {
    process.env.QSTASH_RELAYER_RUN_URL = runUrl
    const body = ''
    const signature = mintSignature({
      key: currentKey,
      body,
      url: 'https://attacker.example/app/api/relayer/run',
    })

    await expect(
      requireRelayerTrigger(request({ signature }), body)
    ).rejects.toThrow('Unauthorized relayer request.')
  })

  it('accepts a signature for the pinned destination', async () => {
    process.env.QSTASH_RELAYER_RUN_URL = runUrl
    const body = ''
    const signature = mintSignature({ key: currentKey, body, url: runUrl })

    await expect(
      requireRelayerTrigger(request({ signature }), body)
    ).resolves.toBe('qstash')
  })

  it('reports a configuration error when a signature arrives but no signing key is set', async () => {
    delete process.env.QSTASH_CURRENT_SIGNING_KEY
    delete process.env.QSTASH_NEXT_SIGNING_KEY
    const body = ''
    const signature = mintSignature({ key: currentKey, body })

    await expect(
      requireRelayerTrigger(request({ signature }), body)
    ).rejects.toThrow('QSTASH_CURRENT_SIGNING_KEY')
  })

  it('does not let the operator token rescue a bad signature', async () => {
    const body = ''
    const signature = mintSignature({ key: strangerKey, body })

    await expect(
      requireRelayerTrigger(request({ signature, token: adminToken }), body)
    ).rejects.toThrow('Unauthorized relayer request.')
  })

  it('falls back to the operator credential when no signature is present', async () => {
    await expect(
      requireRelayerTrigger(request({ token: adminToken }), '')
    ).resolves.toBe('operator')
  })

  it('rejects an unsigned request without an operator credential', async () => {
    await expect(requireRelayerTrigger(request(), '')).rejects.toThrow(
      'Unauthorized relayer request.'
    )
  })
})
