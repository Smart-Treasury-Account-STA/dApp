import { NextResponse } from 'next/server'

import { StrKey } from '@stellar/stellar-sdk'

import { CHALLENGE_TTL_SECONDS, issueChallenge } from '@/lib/auth/challenge'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Hands out a short-lived string for a wallet to sign, proving it holds the
 * key for the address it claims.
 *
 * Unauthenticated on purpose: it is the first half of authentication, and it
 * gives away nothing. A challenge is worthless without the signature, and it
 * is bound to the address asked for -- requesting one for someone else's
 * address produces a string only that address can turn into a session.
 *
 * `RELAYER_ADMIN_TOKEN` keys the MAC. It is not being used as an operator
 * credential here, only as the server secret this deployment already has;
 * rotating it invalidates outstanding challenges, which live two minutes.
 */
export async function POST(request: Request) {
  const secret = process.env.RELAYER_ADMIN_TOKEN
  if (!secret) {
    return NextResponse.json(
      { error: 'Wallet authentication is not configured.' },
      { status: 503 }
    )
  }

  const body = (await request.json().catch(() => null)) as {
    address?: string
  } | null

  if (
    typeof body?.address !== 'string' ||
    !StrKey.isValidEd25519PublicKey(body.address)
  ) {
    return NextResponse.json(
      { error: 'A Stellar account id is required.' },
      { status: 400 }
    )
  }

  return NextResponse.json({
    challenge: issueChallenge(secret, body.address),
    expiresInSeconds: CHALLENGE_TTL_SECONDS,
  })
}
