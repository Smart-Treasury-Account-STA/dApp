import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  executeRelayerJob,
  executeRelayerJobById,
  readQueueableScheduledIntent,
  runDueRelayerJobs,
} from '@/lib/relayer/executor'
import { EXECUTING_LEASE_MS } from '@/lib/relayer/jobStatus'
import {
  getRelayerJob,
  listRelayerJobs,
  tryUpdateRelayerJob,
  updateRelayerJob,
} from '@/lib/relayer/store'
import type { RelayerJobRecord } from '@/lib/relayer/types'
import { getTreasury } from '@/lib/treasuryRegistry/store'

const serverMethods = vi.hoisted(() => ({
  getLatestLedger: vi.fn(),
  getAccount: vi.fn(),
  sendTransaction: vi.fn(),
  getTransaction: vi.fn(),
  getFeeStats: vi.fn(),
}))

const EXECUTOR_PUBLIC_KEY =
  'GEXECUTOR00000000000000000000000000000000000000000000'

vi.mock('@stellar/stellar-sdk', async (importOriginal) => {
  // `Networks` comes from the real module rather than a stub: `@/config`
  // resolves the deployment's network from its passphrase, and a fabricated
  // enum here would let this test pass against values the SDK does not use.
  const actual = await importOriginal<typeof import('@stellar/stellar-sdk')>()
  return {
    Networks: actual.Networks,
    BASE_FEE: '100',
    Contract: vi.fn().mockImplementation(() => ({
      call: vi.fn((method: string, ...args: unknown[]) => ({ method, args })),
    })),
    Keypair: {
      fromSecret: vi.fn(() => ({ publicKey: () => EXECUTOR_PUBLIC_KEY })),
    },
    Operation: {
      invokeContractFunction: vi.fn((opts: unknown) => ({
        __op: 'invokeContractFunction',
        ...(opts as object),
      })),
    },
    TransactionBuilder: vi.fn().mockImplementation(() => {
      const builder: Record<string, unknown> = {}
      builder.addOperation = vi.fn(() => builder)
      builder.setTimeout = vi.fn(() => builder)
      builder.build = vi.fn(() => ({ __tx: true }))
      return builder
    }),
    nativeToScVal: vi.fn((value: unknown) => ({ __native: value })),
    scValToNative: vi.fn((value: unknown) =>
      value && typeof value === 'object' && '__native' in value
        ? (value as { __native: unknown }).__native
        : value
    ),
    xdr: {
      ScVal: {
        scvBytes: vi.fn((bytes: Uint8Array) => ({ __bytes: bytes })),
        scvVoid: vi.fn(() => ({ __void: true })),
      },
    },
    StrKey: {
      isValidContract: vi.fn(() => true),
      isValidEd25519PublicKey: vi.fn(() => true),
    },
    rpc: {
      Server: vi.fn().mockImplementation(() => serverMethods),
    },
  }
})

vi.mock('@/lib/relayer/store', () => ({
  getRelayerJob: vi.fn(),
  listRelayerJobs: vi.fn(),
  tryUpdateRelayerJob: vi.fn(),
  updateRelayerJob: vi.fn(),
}))

// The chain reads and the executor transaction are the SDK's; the executor
// only decides what to do with their results. Mocked at that boundary.
const sdkMocks = vi.hoisted(() => ({
  findEvent: vi.fn(),
  readScheduledIntent: vi.fn(),
  isChildExecuted: vi.fn(),
  prepareRelayerExecution: vi.fn(),
}))
vi.mock('sta-sdk', () => ({
  parseContractEvents: vi.fn((events: unknown) => events),
  ...sdkMocks,
}))
const findEventMock = sdkMocks.findEvent
const readScheduledIntentMock = sdkMocks.readScheduledIntent
const isChildExecutedMock = sdkMocks.isChildExecuted
const prepareRelayerExecutionMock = sdkMocks.prepareRelayerExecution

vi.mock('@/lib/treasuryRegistry/store', () => ({
  getTreasury: vi.fn(),
  toContractSet: vi.fn(
    (record: { smartAccountId: string; intentRegistryId: string }) => ({
      smartAccount: record.smartAccountId,
      policyEngine: 'mock-policy-engine',
      intentRegistry: record.intentRegistryId,
      recoveryManager: 'mock-recovery-manager',
      transferAdapter: 'mock-transfer-adapter',
      splitAdapter: 'mock-split-adapter',
      defaultAsset: 'mock-default-asset',
    })
  ),
}))

const updateRelayerJobMock = vi.mocked(updateRelayerJob)
const tryUpdateRelayerJobMock = vi.mocked(tryUpdateRelayerJob)
const getRelayerJobMock = vi.mocked(getRelayerJob)
const getTreasuryMock = vi.mocked(getTreasury)
const listRelayerJobsMock = vi.mocked(listRelayerJobs)

const INTENT_ID = 'a'.repeat(64)
const TX_HASH =
  'f712d5609ca52226746ad9b6776240b763d597246808df1c2a844bf1905d813'
// Matches vitest.config.ts's NEXT_PUBLIC_SMART_ACCOUNT_ID so
// resolveTreasuryContracts takes the "default treasury" branch (synthesized
// straight from STELLAR_CONFIG) without needing to mock the treasury
// registry too.
const SMART_ACCOUNT_ID =
  'CD6GY4UUTNPW4TUV7LDL5SELN4BBHJG4KDDT3W6G23DY6XCGM75MULMQ'

function job(overrides: Partial<RelayerJobRecord> = {}): RelayerJobRecord {
  return {
    smartAccountId: SMART_ACCOUNT_ID,
    intentId: INTENT_ID,
    childSequence: 1,
    startLedger: 100,
    endLedger: 200,
    maxExecutions: 5,
    executionCount: 0,
    status: 'scheduled',
    note: 'Queued for executor-gated scheduled payment execution.',
    createdAt: '2026-08-17T00:00:00.000Z',
    updatedAt: '2026-08-17T00:00:00.000Z',
    ...overrides,
  }
}

/**
 * Makes the store double hold `record` rather than the default `job()`. The
 * executor only writes for the child it acted on, so a test that passes a job
 * on another child sequence needs the store to agree with it.
 */
function storeHolds(record: RelayerJobRecord) {
  updateRelayerJobMock.mockImplementation(
    async (_smartAccountId, _intentId, update) => update(record)
  )
}

/** get_intent then is_child_executed, decoded via the mocked scValToNative. */
/** What the SDK's get_intent and is_child_executed reads answer. */
function queueIntentReads(
  intent: Record<string, unknown> | null,
  childExecuted: boolean
) {
  readScheduledIntentMock.mockResolvedValueOnce(intent)
  isChildExecutedMock.mockResolvedValueOnce(childExecuted)
}

beforeEach(() => {
  process.env.RELAYER_EXECUTOR_SECRET = 'SEXECUTORSECRET'
  vi.clearAllMocks()
  serverMethods.getFeeStats.mockResolvedValue({
    sorobanInclusionFee: { p99: '200' },
  })
  updateRelayerJobMock.mockImplementation(
    async (_smartAccountId, _intentId, update) => update(job())
  )
  // Routed through the updateRelayerJob double, so a conditional write sees
  // whatever current state a test gave that double.
  tryUpdateRelayerJobMock.mockImplementation(
    async (smartAccountId, intentId, update) => {
      let declined = false
      const written = await updateRelayerJobMock(
        smartAccountId,
        intentId,
        (current) => {
          const next = update(current)
          if (next === null) {
            declined = true
            return current
          }
          return next
        }
      )
      return { job: written, applied: !declined }
    }
  )
})

afterEach(() => {
  delete process.env.RELAYER_EXECUTOR_SECRET
  vi.useRealTimers()
})

describe('executeRelayerJob — window and limit gating (no chain read needed)', () => {
  it('refuses to execute once the execution limit is reached', async () => {
    serverMethods.getLatestLedger.mockResolvedValue({ sequence: 150 })
    const result = await executeRelayerJob(
      job({ executionCount: 5, maxExecutions: 5 })
    )

    expect(result.status).toBe('blocked')
    expect(result.note).toMatch(/execution limit/i)
    expect(readScheduledIntentMock).not.toHaveBeenCalled()
    expect(serverMethods.sendTransaction).not.toHaveBeenCalled()
  })

  it('refuses to execute before the ledger window opens', async () => {
    serverMethods.getLatestLedger.mockResolvedValue({ sequence: 50 })
    const result = await executeRelayerJob(
      job({ startLedger: 100, endLedger: 200 })
    )

    expect(result.status).toBe('scheduled')
    expect(result.note).toMatch(/opens at ledger 100/)
    expect(readScheduledIntentMock).not.toHaveBeenCalled()
  })

  it('refuses to execute after the ledger window has expired', async () => {
    serverMethods.getLatestLedger.mockResolvedValue({ sequence: 999 })
    const result = await executeRelayerJob(
      job({ startLedger: 100, endLedger: 200 })
    )

    expect(result.status).toBe('blocked')
    expect(result.note).toMatch(/window expired/i)
    expect(readScheduledIntentMock).not.toHaveBeenCalled()
  })
})

describe('executeRelayerJob — canonical on-chain state overrides local job state', () => {
  beforeEach(() => {
    serverMethods.getLatestLedger.mockResolvedValue({ sequence: 150 })
  })

  it('blocks when intent_registry reports the intent as cancelled', async () => {
    queueIntentReads(
      { cancelled: true, execution_count: 2, max_executions: 5 },
      false
    )

    const result = await executeRelayerJob(job())

    expect(result.status).toBe('blocked')
    expect(result.note).toMatch(/cancelled on-chain/i)
    expect(serverMethods.sendTransaction).not.toHaveBeenCalled()
  })

  it('refuses to re-execute a child sequence intent_registry already reports as executed, and advances past it', async () => {
    queueIntentReads(
      { cancelled: false, execution_count: 3, max_executions: 5 },
      true
    )

    const result = await executeRelayerJob(
      job({ childSequence: 1, executionCount: 0 })
    )

    expect(result.status).toBe('ready')
    expect(result.childSequence).toBe(2)
    expect(result.note).toMatch(
      /already been consumed on-chain|already consumed on-chain/i
    )
    expect(serverMethods.sendTransaction).not.toHaveBeenCalled()
  })

  it('marks the job executed when the already-consumed child was the last allowed execution', async () => {
    queueIntentReads(
      { cancelled: false, execution_count: 5, max_executions: 5 },
      true
    )

    const last = job({ childSequence: 5, maxExecutions: 5 })
    storeHolds(last)

    const result = await executeRelayerJob(last)

    expect(result.status).toBe('executed')
    expect(serverMethods.sendTransaction).not.toHaveBeenCalled()
  })
})

describe('executeRelayerJob — submission outcomes', () => {
  beforeEach(() => {
    serverMethods.getLatestLedger.mockResolvedValue({ sequence: 150 })
    queueIntentReads(
      { cancelled: false, execution_count: 0, max_executions: 5 },
      false
    )
    prepareRelayerExecutionMock.mockResolvedValue({ sign: vi.fn() })
  })

  it('leaves the inclusion bid to the SDK, whose default is the market rate', async () => {
    // The relayer submits to the same congested mainnet as the dApp, so it
    // needs the same bid. The SDK's prepareRelayerExecution bids it unless
    // told otherwise (sta-sdk's own tests pin that); pinning one here would
    // be the one way to get BASE_FEE back.
    serverMethods.sendTransaction.mockResolvedValue({
      status: 'TRY_AGAIN_LATER',
      hash: TX_HASH,
    })

    await executeRelayerJob(job())

    expect(prepareRelayerExecutionMock).toHaveBeenCalledTimes(1)
    expect(prepareRelayerExecutionMock.mock.calls[0][0].fee).toBeUndefined()
  })

  it('marks the job failed, without advancing the child sequence, when the RPC rejects the transaction', async () => {
    serverMethods.sendTransaction.mockResolvedValue({
      status: 'ERROR',
      hash: TX_HASH,
    })

    const result = await executeRelayerJob(job())

    expect(result.status).toBe('failed')
    expect(result.txHash).toBe(TX_HASH)
    expect(serverMethods.getTransaction).not.toHaveBeenCalled()
  })

  it('leaves the job ready to retry, without advancing the child sequence, on TRY_AGAIN_LATER', async () => {
    serverMethods.sendTransaction.mockResolvedValue({
      status: 'TRY_AGAIN_LATER',
      hash: TX_HASH,
    })

    const result = await executeRelayerJob(job())

    expect(result.status).toBe('ready')
    expect(result.txHash).toBeUndefined()
  })

  it('leaves the job ready to be rechecked, without advancing the child sequence, on DUPLICATE', async () => {
    serverMethods.sendTransaction.mockResolvedValue({
      status: 'DUPLICATE',
      hash: TX_HASH,
    })

    const result = await executeRelayerJob(job())

    expect(result.status).toBe('ready')
    expect(result.txHash).toBe(TX_HASH)
  })

  it('advances the child sequence exactly once on a terminal SUCCESS', async () => {
    serverMethods.sendTransaction.mockResolvedValue({
      status: 'PENDING',
      hash: TX_HASH,
    })
    serverMethods.getTransaction.mockResolvedValue({ status: 'SUCCESS' })
    vi.useFakeTimers()

    const promise = executeRelayerJob(
      job({ childSequence: 1, executionCount: 0, maxExecutions: 5 })
    )
    await vi.advanceTimersByTimeAsync(1500)
    const result = await promise

    expect(result.status).toBe('ready')
    expect(result.childSequence).toBe(2)
    expect(result.executionCount).toBe(1)
    expect(result.txHash).toBe(TX_HASH)
  })

  it("decodes a ScheduledPaymentExecuted event into the job's note when present", async () => {
    serverMethods.sendTransaction.mockResolvedValue({
      status: 'PENDING',
      hash: TX_HASH,
    })
    serverMethods.getTransaction.mockResolvedValue({
      status: 'SUCCESS',
      events: { contractEventsXdr: [['raw-event']] },
    })
    findEventMock.mockReturnValue({
      intent_id: Buffer.alloc(0),
      child_sequence: 3,
      asset: 'CASSET0000000000000000000000000000000000000000000000000',
      destination: 'GDEST000000000000000000000000000000000000000000000000',
      amount: 5000000n,
    })
    vi.useFakeTimers()

    const third = job({ childSequence: 3 })
    storeHolds(third)

    const promise = executeRelayerJob(third)
    await vi.advanceTimersByTimeAsync(1500)
    const result = await promise

    expect(result.note).toContain('child 3')
    expect(result.note).toContain('5000000')
    // The persisted note carries truncated addresses: it is rendered as-is in
    // the relayer job card, where a full strkey blew out the grid column.
    expect(result.note).toContain('GDEST00...000000')
    expect(result.note).not.toContain(
      'GDEST000000000000000000000000000000000000000000000000'
    )
  })

  it('falls back to the generic note when getTransaction returns no events for the operation', async () => {
    serverMethods.sendTransaction.mockResolvedValue({
      status: 'PENDING',
      hash: TX_HASH,
    })
    serverMethods.getTransaction.mockResolvedValue({ status: 'SUCCESS' })
    vi.useFakeTimers()

    const promise = executeRelayerJob(job())
    await vi.advanceTimersByTimeAsync(1500)
    const result = await promise

    expect(result.note).toMatch(/executed exactly once/i)
  })

  it('builds and signs an explicit authorization entry for intent_registry.mark_child_executed, not just a source-account signature', async () => {
    serverMethods.sendTransaction.mockResolvedValue({
      status: 'PENDING',
      hash: TX_HASH,
    })
    serverMethods.getTransaction.mockResolvedValue({ status: 'SUCCESS' })
    vi.useFakeTimers()

    const third = job({ childSequence: 3 })
    storeHolds(third)

    const promise = executeRelayerJob(third)
    await vi.advanceTimersByTimeAsync(1500)
    await promise

    // The SDK roots the entry at intent_registry.mark_child_executed -- not
    // at the outer execute_scheduled_payment call, since that's where the
    // real require_auth() fires (two levels deep) -- and signs it with the
    // executor's own Keypair: a plain classic-account credential, no
    // wallet or AuthPayload involved. What the executor owes it is the
    // right registry, intent, child sequence, executor address and signer.
    expect(prepareRelayerExecutionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        net: expect.objectContaining({
          contracts: expect.objectContaining({
            intentRegistry:
              'CAFIATSIZQSBILZJWVT4PVDXPVITJHLP6LPAVKDRHCA7I7XPZSLTRPUS',
          }),
        }),
        intentId: expect.objectContaining({ length: 32 }),
        childSequence: 3,
        executorAddress: EXECUTOR_PUBLIC_KEY,
        sign: expect.objectContaining({ publicKey: expect.any(Function) }),
      })
    )
  })

  it('persists the transaction hash as soon as the RPC accepts the submission, before the first poll', async () => {
    serverMethods.sendTransaction.mockResolvedValue({
      status: 'PENDING',
      hash: TX_HASH,
    })
    serverMethods.getTransaction.mockResolvedValue({ status: 'SUCCESS' })
    vi.useFakeTimers()

    const promise = executeRelayerJob(job())
    await vi.advanceTimersByTimeAsync(1500)
    await promise

    const writes = updateRelayerJobMock.mock.calls.map(([, , update]) =>
      update(job())
    )
    const submitted = writes.findIndex(
      (write) => write.status === 'executing' && write.txHash === TX_HASH
    )
    expect(submitted).toBeGreaterThan(-1)
    expect(writes[submitted].note).toMatch(/awaiting inclusion/i)
    // A run killed during the poll must leave the hash behind, so the write
    // has to land before the first getTransaction, not with its outcome.
    expect(
      updateRelayerJobMock.mock.invocationCallOrder[submitted]
    ).toBeLessThan(serverMethods.getTransaction.mock.invocationCallOrder[0])
  })

  it('does not advance the child sequence when the submitted transaction fails on-chain', async () => {
    serverMethods.sendTransaction.mockResolvedValue({
      status: 'PENDING',
      hash: TX_HASH,
    })
    serverMethods.getTransaction.mockResolvedValue({ status: 'FAILED' })
    vi.useFakeTimers()

    const promise = executeRelayerJob(job())
    await vi.advanceTimersByTimeAsync(1500)
    const result = await promise

    expect(result.status).toBe('failed')
    expect(result.childSequence).toBe(1)
    expect(result.txHash).toBe(TX_HASH)
  })

  it('does not advance the child sequence while the transaction is still pending after every poll attempt', async () => {
    serverMethods.sendTransaction.mockResolvedValue({
      status: 'PENDING',
      hash: TX_HASH,
    })
    serverMethods.getTransaction.mockResolvedValue({ status: 'NOT_FOUND' })
    vi.useFakeTimers()

    const promise = executeRelayerJob(job())
    await vi.advanceTimersByTimeAsync(20 * 1500)
    const result = await promise

    expect(result.status).toBe('ready')
    expect(result.note).toMatch(/still pending/i)
    expect(result.childSequence).toBe(1)
    expect(serverMethods.getTransaction).toHaveBeenCalledTimes(20)
  })
})

describe('executeRelayerJob — recovering a run interrupted after submission', () => {
  beforeEach(() => {
    serverMethods.getLatestLedger.mockResolvedValue({ sequence: 150 })
    prepareRelayerExecutionMock.mockResolvedValue({ sign: vi.fn() })
  })

  it('settles an interrupted submission that succeeded on-chain without submitting again', async () => {
    const interrupted = job({ status: 'executing', txHash: TX_HASH })
    updateRelayerJobMock.mockImplementation(
      async (_smartAccountId, _intentId, update) => update(interrupted)
    )
    serverMethods.getTransaction.mockResolvedValue({ status: 'SUCCESS' })

    const result = await executeRelayerJob(interrupted)

    expect(result.status).toBe('ready')
    expect(result.childSequence).toBe(2)
    expect(result.executionCount).toBe(1)
    expect(result.txHash).toBe(TX_HASH)
    expect(result.note).toMatch(/interrupted/i)
    expect(serverMethods.sendTransaction).not.toHaveBeenCalled()
    expect(readScheduledIntentMock).not.toHaveBeenCalled()
  })

  it('marks the job executed when the interrupted submission was its last allowed execution', async () => {
    const interrupted = job({
      status: 'executing',
      txHash: TX_HASH,
      executionCount: 4,
      maxExecutions: 5,
    })
    updateRelayerJobMock.mockImplementation(
      async (_smartAccountId, _intentId, update) => update(interrupted)
    )
    serverMethods.getTransaction.mockResolvedValue({ status: 'SUCCESS' })

    const result = await executeRelayerJob(interrupted)

    expect(result.status).toBe('executed')
    expect(result.executionCount).toBe(5)
  })

  it('marks the job failed, without advancing the child sequence, when the interrupted submission failed on-chain', async () => {
    const interrupted = job({ status: 'executing', txHash: TX_HASH })
    updateRelayerJobMock.mockImplementation(
      async (_smartAccountId, _intentId, update) => update(interrupted)
    )
    serverMethods.getTransaction.mockResolvedValue({ status: 'FAILED' })

    const result = await executeRelayerJob(interrupted)

    expect(result.status).toBe('failed')
    expect(result.childSequence).toBe(1)
    expect(serverMethods.sendTransaction).not.toHaveBeenCalled()
  })

  it('falls through to the normal path when the interrupted submission is not found on-chain', async () => {
    // A transaction the RPC no longer knows has expired (setTimeout(120)),
    // so the on-chain child check decides and a fresh submission is safe.
    const interrupted = job({ status: 'executing', txHash: TX_HASH })
    serverMethods.getTransaction
      .mockResolvedValueOnce({ status: 'NOT_FOUND' })
      .mockResolvedValue({ status: 'SUCCESS' })
    queueIntentReads(
      { cancelled: false, execution_count: 0, max_executions: 5 },
      false
    )
    serverMethods.sendTransaction.mockResolvedValue({
      status: 'PENDING',
      hash: 'e'.repeat(64),
    })
    vi.useFakeTimers()

    const promise = executeRelayerJob(interrupted)
    await vi.advanceTimersByTimeAsync(1500)
    const result = await promise

    expect(serverMethods.sendTransaction).toHaveBeenCalledTimes(1)
    expect(result.status).toBe('ready')
    expect(result.childSequence).toBe(2)
    expect(result.txHash).toBe('e'.repeat(64))
  })

  it('goes straight to the normal path when the interrupted run never submitted', async () => {
    const interrupted = job({ status: 'executing' })
    queueIntentReads(
      { cancelled: false, execution_count: 1, max_executions: 5 },
      true
    )

    const result = await executeRelayerJob(interrupted)

    expect(serverMethods.getTransaction).not.toHaveBeenCalled()
    expect(serverMethods.sendTransaction).not.toHaveBeenCalled()
    expect(result.childSequence).toBe(2)
    expect(result.note).toMatch(/already consumed/i)
  })
})

describe('executeRelayerJob — one run per job at a time', () => {
  // The scheduled (QStash) run and the console's Execute reach the same
  // executor, on different instances. Found on mainnet (2026-09-11): Execute
  // clicked while a scheduled run was polling its transaction submitted a
  // second one; the contract refused it, and its failure then overwrote the
  // job's `executed` with `failed`.
  beforeEach(() => {
    serverMethods.getLatestLedger.mockResolvedValue({ sequence: 150 })
    prepareRelayerExecutionMock.mockResolvedValue({ sign: vi.fn() })
  })

  function inFlight(overrides: Partial<RelayerJobRecord> = {}) {
    return job({
      status: 'executing',
      note: 'Submitted, awaiting inclusion.',
      txHash: TX_HASH,
      updatedAt: new Date(Date.now() - 30_000).toISOString(),
      ...overrides,
    })
  }

  it('leaves a job alone while another run holds its executing lease', async () => {
    const running = inFlight()

    const result = await executeRelayerJob(running)

    expect(result).toEqual(running)
    expect(serverMethods.getTransaction).not.toHaveBeenCalled()
    expect(serverMethods.getLatestLedger).not.toHaveBeenCalled()
    expect(serverMethods.sendTransaction).not.toHaveBeenCalled()
    expect(updateRelayerJobMock).not.toHaveBeenCalled()
  })

  it('leaves it alone before the other run has a transaction hash, too', async () => {
    const claimed = inFlight({
      txHash: undefined,
      note: 'Submitting executor-signed scheduled payment.',
    })

    const result = await executeRelayerJob(claimed)

    expect(result).toEqual(claimed)
    expect(serverMethods.sendTransaction).not.toHaveBeenCalled()
    expect(updateRelayerJobMock).not.toHaveBeenCalled()
  })

  it('does not submit from the console while a scheduled run is submitting the same job', async () => {
    getRelayerJobMock.mockResolvedValue(inFlight())

    const result = await executeRelayerJobById(SMART_ACCOUNT_ID, INTENT_ID)

    expect(result.status).toBe('executing')
    expect(serverMethods.sendTransaction).not.toHaveBeenCalled()
  })

  it('backs off without submitting when another run claims the job first', async () => {
    // Both runs read `scheduled` and pass every on-chain check; the claim is
    // re-evaluated against the store's current state, where the other run's
    // `executing` already is.
    queueIntentReads(
      { cancelled: false, execution_count: 0, max_executions: 5 },
      false
    )
    const claimedElsewhere = inFlight({
      txHash: undefined,
      note: 'Submitting executor-signed scheduled payment.',
    })
    updateRelayerJobMock.mockImplementation(
      async (_smartAccountId, _intentId, update) => update(claimedElsewhere)
    )

    const result = await executeRelayerJob(job())

    expect(result).toEqual(claimedElsewhere)
    expect(prepareRelayerExecutionMock).not.toHaveBeenCalled()
    expect(serverMethods.sendTransaction).not.toHaveBeenCalled()
  })

  it('backs off without submitting when another run has already moved past this child', async () => {
    queueIntentReads(
      { cancelled: false, execution_count: 0, max_executions: 5 },
      false
    )
    updateRelayerJobMock.mockImplementation(
      async (_smartAccountId, _intentId, update) =>
        update(job({ childSequence: 2, executionCount: 1, status: 'ready' }))
    )

    const result = await executeRelayerJob(job())

    expect(result.childSequence).toBe(2)
    expect(serverMethods.sendTransaction).not.toHaveBeenCalled()
  })

  it('does not let a refused duplicate overwrite a child another run executed', async () => {
    queueIntentReads(
      { cancelled: false, execution_count: 0, max_executions: 1 },
      false
    )
    let current = job({ maxExecutions: 1 })
    updateRelayerJobMock.mockImplementation(
      async (_smartAccountId, _intentId, update) => {
        current = update(current)
        return current
      }
    )
    const OTHER_HASH = 'b'.repeat(64)
    serverMethods.sendTransaction.mockResolvedValue({
      status: 'PENDING',
      hash: TX_HASH,
    })
    // By the time this run's transaction comes back refused, the other run
    // has recorded the child as executed.
    serverMethods.getTransaction.mockImplementation(async () => {
      current = job({
        maxExecutions: 1,
        childSequence: 2,
        executionCount: 1,
        status: 'executed',
        note: 'Executed child 1.',
        txHash: OTHER_HASH,
      })
      return { status: 'FAILED' }
    })
    vi.useFakeTimers()

    const promise = executeRelayerJob(job({ maxExecutions: 1 }))
    await vi.advanceTimersByTimeAsync(1500)
    const result = await promise

    expect(result.status).toBe('executed')
    expect(result.childSequence).toBe(2)
    expect(result.txHash).toBe(OTHER_HASH)
  })

  it('does not advance the child sequence twice when two runs settle the same submission', async () => {
    // Lease long expired (default updatedAt), so both runs may settle; the
    // second finds the child already recorded.
    const stale = job({ status: 'executing', txHash: TX_HASH })
    updateRelayerJobMock.mockImplementation(
      async (_smartAccountId, _intentId, update) =>
        update(
          job({
            childSequence: 2,
            executionCount: 1,
            status: 'ready',
            txHash: TX_HASH,
          })
        )
    )
    serverMethods.getTransaction.mockResolvedValue({ status: 'SUCCESS' })

    const result = await executeRelayerJob(stale)

    expect(result.childSequence).toBe(2)
    expect(result.executionCount).toBe(1)
    expect(serverMethods.sendTransaction).not.toHaveBeenCalled()
  })

  it('does not advance past a consumed child twice', async () => {
    queueIntentReads(
      { cancelled: false, execution_count: 1, max_executions: 5 },
      true
    )
    updateRelayerJobMock.mockImplementation(
      async (_smartAccountId, _intentId, update) =>
        update(job({ childSequence: 2, executionCount: 1, status: 'ready' }))
    )

    const result = await executeRelayerJob(job())

    expect(result.childSequence).toBe(2)
    expect(serverMethods.sendTransaction).not.toHaveBeenCalled()
  })
})

describe('executeRelayerJob — resolveTreasuryContracts (multi-treasury tracking)', () => {
  const OTHER_SMART_ACCOUNT_ID =
    'CB4KZJ3I4XANE6GWPAMXCNXQ34PTQWPXVKFBBMLNKV25GAOXQC7RQUMS'

  beforeEach(() => {
    serverMethods.getLatestLedger.mockResolvedValue({ sequence: 150 })
  })

  it('resolves a registered non-default treasury from the registry, not the env-configured default', async () => {
    getTreasuryMock.mockResolvedValue({
      smartAccountId: OTHER_SMART_ACCOUNT_ID,
      policyEngineId: 'mock',
      intentRegistryId:
        'COTHERINTENTREGISTRY0000000000000000000000000000000000',
      recoveryManagerId: 'mock',
      transferAdapterId: 'mock',
      splitAdapterId: 'mock',
      ownerAddress: 'mock',
      executorAddress: 'mock',
      deployTxHash: 'a'.repeat(64),
      createdAt: '2026-08-17T00:00:00.000Z',
    })
    queueIntentReads(
      { cancelled: true, execution_count: 0, max_executions: 5 },
      false
    )

    const result = await executeRelayerJob(
      job({ smartAccountId: OTHER_SMART_ACCOUNT_ID })
    )

    expect(getTreasuryMock).toHaveBeenCalledWith(OTHER_SMART_ACCOUNT_ID)
    expect(result.status).toBe('blocked')
    expect(result.note).toMatch(/cancelled on-chain/i)
  })

  it('throws a clear error for a smartAccountId that is neither the default nor registered', async () => {
    getTreasuryMock.mockResolvedValue(null)

    await expect(
      executeRelayerJob(job({ smartAccountId: OTHER_SMART_ACCOUNT_ID }))
    ).rejects.toThrow(/no registered treasury/i)
    expect(readScheduledIntentMock).not.toHaveBeenCalled()
  })
})

describe('executeRelayerJobById', () => {
  it('throws when the job does not exist in the store', async () => {
    getRelayerJobMock.mockResolvedValue(null)
    await expect(
      executeRelayerJobById(SMART_ACCOUNT_ID, INTENT_ID)
    ).rejects.toThrow('Relayer job not found.')
  })

  it('delegates to executeRelayerJob for a known job', async () => {
    getRelayerJobMock.mockResolvedValue(
      job({ executionCount: 5, maxExecutions: 5 })
    )
    serverMethods.getLatestLedger.mockResolvedValue({ sequence: 150 })

    const result = await executeRelayerJobById(SMART_ACCOUNT_ID, INTENT_ID)
    expect(result.status).toBe('blocked')
  })
})

describe('runDueRelayerJobs', () => {
  it('only executes jobs that are due — inside their window, not terminal, and under the batch limit', async () => {
    serverMethods.getLatestLedger.mockResolvedValue({ sequence: 150 })
    const due = job({
      intentId: 'b'.repeat(64),
      executionCount: 0,
      maxExecutions: 5,
    })
    queueIntentReads(
      { cancelled: true, execution_count: 0, max_executions: 5 },
      false
    )
    listRelayerJobsMock.mockResolvedValue([
      job({ status: 'executed' }),
      due,
      job({ intentId: 'c'.repeat(64), startLedger: 500, endLedger: 600 }),
      job({
        intentId: 'd'.repeat(64),
        status: 'executing',
        updatedAt: new Date().toISOString(),
      }),
    ])
    updateRelayerJobMock.mockImplementation(
      async (_smartAccountId, _intentId, update) => update(due)
    )

    const result = await runDueRelayerJobs(5)

    // Only `due` is inside its window, not terminal, not mid-flight, and under
    // maxExecutions — the executed, out-of-window, and executing jobs are all
    // skipped without any chain read.
    expect(result.checked).toBe(4)
    expect(serverMethods.getLatestLedger).toHaveBeenCalledTimes(2)
    expect(readScheduledIntentMock).toHaveBeenCalledTimes(1)
    expect(isChildExecutedMock).toHaveBeenCalledTimes(1)
  })

  it('leaves a job alone while its executing lease is live', async () => {
    serverMethods.getLatestLedger.mockResolvedValue({ sequence: 150 })
    listRelayerJobsMock.mockResolvedValue([
      job({
        status: 'executing',
        txHash: TX_HASH,
        updatedAt: new Date(Date.now() - 60_000).toISOString(),
      }),
    ])

    const result = await runDueRelayerJobs(5)

    expect(result.updated).toEqual([])
    expect(serverMethods.getTransaction).not.toHaveBeenCalled()
    expect(serverMethods.sendTransaction).not.toHaveBeenCalled()
  })

  it('reclaims a job whose executing lease has expired', async () => {
    serverMethods.getLatestLedger.mockResolvedValue({ sequence: 150 })
    const stale = job({
      status: 'executing',
      txHash: TX_HASH,
      updatedAt: new Date(
        Date.now() - EXECUTING_LEASE_MS - 1_000
      ).toISOString(),
    })
    listRelayerJobsMock.mockResolvedValue([stale])
    updateRelayerJobMock.mockImplementation(
      async (_smartAccountId, _intentId, update) => update(stale)
    )
    serverMethods.getTransaction.mockResolvedValue({ status: 'SUCCESS' })

    const result = await runDueRelayerJobs(5)

    expect(result.updated).toHaveLength(1)
    expect(result.updated[0].status).toBe('ready')
    expect(result.updated[0].childSequence).toBe(2)
    expect(serverMethods.sendTransaction).not.toHaveBeenCalled()
  })
})

describe('readQueueableScheduledIntent', () => {
  it('throws when the intent does not exist on-chain', async () => {
    serverMethods.getAccount.mockResolvedValue({
      accountId: () => EXECUTOR_PUBLIC_KEY,
    })
    readScheduledIntentMock.mockResolvedValueOnce(null)

    await expect(
      readQueueableScheduledIntent(SMART_ACCOUNT_ID, INTENT_ID)
    ).rejects.toThrow('Scheduled intent was not found on-chain.')
  })

  it('throws when the intent is already cancelled on-chain', async () => {
    serverMethods.getAccount.mockResolvedValue({
      accountId: () => EXECUTOR_PUBLIC_KEY,
    })
    readScheduledIntentMock.mockResolvedValueOnce({ cancelled: true })

    await expect(
      readQueueableScheduledIntent(SMART_ACCOUNT_ID, INTENT_ID)
    ).rejects.toThrow('Scheduled intent is cancelled on-chain.')
  })

  it('maps the canonical on-chain fields for a live intent', async () => {
    serverMethods.getAccount.mockResolvedValue({
      accountId: () => EXECUTOR_PUBLIC_KEY,
    })
    readScheduledIntentMock.mockResolvedValueOnce({
      cancelled: false,
      start_ledger: 100,
      end_ledger: 200,
      max_executions: 3,
    })

    const result = await readQueueableScheduledIntent(
      SMART_ACCOUNT_ID,
      INTENT_ID
    )

    expect(result).toEqual({
      smartAccountId: SMART_ACCOUNT_ID,
      intentId: INTENT_ID,
      startLedger: 100,
      endLedger: 200,
      maxExecutions: 3,
    })
  })
})
