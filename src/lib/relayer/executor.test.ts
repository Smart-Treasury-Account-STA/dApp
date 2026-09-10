import { TransactionBuilder } from '@stellar/stellar-sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  executeRelayerJob,
  executeRelayerJobById,
  readQueueableScheduledIntent,
  runDueRelayerJobs,
} from '@/lib/relayer/executor'
import {
  getRelayerJob,
  listRelayerJobs,
  updateRelayerJob,
} from '@/lib/relayer/store'
import type { RelayerJobRecord } from '@/lib/relayer/types'
import {
  addressCredentialsEntry,
  contractInvocation,
} from '@/lib/stellarClient'
import { getTreasury } from '@/lib/treasuryRegistry/store'

const serverMethods = vi.hoisted(() => ({
  getLatestLedger: vi.fn(),
  getAccount: vi.fn(),
  simulateTransaction: vi.fn(),
  prepareTransaction: vi.fn(),
  sendTransaction: vi.fn(),
  getTransaction: vi.fn(),
  getFeeStats: vi.fn(),
}))

const EXECUTOR_PUBLIC_KEY =
  'GEXECUTOR00000000000000000000000000000000000000000000'

const authorizeEntryMock = vi.hoisted(() =>
  vi.fn(async (entry: unknown, signer: unknown) => ({
    __signedEntry: true,
    entry,
    signer,
  }))
)

vi.mock('@stellar/stellar-sdk', async (importOriginal) => {
  // `Networks` comes from the real module rather than a stub: `@/config`
  // resolves the deployment's network from its passphrase, and a fabricated
  // enum here would let this test pass against values the SDK does not use.
  const actual = await importOriginal<typeof import('@stellar/stellar-sdk')>()
  return {
    Networks: actual.Networks,
    authorizeEntry: authorizeEntryMock,
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
  updateRelayerJob: vi.fn(),
}))

vi.mock('@/lib/stellarClient', () => ({
  contractInvocation: vi.fn(
    (contractId: string, functionName: string, args: unknown[]) => ({
      __invocation: true,
      contractId,
      functionName,
      args,
    })
  ),
  addressCredentialsEntry: vi.fn((opts: unknown) => ({
    __unsignedEntry: true,
    ...(opts as object),
  })),
  randomAuthNonce: vi.fn(() => '424242'),
}))

const findEventMock = vi.hoisted(() => vi.fn())
vi.mock('sta-sdk', () => ({
  parseContractEvents: vi.fn((events: unknown) => events),
  findEvent: findEventMock,
}))

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
      staAsset: 'mock-sta-asset',
    })
  ),
}))

const updateRelayerJobMock = vi.mocked(updateRelayerJob)
const getRelayerJobMock = vi.mocked(getRelayerJob)
const getTreasuryMock = vi.mocked(getTreasury)
const listRelayerJobsMock = vi.mocked(listRelayerJobs)
const contractInvocationMock = vi.mocked(contractInvocation)
const addressCredentialsEntryMock = vi.mocked(addressCredentialsEntry)

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

/** get_intent then is_child_executed, decoded via the mocked scValToNative. */
function queueIntentReads(
  intent: Record<string, unknown> | null,
  childExecuted: boolean
) {
  serverMethods.getAccount.mockResolvedValue({
    accountId: () => EXECUTOR_PUBLIC_KEY,
  })
  serverMethods.simulateTransaction
    .mockResolvedValueOnce({ result: { retval: { __native: intent } } })
    .mockResolvedValueOnce({ result: { retval: { __native: childExecuted } } })
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
    expect(serverMethods.simulateTransaction).not.toHaveBeenCalled()
    expect(serverMethods.sendTransaction).not.toHaveBeenCalled()
  })

  it('refuses to execute before the ledger window opens', async () => {
    serverMethods.getLatestLedger.mockResolvedValue({ sequence: 50 })
    const result = await executeRelayerJob(
      job({ startLedger: 100, endLedger: 200 })
    )

    expect(result.status).toBe('scheduled')
    expect(result.note).toMatch(/opens at ledger 100/)
    expect(serverMethods.simulateTransaction).not.toHaveBeenCalled()
  })

  it('refuses to execute after the ledger window has expired', async () => {
    serverMethods.getLatestLedger.mockResolvedValue({ sequence: 999 })
    const result = await executeRelayerJob(
      job({ startLedger: 100, endLedger: 200 })
    )

    expect(result.status).toBe('blocked')
    expect(result.note).toMatch(/window expired/i)
    expect(serverMethods.simulateTransaction).not.toHaveBeenCalled()
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

    const result = await executeRelayerJob(
      job({ childSequence: 5, maxExecutions: 5 })
    )

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
    serverMethods.prepareTransaction.mockResolvedValue({ sign: vi.fn() })
  })

  it('bids above the market rate on the transaction it submits', async () => {
    // The relayer submits to the same congested mainnet as the dApp, so it
    // needs the same bid. Only the second build is submitted; the first is
    // the read-only simulation of intent_registry state.
    serverMethods.sendTransaction.mockResolvedValue({
      status: 'TRY_AGAIN_LATER',
      hash: TX_HASH,
    })

    await executeRelayerJob(job())

    const builds = vi.mocked(TransactionBuilder).mock.calls
    expect(builds.at(-1)?.[1]?.fee).toBe('2000')
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

    const promise = executeRelayerJob(job({ childSequence: 3 }))
    await vi.advanceTimersByTimeAsync(1500)
    const result = await promise

    expect(result.note).toContain('child 3')
    expect(result.note).toContain('5000000')
    expect(result.note).toContain(
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

    const promise = executeRelayerJob(job({ childSequence: 3 }))
    await vi.advanceTimersByTimeAsync(1500)
    await promise

    // The invocation this entry authorizes must be rooted directly at
    // mark_child_executed on intent_registry -- not at the outer
    // execute_scheduled_payment call, since that's where the real
    // require_auth() actually fires (two levels deep).
    expect(contractInvocationMock).toHaveBeenCalledWith(
      'CAFIATSIZQSBILZJWVT4PVDXPVITJHLP6LPAVKDRHCA7I7XPZSLTRPUS',
      'mark_child_executed',
      expect.arrayContaining([expect.anything(), expect.anything()])
    )
    expect(addressCredentialsEntryMock).toHaveBeenCalledWith(
      expect.objectContaining({ address: EXECUTOR_PUBLIC_KEY })
    )
    // authorizeEntry must be called with the executor's own Keypair as
    // signer (a plain classic-account credential, no wallet/AuthPayload
    // involved) and the unsigned entry addressCredentialsEntry produced.
    expect(authorizeEntryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        __unsignedEntry: true,
        address: EXECUTOR_PUBLIC_KEY,
      }),
      expect.objectContaining({ publicKey: expect.any(Function) }),
      expect.any(Number),
      expect.any(String)
    )
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
    expect(serverMethods.simulateTransaction).not.toHaveBeenCalled()
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
      job({ intentId: 'd'.repeat(64), status: 'executing' }),
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
    expect(serverMethods.simulateTransaction).toHaveBeenCalledTimes(2)
  })
})

describe('readQueueableScheduledIntent', () => {
  it('throws when the intent does not exist on-chain', async () => {
    serverMethods.getAccount.mockResolvedValue({
      accountId: () => EXECUTOR_PUBLIC_KEY,
    })
    serverMethods.simulateTransaction.mockResolvedValueOnce({
      result: { retval: { __native: null } },
    })

    await expect(
      readQueueableScheduledIntent(SMART_ACCOUNT_ID, INTENT_ID)
    ).rejects.toThrow('Scheduled intent was not found on-chain.')
  })

  it('throws when the intent is already cancelled on-chain', async () => {
    serverMethods.getAccount.mockResolvedValue({
      accountId: () => EXECUTOR_PUBLIC_KEY,
    })
    serverMethods.simulateTransaction.mockResolvedValueOnce({
      result: { retval: { __native: { cancelled: true } } },
    })

    await expect(
      readQueueableScheduledIntent(SMART_ACCOUNT_ID, INTENT_ID)
    ).rejects.toThrow('Scheduled intent is cancelled on-chain.')
  })

  it('maps the canonical on-chain fields for a live intent', async () => {
    serverMethods.getAccount.mockResolvedValue({
      accountId: () => EXECUTOR_PUBLIC_KEY,
    })
    serverMethods.simulateTransaction.mockResolvedValueOnce({
      result: {
        retval: {
          __native: {
            cancelled: false,
            start_ledger: 100,
            end_ledger: 200,
            max_executions: 3,
          },
        },
      },
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
