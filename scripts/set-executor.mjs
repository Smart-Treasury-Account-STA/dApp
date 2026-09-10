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
 * payments, which is rebuilt here rather than imported: `src/lib/
 * stellarClient.ts` is a Next.js module whose `@/config` import validates
 * the whole `NEXT_PUBLIC_*` set at load time, and the published `sta-sdk`
 * is a different, older lineage than the construction that is actually
 * proven on mainnet. Everything below mirrors `stellarClient.ts`'s
 * `buildUnsignedCustomAuthEntries` / `signAndSubmitContractInvocation`
 * exactly; change them together.
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
  authorizeEntry,
  hash,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk'

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

/** Same bid policy as `src/lib/inclusionFee.ts`: `prepareTransaction` sets
 * the resource fee but leaves the inclusion bid at whatever the builder was
 * given, and BASE_FEE (100) is below what mainnet accepts -- that is exactly
 * the `txInsufficientFee` this repo already fixed once, in the dApp. */
const FEE_FLOOR_STROOPS = 2_000
const FEE_CAP_STROOPS = 100_000
const FEE_HEADROOM = 10

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

function u32ScVal(value) {
  return nativeToScVal(Number(value), { type: 'u32' })
}

function bytesScVal(bytes) {
  return xdr.ScVal.scvBytes(bytes)
}

/** Soroban rejects an unsorted ScMap before the contract runs, so struct
 * fields are sorted by key -- mirrors `src/lib/scval.ts`. */
function structScVal(fields) {
  return xdr.ScVal.scvMap(
    Object.entries(fields)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(
        ([key, val]) =>
          new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val })
      )
  )
}

function signerDelegatedScVal(address) {
  return xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol('Delegated'),
    addressScVal(address),
  ])
}

function contractInvocation(contractId, functionName, args) {
  return new xdr.SorobanAuthorizedInvocation({
    function:
      xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({
          contractAddress: addressScAddress(contractId),
          functionName,
          args,
        })
      ),
    subInvocations: [],
  })
}

function addressCredentialsEntry({
  address,
  invocation,
  nonce,
  signature,
  signatureExpirationLedger,
}) {
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: addressScAddress(address),
        nonce: xdr.Int64.fromString(nonce),
        signatureExpirationLedger,
        signature,
      })
    ),
    rootInvocation: invocation,
  })
}

function randomAuthNonce() {
  const high = BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER))
  const nonce =
    (high ^ BigInt(Date.now())) & ((BigInt(1) << BigInt(62)) - BigInt(1))
  return nonce.toString()
}

function signaturePayload(
  invocation,
  nonce,
  signatureExpirationLedger,
  networkPassphrase
) {
  const preimage = xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
    new xdr.HashIdPreimageSorobanAuthorization({
      networkId: hash(Buffer.from(networkPassphrase)),
      nonce: xdr.Int64.fromString(nonce),
      signatureExpirationLedger,
      invocation,
    })
  )
  return hash(preimage.toXDR())
}

function countAuthContexts(invocation) {
  return invocation
    .subInvocations()
    .reduce((total, sub) => total + countAuthContexts(sub), 1)
}

function selectInvocationForAddress(entries, address) {
  for (const entry of entries) {
    const credentials = entry.credentials()
    if (
      credentials.switch().value !==
      xdr.SorobanCredentialsType.sorobanCredentialsAddress().value
    ) {
      continue
    }
    if (
      Address.fromScAddress(credentials.address().address()).toString() ===
      address
    ) {
      return entry.rootInvocation()
    }
  }
  return null
}

function buildUnsignedCustomAuthEntries({
  contextRuleIds,
  rootInvocation,
  signerAddress,
  smartAccountId,
  signatureExpirationLedger,
  networkPassphrase,
}) {
  const entryANonce = randomAuthNonce()
  const rootPayload = signaturePayload(
    rootInvocation,
    entryANonce,
    signatureExpirationLedger,
    networkPassphrase
  )
  const contextRuleIdsScVal = xdr.ScVal.scvVec(
    contextRuleIds.map((id) => u32ScVal(id))
  )
  const authDigest = hash(
    Buffer.concat([rootPayload, contextRuleIdsScVal.toXDR()])
  )

  const entryA = addressCredentialsEntry({
    address: smartAccountId,
    invocation: rootInvocation,
    nonce: entryANonce,
    signatureExpirationLedger,
    signature: structScVal({
      context_rule_ids: contextRuleIdsScVal,
      signers: xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
          key: signerDelegatedScVal(signerAddress),
          val: bytesScVal(Buffer.alloc(0)),
        }),
      ]),
    }),
  })

  const entryB = addressCredentialsEntry({
    address: signerAddress,
    invocation: contractInvocation(smartAccountId, '__check_auth', [
      bytesScVal(authDigest),
    ]),
    nonce: randomAuthNonce(),
    signatureExpirationLedger,
    signature: xdr.ScVal.scvVoid(),
  })

  return { entryA, entryB }
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
    fee: String(FEE_FLOOR_STROOPS),
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

async function inclusionFee(server) {
  let observed = 0
  try {
    const stats = await server.getFeeStats()
    const p99 = Number.parseInt(stats.sorobanInclusionFee.p99, 10)
    observed = Number.isFinite(p99) ? p99 : 0
  } catch {
    observed = 0
  }
  return String(
    Math.min(
      FEE_CAP_STROOPS,
      Math.max(FEE_FLOOR_STROOPS, observed * FEE_HEADROOM)
    )
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
  const { entryA, entryB } = buildUnsignedCustomAuthEntries({
    contextRuleIds: Array.from(
      { length: countAuthContexts(rootInvocation) },
      () => contextRuleId
    ),
    rootInvocation,
    signerAddress: signer.publicKey(),
    smartAccountId,
    signatureExpirationLedger,
    networkPassphrase: network.passphrase,
  })
  const signedEntryB = await authorizeEntry(
    entryB,
    signer,
    signatureExpirationLedger,
    network.passphrase
  )

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
  const sent = await server.sendTransaction(prepared)
  if (sent.status === 'ERROR') {
    const code = sent.errorResult
      ? sent.errorResult.result().switch().name
      : 'ERROR (the RPC gave no result code)'
    throw new Error(`Submission failed: ${code}`)
  }

  let result = await server.getTransaction(sent.hash)
  const deadline = Date.now() + 60_000
  while (result.status === 'NOT_FOUND' && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    result = await server.getTransaction(sent.hash)
  }
  if (result.status !== 'SUCCESS') {
    throw new Error(`set_executor did not succeed (status: ${result.status}).`)
  }

  const after = await readInstanceStorage(server, intentRegistryId)
  if (after.Executor !== newExecutor) {
    throw new Error(
      `Transaction ${sent.hash} succeeded but the executor reads back as ${after.Executor}.`
    )
  }
  console.log(`\nset_executor succeeded, tx ${sent.hash}`)
  console.log(`executor now:    ${after.Executor}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
