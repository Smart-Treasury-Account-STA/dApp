import { TransactionBuilder } from '@stellar/stellar-sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { deployAccount } from '@/lib/deployAccount'

const WALLET_ADDRESS = 'GWALLET0000000000000000000000000000000000000000000000'
const RELAYER_EXECUTOR_ADDRESS =
  'GRELAYER00000000000000000000000000000000000000000000'
const ACCOUNT_FACTORY_ID =
  'CFACTORY00000000000000000000000000000000000000000000000'

const stellarConfig = vi.hoisted(() => ({
  networkPassphrase: 'Test SDF Network ; September 2015',
  accountFactoryId:
    'CFACTORY00000000000000000000000000000000000000000000000' as string | null,
  relayerExecutorAddress:
    'GRELAYER00000000000000000000000000000000000000000000' as string | null,
}))

vi.mock('@/config', () => ({
  STELLAR_CONFIG: stellarConfig,
}))

const serverMethods = vi.hoisted(() => ({
  getLatestLedger: vi.fn(),
  getAccount: vi.fn(),
  simulateTransaction: vi.fn(),
  prepareTransaction: vi.fn(),
  getTransaction: vi.fn(),
  getFeeStats: vi.fn(),
}))

vi.mock('@stellar/stellar-sdk', () => ({
  BASE_FEE: '100',
  Transaction: vi
    .fn()
    .mockImplementation((xdrString: string) => ({ __tx: true, xdrString })),
  TransactionBuilder: vi.fn().mockImplementation(() => {
    const builder: Record<string, unknown> = {}
    builder.addOperation = vi.fn(() => builder)
    builder.setTimeout = vi.fn(() => builder)
    builder.build = vi.fn(() => ({ __unpreparedTx: true }))
    return builder
  }),
  scValToNative: vi.fn((value: unknown) =>
    value && typeof value === 'object' && '__native' in value
      ? (value as { __native: unknown }).__native
      : value
  ),
  xdr: {
    ScVal: {
      scvVec: vi.fn((items: unknown[]) => ({ __vec: items })),
      scvMap: vi.fn((entries: unknown[]) => ({ __map: entries })),
      scvVoid: vi.fn(() => ({ __void: true })),
    },
  },
}))

const sdkMocks = vi.hoisted(() => ({
  selectAllInvocationsForAddress: vi.fn(),
  buildClassicAuthEntry: vi.fn(
    async (address: string, invocation: unknown) => ({
      __signedEntry: true,
      address,
      invocation,
    })
  ),
  addressScVal: vi.fn((address: string) => ({ __address: address })),
  bytesN32ScVal: vi.fn((hex: string) => ({ __bytes32: hex })),
  signerDelegatedScVal: vi.fn((address: string) => ({ __delegated: address })),
  u32ScVal: vi.fn((value: number) => ({ __u32: value })),
}))

vi.mock('sta-sdk', async (importOriginal) => {
  // The fee policy is the SDK's real one: what this test checks is that
  // deployAccount bids it on the submitted build and not on the throwaway.
  const actual = await importOriginal<typeof import('sta-sdk')>()
  return { ...sdkMocks, inclusionFee: actual.inclusionFee }
})

const selectAllInvocationsForAddressMock =
  sdkMocks.selectAllInvocationsForAddress
const buildClassicAuthEntryMock = sdkMocks.buildClassicAuthEntry

const stellarClientMocks = vi.hoisted(() => ({
  getServer: vi.fn(() => serverMethods),
  invokeContractOperation: vi.fn(
    (
      contractId: string,
      functionName: string,
      args: unknown,
      auth: unknown
    ) => ({
      __op: true,
      contractId,
      functionName,
      args,
      auth,
    })
  ),
  signEnvelope: vi.fn(async () => 'signed-envelope-xdr'),
  submitSignedTransaction: vi.fn(),
  walletSigningCallback: vi.fn(() => 'wallet-signing-callback'),
}))

vi.mock('@/lib/stellarClient', () => stellarClientMocks)

const {
  submitSignedTransaction: submitSignedTransactionMock,
  invokeContractOperation: invokeContractOperationMock,
} = stellarClientMocks

const wallet = {
  address: WALLET_ADDRESS,
  signAuthEntry: vi.fn(),
  signTransaction: vi.fn(async () => ({ xdr: 'signed-envelope-xdr' })),
}

function invocation(tag: string) {
  return { __invocation: tag }
}

beforeEach(() => {
  vi.clearAllMocks()
  stellarConfig.accountFactoryId = ACCOUNT_FACTORY_ID
  stellarConfig.relayerExecutorAddress = RELAYER_EXECUTOR_ADDRESS
  serverMethods.getLatestLedger.mockResolvedValue({ sequence: 1000 })
  serverMethods.getFeeStats.mockResolvedValue({
    sorobanInclusionFee: { p99: '200' },
  })
  serverMethods.getAccount.mockResolvedValue({
    accountId: () => WALLET_ADDRESS,
  })
  serverMethods.simulateTransaction.mockResolvedValue({
    result: { auth: ['recorded-entries'] },
  })
  serverMethods.prepareTransaction.mockResolvedValue({
    toXDR: () => 'prepared-tx-xdr',
  })
  wallet.signTransaction.mockResolvedValue({ xdr: 'signed-envelope-xdr' })
  submitSignedTransactionMock.mockResolvedValue({
    hash: 'deploy-tx-hash',
    status: 'SUCCESS',
  })
  serverMethods.getTransaction.mockResolvedValue({
    status: 'SUCCESS',
    returnValue: { __native: deployedAccountNative() },
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

function deployedAccountNative(
  overrides: Partial<Record<string, string>> = {}
) {
  return {
    smart_account: 'CSMARTACCOUNT00000000000000000000000000000000000000000',
    policy_engine: 'CPOLICYENGINE0000000000000000000000000000000000000000000',
    intent_registry: 'CINTENTREGISTRY000000000000000000000000000000000000000',
    recovery_manager: 'CRECOVERYMANAGER00000000000000000000000000000000000000',
    transfer_adapter: 'CTRANSFERADAPTER00000000000000000000000000000000000000',
    split_adapter: 'CSPLITADAPTER0000000000000000000000000000000000000000000',
    ...overrides,
  }
}

describe('deployAccount — configuration guard', () => {
  it('throws before touching the network when NEXT_PUBLIC_ACCOUNT_FACTORY_ID is not configured', async () => {
    stellarConfig.accountFactoryId = null
    await expect(deployAccount(wallet)).rejects.toThrow(/ACCOUNT_FACTORY_ID/)
    expect(serverMethods.getLatestLedger).not.toHaveBeenCalled()
  })

  it('throws before touching the network when NEXT_PUBLIC_RELAYER_EXECUTOR_ADDRESS is not configured', async () => {
    stellarConfig.relayerExecutorAddress = null
    await expect(deployAccount(wallet)).rejects.toThrow(
      /RELAYER_EXECUTOR_ADDRESS/
    )
    expect(serverMethods.getLatestLedger).not.toHaveBeenCalled()
  })
})

describe('deployAccount — inclusion fee', () => {
  // deployAccount builds twice: a throwaway transaction that is only ever
  // simulated, then the one that gets signed and submitted. Only the second
  // is bid on, and bidding the 100-stroop protocol minimum there is what
  // made mainnet reject the deploy with txInsufficientFee.
  const feeOf = (buildIndex: number) =>
    vi.mocked(TransactionBuilder).mock.calls[buildIndex][1]?.fee

  beforeEach(() => {
    // Recording-mode simulation covers every require_auth() node through
    // source-account credentials for this call, so no explicit entries.
    selectAllInvocationsForAddressMock.mockReturnValue([])
  })

  it('bids above the market rate on the transaction it submits', async () => {
    await deployAccount(wallet)

    expect(vi.mocked(TransactionBuilder)).toHaveBeenCalledTimes(2)
    expect(feeOf(1)).toBe('2000')
    expect(feeOf(1)).not.toBe('100')
  })

  it('leaves the simulation-only build at the protocol minimum', async () => {
    await deployAccount(wallet)

    expect(feeOf(0)).toBe('100')
  })

  it('still submits at a viable bid when the RPC cannot report fee stats', async () => {
    serverMethods.getFeeStats.mockRejectedValue(new Error('method not found'))

    await deployAccount(wallet)

    expect(feeOf(1)).toBe('2000')
  })
})

describe('deployAccount — multi-entry discovery and signing', () => {
  it('signs one entry per invocation the simulation recorded for the caller (six, for deploy_account)', async () => {
    const invocations = [
      invocation('factory-body'),
      invocation('policy-engine-init'),
      invocation('recovery-manager-init'),
      invocation('smart-account-init'),
      invocation('transfer-adapter-init'),
      invocation('split-adapter-init'),
    ]
    selectAllInvocationsForAddressMock.mockReturnValue(invocations)

    await deployAccount(wallet)

    expect(buildClassicAuthEntryMock).toHaveBeenCalledTimes(6)
    for (const inv of invocations) {
      // Signed as the connected wallet, through its SigningCallback, over
      // exactly the node the simulation recorded.
      expect(buildClassicAuthEntryMock).toHaveBeenCalledWith(
        WALLET_ADDRESS,
        inv,
        'wallet-signing-callback',
        expect.any(Number),
        'Test SDF Network ; September 2015'
      )
    }

    // The final signed-and-submitted operation must carry all six signed
    // entries, not just the first.
    const finalOpCall = invokeContractOperationMock.mock.calls.at(-1)
    expect(finalOpCall?.[3]).toHaveLength(6)
  })

  it('proceeds via source-account credentials when the simulation recorded auth but none of it is an explicit Address entry for the caller', async () => {
    // This is the normal case for deploy_account: the connected wallet is
    // both the tx source account and `caller`, so Soroban's recording-mode
    // simulation satisfies every caller.require_auth() node via
    // source-account credentials (covered by the envelope signature below)
    // instead of explicit Address-credential entries. selectAllInvocationsForAddress
    // correctly returns none of those -- see its own doc comment -- but the
    // raw simulation still recorded real auth, so this must not be treated
    // as an error.
    serverMethods.simulateTransaction.mockResolvedValue({
      result: { auth: ['source-account-entry'] },
    })
    selectAllInvocationsForAddressMock.mockReturnValue([])

    await deployAccount(wallet)

    expect(buildClassicAuthEntryMock).not.toHaveBeenCalled()
    const finalOpCall = invokeContractOperationMock.mock.calls.at(-1)
    expect(finalOpCall?.[3]).toHaveLength(0)
    expect(submitSignedTransactionMock).toHaveBeenCalled()
  })

  it("throws a clear error when the simulation records no authorization requirement at all — a canary if the contract's auth shape changes", async () => {
    serverMethods.simulateTransaction.mockResolvedValue({
      result: { auth: [] },
    })
    selectAllInvocationsForAddressMock.mockReturnValue([])

    await expect(deployAccount(wallet)).rejects.toThrow(
      /no authorization requirement/i
    )
    expect(buildClassicAuthEntryMock).not.toHaveBeenCalled()
    expect(submitSignedTransactionMock).not.toHaveBeenCalled()
  })

  it('propagates a simulation error without attempting to sign anything', async () => {
    serverMethods.simulateTransaction.mockResolvedValue({
      error: 'simulation blew up',
    })

    await expect(deployAccount(wallet)).rejects.toThrow('simulation blew up')
    expect(selectAllInvocationsForAddressMock).not.toHaveBeenCalled()
  })
})

describe('deployAccount — submission and DeployedAccount decoding', () => {
  beforeEach(() => {
    selectAllInvocationsForAddressMock.mockReturnValue([
      invocation('factory-body'),
    ])
  })

  it('throws when submission does not terminate successfully, without attempting to read a return value', async () => {
    submitSignedTransactionMock.mockResolvedValue({
      hash: 'h',
      status: 'FAILED',
    })

    await expect(deployAccount(wallet)).rejects.toThrow(/did not succeed/i)
    expect(serverMethods.getTransaction).not.toHaveBeenCalled()
  })

  it('throws when the successful transaction carries no return value', async () => {
    serverMethods.getTransaction.mockResolvedValue({ status: 'SUCCESS' })

    await expect(deployAccount(wallet)).rejects.toThrow(
      /return value could not be read back/i
    )
  })

  it('throws when the return value decodes to an incomplete DeployedAccount', async () => {
    serverMethods.getTransaction.mockResolvedValue({
      status: 'SUCCESS',
      returnValue: {
        __native: deployedAccountNative({
          split_adapter: undefined as unknown as string,
        }),
      },
    })

    await expect(deployAccount(wallet)).rejects.toThrow(/could not be decoded/i)
  })

  it('decodes a complete DeployedAccount and maps snake_case fields to the camelCase result shape', async () => {
    const result = await deployAccount(wallet)

    expect(result.receipt).toEqual({
      hash: 'deploy-tx-hash',
      status: 'SUCCESS',
    })
    expect(result.deployed).toEqual({
      smartAccountId: 'CSMARTACCOUNT00000000000000000000000000000000000000000',
      policyEngineId:
        'CPOLICYENGINE0000000000000000000000000000000000000000000',
      intentRegistryId:
        'CINTENTREGISTRY000000000000000000000000000000000000000',
      recoveryManagerId:
        'CRECOVERYMANAGER00000000000000000000000000000000000000',
      transferAdapterId:
        'CTRANSFERADAPTER00000000000000000000000000000000000000',
      splitAdapterId:
        'CSPLITADAPTER0000000000000000000000000000000000000000000',
    })
  })

  it("fetches a fresh Account for the final tx rather than reusing the discovery simulation's Account object", async () => {
    // TransactionBuilder.build() mutates whatever Account it's given
    // (increments its sequence number) as a side effect -- reusing one
    // Account across the (simulate-only) discovery build and the real,
    // submitted final build would leave the final tx's sequence number one
    // higher than the network expects, failing every submission with
    // tx_bad_seq. Two independent getAccount() calls is what avoids that.
    await deployAccount(wallet)
    expect(serverMethods.getAccount).toHaveBeenCalledTimes(2)
  })
})
