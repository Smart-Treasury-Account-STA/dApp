import { NextResponse } from 'next/server'

import { requireRelayerAdmin } from '@/lib/relayer/auth'
import { readQueueableScheduledIntent } from '@/lib/relayer/executor'
import {
  createRelayerJob,
  listRelayerJobs,
  listRelayerJobsForTreasury,
} from '@/lib/relayer/store'
import type { CreateRelayerJobInput } from '@/lib/relayer/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isCreateRelayerJobInput(
  value: unknown
): value is CreateRelayerJobInput {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.smartAccountId === 'string' &&
    typeof candidate.intentId === 'string' &&
    Number.isFinite(candidate.startLedger) &&
    Number.isFinite(candidate.endLedger) &&
    Number.isFinite(candidate.maxExecutions)
  )
}

export async function GET(request: Request) {
  const smartAccountId = new URL(request.url).searchParams.get('smartAccountId')
  const jobs = smartAccountId
    ? await listRelayerJobsForTreasury(smartAccountId)
    : await listRelayerJobs()
  return NextResponse.json({ jobs })
}

export async function POST(request: Request) {
  try {
    requireRelayerAdmin(request)
    const body = (await request.json()) as unknown
    if (!isCreateRelayerJobInput(body)) {
      return NextResponse.json(
        { error: 'Invalid relayer job payload.' },
        { status: 400 }
      )
    }

    const canonicalIntent = await readQueueableScheduledIntent(
      body.smartAccountId,
      body.intentId
    )
    const job = await createRelayerJob(canonicalIntent)
    return NextResponse.json({ job })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const status = message.includes('Unauthorized')
      ? 401
      : message.includes('RELAYER_ADMIN_TOKEN')
        ? 503
        : 400
    return NextResponse.json({ error: message }, { status })
  }
}
