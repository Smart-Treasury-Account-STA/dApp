import {
  Address,
  BASE_FEE,
  Contract,
  Operation,
  Transaction,
  TransactionBuilder,
  rpc,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk'
import type { SigningCallback } from '@stellar/stellar-sdk'
import { Buffer } from 'buffer'
import {
  addressScVal,
  buildSmartAccountAuthEntries,
  countAuthContexts,
  discoverSmartAccountInvocation,
  encodeScheduledIntent,
  encodeSplitArgs,
  encodeTransferArgs,
  inclusionFee,
  isGuardian,
  isNonceUsed,
  prepareCancelScheduledPayment,
  prepareScheduledPayment,
  prepareSplitPayment,
  prepareTransferPayment,
  readAccountStatus,
  readContextRule as readContextRuleOnChain,
  readContextRulesCount,
  readOwner,
  readPolicyVersion,
  readScheduledIntent as readScheduledIntentOnChain,
  readSignerId,
  resolveContextRuleIds,
  serverFor,
  validatePolicy,
} from 'sta-sdk'
import type {
  AccountStatus,
  PolicyCheck,
  PrepareOptions,
  ScheduledIntentArgs,
  SplitPaymentArgs,
  TransferPaymentArgs,
} from 'sta-sdk'

import { NETWORK, STELLAR_CONFIG, toNetworkConfig } from '@/config'
import {
  validatePaymentDraft,
  validateScheduleDraft,
  validateSplitDraft,
} from '@/features/treasury/drafts'
import type { AssetHolding } from '@/lib/assetHolding'
import type { ContractSet } from '@/lib/env'
import { describeSimulationFailure } from '@/lib/format'
import type { LedgerClock } from '@/lib/ledgerClock'
import { classifyProbeFailure, isWholePaymentReason } from '@/lib/policyProbe'
import { collectIntentIds } from '@/lib/scheduledIntents'
import type { IntentEvent, ScheduledIntentRecord } from '@/lib/scheduledIntents'
import { validationFailure } from '@/lib/simulationResult'
import { selectRuleForSigner } from '@/lib/smartAccountAuth'
import { decodeWalletSignature } from '@/lib/walletSignature'
import type {
  ContextRule,
  PaymentDraft,
  ScheduleDraft,
  SimulationResult,
  SplitDraft,
  TransactionReceipt,
  TreasuryStatus,
  WalletSigning,
} from '@/types'

type SimulationValue =
  string | number | boolean | bigint | null | Record<string, unknown>

type SimulatedContractCall = {
  value: SimulationValue
}

type ContractRuleRecord = {
  name?: unknown
  context_type?: unknown
  contextType?: unknown
  signers?: unknown
  signer_ids?: unknown
  policies?: unknown
  policy_ids?: unknown
  valid_until?: unknown
}

/** The one `rpc.Server` this dApp talks to -- the SDK's factory, so the
 * two agree about URL and headers. */
export function getServer() {
  return serverFor(toNetworkConfig())
}

function isSimulationError(
  simulation: rpc.Api.SimulateTransactionResponse
): simulation is rpc.Api.SimulateTransactionErrorResponse {
  return 'error' in simulation
}

function readSimulationValue(
  simulation: rpc.Api.SimulateTransactionResponse
): SimulationValue {
  if (isSimulationError(simulation)) {
    throw new Error(simulation.error)
  }

  const retval = simulation.result?.retval
  if (!retval) return null

  return scValToNative(retval) as SimulationValue
}

async function simulateContractCall(
  sourceAddress: string,
  contractId: string,
  method: string,
  args: xdr.ScVal[] = []
): Promise<SimulatedContractCall> {
  const server = getServer()
  const source = await server.getAccount(sourceAddress)
  const contract = new Contract(contractId)
  const tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: STELLAR_CONFIG.networkPassphrase,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(60)
    .build()

  const simulation = await server.simulateTransaction(tx)
  return { value: readSimulationValue(simulation) }
}

/** A draft's intent id as the 32 bytes the contracts take. */
function intentIdBytes(hex: string): Buffer {
  const bytes = Buffer.from(hex.replace(/^0x/i, ''), 'hex')
  if (bytes.length !== 32) {
    throw new Error('Intent ID must be 32 bytes encoded as 64 hex characters.')
  }
  return bytes
}

// The forms keep everything as strings; the SDK takes the contracts' own
// types. These are the only places that conversion happens.

function transferPaymentArgs(draft: PaymentDraft): TransferPaymentArgs {
  return {
    asset: draft.asset,
    destination: draft.destination,
    amount: BigInt(draft.amount),
    nonce: BigInt(draft.nonce),
    expectedPolicyVersion: draft.expectedPolicyVersion,
  }
}

function splitPaymentArgs(draft: SplitDraft): SplitPaymentArgs {
  return {
    asset: draft.asset,
    // `split_adapter::execute_split` names this argument `recipients`; the
    // value it carries is this dApp's `destinations` list. The contract's
    // spelling stops at the call boundary.
    recipients: draft.destinations.map((entry) => entry.destination),
    amounts: draft.destinations.map((entry) => BigInt(entry.amount)),
    nonce: BigInt(draft.nonce),
    expectedPolicyVersion: draft.expectedPolicyVersion,
  }
}

function scheduledIntentArgs(
  draft: ScheduleDraft,
  contracts: ContractSet
): ScheduledIntentArgs {
  return {
    intent_id: intentIdBytes(draft.intentId),
    asset: draft.asset,
    destination: draft.destination,
    amount: BigInt(draft.amount),
    start_ledger: Number(draft.startLedger),
    end_ledger: Number(draft.endLedger),
    interval_ledgers: Number(draft.intervalLedgers ?? 0),
    max_executions: Number(draft.maxExecutions),
    execution_count: 0,
    policy_version: draft.expectedPolicyVersion,
    adapter: contracts.transferAdapter,
    cancelled: false,
  }
}

function policyCheck(
  draft: PaymentDraft | ScheduleDraft,
  operation = 'transfer'
): PolicyCheck {
  return {
    operation,
    asset: draft.asset,
    destination: draft.destination,
    amount: BigInt(draft.amount),
    expectedVersion: draft.expectedPolicyVersion,
  }
}

/**
 * The connected wallet as the `SigningCallback` the SDK's auth builders
 * take: it is handed the `HashIdPreimage` and returns raw signature bytes.
 *
 * Passing the wallet the entry itself makes it fail to parse; expecting an
 * entry back makes the reply fail to decode. The SDK drives `authorizeEntry`
 * with this callback, which is the one shape Freighter accepts.
 *
 * Freighter reports which account it actually signed with. That can diverge
 * from the account asked for (its active account didn't match) -- plugging
 * `wallet.address` in as the verification key regardless produces a valid
 * signature that the SDK's own crypto check rejects, surfacing only a
 * generic "signature doesn't match payload". Trust what the wallet reports,
 * and fail with the actual mismatch when it isn't the signer this treasury
 * action needs.
 */
export function walletSigningCallback(wallet: WalletSigning): SigningCallback {
  return async (preimage) => {
    const result = await wallet.signAuthEntry(
      preimage.toXDR('base64'),
      wallet.address
    )
    if (!result) {
      throw new Error('Wallet did not return a signed authorization entry.')
    }
    const signerAddress = result.signerAddress ?? wallet.address
    if (signerAddress !== wallet.address) {
      throw new Error(
        `Wallet signed with ${signerAddress} instead of the expected signer ${wallet.address}. Switch to that account in your wallet and try again.`
      )
    }
    return {
      signature: decodeWalletSignature(result.signature),
      publicKey: signerAddress,
    }
  }
}

/**
 * Signs a transaction envelope with the fee-paying/source account and
 * verifies the wallet actually signed with the expected key -- the
 * envelope-signature counterpart to signDelegatedAuthEntry's own check
 * above, for the same reason: Freighter's signTransaction can silently
 * sign with whichever account is active in the extension, not necessarily
 * the one requested. Submitting that mismatched signature would surface
 * only a generic tx_bad_auth from the network instead of naming the
 * actual problem -- this is the only signature check at all for a
 * source-account-strategy write (policy_engine/recovery_manager admin
 * calls), which has no custom AuthPayload to catch it another way.
 */
export async function signEnvelope(
  wallet: WalletSigning,
  transactionXdr: string
): Promise<string> {
  const result = await wallet.signTransaction(transactionXdr, wallet.address)
  if (!result) {
    throw new Error('Wallet did not return a signed transaction envelope.')
  }
  const signerAddress = result.signerAddress ?? wallet.address
  if (signerAddress !== wallet.address) {
    throw new Error(
      `Wallet signed with ${signerAddress} instead of the expected signer ${wallet.address}. Switch to that account in your wallet and try again.`
    )
  }
  return result.xdr
}

export function invokeContractOperation(
  contractId: string,
  functionName: string,
  args: xdr.ScVal[],
  auth: xdr.SorobanAuthorizationEntry[]
) {
  return Operation.invokeContractFunction({
    contract: contractId,
    function: functionName,
    args,
    auth,
  })
}

function getSignerAddresses(value: unknown) {
  const serialized = JSON.stringify(value, (_key, nestedValue) =>
    typeof nestedValue === 'bigint' ? nestedValue.toString() : nestedValue
  )
  return Array.from(new Set(serialized.match(/G[A-Z2-7]{55}/g) ?? []))
}

/**
 * Names the reason the network refused a transaction.
 *
 * A sendTransaction status of ERROR means the transaction was rejected
 * before it ever reached a ledger, and `errorResult` is the only thing that
 * says why: a TransactionResult whose result code is the actual diagnosis --
 * txBadAuth (signed for a different network, or by the wrong key),
 * txInsufficientFee, txInsufficientBalance, txBadSeq, txSorobanInvalid, and
 * so on. Reporting the bare status made every one of those read identically
 * as "Submission failed: ERROR", which tells whoever has to act on it
 * nothing at all.
 *
 * The RPC's own schema marks the field optional, so an absent one is
 * reported as absent rather than papered over with a guess.
 */
export function describeSubmissionRejection(
  errorResult?: xdr.TransactionResult
): string {
  if (!errorResult) {
    return 'ERROR (the RPC gave no result code)'
  }
  return errorResult.result().switch().name
}

export async function submitSignedTransaction(
  signedTx: Transaction
): Promise<TransactionReceipt> {
  const server = getServer()
  const sendResponse = await server.sendTransaction(signedTx)
  if (sendResponse.status === 'ERROR') {
    throw new Error(
      `Submission failed: ${describeSubmissionRejection(sendResponse.errorResult)}`
    )
  }
  if (sendResponse.status === 'TRY_AGAIN_LATER') {
    throw new Error('RPC asked the dApp to retry submission later.')
  }
  if (sendResponse.status === 'DUPLICATE') {
    throw new Error('RPC reported a duplicate transaction submission.')
  }

  // Testnet usually closes a ledger in ~5s, but inclusion has been observed
  // taking over two minutes under load. The old 30s ceiling reported such a
  // transaction as unresolved while it went on to succeed on-chain, so the
  // wait now covers that case. Timing out is no longer read as a failure —
  // describeReceipt reports it as still pending.
  for (let attempt = 0; attempt < 90; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2000))
    const txResult = await server.getTransaction(sendResponse.hash)
    if (txResult.status !== 'NOT_FOUND') {
      return {
        hash: sendResponse.hash,
        status: txResult.status,
        latestLedger: txResult.latestLedger,
        // Present on both SUCCESS and FAILED (not on the NOT_FOUND variant,
        // which this branch already excludes) -- one events array per
        // operation; this dApp's transactions always have exactly one.
        events:
          'events' in txResult
            ? txResult.events.contractEventsXdr[0]
            : undefined,
      }
    }
  }

  return {
    hash: sendResponse.hash,
    status: sendResponse.status,
    latestLedger: sendResponse.latestLedger,
  }
}

/**
 * The context rule the connected wallet authorizes under, with the checks
 * that turn a refused signature into a sentence: no rule at all, a rule
 * whose signers could not be read, or a wallet that is on none of them.
 */
async function selectRuleForWallet(
  sourceAddress: string,
  wallet: WalletSigning,
  contracts: ContractSet
): Promise<ContextRule> {
  const rules = await loadContextRules(sourceAddress, contracts)
  const matchedRule = selectRuleForSigner(rules, wallet.address)

  if (!matchedRule) {
    throw new Error('No SmartAccount context rule is available for approval.')
  }
  if (matchedRule.signerCount > 0 && matchedRule.signerAddresses.length === 0) {
    throw new Error(
      'Could not verify delegated signer addresses for the matched SmartAccount rule.'
    )
  }
  if (
    matchedRule.signerAddresses.length > 0 &&
    !matchedRule.signerAddresses.includes(wallet.address)
  ) {
    throw new Error(
      `Connected wallet is not a delegated signer on any SmartAccount context rule. Rules on-chain: ${rules
        .map((rule) => `${rule.id} (${rule.name})`)
        .join(', ')}.`
    )
  }
  return matchedRule
}

/**
 * Signs and submits any `smart_account` entrypoint the wallet authorizes
 * as a delegated signer -- the generic path for signer, rule and guardian
 * writes, which the SDK has no dedicated `prepare*` for. Built from the
 * SDK's primitives: recording-mode discovery of the tree the treasury has
 * to authorize, one context rule id per node, Entry A + Entry B.
 */
export async function signAndSubmitContractInvocation({
  args,
  functionName,
  sourceAddress,
  wallet,
  contracts = STELLAR_CONFIG.contracts,
}: {
  args: xdr.ScVal[]
  functionName: string
  sourceAddress: string
  wallet: WalletSigning
  contracts?: ContractSet
}): Promise<TransactionReceipt> {
  const net = toNetworkConfig(contracts)
  const server = getServer()
  const latestLedger = await server.getLatestLedger()
  const signatureExpirationLedger = latestLedger.sequence + 100
  const matchedRule = await selectRuleForWallet(
    sourceAddress,
    wallet,
    contracts
  )

  const rootInvocation = await discoverSmartAccountInvocation(
    net,
    sourceAddress,
    functionName,
    args
  )
  const [entryA, entryB] = await buildSmartAccountAuthEntries({
    smartAccountId: contracts.smartAccount,
    rootInvocation,
    signerAddress: wallet.address,
    sign: walletSigningCallback(wallet),
    networkPassphrase: STELLAR_CONFIG.networkPassphrase,
    contextRuleIds: resolveContextRuleIds(
      [matchedRule.id],
      countAuthContexts(rootInvocation)
    ),
    signatureExpirationLedger,
  })

  const source = await server.getAccount(sourceAddress)
  const tx = new TransactionBuilder(source, {
    fee: await inclusionFee(server),
    networkPassphrase: STELLAR_CONFIG.networkPassphrase,
  })
    .addOperation(
      invokeContractOperation(contracts.smartAccount, functionName, args, [
        entryA,
        entryB,
      ])
    )
    .setTimeout(120)
    .build()

  const prepared = await server.prepareTransaction(tx)
  const signedTxXdr = await signEnvelope(wallet, prepared.toXDR())

  return submitSignedTransaction(
    new Transaction(signedTxXdr, STELLAR_CONFIG.networkPassphrase)
  )
}

/**
 * Runs one of the SDK's `prepare*` payment helpers as the connected wallet
 * and submits what it prepared: the wallet is the fee payer, the delegated
 * signer, and -- through `walletSigningCallback` -- Entry B's signer. The
 * SDK does discovery, the AuthPayload and the market fee; the wallet then
 * signs the envelope, which the SDK's own `signAndSubmit` cannot do.
 */
async function submitPreparedByWallet(
  wallet: WalletSigning,
  contracts: ContractSet,
  prepare: (opts: PrepareOptions) => Promise<Transaction>
): Promise<TransactionReceipt> {
  const matchedRule = await selectRuleForWallet(
    wallet.address,
    wallet,
    contracts
  )
  const prepared = await prepare({
    net: toNetworkConfig(contracts),
    feeSourceAddress: wallet.address,
    signerAddress: wallet.address,
    sign: walletSigningCallback(wallet),
    contextRuleIds: [matchedRule.id],
  })
  const signedTxXdr = await signEnvelope(wallet, prepared.toXDR())
  return submitSignedTransaction(
    new Transaction(signedTxXdr, STELLAR_CONFIG.networkPassphrase)
  )
}

function getRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

function countCollection(value: unknown, fallback: number) {
  if (Array.isArray(value)) return value.length
  if (value instanceof Map) return value.size
  return fallback
}

function toTreasuryStatus(status: AccountStatus): TreasuryStatus {
  return {
    initialized: Boolean(status?.initialized),
    paused: Boolean(status?.paused),
    frozen: Boolean(status?.frozen),
    policyVersionHint: Number(status?.policy_version_hint ?? 1),
  }
}

function readContextRule(id: number, value: unknown): ContextRule {
  const raw = getRecord(value) as ContractRuleRecord

  return {
    id,
    name: String(raw.name ?? `Context rule ${id}`),
    contextType: String(raw.context_type ?? raw.contextType ?? 'Default'),
    signerCount: countCollection(raw.signers ?? raw.signer_ids, 1),
    policyCount: countCollection(raw.policies ?? raw.policy_ids, 0),
    signerAddresses: getSignerAddresses(value),
    validUntil:
      typeof raw.valid_until === 'number' ? raw.valid_until : undefined,
    raw,
  }
}

export async function loadTreasurySnapshot(
  sourceAddress: string,
  contracts: ContractSet = STELLAR_CONFIG.contracts
) {
  const net = toNetworkConfig(contracts)
  const [status, policyVersion, latestLedger] = await Promise.all([
    readAccountStatus(net, sourceAddress),
    readPolicyVersion(net, sourceAddress),
    getLatestLedger(),
  ])

  return {
    status: toTreasuryStatus(status),
    policyVersion,
    latestLedger,
  }
}

/**
 * Rule IDs are `0..count` but not necessarily contiguous once rules have been
 * removed (DAPP_INTEGRATION_SPEC.md §4) — a missing id makes `get_context_rule`
 * throw, not return null. So this probes candidate ids one at a time and skips
 * the gaps, rather than assuming `count` consecutive ids starting at 0.
 */
export async function loadContextRules(
  sourceAddress: string,
  contracts: ContractSet = STELLAR_CONFIG.contracts
): Promise<ContextRule[]> {
  const net = toNetworkConfig(contracts)
  const count = await readContextRulesCount(net, sourceAddress)
  const rules: ContextRule[] = []
  const maxId = count + 32

  for (let id = 0; rules.length < count && id < maxId; id += 1) {
    try {
      const rule = await readContextRuleOnChain(net, sourceAddress, id)
      rules.push(readContextRule(id, rule))
    } catch {
      // No rule at this id — removed or never allocated. Keep scanning.
    }
  }

  return rules
}

export async function loadOwner(
  sourceAddress: string,
  contracts: ContractSet = STELLAR_CONFIG.contracts
): Promise<string | null> {
  return readOwner(toNetworkConfig(contracts), sourceAddress)
}

/**
 * Reads a holder's balance and authorization flag for a Stellar Asset
 * Contract, as `describeAssetReadiness` consumes them.
 *
 * Two reads because they answer different questions and fail differently:
 * `balance` raises the token's own `#13` when there is no trustline at all,
 * while `authorized` reports the issuer's flag on an entry that does exist.
 * A contract address (a treasury) never needs a trustline -- the token keeps
 * it a balance entry with an authorization flag -- but a classic `G...`
 * account does, which is why "missing" and "deauthorized" are separate states
 * rather than one "cannot receive".
 *
 * Failures other than `#13` come back as nulls rather than throwing: this
 * feeds a status panel, and an RPC hiccup must not read as "the issuer said
 * no". `describeAssetReadiness` treats a null authorization as acceptable for
 * the same reason.
 */
export async function loadAssetHolding(
  sourceAddress: string,
  holder: string,
  assetContractId: string
): Promise<AssetHolding> {
  let balance: bigint | null = null
  let missing = false

  try {
    const result = await simulateContractCall(
      sourceAddress,
      assetContractId,
      'balance',
      [addressScVal(holder)]
    )
    balance =
      typeof result.value === 'bigint'
        ? result.value
        : typeof result.value === 'string' || typeof result.value === 'number'
          ? BigInt(result.value)
          : null
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // #13 is the token's TrustlineMissing -- verified against the live testnet
    // SAC, alongside #8/#10/#11 (see explainContractError's own note).
    missing = /Error\(Contract, #13\)/.test(message)
  }

  let authorized: boolean | null = null
  try {
    const result = await simulateContractCall(
      sourceAddress,
      assetContractId,
      'authorized',
      [addressScVal(holder)]
    )
    authorized = typeof result.value === 'boolean' ? result.value : null
  } catch {
    authorized = null
  }

  return { balance, authorized, missing }
}

/** The contracts a `smart_account` is actually wired to, read from its own
 * instance storage. Every field is nullable: a contract that isn't a
 * smart_account, or one whose storage layout changed, must surface as "not
 * found" rather than as a silent match. */
export type SmartAccountLinks = {
  owner: string | null
  policyEngine: string | null
  intentRegistry: string | null
  recoveryManager: string | null
  transferAdapter: string | null
  splitAdapter: string | null
}

/**
 * Reads a smart_account's linked contract set straight from its instance
 * storage, with no simulation and no contract call.
 *
 * `smart_account` exposes no getter for these addresses -- which is why the
 * treasury registry originally could not check a claimed contract set -- but
 * they are plain ledger state, under the keys this reads. Two properties make
 * this the right source rather than the deploy transaction's `DeployedAccount`
 * return value: it has no retention window (the transaction leaves the RPC's
 * ~7 day history and becomes unreadable), and it reflects the account's
 * *current* wiring rather than its wiring at deploy time.
 *
 * Returns `null` when there is no contract instance at `smartAccountId` at
 * all. Individual fields come back `null` when a key is absent, so a caller
 * comparing against a claim can tell "wired to something else" apart from
 * "not wired at all"; neither may be treated as a match.
 */
export async function loadSmartAccountLinks(
  smartAccountId: string
): Promise<SmartAccountLinks | null> {
  const key = xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(smartAccountId).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
    })
  )

  const response = await getServer().getLedgerEntries(key)
  const entry = response.entries[0]
  if (!entry) return null

  const storage = entry.val.contractData().val().instance().storage() ?? []

  // Keys are either a bare symbol (`PolicyEngine`) or a two-symbol vec
  // (`["Adapter", "transfer"]`); `scValToNative` renders those as a string and
  // a string array respectively. Verified against the live testnet instance of
  // CCMPGTBA...ODUDL, whose 11 entries this parse reproduces exactly.
  const byKey = new Map<string, unknown>()
  for (const item of storage) {
    const rawKey = scValToNative(item.key()) as unknown
    const name = Array.isArray(rawKey) ? rawKey.join('/') : String(rawKey)
    byKey.set(name, scValToNative(item.val()) as unknown)
  }

  const address = (name: string) => {
    const value = byKey.get(name)
    return typeof value === 'string' ? value : null
  }

  return {
    owner: address('Owner'),
    policyEngine: address('PolicyEngine'),
    intentRegistry: address('IntentRegistry'),
    recoveryManager: address('RecoveryManager'),
    transferAdapter: address('Adapter/transfer'),
    splitAdapter: address('Adapter/split'),
  }
}

export async function loadSignerId(
  sourceAddress: string,
  signerAddress: string,
  contracts: ContractSet = STELLAR_CONFIG.contracts
) {
  return readSignerId(toNetworkConfig(contracts), sourceAddress, signerAddress)
}

export async function checkIsGuardian(
  sourceAddress: string,
  guardianAddress: string,
  contracts: ContractSet = STELLAR_CONFIG.contracts
) {
  return isGuardian(toNetworkConfig(contracts), sourceAddress, guardianAddress)
}

/**
 * Builds the probe function `policyProbe` consumes. Rejects with the raw host
 * error so `classifyProbeFailure` can read the contract code out of it.
 */
export function simulatePolicyProbe(
  sourceAddress: string,
  contracts: ContractSet = STELLAR_CONFIG.contracts
) {
  const net = toNetworkConfig(contracts)
  return async (input: {
    asset: string
    destination: string
    operation: string
    amount: string
    expectedVersion: number
  }) => {
    await validatePolicy(net, sourceAddress, {
      operation: input.operation,
      asset: input.asset,
      destination: input.destination,
      amount: BigInt(input.amount),
      expectedVersion: input.expectedVersion,
    })
  }
}

/**
 * Submits a contract call authorized by the connected wallet as the
 * transaction source. This is the plain `Address::require_auth()` model that
 * `policy_engine` uses — no SmartAccount AuthPayload is involved, so the
 * wallet signs the prepared envelope rather than an authorization entry.
 */
export async function submitAsSourceAccount({
  args,
  contractId,
  functionName,
  wallet,
}: {
  args: xdr.ScVal[]
  contractId: string
  functionName: string
  wallet: WalletSigning
}): Promise<TransactionReceipt> {
  const server = getServer()
  const source = await server.getAccount(wallet.address)
  const tx = new TransactionBuilder(source, {
    fee: await inclusionFee(server),
    networkPassphrase: STELLAR_CONFIG.networkPassphrase,
  })
    .addOperation(new Contract(contractId).call(functionName, ...args))
    .setTimeout(120)
    .build()

  const prepared = await server.prepareTransaction(tx)
  const signedTxXdr = await signEnvelope(wallet, prepared.toXDR())

  return submitSignedTransaction(
    new Transaction(signedTxXdr, STELLAR_CONFIG.networkPassphrase)
  )
}

export async function approveAndSubmitTransfer(
  wallet: WalletSigning,
  draft: PaymentDraft,
  contracts: ContractSet = STELLAR_CONFIG.contracts
): Promise<TransactionReceipt> {
  validatePaymentDraft(draft)
  const policyResult = await simulatePolicy(wallet.address, draft, contracts)
  if (!policyResult.ok) {
    throw new Error(policyResult.detail)
  }
  const nonceUsed = await checkNonce(wallet.address, draft.nonce, contracts)
  if (nonceUsed) {
    throw new Error('Nonce has already been used.')
  }

  return submitPreparedByWallet(wallet, contracts, (opts) =>
    prepareTransferPayment(opts, transferPaymentArgs(draft))
  )
}

/**
 * Raised when the intent ID in the form is already taken on-chain.
 *
 * A class rather than a message so the caller can recognise the one failure
 * that is fixed by regenerating the ID, and do it, instead of asking the
 * operator to read an error and work that out. It happens routinely: the
 * schedule form only regenerates its ID after a *successful* submission, so
 * every retry after a confirmed creation carries a spent one.
 */
export class ScheduledIntentExistsError extends Error {
  constructor(readonly intentId: string) {
    super(
      `Intent ${intentId.slice(0, 8)} already exists on-chain. Intent IDs are single-use — a new one has been generated.`
    )
    this.name = 'ScheduledIntentExistsError'
  }
}

export async function approveAndSubmitSchedule(
  wallet: WalletSigning,
  draft: ScheduleDraft,
  contracts: ContractSet = STELLAR_CONFIG.contracts
): Promise<TransactionReceipt> {
  validateScheduleDraft(draft)
  const policyResult = await simulatePolicy(wallet.address, draft, contracts)
  if (!policyResult.ok) {
    throw new Error(policyResult.detail)
  }
  const exists = await checkScheduledIntentExists(
    wallet.address,
    draft.intentId,
    contracts
  )
  if (exists) {
    throw new ScheduledIntentExistsError(draft.intentId)
  }

  return submitPreparedByWallet(wallet, contracts, (opts) =>
    prepareScheduledPayment(opts, scheduledIntentArgs(draft, contracts))
  )
}

export async function approveAndSubmitSplit(
  wallet: WalletSigning,
  draft: SplitDraft,
  contracts: ContractSet = STELLAR_CONFIG.contracts
): Promise<TransactionReceipt> {
  validateSplitDraft(draft)
  const policyResult = await simulateSplitPolicy(
    wallet.address,
    draft,
    contracts
  )
  if (!policyResult.ok) {
    throw new Error(policyResult.detail)
  }
  const nonceUsed = await checkNonce(wallet.address, draft.nonce, contracts)
  if (nonceUsed) {
    throw new Error('Nonce has already been used.')
  }

  return submitPreparedByWallet(wallet, contracts, (opts) =>
    prepareSplitPayment(opts, splitPaymentArgs(draft))
  )
}

export async function approveAndSubmitCancelSchedule(
  wallet: WalletSigning,
  intentId: string,
  contracts: ContractSet = STELLAR_CONFIG.contracts
): Promise<TransactionReceipt> {
  if (!/^(0x)?[0-9a-fA-F]{64}$/.test(intentId)) {
    throw new Error('Intent ID must be 32 bytes encoded as 64 hex characters.')
  }
  const exists = await checkScheduledIntentExists(
    wallet.address,
    intentId,
    contracts
  )
  if (!exists) {
    throw new Error('No scheduled intent exists on-chain for this ID.')
  }

  return submitPreparedByWallet(wallet, contracts, (opts) =>
    prepareCancelScheduledPayment(opts, intentIdBytes(intentId))
  )
}

export async function getLatestLedger() {
  const result = await getServer().getLatestLedger()
  return result.sequence
}

export async function checkNonce(
  sourceAddress: string,
  nonce: string,
  contracts: ContractSet = STELLAR_CONFIG.contracts
) {
  return isNonceUsed(toNetworkConfig(contracts), sourceAddress, BigInt(nonce))
}

export async function checkScheduledIntentExists(
  sourceAddress: string,
  intentId: string,
  contracts: ContractSet = STELLAR_CONFIG.contracts
) {
  try {
    await readScheduledIntentOnChain(
      toNetworkConfig(contracts),
      sourceAddress,
      intentIdBytes(intentId)
    )
    return true
  } catch {
    return false
  }
}

/**
 * Reads the policy version an intent pinned at creation. Returns null when the
 * intent cannot be read, so a missing intent never silently reads as "safe".
 */
export async function loadIntentPolicyVersion(
  sourceAddress: string,
  intentId: string,
  contracts: ContractSet = STELLAR_CONFIG.contracts
): Promise<number | null> {
  try {
    const intent = await readScheduledIntentOnChain(
      toNetworkConfig(contracts),
      sourceAddress,
      intentIdBytes(intentId)
    )
    const version = getRecord(intent).policy_version
    return typeof version === 'number' ? version : null
  } catch {
    return null
  }
}

function readOptionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** Decodes one `ScheduledIntent` field-by-field rather than by shape.
 *
 * The deployed registry carries fields this workspace's source does not
 * declare (`interval_ledgers`), so anything absent has to read as "unknown"
 * instead of failing the whole row.
 */
function toScheduledIntentRecord(
  intentId: string,
  value: unknown
): ScheduledIntentRecord {
  const raw = getRecord(value)

  return {
    intentId,
    asset: readOptionalString(raw.asset),
    destination: readOptionalString(raw.destination),
    amount: typeof raw.amount === 'bigint' ? raw.amount : null,
    startLedger: readOptionalNumber(raw.start_ledger),
    endLedger: readOptionalNumber(raw.end_ledger),
    maxExecutions: readOptionalNumber(raw.max_executions),
    executionCount: readOptionalNumber(raw.execution_count),
    policyVersion: readOptionalNumber(raw.policy_version),
    cancelled: Boolean(raw.cancelled),
    unreadable: false,
  }
}

/** The ledger a `getEvents` cursor has reached — its leading TOID's high 32
 * bits. Paging stops on this rather than on an empty page: RPC scans a bounded
 * slice per request and returns an empty page with a cursor whenever that
 * slice held no matching event, which happens routinely mid-scan. */
function cursorLedger(cursor: string): number {
  try {
    return Number(BigInt(cursor.split('-')[0]) >> 32n)
  } catch {
    return Number.MAX_SAFE_INTEGER
  }
}

function decodeEventTopics(topics: xdr.ScVal[]): unknown[] {
  return topics.map((topic) => {
    try {
      return scValToNative(topic)
    } catch {
      return null
    }
  })
}

/** Hard stop on a scan that would otherwise walk the whole retention window
 * one bounded slice at a time. 60 pages covers the testnet window in practice;
 * hitting it truncates the list rather than hanging the panel. */
const MAX_EVENT_PAGES = 60

/**
 * Every scheduled payment this treasury's registry still has events for,
 * hydrated with its current on-chain state.
 *
 * Two sources because neither one answers the question alone: the event
 * stream is the only place the *set* of intent ids exists (`intent_registry`
 * has no enumeration entrypoint), while `get_intent` is the only place their
 * current state does. See `lib/scheduledIntents.ts` for why, and for the
 * retention horizon this inherits.
 *
 * `latestLedger` comes back with the rows because every status the caller can
 * derive is relative to it, and reading it separately would let the window
 * comparison drift against the events it is judging. `clock` and
 * `retentionLedgers` travel with them for the same reason: both are what this
 * particular read saw, not a constant restated in the UI.
 */
export async function loadScheduledIntents(
  sourceAddress: string,
  contracts: ContractSet = STELLAR_CONFIG.contracts
): Promise<{
  intents: ScheduledIntentRecord[]
  latestLedger: number
  clock: LedgerClock
  retentionLedgers: number | undefined
  truncated: boolean
}> {
  const net = toNetworkConfig(contracts)
  const server = getServer()
  const health = await server.getHealth()
  const filters = [
    { type: 'contract' as const, contractIds: [contracts.intentRegistry] },
  ]

  const events: IntentEvent[] = []
  let latestLedger = health.latestLedger
  let cursor: string | undefined
  let truncated = false

  for (let page = 0; page < MAX_EVENT_PAGES; page += 1) {
    const response = await server.getEvents(
      cursor
        ? { filters, limit: 200, cursor }
        : { filters, limit: 200, startLedger: health.oldestLedger }
    )

    latestLedger = response.latestLedger ?? latestLedger
    for (const event of response.events) {
      events.push({ topics: decodeEventTopics(event.topic) })
    }

    if (!response.cursor || cursorLedger(response.cursor) >= latestLedger) break
    cursor = response.cursor
    truncated = page === MAX_EVENT_PAGES - 1
  }

  const intents = await Promise.all(
    collectIntentIds(events).map(async (intentId) => {
      try {
        const intent = await readScheduledIntentOnChain(
          net,
          sourceAddress,
          intentIdBytes(intentId)
        )
        return toScheduledIntentRecord(intentId, intent)
      } catch {
        // The id was announced on-chain, so the row stays: an intent that
        // cannot be read is not the same as one that was never created.
        return {
          intentId,
          asset: null,
          destination: null,
          amount: null,
          startLedger: null,
          endLedger: null,
          maxExecutions: null,
          executionCount: null,
          policyVersion: null,
          cancelled: false,
          unreadable: true,
        } satisfies ScheduledIntentRecord
      }
    })
  )

  return {
    intents,
    latestLedger,
    // The reference is "the ledger this read saw, at the moment it saw it".
    // The SDK's typed `getHealth` response carries no close time, and the
    // latest ledger closed within one close interval of now anyway -- an error
    // far smaller than the projection's own drift over a schedule window.
    clock: {
      referenceLedger: latestLedger,
      referenceCloseTime: Math.floor(Date.now() / 1000),
    },
    retentionLedgers: health.ledgerRetentionWindow,
    truncated,
  }
}

/**
 * Simulates a write before any signature is requested, so a contract-level
 * rejection surfaces without troubling the wallet.
 *
 * This does NOT verify authorization: Soroban's recording auth mode records
 * `require_auth` rather than enforcing it, so a successful simulation says
 * nothing about whether the connected key may perform the write.
 */
export async function simulateWriteOperation(
  operation: { args: xdr.ScVal[]; contractId: string; functionName: string },
  sourceAddress: string
): Promise<void> {
  await simulateContractCall(
    sourceAddress,
    operation.contractId,
    operation.functionName,
    operation.args
  )
}

export async function simulatePolicy(
  sourceAddress: string,
  draft: PaymentDraft,
  contracts: ContractSet = STELLAR_CONFIG.contracts
): Promise<SimulationResult> {
  const invalid = validationFailure(() => validatePaymentDraft(draft))
  if (invalid) return invalid

  try {
    await validatePolicy(
      toNetworkConfig(contracts),
      sourceAddress,
      policyCheck(draft, 'transfer')
    )
    return {
      ok: true,
      title: 'Policy simulation passed',
      detail: `Asset, destination, amount, operation, and expected policy version are accepted on ${NETWORK.name}.`,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const failure = describeSimulationFailure(message)
    return {
      ok: false,
      title: failure.rejectedByContract
        ? 'Policy rejected this payment'
        : 'Policy check could not run',
      detail: failure.detail,
      diagnostic: message,
    }
  }
}

/**
 * Checks policy for every destination/amount pair, matching how
 * `execute_split_payment` validates on-chain — it calls
 * `policy_engine.validate_policy` once per destination with `operation:
 * "split"`, not once for the whole batch (see contracts/smart_account/src/lib.rs).
 * Reports the first rejection found, in destination order.
 */
export async function simulateSplitPolicy(
  sourceAddress: string,
  draft: SplitDraft,
  contracts: ContractSet = STELLAR_CONFIG.contracts
): Promise<SimulationResult> {
  const invalid = validationFailure(() => validateSplitDraft(draft))
  if (invalid) return invalid

  for (const [index, entry] of draft.destinations.entries()) {
    try {
      await validatePolicy(
        toNetworkConfig(contracts),
        sourceAddress,
        policyCheck(
          {
            asset: draft.asset,
            destination: entry.destination,
            amount: entry.amount,
            nonce: '1',
            expectedPolicyVersion: draft.expectedPolicyVersion,
          },
          'split'
        )
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const failure = describeSimulationFailure(message)
      // Only `destination` and `amount` belong to the entry being checked. The
      // asset, the operation and the policy version are the same for every
      // destination, so naming this one would send the operator to edit an
      // address that is not the problem -- the loop simply stopped here first.
      const verdict = classifyProbeFailure(message)
      const wholePayment = isWholePaymentReason(
        verdict.allowed ? 'unknown' : verdict.reason
      )
      return {
        ok: false,
        title: failure.rejectedByContract
          ? wholePayment
            ? 'Policy rejected this split payment'
            : `Policy rejected destination ${index + 1}`
          : 'Policy check could not run',
        detail:
          failure.rejectedByContract && wholePayment
            ? `${failure.detail} It applies to the whole payment, not to destination ${index + 1} — every destination would be rejected the same way.`
            : failure.detail,
        diagnostic: message,
      }
    }
  }

  return {
    ok: true,
    title: 'Policy simulation passed',
    detail: `Every destination, amount, and the expected policy version are accepted on ${NETWORK.name}.`,
  }
}

export async function simulateTransfer(
  sourceAddress: string,
  draft: PaymentDraft,
  contracts: ContractSet = STELLAR_CONFIG.contracts
): Promise<SimulationResult> {
  const invalid = validationFailure(() => validatePaymentDraft(draft))
  if (invalid) return invalid

  try {
    const nonceUsed = await checkNonce(sourceAddress, draft.nonce, contracts)
    if (nonceUsed) {
      return {
        ok: false,
        title: 'Nonce already used',
        detail: 'Generate a fresh nonce before asking the signer to approve.',
      }
    }

    await discoverSmartAccountInvocation(
      toNetworkConfig(contracts),
      sourceAddress,
      'execute_transfer_payment',
      encodeTransferArgs(transferPaymentArgs(draft))
    )

    return {
      ok: true,
      title: 'Transfer simulation built',
      detail:
        'The unsigned transfer invocation is structurally valid. Final submission still requires SmartAccount custom auth entries.',
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const failure = describeSimulationFailure(message)
    return {
      ok: false,
      title:
        failure.kind === 'authorization'
          ? 'Transfer simulation needs auth'
          : failure.rejectedByContract
            ? 'Transfer rejected by the contract'
            : 'Transfer simulation could not run',
      detail: failure.detail,
      diagnostic: message,
    }
  }
}

export async function simulateSplit(
  sourceAddress: string,
  draft: SplitDraft,
  contracts: ContractSet = STELLAR_CONFIG.contracts
): Promise<SimulationResult> {
  const invalid = validationFailure(() => validateSplitDraft(draft))
  if (invalid) return invalid

  try {
    const nonceUsed = await checkNonce(sourceAddress, draft.nonce, contracts)
    if (nonceUsed) {
      return {
        ok: false,
        title: 'Nonce already used',
        detail: 'Generate a fresh nonce before asking the signer to approve.',
      }
    }

    await discoverSmartAccountInvocation(
      toNetworkConfig(contracts),
      sourceAddress,
      'execute_split_payment',
      encodeSplitArgs(splitPaymentArgs(draft))
    )

    return {
      ok: true,
      title: 'Split simulation built',
      detail:
        'The unsigned split invocation is structurally valid. Final submission still requires SmartAccount custom auth entries.',
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const failure = describeSimulationFailure(message)
    return {
      ok: false,
      title:
        failure.kind === 'authorization'
          ? 'Split simulation needs auth'
          : failure.rejectedByContract
            ? 'Split rejected by the contract'
            : 'Split simulation could not run',
      detail: failure.detail,
      diagnostic: message,
    }
  }
}

export async function simulateSchedule(
  sourceAddress: string,
  draft: ScheduleDraft,
  contracts: ContractSet = STELLAR_CONFIG.contracts
): Promise<SimulationResult> {
  const invalid = validationFailure(() => validateScheduleDraft(draft))
  if (invalid) return invalid

  try {
    const exists = await checkScheduledIntentExists(
      sourceAddress,
      draft.intentId,
      contracts
    )
    if (exists) {
      return {
        ok: false,
        title: 'Intent already exists',
        detail:
          'Generate a new intent ID before creating this scheduled payment.',
      }
    }

    await discoverSmartAccountInvocation(
      toNetworkConfig(contracts),
      sourceAddress,
      'create_scheduled_payment',
      [encodeScheduledIntent(scheduledIntentArgs(draft, contracts))]
    )
    return {
      ok: true,
      title: 'Schedule simulation built',
      detail:
        'The scheduled intent shape is valid. The contract will pin current policy version and adapter at creation.',
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const failure = describeSimulationFailure(message)
    return {
      ok: false,
      title:
        failure.kind === 'authorization'
          ? 'Schedule simulation needs auth'
          : failure.rejectedByContract
            ? 'Schedule rejected by the contract'
            : 'Schedule simulation could not run',
      detail: failure.detail,
      diagnostic: message,
    }
  }
}
