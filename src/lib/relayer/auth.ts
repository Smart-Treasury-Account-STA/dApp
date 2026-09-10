import { timingSafeEqual } from 'node:crypto'

import { mayQueueForTreasury } from '@/lib/auth/treasuryAccess'
import {
  RELAYER_SESSION_COOKIE,
  readSessionSubject,
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
      // The session cookie value is always `<strkey>.<digits>.<hex>` (see
      // createSessionValue), none of which can contain percent-encoded
      // bytes, so no decodeURIComponent is needed here (and it could
      // otherwise throw on a malformed cookie, turning a clean 401 into a
      // 500).
      return part.slice(separatorIndex + 1).trim()
    }
  }

  return undefined
}

function requireAdminToken() {
  const adminToken = process.env.RELAYER_ADMIN_TOKEN
  if (!adminToken) {
    throw new Error(
      'RELAYER_ADMIN_TOKEN must be configured before mutating relayer jobs.'
    )
  }
  return adminToken
}

function hasHeaderToken(request: Request, adminToken: string) {
  const headerToken = request.headers.get('x-relayer-token')
  return Boolean(headerToken && tokensMatch(headerToken, adminToken))
}

/**
 * The address the request's relayer session cookie belongs to, or null.
 *
 * Deliberately blind to `x-relayer-token`: that header authorizes one
 * operator call, it is not a session, and it names no address.
 *
 * Exists so the console can ask the server whether the httpOnly cookie it
 * cannot read is still valid -- without it, a page refresh would prompt the
 * wallet to sign again while the server would still accept the call.
 */
export function readRelayerSessionSubject(request: Request): string | null {
  const adminToken = process.env.RELAYER_ADMIN_TOKEN
  if (!adminToken) return null
  return readSessionSubject(
    adminToken,
    readCookie(request, RELAYER_SESSION_COOKIE)
  )
}

/**
 * Authorizes an operator action: the `x-relayer-token` header, matched
 * against `RELAYER_ADMIN_TOKEN` with a timing-safe comparison. That is the
 * credential `pnpm relayer:run` sends; the console never holds it.
 *
 * A session cookie does not pass here on purpose. Sessions belong to wallet
 * addresses and are scoped per treasury by `requireTreasuryAccess`; the
 * actions behind this gate -- running the whole batch, listing every
 * treasury's jobs -- are not scoped to one treasury, and no single
 * treasury's signer should be able to reach into them.
 *
 * Throws when the header is absent or wrong.
 */
export function requireRelayerAdmin(request: Request) {
  if (hasHeaderToken(request, requireAdminToken())) {
    return
  }

  throw new Error('Unauthorized relayer request.')
}

/**
 * Authorizes a request to act on one specific treasury's relayer queue.
 *
 * Two callers pass. The operator -- `x-relayer-token` -- keeps blanket
 * access, because that is what the CLI uses. A wallet session passes only
 * for a treasury whose signers include the address it proved, which is the
 * check that makes the queue usable without handing every user the
 * operator's shared secret.
 */
export async function requireTreasuryAccess(
  request: Request,
  smartAccountId: string
) {
  const adminToken = requireAdminToken()
  if (hasHeaderToken(request, adminToken)) {
    return
  }

  const subject = readSessionSubject(
    adminToken,
    readCookie(request, RELAYER_SESSION_COOKIE)
  )
  if (!subject) {
    throw new Error('Unauthorized relayer request.')
  }
  if (await mayQueueForTreasury(subject, smartAccountId)) {
    return
  }

  throw new Error(
    `Unauthorized relayer request: ${subject} is not a signer of ${smartAccountId}.`
  )
}
