import { createHmac, timingSafeEqual } from 'node:crypto'

export const RELAYER_SESSION_COOKIE = 'sta_relayer_session'
export const RELAYER_SESSION_TTL_SECONDS = 60 * 60 * 8

function sign(adminToken: string, expiresAt: number) {
  return createHmac('sha256', adminToken)
    .update(`relayer-session:${expiresAt}`)
    .digest('hex')
}

export function createSessionValue(
  adminToken: string,
  now = Math.floor(Date.now() / 1000)
) {
  const expiresAt = now + RELAYER_SESSION_TTL_SECONDS
  return `${expiresAt}.${sign(adminToken, expiresAt)}`
}

export function verifySessionValue(
  adminToken: string,
  value: string | undefined,
  now = Math.floor(Date.now() / 1000)
) {
  if (!value) {
    return false
  }

  const [rawExpiry, mac] = value.split('.')
  const expiresAt = Number(rawExpiry)
  if (!Number.isSafeInteger(expiresAt) || !mac || expiresAt <= now) {
    return false
  }

  const expected = Buffer.from(sign(adminToken, expiresAt), 'hex')
  const received = Buffer.from(mac, 'hex')
  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  )
}
