import { NextResponse } from 'next/server'

import { requireTreasuryAccess } from '@/lib/relayer/auth'
import { executeRelayerJobById } from '@/lib/relayer/executor'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ intentId: string }> }
) {
  try {
    const { intentId } = await params
    const smartAccountId = new URL(request.url).searchParams.get(
      'smartAccountId'
    )
    if (!smartAccountId) {
      return NextResponse.json(
        { error: 'A smartAccountId query parameter is required.' },
        { status: 400 }
      )
    }
    // Authorized against this treasury specifically, not the deployment as a
    // whole -- the parameter has to be read before the check can mean
    // anything.
    await requireTreasuryAccess(request, smartAccountId)
    const updated = await executeRelayerJobById(smartAccountId, intentId)
    return NextResponse.json({ job: updated })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const status = message.includes('Unauthorized')
      ? 401
      : message.includes('RELAYER_ADMIN_TOKEN')
        ? 503
        : message.includes('not found')
          ? 404
          : 500
    return NextResponse.json({ error: message }, { status })
  }
}
