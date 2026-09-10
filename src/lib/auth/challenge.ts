import { StrKey } from '@stellar/stellar-sdk'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * How long a challenge stays signable. Short on purpose: the window is the
 * only thing bounding replay, because these challenges are stateless.
 */
export const CHALLENGE_TTL_SECONDS = 120

const PREFIX = 'sta-auth'

/**
 * Issues a challenge for `address` to sign, carrying its own proof of issue.
 *
 * Deliberately stateless. A nonce kept server-side would have to be readable
 * by whichever serverless instance receives the *next* request, which means a
 * database round trip on the login path and a row to expire. Instead the
 * challenge carries the address and the issue time in plain sight, MAC'd with
 * a server-only secret: the instance that verifies it needs nothing but that
 * secret to know it issued the thing, and to know when.
 *
 * The trade-off is honest and bounded: within its TTL a challenge is not
 * single-use, so a signature captured in that window could be replayed. What
 * that buys an attacker is a session for an address they were already able to
 * make sign -- not the ability to forge one for an address they cannot. Making
 * it single-use means storing spent nonces, which is the database round trip
 * this avoids; revisit if the window ever needs to be long.
 *
 * The random component is not what makes the challenge unforgeable (the MAC
 * is). It is what stops two challenges issued to the same address in the same
 * second from being the same string, so a signature for one is not a
 * signature for the other.
 */
export function issueChallenge(
  secret: string,
  address: string,
  now = Math.floor(Date.now() / 1000)
): string {
  if (!StrKey.isValidEd25519PublicKey(address)) {
    throw new Error('A challenge can only be issued for a Stellar account id.')
  }
  const body = `${PREFIX}:${address}:${now}:${randomBytes(16).toString('hex')}`
  return `${body}.${sign(secret, body)}`
}

/**
 * Returns the address a challenge was issued for, or null if it was not
 * issued by this server, has expired, or is malformed.
 *
 * Never throws on bad input: every rejection here is an ordinary
 * unauthenticated request, not an exceptional condition.
 */
export function verifyChallenge(
  secret: string,
  challenge: string | undefined,
  now = Math.floor(Date.now() / 1000)
): string | null {
  if (!challenge) return null

  const separator = challenge.lastIndexOf('.')
  if (separator === -1) return null

  const body = challenge.slice(0, separator)
  const mac = challenge.slice(separator + 1)
  if (!macsMatch(sign(secret, body), mac)) return null

  const [prefix, address, rawIssuedAt] = body.split(':')
  if (prefix !== PREFIX) return null

  const issuedAt = Number(rawIssuedAt)
  if (!Number.isSafeInteger(issuedAt)) return null
  // A challenge from the future is as wrong as an expired one: it means the
  // MAC held for a body this server did not issue now, which cannot happen,
  // or that clocks moved. Either way, refuse rather than widen the window.
  if (issuedAt > now || now - issuedAt > CHALLENGE_TTL_SECONDS) return null

  return StrKey.isValidEd25519PublicKey(address) ? address : null
}

function sign(secret: string, body: string) {
  return createHmac('sha256', secret).update(body).digest('hex')
}

function macsMatch(expected: string, received: string) {
  const left = Buffer.from(expected, 'hex')
  const right = Buffer.from(received, 'hex')
  return left.length === right.length && timingSafeEqual(left, right)
}
