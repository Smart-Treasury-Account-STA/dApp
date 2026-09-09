import { NextResponse } from 'next/server'

import { timingSafeEqual } from 'node:crypto'

import { hasValidRelayerSession } from '@/lib/relayer/auth'
import {
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
  } | null
  if (typeof body?.token !== 'string' || !tokensMatch(body.token, adminToken)) {
    return NextResponse.json(
      { error: 'Invalid operator token.' },
      { status: 401 }
    )
  }

  const response = NextResponse.json({ ok: true })
  response.cookies.set(RELAYER_SESSION_COOKIE, createSessionValue(adminToken), {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: RELAYER_SESSION_TTL_SECONDS,
  })
  return response
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true })
  response.cookies.delete(RELAYER_SESSION_COOKIE)
  return response
}
