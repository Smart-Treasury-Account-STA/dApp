import { NextResponse } from 'next/server'

import { verifyChallenge } from '@/lib/auth/challenge'
import { verifyWalletSignature } from '@/lib/auth/walletProof'
import { readRelayerSessionSubject } from '@/lib/relayer/auth'
import {
  RELAYER_SESSION_COOKIE,
  RELAYER_SESSION_TTL_SECONDS,
  createSessionValue,
} from '@/lib/relayer/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Reports whether the caller's session cookie is still live, and for which
 * address.
 *
 * Unauthenticated on purpose: it *is* the authentication check, and it
 * reveals nothing a caller does not already hold -- only whether the cookie
 * they already sent is valid. Without it the console cannot know, because
 * the cookie is httpOnly, and it would prompt the wallet to sign again on
 * every page load while the server kept accepting the calls behind them.
 *
 * Not a claim of authorization: the routes decide that per treasury.
 */
export async function GET(request: Request) {
  const subject = readRelayerSessionSubject(request)
  return NextResponse.json({ active: subject !== null, subject })
}

/**
 * Opens a session for a wallet: `{ challenge, signedMessage }` proves it
 * holds the key for the address the challenge was issued to. The subject of
 * the resulting session is that address, which is what lets a later route
 * scope work to the treasuries the address may act on.
 *
 * There is no token-based variant. The operator's credential is the
 * `x-relayer-token` header on the calls that need it (the CLI runner); it
 * never becomes a browser session, so it never has to be typed into one.
 */
export async function POST(request: Request) {
  const adminToken = process.env.RELAYER_ADMIN_TOKEN
  if (!adminToken) {
    return NextResponse.json(
      { error: 'Relayer admin token is not configured.' },
      { status: 500 }
    )
  }

  const body = (await request.json().catch(() => null)) as {
    challenge?: string
    signedMessage?: string
  } | null

  // The address comes from the challenge the server itself minted, never
  // from the request body -- a caller cannot name the address they want to
  // become, only sign the one they were given.
  const challenge = typeof body?.challenge === 'string' ? body.challenge : null
  const address = challenge ? verifyChallenge(adminToken, challenge) : null
  const subject =
    challenge &&
    address &&
    verifyWalletSignature(address, challenge, body?.signedMessage)
      ? address
      : null

  if (!subject) {
    return NextResponse.json({ error: 'Invalid credentials.' }, { status: 401 })
  }

  const response = NextResponse.json({ ok: true, subject })
  response.cookies.set(
    RELAYER_SESSION_COOKIE,
    createSessionValue(adminToken, subject),
    {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: RELAYER_SESSION_TTL_SECONDS,
    }
  )
  return response
}
