import { timingSafeEqual } from 'node:crypto'

import { mayQueueForTreasury } from '@/lib/auth/treasuryAccess'
import {
  OPERATOR_SUBJECT,
  RELAYER_SESSION_COOKIE,
  readSessionSubject,
  verifySessionValue,
} from '@/lib/relayer/session'

function tokensMatch(a: string, b: string) {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get('cookie')
  if (!header) {
    return undefined
  }

  for (const part of header.split(';')) {
    const separatorIndex = part.indexOf('=')
    if (separatorIndex === -1) {
      continue
    }
    const key = part.slice(0, separatorIndex).trim()
    if (key === name) {
      // The session cookie value is always `<digits>.<hex>` (see
      // createSessionValue), which never contains percent-encoded bytes, so
      // no decodeURIComponent is needed here (and it could otherwise throw
      // on a malformed cookie, turning a clean 401 into a 500).
      return part.slice(separatorIndex + 1).trim()
    }
  }

  return undefined
}

/**
 * Whether this request carries a live relayer *session* cookie.
 *
 * Deliberately blind to `x-relayer-token`: that header authorizes one CLI
 * mutation, it is not a session. Reporting it as one would let the console
 * claim an unlock that no subsequent browser request could reproduce.
 *
 * Exists so the console can ask the server whether the httpOnly cookie it
 * cannot read is still valid — without it, a page refresh shows a locked
 * session while the server would still accept the call.
 */
export function readRelayerSessionSubject(request: Request): string | null {
  const adminToken = process.env.RELAYER_ADMIN_TOKEN
  if (!adminToken) return null
  return readSessionSubject(
    adminToken,
    readCookie(request, RELAYER_SESSION_COOKIE)
  )
}

export function hasValidRelayerSession(request: Request): boolean {
  const adminToken = process.env.RELAYER_ADMIN_TOKEN
  if (!adminToken) return false

  return verifySessionValue(
    adminToken,
    readCookie(request, RELAYER_SESSION_COOKIE)
  )
}

/**
 * Authorizes a relayer mutation via either credential:
 * - the `x-relayer-token` header, matched against `RELAYER_ADMIN_TOKEN` with a
 *   timing-safe comparison (used by the `pnpm relayer:run` CLI), or
 * - a valid `sta_relayer_session` cookie minted by `POST /api/relayer/session`
 *   (used by the browser console after the operator unlocks it).
 *
 * Throws when neither credential authenticates.
 */
export function requireRelayerAdmin(request: Request) {
  const adminToken = process.env.RELAYER_ADMIN_TOKEN
  if (!adminToken) {
    throw new Error(
      'RELAYER_ADMIN_TOKEN must be configured before mutating relayer jobs.'
    )
  }

  const headerToken = request.headers.get('x-relayer-token')
  if (headerToken && tokensMatch(headerToken, adminToken)) {
    return
  }

  const sessionCookie = readCookie(request, RELAYER_SESSION_COOKIE)
  if (verifySessionValue(adminToken, sessionCookie)) {
    return
  }

  throw new Error('Unauthorized relayer request.')
}

/**
 * Authorizes a request to act on one specific treasury's relayer queue.
 *
 * Two callers pass. The operator -- `x-relayer-token`, or an operator session
 * -- keeps blanket access, because that is what runs the batch and the CLI. A
 * wallet session passes only for a treasury whose signers include the address
 * it proved, which is the check that makes the queue usable without handing
 * every user the operator's shared secret.
 *
 * `requireRelayerAdmin` stays the gate for anything not scoped to one
 * treasury: running the whole batch is an operator action, and no single
 * treasury's signer should be able to reach into it.
 */
export async function requireTreasuryAccess(
  request: Request,
  smartAccountId: string
) {
  const adminToken = process.env.RELAYER_ADMIN_TOKEN
  if (!adminToken) {
    throw new Error(
      'RELAYER_ADMIN_TOKEN must be configured before mutating relayer jobs.'
    )
  }

  const headerToken = request.headers.get('x-relayer-token')
  if (headerToken && tokensMatch(headerToken, adminToken)) {
    return
  }

  const subject = readSessionSubject(
    adminToken,
    readCookie(request, RELAYER_SESSION_COOKIE)
  )
  if (!subject) {
    throw new Error('Unauthorized relayer request.')
  }
  if (subject === OPERATOR_SUBJECT) {
    return
  }
  if (await mayQueueForTreasury(subject, smartAccountId)) {
    return
  }

  throw new Error(
    `Unauthorized relayer request: ${subject} is not a signer of ${smartAccountId}.`
  )
}
