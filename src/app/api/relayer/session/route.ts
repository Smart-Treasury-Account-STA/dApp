import { NextResponse } from 'next/server'

import { timingSafeEqual } from 'node:crypto'

import { verifyChallenge } from '@/lib/auth/challenge'
import { verifyWalletSignature } from '@/lib/auth/walletProof'
import { hasValidRelayerSession } from '@/lib/relayer/auth'
import {
  OPERATOR_SUBJECT,
  RELAYER_SESSION_COOKIE,
  RELAYER_SESSION_TTL_SECONDS,
  createSessionValue,
} from '@/lib/relayer/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function tokensMatch(a: string, b: string) {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

/**
 * Reports whether the caller's session cookie is still live.
 *
 * Unauthenticated on purpose: it *is* the authentication check, and it
 * reveals nothing a caller does not already hold — only whether the cookie
 * they already sent is valid. Without it the console cannot know, because the
 * cookie is httpOnly and every relayer-gated button would sit disabled after
 * a refresh while the server kept accepting the calls behind them.
 */
export async function GET(request: Request) {
  return NextResponse.json({ active: hasValidRelayerSession(request) })
}

/**
 * Opens a session for one of two callers, into the same cookie.
 *
 * `{ token }` is the operator: whoever holds `RELAYER_ADMIN_TOKEN`. That is
 * the credential the CLI runner and the operator console use, and it must
 * never reach an ordinary user.
 *
 * `{ challenge, signedMessage }` is a wallet proving it holds the key for the
 * address the challenge was issued to. The subject of the resulting session
 * is that address, which is what lets a later route scope work to the
 * treasuries the address may act on -- an operator token cannot say who is
 * asking, only that someone knew a shared secret.
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
    token?: string
    challenge?: string
    signedMessage?: string
  } | null

  let subject: string | null = null

  if (typeof body?.token === 'string') {
    if (tokensMatch(body.token, adminToken)) {
      subject = OPERATOR_SUBJECT
    }
  } else if (typeof body?.challenge === 'string') {
    const address = verifyChallenge(adminToken, body.challenge)
    // The address comes from the challenge the server itself minted, never
    // from the request body -- a caller cannot name the address they want to
    // become, only sign the one they were given.
    if (
      address &&
      verifyWalletSignature(address, body.challenge, body.signedMessage)
    ) {
      subject = address
    }
  }

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

export async function DELETE() {
  const response = NextResponse.json({ ok: true })
  response.cookies.delete(RELAYER_SESSION_COOKIE)
  return response
}
