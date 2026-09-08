import {
  Address,
  BASE_FEE,
  authorizeEntry,
  Contract,
  Operation,
  Transaction,
  TransactionBuilder,
  hash,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { Buffer } from "buffer";

import { STELLAR_CONFIG } from "@/config";
import { validatePaymentDraft, validateScheduleDraft, validateSplitDraft } from "@/features/treasury/drafts";
import { countAuthContexts, selectInvocationForAddress } from "@/lib/authTree";
import type { ContractSet } from "@/lib/env";
import type { AssetHolding } from "@/lib/assetHolding";
import { describeSimulationFailure } from "@/lib/format";
import { classifyProbeFailure, isWholePaymentReason } from "@/lib/policyProbe";
import { structScVal } from "@/lib/scval";
import { validationFailure } from "@/lib/simulationResult";
import { selectRuleForSigner } from "@/lib/smartAccountAuth";
import { decodeWalletSignature } from "@/lib/walletSignature";
import type {
  ContextRule,
  PaymentDraft,
  ScheduleDraft,
  SimulationResult,
  SplitDraft,
  TreasuryStatus,
  TransactionReceipt,
  WalletSigning,
} from "@/types";

type SimulationValue = string | number | boolean | bigint | null | Record<string, unknown>;

type SimulatedContractCall = {
  value: SimulationValue;
};

type ContractRuleRecord = {
  name?: unknown;
  context_type?: unknown;
  contextType?: unknown;
  signers?: unknown;
  signer_ids?: unknown;
  policies?: unknown;
  policy_ids?: unknown;
  valid_until?: unknown;
};

type CustomAuthInput = {
  rootInvocation: xdr.SorobanAuthorizedInvocation;
  contextRuleIds: number[];
  signerAddress: string;
  signatureExpirationLedger: number;
  contracts: ContractSet;
};

/**
 * Asks the host which invocation tree the treasury has to authorize.
 *
 * Building the tree from the entrypoint alone only works when the call moves
 * no tokens. `execute_transfer_payment` reaches the SAC's `transfer` through
 * the adapter, and because the adapter — not the treasury — is the SAC's
 * direct caller, that `transfer` needs its own declared node; without it the
 * SAC rejects the payment with `Error(Auth, InvalidAction)` /
 * "Unauthorized function call for address". Simulating with no auth entries
 * puts the host in recording mode, so it reports that tree itself rather than
 * the dApp restating each contract's internal call graph.
 */
async function discoverTreasuryInvocation(
  sourceAddress: string,
  functionName: string,
  args: xdr.ScVal[],
  contracts: ContractSet,
): Promise<xdr.SorobanAuthorizedInvocation> {
  const server = getServer();
  const source = await server.getAccount(sourceAddress);
  const contract = new Contract(contracts.smartAccount);
  const tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: STELLAR_CONFIG.networkPassphrase,
  })
    .addOperation(contract.call(functionName, ...args))
    .setTimeout(60)
    .build();

  const simulation = await server.simulateTransaction(tx);
  if (isSimulationError(simulation)) {
    throw new Error(simulation.error);
  }

  const recorded = selectInvocationForAddress(
    simulation.result?.auth ?? [],
    contracts.smartAccount,
  );
  if (!recorded) {
    throw new Error(
      "Simulation recorded no authorization requirement for the treasury account.",
    );
  }

  return recorded;
}

export function getServer() {
  return new rpc.Server(STELLAR_CONFIG.rpcUrl);
}

function isSimulationError(
  simulation: rpc.Api.SimulateTransactionResponse,
): simulation is rpc.Api.SimulateTransactionErrorResponse {
  return "error" in simulation;
}

function readSimulationValue(
  simulation: rpc.Api.SimulateTransactionResponse,
): SimulationValue {
  if (isSimulationError(simulation)) {
    throw new Error(simulation.error);
  }

  const retval = simulation.result?.retval;
  if (!retval) return null;

  return scValToNative(retval) as SimulationValue;
}

async function simulateContractCall(
  sourceAddress: string,
  contractId: string,
  method: string,
  args: xdr.ScVal[] = [],
): Promise<SimulatedContractCall> {
  const server = getServer();
  const source = await server.getAccount(sourceAddress);
  const contract = new Contract(contractId);
  const tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: STELLAR_CONFIG.networkPassphrase,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(60)
    .build();

  const simulation = await server.simulateTransaction(tx);
  return { value: readSimulationValue(simulation) };
}

export function addressScVal(address: string) {
  return new Address(address).toScVal();
}

function addressScAddress(address: string) {
  return new Address(address).toScAddress();
}

export function symbolScVal(value: string) {
  return xdr.ScVal.scvSymbol(value);
}

export function i128ScVal(value: string) {
  return nativeToScVal(BigInt(value), { type: "i128" });
}

export function u32ScVal(value: number | string) {
  return nativeToScVal(Number(value), { type: "u32" });
}

function u64ScVal(value: number | string) {
  return nativeToScVal(BigInt(value), { type: "u64" });
}

export function boolScVal(value: boolean) {
  return nativeToScVal(value);
}

export function bytesN32ScVal(hex: string) {
  const normalized = hex.replace(/^0x/, "");
  const parts = normalized.match(/.{1,2}/g) ?? [];
  const bytes = Buffer.from(parts.map((byte) => parseInt(byte, 16)));

  if (bytes.length !== 32) {
    throw new Error("Intent ID must be 32 bytes encoded as 64 hex characters.");
  }

  return xdr.ScVal.scvBytes(bytes);
}

function bytesScVal(bytes: Buffer) {
  return xdr.ScVal.scvBytes(bytes);
}

function policyCheckScVal(draft: PaymentDraft | ScheduleDraft, operation = "transfer") {
  return structScVal({
    operation: symbolScVal(operation),
    asset: addressScVal(draft.asset),
    destination: addressScVal(draft.destination),
    amount: i128ScVal(draft.amount),
    expected_version: u32ScVal(draft.expectedPolicyVersion),
  });
}

function scheduledIntentScVal(draft: ScheduleDraft, contracts: ContractSet) {
  return structScVal({
    intent_id: bytesN32ScVal(draft.intentId),
    asset: addressScVal(draft.asset),
    destination: addressScVal(draft.destination),
    amount: i128ScVal(draft.amount),
    start_ledger: u32ScVal(draft.startLedger),
    end_ledger: u32ScVal(draft.endLedger),
    interval_ledgers: u32ScVal(draft.intervalLedgers ?? 0),
    max_executions: u32ScVal(draft.maxExecutions),
    execution_count: u32ScVal(0),
    policy_version: u32ScVal(draft.expectedPolicyVersion),
    adapter: addressScVal(contracts.transferAdapter),
    cancelled: boolScVal(false),
  });
}

export function contractInvocation(contractId: string, functionName: string, args: xdr.ScVal[]) {
  return new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: addressScAddress(contractId),
        functionName,
        args,
      }),
    ),
    subInvocations: [],
  });
}

export function addressCredentialsEntry({
  address,
  invocation,
  nonce,
  signature,
  signatureExpirationLedger,
}: {
  address: string;
  invocation: xdr.SorobanAuthorizedInvocation;
  nonce: string;
  signature: xdr.ScVal;
  signatureExpirationLedger: number;
}) {
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: addressScAddress(address),
        nonce: xdr.Int64.fromString(nonce),
        signatureExpirationLedger,
        signature,
      }),
    ),
    rootInvocation: invocation,
  });
}

function signaturePayload(
  invocation: xdr.SorobanAuthorizedInvocation,
  nonce: string,
  signatureExpirationLedger: number,
) {
  const preimage = xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
    new xdr.HashIdPreimageSorobanAuthorization({
      networkId: hash(Buffer.from(STELLAR_CONFIG.networkPassphrase)),
      nonce: xdr.Int64.fromString(nonce),
      signatureExpirationLedger,
      invocation,
    }),
  );
  return hash(preimage.toXDR());
}

export function randomAuthNonce() {
  const high = BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));
  const nonce =
    (high ^ BigInt(Date.now())) & ((BigInt(1) << BigInt(62)) - BigInt(1));
  return nonce.toString();
}

export function signerDelegatedScVal(address: string) {
  return xdr.ScVal.scvVec([symbolScVal("Delegated"), addressScVal(address)]);
}

/** `ContextRuleType::Default` -- the unit-variant encoding, same shape as
 * signerDelegatedScVal's `Signer::Delegated`. The other variant,
 * `CallContract(Address)`, isn't needed here: every context rule this
 * dApp creates is `Default` (DAPP_DEVELOPER_QA.md Part 4 -- rules can't
 * discriminate by function, only by which contract required auth, and
 * every smart_account-gated call in this dApp is a call to smart_account
 * itself). */
export function contextTypeDefaultScVal() {
  return xdr.ScVal.scvVec([symbolScVal("Default")]);
}

function smartAccountAuthPayload(signerAddress: string, contextRuleIdsScVal: xdr.ScVal) {
  const signersMap = xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: signerDelegatedScVal(signerAddress),
      val: bytesScVal(Buffer.alloc(0)),
    }),
  ]);

  // Routed through structScVal like every other contract struct: these two
  // keys happen to be in sorted order already, and nothing should depend on
  // that holding if a field is ever added.
  return structScVal({
    context_rule_ids: contextRuleIdsScVal,
    signers: signersMap,
  });
}

/**
 * Signs entry B — the delegated signer's standard `Address` credentials entry,
 * which authorizes the nested `require_auth_for_args((auth_digest,))` call that
 * `smart_account`'s `authenticate()` makes on its own behalf.
 *
 * Only entry B goes through here. Entry A carries the contract's own
 * `AuthPayload` and is hand-built, because no SDK helper models a custom
 * account's signature shape.
 */
export async function signDelegatedAuthEntry(
  entry: xdr.SorobanAuthorizationEntry,
  wallet: WalletSigning,
  signatureExpirationLedger: number,
): Promise<xdr.SorobanAuthorizationEntry> {
  // The wallet is handed the HashIdPreimage and returns raw signature bytes.
  // Passing it the entry itself makes it fail to parse; expecting an entry back
  // makes the reply fail to decode. authorizeEntry drives both sides correctly
  // and writes the signature into a copy of the entry.
  return authorizeEntry(
    entry,
    async (preimage) => {
      const result = await wallet.signAuthEntry(preimage.toXDR("base64"), wallet.address);
      if (!result) {
        throw new Error("Wallet did not return a signed authorization entry.");
      }
      // Freighter reports which account it actually signed with. That can
      // diverge from the account we asked for (e.g. its active account
      // didn't match the requested one) — plugging `wallet.address` in as
      // the verification key regardless produces a valid signature that the
      // SDK's own crypto check rejects, surfacing only a generic "signature
      // doesn't match payload". Trust what the wallet reports instead, and
      // fail with the actual mismatch when it doesn't match the signer this
      // treasury action needs.
      const signerAddress = result.signerAddress ?? wallet.address;
      if (signerAddress !== wallet.address) {
        throw new Error(
          `Wallet signed with ${signerAddress} instead of the expected signer ${wallet.address}. Switch to that account in your wallet and try again.`,
        );
      }
      return {
        signature: decodeWalletSignature(result.signature),
        publicKey: signerAddress,
      };
    },
    signatureExpirationLedger,
    STELLAR_CONFIG.networkPassphrase,
  );
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
  transactionXdr: string,
): Promise<string> {
  const result = await wallet.signTransaction(transactionXdr, wallet.address);
  if (!result) {
    throw new Error("Wallet did not return a signed transaction envelope.");
  }
  const signerAddress = result.signerAddress ?? wallet.address;
  if (signerAddress !== wallet.address) {
    throw new Error(
      `Wallet signed with ${signerAddress} instead of the expected signer ${wallet.address}. Switch to that account in your wallet and try again.`,
    );
  }
  return result.xdr;
}

function buildUnsignedCustomAuthEntries({
  contextRuleIds,
  rootInvocation,
  signerAddress,
  signatureExpirationLedger,
  contracts,
}: CustomAuthInput) {
  if (contextRuleIds.length === 0) {
    throw new Error("No SmartAccount context rule is selected.");
  }

  const entryANonce = randomAuthNonce();
  const rootPayload = signaturePayload(
    rootInvocation,
    entryANonce,
    signatureExpirationLedger,
  );
  const contextRuleIdsScVal = xdr.ScVal.scvVec(contextRuleIds.map((id) => u32ScVal(id)));
  const authDigest = hash(Buffer.concat([rootPayload, contextRuleIdsScVal.toXDR()]));

  const entryA = addressCredentialsEntry({
    address: contracts.smartAccount,
    invocation: rootInvocation,
    nonce: entryANonce,
    signatureExpirationLedger,
    signature: smartAccountAuthPayload(signerAddress, contextRuleIdsScVal),
  });

  const entryB = addressCredentialsEntry({
    address: signerAddress,
    invocation: contractInvocation(contracts.smartAccount, "__check_auth", [
      bytesScVal(authDigest),
    ]),
    nonce: randomAuthNonce(),
    signatureExpirationLedger,
    signature: xdr.ScVal.scvVoid(),
  });

  return { entryA, entryB };
}

export function invokeContractOperation(
  contractId: string,
  functionName: string,
  args: xdr.ScVal[],
  auth: xdr.SorobanAuthorizationEntry[],
) {
  return Operation.invokeContractFunction({
    contract: contractId,
    function: functionName,
    args,
    auth,
  });
}

function transferArgs(draft: PaymentDraft) {
  return [
    addressScVal(draft.asset),
    addressScVal(draft.destination),
    i128ScVal(draft.amount),
    u64ScVal(draft.nonce),
    u32ScVal(draft.expectedPolicyVersion),
  ];
}

function splitArgs(draft: SplitDraft) {
  return [
    addressScVal(draft.asset),
    xdr.ScVal.scvVec(draft.recipients.map((recipient) => addressScVal(recipient.destination))),
    xdr.ScVal.scvVec(draft.recipients.map((recipient) => i128ScVal(recipient.amount))),
    u64ScVal(draft.nonce),
    u32ScVal(draft.expectedPolicyVersion),
  ];
}

function cancelScheduleArgs(intentId: string) {
  return [bytesN32ScVal(intentId)];
}

function getSignerAddresses(value: SimulationValue) {
  const serialized = JSON.stringify(value, (_key, nestedValue) =>
    typeof nestedValue === "bigint" ? nestedValue.toString() : nestedValue,
  );
  return Array.from(new Set(serialized.match(/G[A-Z2-7]{55}/g) ?? []));
}

export async function submitSignedTransaction(signedTx: Transaction): Promise<TransactionReceipt> {
  const server = getServer();
  const sendResponse = await server.sendTransaction(signedTx);
  if (sendResponse.status === "ERROR") {
    throw new Error(`Submission failed: ${sendResponse.status}`);
  }
  if (sendResponse.status === "TRY_AGAIN_LATER") {
    throw new Error("RPC asked the dApp to retry submission later.");
  }
  if (sendResponse.status === "DUPLICATE") {
    throw new Error("RPC reported a duplicate transaction submission.");
  }

  // Testnet usually closes a ledger in ~5s, but inclusion has been observed
  // taking over two minutes under load. The old 30s ceiling reported such a
  // transaction as unresolved while it went on to succeed on-chain, so the
  // wait now covers that case. Timing out is no longer read as a failure —
  // describeReceipt reports it as still pending.
  for (let attempt = 0; attempt < 90; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const txResult = await server.getTransaction(sendResponse.hash);
    if (txResult.status !== "NOT_FOUND") {
      return {
        hash: sendResponse.hash,
        status: txResult.status,
        latestLedger: txResult.latestLedger,
        // Present on both SUCCESS and FAILED (not on the NOT_FOUND variant,
        // which this branch already excludes) -- one events array per
        // operation; this dApp's transactions always have exactly one.
        events: "events" in txResult ? txResult.events.contractEventsXdr[0] : undefined,
      };
    }
  }

  return {
    hash: sendResponse.hash,
    status: sendResponse.status,
    latestLedger: sendResponse.latestLedger,
  };
}

export async function signAndSubmitContractInvocation({
  args,
  functionName,
  sourceAddress,
  wallet,
  contracts = STELLAR_CONFIG.contracts,
}: {
  args: xdr.ScVal[];
  functionName: string;
  sourceAddress: string;
  wallet: WalletSigning;
  contracts?: ContractSet;
}): Promise<TransactionReceipt> {
  const server = getServer();
  const latestLedger = await server.getLatestLedger();
  const signatureExpirationLedger = latestLedger.sequence + 100;
  const source = await server.getAccount(sourceAddress);
  const rules = await loadContextRules(sourceAddress, contracts);
  const matchedRule = selectRuleForSigner(rules, wallet.address);

  if (!matchedRule) {
    throw new Error("No SmartAccount context rule is available for approval.");
  }
  if (matchedRule.signerCount > 0 && matchedRule.signerAddresses.length === 0) {
    throw new Error(
      "Could not verify delegated signer addresses for the matched SmartAccount rule.",
    );
  }
  if (
    matchedRule.signerAddresses.length > 0 &&
    !matchedRule.signerAddresses.includes(wallet.address)
  ) {
    throw new Error(
      `Connected wallet is not a delegated signer on any SmartAccount context rule. Rules on-chain: ${rules
        .map((rule) => `${rule.id} (${rule.name})`)
        .join(", ")}.`,
    );
  }

  const rootInvocation = await discoverTreasuryInvocation(
    sourceAddress,
    functionName,
    args,
    contracts,
  );
  // One context_rule_id per authorization context the tree produces. The
  // treasury validates every context against the same rule, so this repeats
  // the matched rule rather than selecting a different one per node.
  const contextRuleIds = Array.from(
    { length: countAuthContexts(rootInvocation) },
    () => matchedRule.id,
  );
  const { entryA, entryB } = buildUnsignedCustomAuthEntries({
    contextRuleIds,
    rootInvocation,
    signerAddress: wallet.address,
    signatureExpirationLedger,
    contracts,
  });

  const signedEntryB = await signDelegatedAuthEntry(
    entryB,
    wallet,
    signatureExpirationLedger,
  );

  const tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: STELLAR_CONFIG.networkPassphrase,
  })
    .addOperation(
      invokeContractOperation(contracts.smartAccount, functionName, args, [
        entryA,
        signedEntryB,
      ]),
    )
    .setTimeout(120)
    .build();

  const prepared = await server.prepareTransaction(tx);
  const signedTxXdr = await signEnvelope(wallet, prepared.toXDR());

  return submitSignedTransaction(
    new Transaction(signedTxXdr, STELLAR_CONFIG.networkPassphrase),
  );
}

function getRecord(value: SimulationValue): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  return {};
}

function countCollection(value: unknown, fallback: number) {
  if (Array.isArray(value)) return value.length;
  if (value instanceof Map) return value.size;
  return fallback;
}

function readTreasuryStatus(value: SimulationValue): TreasuryStatus {
  const record = getRecord(value);

  return {
    initialized: Boolean(record.initialized ?? true),
    paused: Boolean(record.paused ?? false),
    frozen: Boolean(record.frozen ?? false),
    policyVersionHint: Number(record.policy_version_hint ?? record.policyVersionHint ?? 0),
  };
}

function readContextRule(id: number, value: SimulationValue): ContextRule {
  const raw = getRecord(value) as ContractRuleRecord;

  return {
    id,
    name: String(raw.name ?? `Context rule ${id}`),
    contextType: String(raw.context_type ?? raw.contextType ?? "Default"),
    signerCount: countCollection(raw.signers ?? raw.signer_ids, 1),
    policyCount: countCollection(raw.policies ?? raw.policy_ids, 0),
    signerAddresses: getSignerAddresses(value),
    validUntil: typeof raw.valid_until === "number" ? raw.valid_until : undefined,
    raw,
  };
}

export async function loadTreasurySnapshot(
  sourceAddress: string,
  contracts: ContractSet = STELLAR_CONFIG.contracts,
) {
  const status = await simulateContractCall(sourceAddress, contracts.smartAccount, "status");
  const version = await simulateContractCall(sourceAddress, contracts.policyEngine, "version");
  const latestLedger = await getLatestLedger();

  return {
    status: readTreasuryStatus(status.value),
    policyVersion: Number(version.value ?? 1),
    latestLedger,
  };
}

/**
 * Rule IDs are `0..count` but not necessarily contiguous once rules have been
 * removed (DAPP_INTEGRATION_SPEC.md §4) — a missing id makes `get_context_rule`
 * throw, not return null. So this probes candidate ids one at a time and skips
 * the gaps, rather than assuming `count` consecutive ids starting at 0.
 */
export async function loadContextRules(
  sourceAddress: string,
  contracts: ContractSet = STELLAR_CONFIG.contracts,
): Promise<ContextRule[]> {
  const countResult = await simulateContractCall(
    sourceAddress,
    contracts.smartAccount,
    "get_context_rules_count",
  );
  const count = Number(countResult.value ?? 0);
  const rules: ContextRule[] = [];
  const maxId = count + 32;

  for (let id = 0; rules.length < count && id < maxId; id += 1) {
    try {
      const result = await simulateContractCall(
        sourceAddress,
        contracts.smartAccount,
        "get_context_rule",
        [u32ScVal(id)],
      );
      rules.push(readContextRule(id, result.value));
    } catch {
      // No rule at this id — removed or never allocated. Keep scanning.
    }
  }

  return rules;
}

export async function loadOwner(
  sourceAddress: string,
  contracts: ContractSet = STELLAR_CONFIG.contracts,
): Promise<string | null> {
  const result = await simulateContractCall(sourceAddress, contracts.smartAccount, "get_owner");
  return typeof result.value === "string" ? result.value : null;
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
  assetContractId: string,
): Promise<AssetHolding> {
  let balance: bigint | null = null;
  let missing = false;

  try {
    const result = await simulateContractCall(sourceAddress, assetContractId, "balance", [
      addressScVal(holder),
    ]);
    balance =
      typeof result.value === "bigint"
        ? result.value
        : typeof result.value === "string" || typeof result.value === "number"
          ? BigInt(result.value)
          : null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // #13 is the token's TrustlineMissing -- verified against the live testnet
    // SAC, alongside #8/#10/#11 (see explainContractError's own note).
    missing = /Error\(Contract, #13\)/.test(message);
  }

  let authorized: boolean | null = null;
  try {
    const result = await simulateContractCall(sourceAddress, assetContractId, "authorized", [
      addressScVal(holder),
    ]);
    authorized = typeof result.value === "boolean" ? result.value : null;
  } catch {
    authorized = null;
  }

  return { balance, authorized, missing };
}

/** The contracts a `smart_account` is actually wired to, read from its own
 * instance storage. Every field is nullable: a contract that isn't a
 * smart_account, or one whose storage layout changed, must surface as "not
 * found" rather than as a silent match. */
export type SmartAccountLinks = {
  owner: string | null;
  policyEngine: string | null;
  intentRegistry: string | null;
  recoveryManager: string | null;
  transferAdapter: string | null;
  splitAdapter: string | null;
};

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
  smartAccountId: string,
): Promise<SmartAccountLinks | null> {
  const key = xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(smartAccountId).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  );

  const response = await getServer().getLedgerEntries(key);
  const entry = response.entries[0];
  if (!entry) return null;

  const storage = entry.val.contractData().val().instance().storage() ?? [];

  // Keys are either a bare symbol (`PolicyEngine`) or a two-symbol vec
  // (`["Adapter", "transfer"]`); `scValToNative` renders those as a string and
  // a string array respectively. Verified against the live testnet instance of
  // CCMPGTBA...ODUDL, whose 11 entries this parse reproduces exactly.
  const byKey = new Map<string, unknown>();
  for (const item of storage) {
    const rawKey = scValToNative(item.key()) as unknown;
    const name = Array.isArray(rawKey) ? rawKey.join("/") : String(rawKey);
    byKey.set(name, scValToNative(item.val()) as unknown);
  }

  const address = (name: string) => {
    const value = byKey.get(name);
    return typeof value === "string" ? value : null;
  };

  return {
    owner: address("Owner"),
    policyEngine: address("PolicyEngine"),
    intentRegistry: address("IntentRegistry"),
    recoveryManager: address("RecoveryManager"),
    transferAdapter: address("Adapter/transfer"),
    splitAdapter: address("Adapter/split"),
  };
}

export async function loadSignerId(
  sourceAddress: string,
  signerAddress: string,
  contracts: ContractSet = STELLAR_CONFIG.contracts,
) {
  const result = await simulateContractCall(
    sourceAddress,
    contracts.smartAccount,
    "get_signer_id",
    [signerDelegatedScVal(signerAddress)],
  );
  return Number(result.value ?? 0);
}

export async function checkIsGuardian(
  sourceAddress: string,
  guardianAddress: string,
  contracts: ContractSet = STELLAR_CONFIG.contracts,
) {
  const result = await simulateContractCall(
    sourceAddress,
    contracts.recoveryManager,
    "is_guardian",
    [addressScVal(guardianAddress)],
  );
  return Boolean(result.value);
}

/**
 * Builds the probe function `policyProbe` consumes. Rejects with the raw host
 * error so `classifyProbeFailure` can read the contract code out of it.
 */
export function simulatePolicyProbe(
  sourceAddress: string,
  contracts: ContractSet = STELLAR_CONFIG.contracts,
) {
  return async (input: {
    asset: string;
    destination: string;
    operation: string;
    amount: string;
    expectedVersion: number;
  }) => {
    await simulateContractCall(
      sourceAddress,
      contracts.policyEngine,
      "validate_policy",
      [
        structScVal({
          operation: symbolScVal(input.operation),
          asset: addressScVal(input.asset),
          destination: addressScVal(input.destination),
          amount: i128ScVal(input.amount),
          expected_version: u32ScVal(input.expectedVersion),
        }),
      ],
    );
  };
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
  args: xdr.ScVal[];
  contractId: string;
  functionName: string;
  wallet: WalletSigning;
}): Promise<TransactionReceipt> {
  const server = getServer();
  const source = await server.getAccount(wallet.address);
  const tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: STELLAR_CONFIG.networkPassphrase,
  })
    .addOperation(new Contract(contractId).call(functionName, ...args))
    .setTimeout(120)
    .build();

  const prepared = await server.prepareTransaction(tx);
  const signedTxXdr = await signEnvelope(wallet, prepared.toXDR());

  return submitSignedTransaction(
    new Transaction(signedTxXdr, STELLAR_CONFIG.networkPassphrase),
  );
}

export async function approveAndSubmitTransfer(
  wallet: WalletSigning,
  draft: PaymentDraft,
  contracts: ContractSet = STELLAR_CONFIG.contracts,
): Promise<TransactionReceipt> {
  validatePaymentDraft(draft);
  const policyResult = await simulatePolicy(wallet.address, draft, contracts);
  if (!policyResult.ok) {
    throw new Error(policyResult.detail);
  }
  const nonceUsed = await checkNonce(wallet.address, draft.nonce, contracts);
  if (nonceUsed) {
    throw new Error("Nonce has already been used.");
  }

  return signAndSubmitContractInvocation({
    args: transferArgs(draft),
    functionName: "execute_transfer_payment",
    sourceAddress: wallet.address,
    wallet,
    contracts,
  });
}

export async function approveAndSubmitSchedule(
  wallet: WalletSigning,
  draft: ScheduleDraft,
  contracts: ContractSet = STELLAR_CONFIG.contracts,
): Promise<TransactionReceipt> {
  validateScheduleDraft(draft);
  const policyResult = await simulatePolicy(wallet.address, draft, contracts);
  if (!policyResult.ok) {
    throw new Error(policyResult.detail);
  }
  const exists = await checkScheduledIntentExists(wallet.address, draft.intentId, contracts);
  if (exists) {
    throw new Error("Scheduled intent already exists on-chain.");
  }

  return signAndSubmitContractInvocation({
    args: [scheduledIntentScVal(draft, contracts)],
    functionName: "create_scheduled_payment",
    sourceAddress: wallet.address,
    wallet,
    contracts,
  });
}

export async function approveAndSubmitSplit(
  wallet: WalletSigning,
  draft: SplitDraft,
  contracts: ContractSet = STELLAR_CONFIG.contracts,
): Promise<TransactionReceipt> {
  validateSplitDraft(draft);
  const policyResult = await simulateSplitPolicy(wallet.address, draft, contracts);
  if (!policyResult.ok) {
    throw new Error(policyResult.detail);
  }
  const nonceUsed = await checkNonce(wallet.address, draft.nonce, contracts);
  if (nonceUsed) {
    throw new Error("Nonce has already been used.");
  }

  return signAndSubmitContractInvocation({
    args: splitArgs(draft),
    functionName: "execute_split_payment",
    sourceAddress: wallet.address,
    wallet,
    contracts,
  });
}

export async function approveAndSubmitCancelSchedule(
  wallet: WalletSigning,
  intentId: string,
  contracts: ContractSet = STELLAR_CONFIG.contracts,
): Promise<TransactionReceipt> {
  if (!/^(0x)?[0-9a-fA-F]{64}$/.test(intentId)) {
    throw new Error("Intent ID must be 32 bytes encoded as 64 hex characters.");
  }
  const exists = await checkScheduledIntentExists(wallet.address, intentId, contracts);
  if (!exists) {
    throw new Error("No scheduled intent exists on-chain for this ID.");
  }

  return signAndSubmitContractInvocation({
    args: cancelScheduleArgs(intentId),
    functionName: "cancel_scheduled_payment",
    sourceAddress: wallet.address,
    wallet,
    contracts,
  });
}

export async function getLatestLedger() {
  const result = await getServer().getLatestLedger();
  return result.sequence;
}

export async function checkNonce(
  sourceAddress: string,
  nonce: string,
  contracts: ContractSet = STELLAR_CONFIG.contracts,
) {
  const result = await simulateContractCall(sourceAddress, contracts.smartAccount, "is_nonce_used", [
    u64ScVal(nonce),
  ]);
  return Boolean(result.value);
}

export async function checkScheduledIntentExists(
  sourceAddress: string,
  intentId: string,
  contracts: ContractSet = STELLAR_CONFIG.contracts,
) {
  try {
    await simulateContractCall(sourceAddress, contracts.intentRegistry, "get_intent", [
      bytesN32ScVal(intentId),
    ]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads the policy version an intent pinned at creation. Returns null when the
 * intent cannot be read, so a missing intent never silently reads as "safe".
 */
export async function loadIntentPolicyVersion(
  sourceAddress: string,
  intentId: string,
  contracts: ContractSet = STELLAR_CONFIG.contracts,
): Promise<number | null> {
  try {
    const result = await simulateContractCall(sourceAddress, contracts.intentRegistry, "get_intent", [
      bytesN32ScVal(intentId),
    ]);
    const record = getRecord(result.value);
    const version = record.policy_version;
    return typeof version === "number" ? version : null;
  } catch {
    return null;
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
  sourceAddress: string,
): Promise<void> {
  await simulateContractCall(
    sourceAddress,
    operation.contractId,
    operation.functionName,
    operation.args,
  );
}

export async function simulatePolicy(
  sourceAddress: string,
  draft: PaymentDraft,
  contracts: ContractSet = STELLAR_CONFIG.contracts,
): Promise<SimulationResult> {
  const invalid = validationFailure(() => validatePaymentDraft(draft));
  if (invalid) return invalid;

  try {
    await simulateContractCall(sourceAddress, contracts.policyEngine, "validate_policy", [
      policyCheckScVal(draft, "transfer"),
    ]);
    return {
      ok: true,
      title: "Policy simulation passed",
      detail:
        "Asset, recipient, amount, operation, and expected policy version are accepted on testnet.",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failure = describeSimulationFailure(message);
    return {
      ok: false,
      title: failure.rejectedByContract
        ? "Policy rejected this payment"
        : "Policy check could not run",
      detail: failure.detail,
      diagnostic: message,
    };
  }
}

/**
 * Checks policy for every recipient/amount pair, matching how
 * `execute_split_payment` validates on-chain — it calls
 * `policy_engine.validate_policy` once per recipient with `operation:
 * "split"`, not once for the whole batch (see contracts/smart_account/src/lib.rs).
 * Reports the first rejection found, in recipient order.
 */
export async function simulateSplitPolicy(
  sourceAddress: string,
  draft: SplitDraft,
  contracts: ContractSet = STELLAR_CONFIG.contracts,
): Promise<SimulationResult> {
  const invalid = validationFailure(() => validateSplitDraft(draft));
  if (invalid) return invalid;

  for (const [index, recipient] of draft.recipients.entries()) {
    try {
      await simulateContractCall(sourceAddress, contracts.policyEngine, "validate_policy", [
        policyCheckScVal(
          {
            asset: draft.asset,
            destination: recipient.destination,
            amount: recipient.amount,
            nonce: "1",
            expectedPolicyVersion: draft.expectedPolicyVersion,
          },
          "split",
        ),
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failure = describeSimulationFailure(message);
      // Only `recipient` and `amount` belong to the entry being checked. The
      // asset, the operation and the policy version are the same for every
      // recipient, so naming this one would send the operator to edit an
      // address that is not the problem -- the loop simply stopped here first.
      const verdict = classifyProbeFailure(message);
      const wholePayment = isWholePaymentReason(verdict.allowed ? "unknown" : verdict.reason);
      return {
        ok: false,
        title: failure.rejectedByContract
          ? wholePayment
            ? "Policy rejected this split payment"
            : `Policy rejected recipient ${index + 1}`
          : "Policy check could not run",
        detail:
          failure.rejectedByContract && wholePayment
            ? `${failure.detail} It applies to the whole payment, not to recipient ${index + 1} — every recipient would be rejected the same way.`
            : failure.detail,
        diagnostic: message,
      };
    }
  }

  return {
    ok: true,
    title: "Policy simulation passed",
    detail: `Every recipient, amount, and the expected policy version are accepted on testnet.`,
  };
}

export async function simulateTransfer(
  sourceAddress: string,
  draft: PaymentDraft,
  contracts: ContractSet = STELLAR_CONFIG.contracts,
): Promise<SimulationResult> {
  const invalid = validationFailure(() => validatePaymentDraft(draft));
  if (invalid) return invalid;

  try {
    const nonceUsed = await checkNonce(sourceAddress, draft.nonce, contracts);
    if (nonceUsed) {
      return {
        ok: false,
        title: "Nonce already used",
        detail: "Generate a fresh nonce before asking the signer to approve.",
      };
    }

    await simulateContractCall(
      sourceAddress,
      contracts.smartAccount,
      "execute_transfer_payment",
      [
        addressScVal(draft.asset),
        addressScVal(draft.destination),
        i128ScVal(draft.amount),
        u64ScVal(draft.nonce),
        u32ScVal(draft.expectedPolicyVersion),
      ],
    );

    return {
      ok: true,
      title: "Transfer simulation built",
      detail:
        "The unsigned transfer invocation is structurally valid. Final submission still requires SmartAccount custom auth entries.",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failure = describeSimulationFailure(message);
    return {
      ok: false,
      title:
        failure.kind === "authorization"
          ? "Transfer simulation needs auth"
          : failure.rejectedByContract
            ? "Transfer rejected by the contract"
            : "Transfer simulation could not run",
      detail: failure.detail,
      diagnostic: message,
    };
  }
}

export async function simulateSplit(
  sourceAddress: string,
  draft: SplitDraft,
  contracts: ContractSet = STELLAR_CONFIG.contracts,
): Promise<SimulationResult> {
  const invalid = validationFailure(() => validateSplitDraft(draft));
  if (invalid) return invalid;

  try {
    const nonceUsed = await checkNonce(sourceAddress, draft.nonce, contracts);
    if (nonceUsed) {
      return {
        ok: false,
        title: "Nonce already used",
        detail: "Generate a fresh nonce before asking the signer to approve.",
      };
    }

    await simulateContractCall(
      sourceAddress,
      contracts.smartAccount,
      "execute_split_payment",
      splitArgs(draft),
    );

    return {
      ok: true,
      title: "Split simulation built",
      detail:
        "The unsigned split invocation is structurally valid. Final submission still requires SmartAccount custom auth entries.",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failure = describeSimulationFailure(message);
    return {
      ok: false,
      title:
        failure.kind === "authorization"
          ? "Split simulation needs auth"
          : failure.rejectedByContract
            ? "Split rejected by the contract"
            : "Split simulation could not run",
      detail: failure.detail,
      diagnostic: message,
    };
  }
}

export async function simulateSchedule(
  sourceAddress: string,
  draft: ScheduleDraft,
  contracts: ContractSet = STELLAR_CONFIG.contracts,
): Promise<SimulationResult> {
  const invalid = validationFailure(() => validateScheduleDraft(draft));
  if (invalid) return invalid;

  try {
    const exists = await checkScheduledIntentExists(sourceAddress, draft.intentId, contracts);
    if (exists) {
      return {
        ok: false,
        title: "Intent already exists",
        detail: "Generate a new intent ID before creating this scheduled payment.",
      };
    }

    await simulateContractCall(
      sourceAddress,
      contracts.smartAccount,
      "create_scheduled_payment",
      [scheduledIntentScVal(draft, contracts)],
    );
    return {
      ok: true,
      title: "Schedule simulation built",
      detail:
        "The scheduled intent shape is valid. The contract will pin current policy version and adapter at creation.",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failure = describeSimulationFailure(message);
    return {
      ok: false,
      title:
        failure.kind === "authorization"
          ? "Schedule simulation needs auth"
          : failure.rejectedByContract
            ? "Schedule rejected by the contract"
            : "Schedule simulation could not run",
      detail: failure.detail,
      diagnostic: message,
    };
  }
}
