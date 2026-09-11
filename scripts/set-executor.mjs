#!/usr/bin/env node
/**
 * Operator script: repoints a treasury's `intent_registry` Executor at a
 * different relayer key.
 *
 * Why this exists: `intent_registry.set_executor` is gated by
 * `ensure_admin` -> `admin.require_auth()`, and for every treasury the
 * factory deploys the admin is *the smart account contract itself*
 * (`smart_account::initialize` calls `intent_registry.initialize(
 * env.current_contract_address())`). So a bare `stellar contract invoke`
 * can't sign it -- there is no Ed25519 key for a `C...` address. It needs
 * the same Entry A + Entry B custom-auth construction the dApp uses for
 * payments, which `sta-sdk` builds (`buildSmartAccountAuthEntries`; its
 * bytes are pinned by test to what the dApp submitted on mainnet). The
 * root invocation is discovered by simulation rather than hand-built, and
 * the inclusion fee follows the market -- BASE_FEE is refused on mainnet.
 *
 * The signer must be a `Signer::Delegated` on one of the smart account's
 * context rules (true of the deploying wallet for any Tier 1 guided
 * deploy). The rule is auto-selected from the chain unless you pin one.
 *
 * Usage -- keep the secret out of shell history by reading it, not typing
 * it on the command line:
 *
 *   read -rs SIGNER_SECRET && export SIGNER_SECRET
 *   NETWORK=mainnet \
 *   SMART_ACCOUNT_ID=C... \
 *   NEW_EXECUTOR=G... \
 *   node scripts/set-executor.mjs
 *   unset SIGNER_SECRET
 *
 * Set DRY_RUN=1 to stop after simulation, printing what would be sent.
 */
import {
  Address,
  Keypair,
  Operation,
  TransactionBuilder,
  rpc,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk'
import {
  buildSmartAccountAuthEntries,
  countAuthContexts,
  inclusionFee,
  resolveContextRuleIds,
  selectInvocationForAddress,
  submitTransaction,
  u32ScVal,
} from 'sta-sdk'

const NETWORKS = {
  mainnet: {
    passphrase: 'Public Global Stellar Network ; September 2015',
    rpcUrl: 'https://soroban-rpc.mainnet.stellar.gateway.fm',
  },
  testnet: {
    passphrase: 'Test SDF Network ; September 2015',
    rpcUrl: 'https://soroban-testnet.stellar.org',
  },
}

function requireEnv(name) {
  const value = process.env[name]
  if (!value) throw new Error(`Set ${name} before running this script.`)
  return value
}

function addressScVal(id) {
  return new Address(id).toScVal()
}

function addressScAddress(id) {
  return new Address(id).toScAddress()
}

/** Reads a contract's instance storage as a plain object, so the script can
 * check what it is about to change and prove afterwards that it changed. */
async function readInstanceStorage(server, contractId) {
  const key = xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: addressScAddress(contractId),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
    })
  )
  const { entries } = await server.getLedgerEntries(key)
  if (entries.length === 0) {
    throw new Error(`No contract instance exists at ${contractId}.`)
  }

  const storage = entries[0].val.contractData().val().instance().storage() ?? []
  const out = {}
  for (const entry of storage) {
    const nativeKey = scValToNative(entry.key())
    const name = Array.isArray(nativeKey) ? nativeKey[0] : String(nativeKey)
    out[name] = scValToNative(entry.val())
  }
  return out
}

async function simulateRead(
  server,
  network,
  source,
  contractId,
  fn,
  args = []
) {
  const tx = new TransactionBuilder(source, {
    fee: '100',
    networkPassphrase: network.passphrase,
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract: contractId,
        function: fn,
        args,
      })
    )
    .setTimeout(30)
    .build()

  const simulation = await server.simulateTransaction(tx)
  if (rpc.Api.isSimulationError(simulation)) {
    throw new Error(`Simulating ${fn} failed: ${simulation.error}`)
  }
  return simulation
}

/** Picks the context rule the signer is actually a delegated signer on.
 * Rule ids are not contiguous once rules have been removed, so this probes
 * candidates and skips gaps -- same scan as `loadContextRules`. */
async function findContextRuleId(
  server,
  network,
  source,
  smartAccountId,
  signerAddress
) {
  const countSim = await simulateRead(
    server,
    network,
    source,
    smartAccountId,
    'get_context_rules_count'
  )
  const count = Number(scValToNative(countSim.result.retval) ?? 0)
  const seen = []

  for (let id = 0, found = 0; found < count && id < count + 32; id += 1) {
    let rule
    try {
      const sim = await simulateRead(
        server,
        network,
        source,
        smartAccountId,
        'get_context_rule',
        [u32ScVal(id)]
      )
      rule = scValToNative(sim.result.retval)
    } catch {
      continue // no rule at this id
    }
    found += 1
    const serialized = JSON.stringify(rule, (_key, value) =>
      typeof value === 'bigint' ? value.toString() : value
    )
    const signers = Array.from(
      new Set(serialized.match(/G[A-Z2-7]{55}/g) ?? [])
    )
    seen.push(`${id} (${rule?.name ?? 'unnamed'})`)
    if (signers.includes(signerAddress)) return id
  }

  throw new Error(
    `${signerAddress} is not a delegated signer on any context rule of ${smartAccountId}. Rules on-chain: ${seen.join(', ') || 'none'}.`
  )
}

async function main() {
  const networkName = requireEnv('NETWORK')
  const network = NETWORKS[networkName]
  if (!network) {
    throw new Error(
      `NETWORK must be one of: ${Object.keys(NETWORKS).join(', ')}.`
    )
  }
  const rpcUrl = process.env.RPC_URL ?? network.rpcUrl
  const smartAccountId = requireEnv('SMART_ACCOUNT_ID')
  const newExecutor = requireEnv('NEW_EXECUTOR')
  const signer = Keypair.fromSecret(requireEnv('SIGNER_SECRET'))
  const dryRun = process.env.DRY_RUN === '1'

  const server = new rpc.Server(rpcUrl)

  // Read the wiring off the chain rather than trusting arguments: the
  // registry to change is whichever one this treasury actually points at.
  const accountStorage = await readInstanceStorage(server, smartAccountId)
  const intentRegistryId = accountStorage.IntentRegistry
  if (!intentRegistryId) {
    throw new Error(
      `${smartAccountId} has no IntentRegistry in its instance storage — is it a smart_account?`
    )
  }
  const pinnedRegistry = process.env.INTENT_REGISTRY_ID
  if (pinnedRegistry && pinnedRegistry !== intentRegistryId) {
    throw new Error(
      `INTENT_REGISTRY_ID is ${pinnedRegistry} but ${smartAccountId} is wired to ${intentRegistryId}.`
    )
  }

  const registryStorage = await readInstanceStorage(server, intentRegistryId)
  console.log(`network:         ${networkName} (${rpcUrl})`)
  console.log(`smart account:   ${smartAccountId}`)
  console.log(`intent registry: ${intentRegistryId}`)
  console.log(`admin:           ${registryStorage.Admin}`)
  console.log(`executor now:    ${registryStorage.Executor}`)
  console.log(`executor wanted: ${newExecutor}`)

  if (registryStorage.Executor === newExecutor) {
    console.log('\nAlready set. Nothing to do.')
    return
  }
  if (registryStorage.Admin !== smartAccountId) {
    throw new Error(
      `${intentRegistryId}'s admin is ${registryStorage.Admin}, not the smart account. If that is an Ed25519 account, use a plain \`stellar contract invoke --source-account\` instead; this script only builds smart-account custom auth.`
    )
  }

  const args = [addressScVal(newExecutor)]
  const source = await server.getAccount(signer.publicKey())
  const contextRuleId = process.env.CONTEXT_RULE_ID
    ? Number(process.env.CONTEXT_RULE_ID)
    : await findContextRuleId(
        server,
        network,
        source,
        smartAccountId,
        signer.publicKey()
      )
  console.log(`context rule:    ${contextRuleId}`)

  // Recording-mode simulation reports the exact tree the smart account has
  // to authorize; hand-building it would only guess at the same thing.
  const discovery = await simulateRead(
    server,
    network,
    source,
    intentRegistryId,
    'set_executor',
    args
  )
  const rootInvocation = selectInvocationForAddress(
    discovery.result?.auth ?? [],
    smartAccountId
  )
  if (!rootInvocation) {
    throw new Error(
      `Simulation recorded no authorization requirement for ${smartAccountId} — set_executor's authorization shape may have changed.`
    )
  }

  const latestLedger = await server.getLatestLedger()
  const signatureExpirationLedger = latestLedger.sequence + 100
  const [entryA, signedEntryB] = await buildSmartAccountAuthEntries({
    smartAccountId,
    rootInvocation,
    signerAddress: signer.publicKey(),
    sign: signer,
    networkPassphrase: network.passphrase,
    contextRuleIds: resolveContextRuleIds(
      [contextRuleId],
      countAuthContexts(rootInvocation)
    ),
    signatureExpirationLedger,
  })

  // Fetched again: TransactionBuilder.build() increments the sequence number
  // of whatever Account object it is given, and the simulations above each
  // built a throwaway transaction from this same object.
  const txSource = await server.getAccount(signer.publicKey())
  const tx = new TransactionBuilder(txSource, {
    fee: await inclusionFee(server),
    networkPassphrase: network.passphrase,
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract: intentRegistryId,
        function: 'set_executor',
        args,
        auth: [entryA, signedEntryB],
      })
    )
    .setTimeout(120)
    .build()

  const prepared = await server.prepareTransaction(tx)
  if (dryRun) {
    console.log('\nDRY_RUN=1 — simulation succeeded, nothing submitted.')
    console.log(`fee (stroops):   ${prepared.fee}`)
    return
  }

  prepared.sign(signer)
  const net = {
    network: networkName,
    rpcUrl,
    networkPassphrase: network.passphrase,
    contracts: {},
  }
  const result = await submitTransaction(net, prepared)

  const after = await readInstanceStorage(server, intentRegistryId)
  if (after.Executor !== newExecutor) {
    throw new Error(
      `Transaction ${result.txHash} succeeded but the executor reads back as ${after.Executor}.`
    )
  }
  console.log(`\nset_executor succeeded, tx ${result.txHash}`)
  console.log(`executor now:    ${after.Executor}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
