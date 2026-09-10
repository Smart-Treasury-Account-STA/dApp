import { createHmac, timingSafeEqual } from 'node:crypto'

export const RELAYER_SESSION_COOKIE = 'sta_relayer_session'
export const RELAYER_SESSION_TTL_SECONDS = 60 * 60 * 8

/**
 * The subject of an operator session: whoever proved they hold
 * `RELAYER_ADMIN_TOKEN`. Not an address, and deliberately not shaped like
 * one -- a strkey is base32, so no account id can ever collide with it.
 */
export const OPERATOR_SUBJECT = 'operator'

/**
 * One cookie, two kinds of caller.
 *
 * The session used to say only "someone knew the admin token", which is all
 * there was to say while the relayer had a single operator. A treasury
 * deployed from the dApp has its own signers, so a session now also has to be
 * able to say *which address* proved itself -- otherwise every route that
 * wants to scope work to one treasury has nothing to scope by.
 *
 * Both live in the same cookie, discriminated by their subject, so the routes
 * have one place to look rather than two cookies to reconcile. The subject is
 * inside the MAC'd payload: rewriting it invalidates the session rather than
 * escalating it.
 */
function sign(secret: string, subject: string, expiresAt: number) {
  return createHmac('sha256', secret)
    .update(`relayer-session:${subject}:${expiresAt}`)
    .digest('hex')
}

export function createSessionValue(
  secret: string,
  subject: string = OPERATOR_SUBJECT,
  now = Math.floor(Date.now() / 1000)
) {
  if (subject.includes('.')) {
    throw new Error('A session subject cannot contain the field separator.')
  }
  const expiresAt = now + RELAYER_SESSION_TTL_SECONDS
  return `${subject}.${expiresAt}.${sign(secret, subject, expiresAt)}`
}

/**
 * Returns the subject a live session belongs to, or null when the cookie is
 * absent, expired, malformed, or not minted by this server.
 */
export function readSessionSubject(
  secret: string,
  value: string | undefined,
  now = Math.floor(Date.now() / 1000)
): string | null {
  if (!value) return null

  const [subject, rawExpiry, mac] = value.split('.')
  if (!subject || !mac) return null

  const expiresAt = Number(rawExpiry)
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) return null

  const expected = Buffer.from(sign(secret, subject, expiresAt), 'hex')
  const received = Buffer.from(mac, 'hex')
  if (
    expected.length !== received.length ||
    !timingSafeEqual(expected, received)
  ) {
    return null
  }
  return subject
}

/** Whether the cookie carries a live *operator* session specifically. */
export function verifySessionValue(
  secret: string,
  value: string | undefined,
  now = Math.floor(Date.now() / 1000)
) {
  return readSessionSubject(secret, value, now) === OPERATOR_SUBJECT
}
