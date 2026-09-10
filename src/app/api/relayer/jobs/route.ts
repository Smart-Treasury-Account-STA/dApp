import { NextResponse } from 'next/server'

import { requireRelayerAdmin, requireTreasuryAccess } from '@/lib/relayer/auth'
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

/**
 * Lists relayer jobs.
 *
 * Filtered by `smartAccountId`, this stays open: a job record restates what
 * the ledger already published for that treasury -- intent id, window, how
 * many executions it has had -- and the console reads it on every treasury
 * page. The unfiltered listing is different: it *enumerates* every treasury
 * this deployment has ever queued work for, which no visitor should be able
 * to walk. That one is the operator's.
 */
export async function GET(request: Request) {
  const smartAccountId = new URL(request.url).searchParams.get('smartAccountId')
  if (smartAccountId) {
    return NextResponse.json({
      jobs: await listRelayerJobsForTreasury(smartAccountId),
    })
  }

  try {
    requireRelayerAdmin(request)
  } catch {
    return NextResponse.json(
      { error: "Listing every treasury's jobs requires an operator session." },
      { status: 401 }
    )
  }
  return NextResponse.json({ jobs: await listRelayerJobs() })
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as unknown
    if (!isCreateRelayerJobInput(body)) {
      return NextResponse.json(
        { error: 'Invalid relayer job payload.' },
        { status: 400 }
      )
    }
    // Authorized against the treasury named in the payload, so a caller can
    // only queue work for a treasury they sign for -- validated first, since
    // the check needs a smartAccountId to mean anything.
    await requireTreasuryAccess(request, body.smartAccountId)

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
