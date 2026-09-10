import {
  BASE_FEE,
  Transaction,
  TransactionBuilder,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk'

import { STELLAR_CONFIG } from '@/config'
import { selectAllInvocationsForAddress } from '@/lib/authTree'
import { inclusionFee } from '@/lib/inclusionFee'
import {
  addressCredentialsEntry,
  addressScVal,
  bytesN32ScVal,
  getServer,
  invokeContractOperation,
  randomAuthNonce,
  signDelegatedAuthEntry,
  signEnvelope,
  signerDelegatedScVal,
  submitSignedTransaction,
  u32ScVal,
} from '@/lib/stellarClient'
import type { TransactionReceipt, WalletSigning } from '@/types'

export type DeployedAccountResult = {
  smartAccountId: string
  policyEngineId: string
  intentRegistryId: string
  recoveryManagerId: string
  transferAdapterId: string
  splitAdapterId: string
}

export type DeployAccountResult = {
  receipt: TransactionReceipt
  deployed: DeployedAccountResult
}

function randomSaltHex(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    ''
  )
}

/**
 * account_factory.deploy_account is only usable once these two env vars are
 * configured: the factory's own contract id, and the shared relayer's
 * public address (passed as `executor` so the relayer can service the new
 * treasury's scheduled payments immediately). Both are optional at the env
 * layer (src/lib/env.ts) precisely so an environment that hasn't set up the
 * deploy feature yet doesn't fail config validation for the whole app --
 * this is where that absence actually gets surfaced, to whoever tries to
 * use the feature rather than to every page load.
 */
function requireFactoryConfig() {
  const { accountFactoryId, relayerExecutorAddress } = STELLAR_CONFIG
  if (!accountFactoryId) {
    throw new Error(
      'Treasury deployment is not configured: NEXT_PUBLIC_ACCOUNT_FACTORY_ID is not set.'
    )
  }
  if (!relayerExecutorAddress) {
    throw new Error(
      'Treasury deployment is not configured: NEXT_PUBLIC_RELAYER_EXECUTOR_ADDRESS is not set.'
    )
  }
  return { accountFactoryId, relayerExecutorAddress }
}

function decodeDeployedAccount(value: unknown): DeployedAccountResult {
  const record = (value ?? {}) as Record<string, unknown>
  const smartAccountId = record.smart_account
  const policyEngineId = record.policy_engine
  const intentRegistryId = record.intent_registry
  const recoveryManagerId = record.recovery_manager
  const transferAdapterId = record.transfer_adapter
  const splitAdapterId = record.split_adapter

  if (
    typeof smartAccountId !== 'string' ||
    typeof policyEngineId !== 'string' ||
    typeof intentRegistryId !== 'string' ||
    typeof recoveryManagerId !== 'string' ||
    typeof transferAdapterId !== 'string' ||
    typeof splitAdapterId !== 'string'
  ) {
    throw new Error(
      'account_factory.deploy_account did not return a complete DeployedAccount — the transaction succeeded but its return value could not be decoded.'
    )
  }

  return {
    smartAccountId,
    policyEngineId,
    intentRegistryId,
    recoveryManagerId,
    transferAdapterId,
    splitAdapterId,
  }
}

/**
 * Deploys a brand-new Smart Treasury Account (smart_account + 5 supporting
 * contracts) via account_factory.deploy_account — Tier 1 "guided" setup
 * (smart-contracts repo's docs/DAPP_INTEGRATION_SPEC.md §12.2/§12.3): the
 * connected wallet becomes owner + policy admin + recovery admin together,
 * with itself as the sole Signer::Delegated, guardian_threshold 1 (no
 * guardians registered yet — a follow-up step, not this call), and the
 * shared relayer's known address as executor so it can service this
 * treasury's scheduled payments immediately.
 *
 * The auth wrinkle this has to handle: `caller.require_auth()` fires at six
 * separate, sibling (non-nested) points in deploy_account's call tree — its
 * own body, plus once inside each of the five sub-contracts' own
 * `initialize` — not just at the root. A plain envelope (source-account)
 * signature only covers root-level require_auth(), so this discovers every
 * node via simulate-in-recording-mode and signs each one as its own
 * standard (non-custom-account) Address credential entry — the exact same
 * `authorizeEntry`/`wallet.signAuthEntry` mechanism stellarClient.ts already
 * uses for smart_account's Entry B, just repeated per node instead of once.
 * This is unrelated to smart_account's custom AuthPayload machinery: it
 * doesn't exist yet at deploy time, and `caller` here is an ordinary
 * wallet key the whole way through.
 */
export async function deployAccount(
  wallet: WalletSigning
): Promise<DeployAccountResult> {
  const { accountFactoryId, relayerExecutorAddress } = requireFactoryConfig()
  const server = getServer()
  const latestLedger = await server.getLatestLedger()
  const signatureExpirationLedger = latestLedger.sequence + 100

  const args = [
    addressScVal(wallet.address),
    bytesN32ScVal(randomSaltHex()),
    xdr.ScVal.scvVec([signerDelegatedScVal(wallet.address)]),
    xdr.ScVal.scvMap([]),
    u32ScVal(1),
    addressScVal(relayerExecutorAddress),
  ]

  // A fresh, throwaway Account fetch for the discovery simulation --
  // TransactionBuilder.build() mutates whatever Account object it's given
  // (incrementSequenceNumber(), as a side effect of every build() call, per
  // the SDK's own transaction_builder.js). Reusing one Account object across
  // both this discovery build and the final tx build below would leave the
  // final tx's sequence number one higher than the network actually expects
  // (this discovery tx is only ever simulated, never submitted), failing
  // every submission with tx_bad_seq -- matching how discoverTreasuryInvocation
  // in stellarClient.ts already avoids this, with its own separate fetch.
  const discoverySource = await server.getAccount(wallet.address)
  const discoveryTx = new TransactionBuilder(discoverySource, {
    fee: BASE_FEE,
    networkPassphrase: STELLAR_CONFIG.networkPassphrase,
  })
    .addOperation(
      invokeContractOperation(accountFactoryId, 'deploy_account', args, [])
    )
    .setTimeout(60)
    .build()

  const simulation = await server.simulateTransaction(discoveryTx)
  if ('error' in simulation) {
    throw new Error(simulation.error)
  }

  const rawAuth = simulation.result?.auth ?? []
  const invocations = selectAllInvocationsForAddress(rawAuth, wallet.address)
  if (invocations.length === 0 && rawAuth.length === 0) {
    throw new Error(
      "Simulation recorded no authorization requirement for the connected wallet — account_factory.deploy_account's authorization shape may have changed."
    )
  }

  // When the connected wallet is both the transaction's source account and
  // `caller` (always true for this call), Soroban's recording-mode
  // simulation satisfies every caller.require_auth() node via
  // source-account credentials rather than explicit Address-credential
  // entries -- selectAllInvocationsForAddress correctly returns none of
  // those (see its own doc comment), and `invocations` being empty here is
  // expected, not an error: the envelope signature below already covers
  // it. Verified directly against a live testnet simulation of this exact
  // call (2026-09-07) -- the recorded auth entry's credentials discriminant
  // is SOROBAN_CREDENTIALS_SOURCE_ACCOUNT (0), not _ADDRESS (1).
  const signedEntries: xdr.SorobanAuthorizationEntry[] = []
  for (const invocation of invocations) {
    const unsigned = addressCredentialsEntry({
      address: wallet.address,
      invocation,
      nonce: randomAuthNonce(),
      signature: xdr.ScVal.scvVoid(),
      signatureExpirationLedger,
    })
    signedEntries.push(
      await signDelegatedAuthEntry(unsigned, wallet, signatureExpirationLedger)
    )
  }

  // Fetched fresh (not reused from discoverySource above, for the mutation
  // reason noted there) -- also naturally reflects the account's current
  // sequence number after however long the signing round trip above took.
  const source = await server.getAccount(wallet.address)
  const tx = new TransactionBuilder(source, {
    fee: await inclusionFee(server),
    networkPassphrase: STELLAR_CONFIG.networkPassphrase,
  })
    .addOperation(
      invokeContractOperation(
        accountFactoryId,
        'deploy_account',
        args,
        signedEntries
      )
    )
    .setTimeout(120)
    .build()

  const prepared = await server.prepareTransaction(tx)
  const signedTxXdr = await signEnvelope(wallet, prepared.toXDR())

  const receipt = await submitSignedTransaction(
    new Transaction(signedTxXdr, STELLAR_CONFIG.networkPassphrase)
  )

  if (receipt.status !== 'SUCCESS') {
    throw new Error(
      `account_factory.deploy_account did not succeed (status: ${receipt.status}). No treasury was deployed.`
    )
  }

  // submitSignedTransaction already polled to a terminal status but only
  // returns {hash, status, latestLedger} -- fetch once more to read back
  // the DeployedAccount struct the call actually returned.
  const txResult = await server.getTransaction(receipt.hash)
  if (!('returnValue' in txResult) || !txResult.returnValue) {
    throw new Error(
      'deploy_account succeeded but its return value could not be read back — cannot recover the deployed contract addresses.'
    )
  }

  const deployed = decodeDeployedAccount(scValToNative(txResult.returnValue))
  return { receipt, deployed }
}
