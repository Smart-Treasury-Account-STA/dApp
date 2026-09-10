import { createHmac, timingSafeEqual } from 'node:crypto'

export const RELAYER_SESSION_COOKIE = 'sta_relayer_session'
export const RELAYER_SESSION_TTL_SECONDS = 60 * 60 * 8

/**
 * The relayer session cookie: `<subject>.<expiresAt>.<mac>`, where the
 * subject is the Stellar address that proved itself by signing a challenge
 * (`POST /api/relayer/session`).
 *
 * The session used to carry a second kind of subject, `operator`, minted
 * from the shared admin token for the console's unlock panel. That panel is
 * gone: everything a user does from the console is authorized per treasury
 * by the address in this cookie, and the two remaining operator actions --
 * running the batch, listing every treasury's jobs -- take the token as a
 * header (`x-relayer-token`, from the CLI) or a signed delivery (QStash).
 * So the only subject a session can have is an address.
 *
 * The subject is inside the MAC'd payload: rewriting it invalidates the
 * session rather than turning one address into another.
 */
function sign(secret: string, subject: string, expiresAt: number) {
  return createHmac('sha256', secret)
    .update(`relayer-session:${subject}:${expiresAt}`)
    .digest('hex')
}

export function createSessionValue(
  secret: string,
  subject: string,
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
