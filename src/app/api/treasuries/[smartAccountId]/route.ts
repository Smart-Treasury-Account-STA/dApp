import { NextResponse } from 'next/server'

import { getTreasury } from '@/lib/treasuryRegistry/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ smartAccountId: string }> }
) {
  const { smartAccountId } = await params
  const treasury = await getTreasury(smartAccountId)
  if (!treasury) {
    return NextResponse.json({ error: 'Treasury not found.' }, { status: 404 })
  }
  return NextResponse.json({ treasury })
}
