import { NextResponse } from 'next/server'

import { runDueRelayerJobs } from '@/lib/relayer/executor'
import { requireRelayerTrigger } from '@/lib/relayer/qstash'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// A run polls each submitted transaction for up to 30 s and handles up to
// five jobs, after the simulations that precede every submission. The
// platform default would cut that short and strand a job in `executing`
// until its lease expires; 300 s is within every Vercel plan's ceiling under
// Fluid compute.
export const maxDuration = 300

/**
 * Runs every queued job whose ledger window is open.
 *
 * Two callers reach this route: an operator (the console's "Run due jobs"
 * button or `pnpm relayer:run`, authorized by `RELAYER_ADMIN_TOKEN`) and a
 * QStash schedule (authorized by the signature on its delivery). Overlapping
 * or repeated runs are safe by construction: the executor re-reads each
 * intent and `is_child_executed` on chain before submitting, and the job
 * store's optimistic versioning stops two runs from claiming one job. That is
 * what makes QStash retries acceptable -- a non-2xx status here is the signal
 * that asks for one, so failures are reported as such rather than swallowed.
 */
export async function POST(request: Request) {
  try {
    // Read the body before anything else: the QStash signature commits to
    // these exact bytes, and a request body can only be consumed once.
    const rawBody = await request.text()
    const trigger = await requireRelayerTrigger(request, rawBody)
    const result = await runDueRelayerJobs()
    return NextResponse.json({ trigger, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const status = message.includes('Unauthorized')
      ? 401
      : message.includes('RELAYER_ADMIN_TOKEN') || message.includes('QSTASH_')
        ? 503
        : 500
    return NextResponse.json({ error: message }, { status })
  }
}
