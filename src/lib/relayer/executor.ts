import { Keypair, rpc } from '@stellar/stellar-sdk'
import { Buffer } from 'buffer'
import {
  findEvent,
  isChildExecuted,
  parseContractEvents,
  prepareRelayerExecution,
  readScheduledIntent,
} from 'sta-sdk'
import type { NetworkConfig } from 'sta-sdk'

import { STELLAR_CONFIG, toNetworkConfig } from '@/config'
import { truncateAddress } from '@/lib/format'
import {
  isRelayerJobInFlight,
  isTerminalRelayerJob,
} from '@/lib/relayer/jobStatus'
import {
  getRelayerJob,
  listRelayerJobs,
  tryUpdateRelayerJob,
  updateRelayerJob,
} from '@/lib/relayer/store'
import type {
  CreateRelayerJobInput,
  RelayerJobRecord,
  RelayerRunResult,
} from '@/lib/relayer/types'
import { resolveTreasuryContracts } from '@/lib/treasuryRegistry/resolveContracts'

type IntentRegistryState = {
  cancelled?: boolean
  end_ledger?: number
  endLedger?: number
  execution_count?: number
  executionCount?: number
  intent_id?: unknown
  intentId?: unknown
  max_executions?: number
  maxExecutions?: number
  start_ledger?: number
  startLedger?: number
}

function intentIdBytes(hex: string): Buffer {
  const bytes = Buffer.from(hex.replace(/^0x/i, ''), 'hex')
  if (bytes.length !== 32) {
    throw new Error('Intent ID must be 32 bytes encoded as 64 hex characters.')
  }
  return bytes
}

function getExecutorKeypair() {
  const secret = process.env.RELAYER_EXECUTOR_SECRET
  if (!secret) {
    throw new Error('RELAYER_EXECUTOR_SECRET is not configured.')
  }
  return Keypair.fromSecret(secret)
}

function numeric(value: unknown, fallback: number) {
  if (typeof value === 'number') return value
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'string') return Number(value)
  return fallback
}

async function readIntentState(
  net: NetworkConfig,
  sourceAddress: string,
  job: RelayerJobRecord
) {
  const intentId = intentIdBytes(job.intentId)
  const intent = (await readScheduledIntent(
    net,
    sourceAddress,
    intentId
  )) as IntentRegistryState | null
  const childExecuted = await isChildExecuted(
    net,
    sourceAddress,
    intentId,
    job.childSequence
  )

  return {
    cancelled: Boolean(intent?.cancelled),
    childExecuted,
    executionCount: numeric(
      intent?.execution_count ?? intent?.executionCount,
      job.executionCount
    ),
    maxExecutions: numeric(
      intent?.max_executions ?? intent?.maxExecutions,
      job.maxExecutions
    ),
  }
}

export async function readQueueableScheduledIntent(
  smartAccountId: string,
  intentId: string
): Promise<CreateRelayerJobInput> {
  const contracts = await resolveTreasuryContracts(smartAccountId)
  const executor = getExecutorKeypair()
  const intent = (await readScheduledIntent(
    toNetworkConfig(contracts),
    executor.publicKey(),
    intentIdBytes(intentId)
  )) as IntentRegistryState | null

  if (!intent) {
    throw new Error('Scheduled intent was not found on-chain.')
  }
  if (intent.cancelled) {
    throw new Error('Scheduled intent is cancelled on-chain.')
  }

  return {
    smartAccountId,
    intentId,
    startLedger: numeric(intent.start_ledger ?? intent.startLedger, 0),
    endLedger: numeric(intent.end_ledger ?? intent.endLedger, 0),
    maxExecutions: numeric(intent.max_executions ?? intent.maxExecutions, 0),
  }
}

function describeExecution(
  result: rpc.Api.GetSuccessfulTransactionResponse
): string {
  const eventsForOp = result.events?.contractEventsXdr?.[0]
  const executed = eventsForOp
    ? findEvent(parseContractEvents(eventsForOp), 'auto_ok')
    : undefined
  return executed
    ? `Executed child ${executed.child_sequence}: ${executed.amount.toString()} of ${truncateAddress(executed.asset)} to ${truncateAddress(executed.destination)}.`
    : 'Scheduled payment executed exactly once for the consumed child sequence.'
}

/**
 * Writes `update` only while the store still holds the child sequence this
 * run acted on, and returns the job as the store then holds it.
 *
 * Once another run has recorded that child -- executed it, or found it
 * consumed -- what this run learned about it is stale, and writing it would
 * undo the other run's record: a refused duplicate turning `executed` into
 * `failed`, or the child sequence advancing twice.
 */
async function updateForChild(
  job: RelayerJobRecord,
  update: (current: RelayerJobRecord) => RelayerJobRecord
) {
  const { job: current } = await tryUpdateRelayerJob(
    job.smartAccountId,
    job.intentId,
    (current) =>
      current.childSequence === job.childSequence ? update(current) : null
  )
  return current
}

/**
 * Records one successful on-chain execution: the child sequence advances,
 * and the job is `executed` once the execution count meets the lower of the
 * local and (when known) on-chain limits, `ready` otherwise.
 */
function recordExecution(
  job: RelayerJobRecord,
  txHash: string,
  note: string,
  maxExecutionsOnChain?: number
) {
  return updateForChild(job, (current) => {
    const executionCount = current.executionCount + 1
    const limit = Math.min(
      current.maxExecutions,
      maxExecutionsOnChain ?? current.maxExecutions
    )
    return {
      ...current,
      status: executionCount >= limit ? 'executed' : 'ready',
      executionCount,
      childSequence: current.childSequence + 1,
      note,
      txHash,
    }
  })
}

function recordFailedExecution(
  job: RelayerJobRecord,
  txHash: string,
  note: string
) {
  return updateForChild(job, (current) => ({
    ...current,
    status: 'failed',
    note,
    txHash,
  }))
}

/**
 * Settles a submission an earlier run made but never got to record.
 *
 * Returns the updated job when the RPC knows the outcome, and `null` when it
 * does not: every executor transaction carries `setTimeout(120)`, so a hash
 * the RPC no longer knows once the lease has expired cannot be included any
 * more, and the caller proceeds with the normal path -- whose on-chain
 * `is_child_executed` read is the final authority either way.
 */
async function settleInterruptedSubmission(
  server: rpc.Server,
  job: RelayerJobRecord,
  txHash: string
) {
  const result = await server.getTransaction(txHash)
  if (result.status === 'SUCCESS') {
    return recordExecution(
      job,
      txHash,
      `Settled after an interrupted run. ${describeExecution(result)}`
    )
  }
  if (result.status === 'FAILED') {
    return recordFailedExecution(
      job,
      txHash,
      'Executor transaction failed on-chain (settled after an interrupted run). Child sequence was not advanced.'
    )
  }
  return null
}

export async function executeRelayerJob(job: RelayerJobRecord) {
  // Another run -- the scheduled one, or a console Execute -- is executing
  // this job right now. Leave it be: its transaction may still be pending,
  // so the RPC would not know the hash yet and the child would read as not
  // consumed, which is exactly how a second submission used to get through.
  if (isRelayerJobInFlight(job)) return job

  const server = new rpc.Server(STELLAR_CONFIG.rpcUrl)

  // A job still marked `executing` with a hash, past its lease, is a run
  // that was interrupted between submission and outcome. Settle that first:
  // nothing below may submit again while the earlier transaction could have
  // landed.
  if (job.status === 'executing' && job.txHash) {
    const settled = await settleInterruptedSubmission(server, job, job.txHash)
    if (settled) return settled
  }
  const contracts = await resolveTreasuryContracts(job.smartAccountId)
  const latestLedger = await server.getLatestLedger()

  if (job.executionCount >= job.maxExecutions) {
    return updateRelayerJob(job.smartAccountId, job.intentId, (current) => ({
      ...current,
      status: 'blocked',
      note: 'Execution limit reached.',
    }))
  }
  if (latestLedger.sequence < job.startLedger) {
    return updateRelayerJob(job.smartAccountId, job.intentId, (current) => ({
      ...current,
      status: 'scheduled',
      note: `Execution window opens at ledger ${job.startLedger}.`,
    }))
  }
  if (latestLedger.sequence > job.endLedger) {
    return updateRelayerJob(job.smartAccountId, job.intentId, (current) => ({
      ...current,
      status: 'blocked',
      note: 'Execution window expired.',
    }))
  }

  const executor = getExecutorKeypair()
  const sourceAddress = executor.publicKey()
  const net = toNetworkConfig(contracts)
  const intentState = await readIntentState(net, sourceAddress, job)

  if (intentState.cancelled) {
    return updateRelayerJob(job.smartAccountId, job.intentId, (current) => ({
      ...current,
      status: 'blocked',
      executionCount: intentState.executionCount,
      note: 'Scheduled intent is cancelled on-chain.',
    }))
  }
  if (intentState.childExecuted) {
    return updateForChild(job, (current) => ({
      ...current,
      childSequence: current.childSequence + 1,
      executionCount: Math.max(
        current.executionCount,
        intentState.executionCount
      ),
      status:
        intentState.executionCount >=
        Math.min(current.maxExecutions, intentState.maxExecutions)
          ? 'executed'
          : 'ready',
      note: 'Child sequence was already consumed on-chain; local relayer state was advanced.',
    }))
  }

  // The claim. Everything above worked from the job as this run read it;
  // another run may have claimed it since. The condition is decided on the
  // store's current state at the moment of the write, so of two runs that
  // got this far, exactly one goes on to submit -- the other returns the
  // job as the winner left it.
  const claim = await tryUpdateRelayerJob(
    job.smartAccountId,
    job.intentId,
    (current) =>
      isTerminalRelayerJob(current) ||
      isRelayerJobInFlight(current) ||
      current.childSequence !== job.childSequence
        ? null
        : {
            ...current,
            status: 'executing',
            note: 'Submitting executor-signed scheduled payment.',
          }
  )
  if (!claim.applied) return claim.job

  // execute_scheduled_payment has no require_auth() of its own -- it is
  // deliberately permissionless. The only real authorization check in the
  // whole call graph is intent_registry.mark_child_executed's
  // executor.require_auth(), two levels deep, which the SDK's
  // prepareRelayerExecution signs as its own explicit classic-account entry
  // (see buildExecutorAuthEntry there) -- an envelope signature alone covers
  // only a root-level require_auth(). It also bids the market inclusion fee;
  // BASE_FEE is what mainnet refused with txInsufficientFee.
  const prepared = await prepareRelayerExecution({
    net,
    intentId: intentIdBytes(job.intentId),
    childSequence: job.childSequence,
    executorAddress: sourceAddress,
    sign: executor,
  })
  prepared.sign(executor)
  const sent = await server.sendTransaction(prepared)

  if (sent.status === 'ERROR') {
    return updateForChild(job, (current) => ({
      ...current,
      status: 'failed',
      note: 'RPC rejected the executor transaction.',
      txHash: sent.hash,
    }))
  }
  if (sent.status === 'TRY_AGAIN_LATER') {
    return updateForChild(job, (current) => ({
      ...current,
      status: 'ready',
      note: 'RPC asked the relayer to retry later. Child sequence was not advanced.',
    }))
  }
  if (sent.status === 'DUPLICATE') {
    return updateForChild(job, (current) => ({
      ...current,
      status: 'ready',
      note: 'RPC reported a duplicate submission. Child sequence will be rechecked before retry.',
      txHash: sent.hash,
    }))
  }

  // Record the hash before polling. A run killed during the poll must leave
  // enough behind for the next run to settle the outcome instead of
  // guessing -- see `settleInterruptedSubmission`.
  await updateForChild(job, (current) => ({
    ...current,
    status: 'executing',
    note: 'Submitted, awaiting inclusion.',
    txHash: sent.hash,
  }))

  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1500))
    const result = await server.getTransaction(sent.hash)
    if (result.status === 'SUCCESS') {
      return recordExecution(
        job,
        sent.hash,
        describeExecution(result),
        intentState.maxExecutions
      )
    }
    if (result.status === 'FAILED') {
      return recordFailedExecution(
        job,
        sent.hash,
        'Executor transaction failed on-chain. Child sequence was not advanced.'
      )
    }
  }

  return updateForChild(job, (current) => ({
    ...current,
    status: 'ready',
    note: 'Transaction submitted and still pending. Child sequence was not advanced.',
    txHash: sent.hash,
  }))
}

export async function executeRelayerJobById(
  smartAccountId: string,
  intentId: string
) {
  const job = await getRelayerJob(smartAccountId, intentId)
  if (!job) {
    throw new Error('Relayer job not found.')
  }
  return executeRelayerJob(job)
}

export async function runDueRelayerJobs(limit = 5): Promise<RelayerRunResult> {
  const server = new rpc.Server(STELLAR_CONFIG.rpcUrl)
  const latestLedger = await server.getLatestLedger()
  const jobs = await listRelayerJobs()
  const now = Date.now()
  const dueJobs = jobs
    .filter(
      (job) =>
        !isTerminalRelayerJob(job) &&
        !isRelayerJobInFlight(job, now) &&
        job.executionCount < job.maxExecutions &&
        latestLedger.sequence >= job.startLedger &&
        latestLedger.sequence <= job.endLedger
    )
    .slice(0, limit)
  const updated: RelayerJobRecord[] = []

  for (const job of dueJobs) {
    updated.push(await executeRelayerJob(job))
  }

  return {
    checked: jobs.length,
    executed: updated.filter((job) => job.status === 'executed').length,
    updated,
  }
}
