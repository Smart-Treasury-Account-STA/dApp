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
import { validatePaymentDraft, validateScheduleDraft } from "@/features/treasury/drafts";
import { countAuthContexts, selectInvocationForAddress } from "@/lib/authTree";
import { describeSimulationFailure } from "@/lib/format";
import { structScVal } from "@/lib/scval";
import { validationFailure } from "@/lib/simulationResult";
import { selectRuleForSigner } from "@/lib/smartAccountAuth";
import { decodeWalletSignature } from "@/lib/walletSignature";
import type {
  ContextRule,
  PaymentDraft,
  ScheduleDraft,
  SimulationResult,
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
): Promise<xdr.SorobanAuthorizedInvocation> {
  const server = getServer();
  const source = await server.getAccount(sourceAddress);
  const contract = new Contract(STELLAR_CONFIG.contracts.smartAccount);
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
    STELLAR_CONFIG.contracts.smartAccount,
  );
  if (!recorded) {
    throw new Error(
      "Simulation recorded no authorization requirement for the treasury account.",
    );
  }

  return recorded;
}

function getServer() {
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

function addressScVal(address: string) {
  return new Address(address).toScVal();
}

function addressScAddress(address: string) {
  return new Address(address).toScAddress();
}

function symbolScVal(value: string) {
  return xdr.ScVal.scvSymbol(value);
}

function i128ScVal(value: string) {
  return nativeToScVal(BigInt(value), { type: "i128" });
}

function u32ScVal(value: number | string) {
  return nativeToScVal(Number(value), { type: "u32" });
}

function u64ScVal(value: number | string) {
  return nativeToScVal(BigInt(value), { type: "u64" });
}

function boolScVal(value: boolean) {
  return nativeToScVal(value);
}

function bytesN32ScVal(hex: string) {
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

function scheduledIntentScVal(draft: ScheduleDraft) {
  return structScVal({
    intent_id: bytesN32ScVal(draft.intentId),
    asset: addressScVal(draft.asset),
    destination: addressScVal(draft.destination),
    amount: i128ScVal(draft.amount),
    start_ledger: u32ScVal(draft.startLedger),
    end_ledger: u32ScVal(draft.endLedger),
    max_executions: u32ScVal(draft.maxExecutions),
    execution_count: u32ScVal(0),
    policy_version: u32ScVal(draft.expectedPolicyVersion),
    adapter: addressScVal(STELLAR_CONFIG.contracts.transferAdapter),
    cancelled: boolScVal(false),
  });
}

function contractInvocation(contractId: string, functionName: string, args: xdr.ScVal[]) {
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

function addressCredentialsEntry({
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

function randomAuthNonce() {
  const high = BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));
  const nonce =
    (high ^ BigInt(Date.now())) & ((BigInt(1) << BigInt(62)) - BigInt(1));
  return nonce.toString();
}

function signerDelegatedScVal(address: string) {
  return xdr.ScVal.scvVec([symbolScVal("Delegated"), addressScVal(address)]);
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

function buildUnsignedCustomAuthEntries({
  contextRuleIds,
  rootInvocation,
  signerAddress,
  signatureExpirationLedger,
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
    address: STELLAR_CONFIG.contracts.smartAccount,
    invocation: rootInvocation,
    nonce: entryANonce,
    signatureExpirationLedger,
    signature: smartAccountAuthPayload(signerAddress, contextRuleIdsScVal),
  });

  const entryB = addressCredentialsEntry({
    address: signerAddress,
    invocation: contractInvocation(STELLAR_CONFIG.contracts.smartAccount, "__check_auth", [
      bytesScVal(authDigest),
    ]),
    nonce: randomAuthNonce(),
    signatureExpirationLedger,
    signature: xdr.ScVal.scvVoid(),
  });

  return { entryA, entryB };
}

function invokeContractOperation(
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

function getSignerAddresses(value: SimulationValue) {
  const serialized = JSON.stringify(value, (_key, nestedValue) =>
    typeof nestedValue === "bigint" ? nestedValue.toString() : nestedValue,
  );
  return Array.from(new Set(serialized.match(/G[A-Z2-7]{55}/g) ?? []));
}

async function signAndSubmitContractInvocation({
  args,
  functionName,
  sourceAddress,
  wallet,
}: {
  args: xdr.ScVal[];
  functionName: string;
  sourceAddress: string;
  wallet: WalletSigning;
}): Promise<TransactionReceipt> {
  const server = getServer();
  const latestLedger = await server.getLatestLedger();
  const signatureExpirationLedger = latestLedger.sequence + 100;
  const source = await server.getAccount(sourceAddress);
  const rules = await loadContextRules(sourceAddress);
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
      invokeContractOperation(STELLAR_CONFIG.contracts.smartAccount, functionName, args, [
        entryA,
        signedEntryB,
      ]),
    )
    .setTimeout(120)
    .build();

  const prepared = await server.prepareTransaction(tx);
  const signedTxXdr = await wallet.signTransaction(prepared.toXDR(), wallet.address);
  if (!signedTxXdr) {
    throw new Error("Wallet did not return a signed transaction envelope.");
  }

  const signedTx = new Transaction(signedTxXdr, STELLAR_CONFIG.networkPassphrase);
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
      };
    }
  }

  return {
    hash: sendResponse.hash,
    status: sendResponse.status,
    latestLedger: sendResponse.latestLedger,
  };
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

export async function loadTreasurySnapshot(sourceAddress: string) {
  const status = await simulateContractCall(
    sourceAddress,
    STELLAR_CONFIG.contracts.smartAccount,
    "status",
  );
  const version = await simulateContractCall(
    sourceAddress,
    STELLAR_CONFIG.contracts.policyEngine,
    "version",
  );
  const latestLedger = await getLatestLedger();

  return {
    status: readTreasuryStatus(status.value),
    policyVersion: Number(version.value ?? 1),
    latestLedger,
  };
}

export async function loadContextRules(sourceAddress: string): Promise<ContextRule[]> {
  const countResult = await simulateContractCall(
    sourceAddress,
    STELLAR_CONFIG.contracts.smartAccount,
    "get_context_rules_count",
  );
  const count = Number(countResult.value ?? 0);
  const rules: ContextRule[] = [];

  for (let id = 0; id < Math.min(count, 8); id += 1) {
    const result = await simulateContractCall(
      sourceAddress,
      STELLAR_CONFIG.contracts.smartAccount,
      "get_context_rule",
      [u32ScVal(id)],
    );
    rules.push(readContextRule(id, result.value));
  }

  return rules;
}

export async function approveAndSubmitTransfer(
  wallet: WalletSigning,
  draft: PaymentDraft,
): Promise<TransactionReceipt> {
  validatePaymentDraft(draft);
  const policyResult = await simulatePolicy(wallet.address, draft);
  if (!policyResult.ok) {
    throw new Error(policyResult.detail);
  }
  const nonceUsed = await checkNonce(wallet.address, draft.nonce);
  if (nonceUsed) {
    throw new Error("Nonce has already been used.");
  }

  return signAndSubmitContractInvocation({
    args: transferArgs(draft),
    functionName: "execute_transfer_payment",
    sourceAddress: wallet.address,
    wallet,
  });
}

export async function approveAndSubmitSchedule(
  wallet: WalletSigning,
  draft: ScheduleDraft,
): Promise<TransactionReceipt> {
  validateScheduleDraft(draft);
  const policyResult = await simulatePolicy(wallet.address, draft);
  if (!policyResult.ok) {
    throw new Error(policyResult.detail);
  }
  const exists = await checkScheduledIntentExists(wallet.address, draft.intentId);
  if (exists) {
    throw new Error("Scheduled intent already exists on-chain.");
  }

  return signAndSubmitContractInvocation({
    args: [scheduledIntentScVal(draft)],
    functionName: "create_scheduled_payment",
    sourceAddress: wallet.address,
    wallet,
  });
}

export async function getLatestLedger() {
  const result = await getServer().getLatestLedger();
  return result.sequence;
}

export async function checkNonce(sourceAddress: string, nonce: string) {
  const result = await simulateContractCall(
    sourceAddress,
    STELLAR_CONFIG.contracts.smartAccount,
    "is_nonce_used",
    [u64ScVal(nonce)],
  );
  return Boolean(result.value);
}

export async function checkScheduledIntentExists(sourceAddress: string, intentId: string) {
  try {
    await simulateContractCall(
      sourceAddress,
      STELLAR_CONFIG.contracts.intentRegistry,
      "get_intent",
      [bytesN32ScVal(intentId)],
    );
    return true;
  } catch {
    return false;
  }
}

export async function simulatePolicy(
  sourceAddress: string,
  draft: PaymentDraft,
): Promise<SimulationResult> {
  const invalid = validationFailure(() => validatePaymentDraft(draft));
  if (invalid) return invalid;

  try {
    await simulateContractCall(
      sourceAddress,
      STELLAR_CONFIG.contracts.policyEngine,
      "validate_policy",
      [policyCheckScVal(draft, "transfer")],
    );
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

export async function simulateTransfer(
  sourceAddress: string,
  draft: PaymentDraft,
): Promise<SimulationResult> {
  const invalid = validationFailure(() => validatePaymentDraft(draft));
  if (invalid) return invalid;

  try {
    const nonceUsed = await checkNonce(sourceAddress, draft.nonce);
    if (nonceUsed) {
      return {
        ok: false,
        title: "Nonce already used",
        detail: "Generate a fresh nonce before asking the signer to approve.",
      };
    }

    await simulateContractCall(
      sourceAddress,
      STELLAR_CONFIG.contracts.smartAccount,
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

export async function simulateSchedule(
  sourceAddress: string,
  draft: ScheduleDraft,
): Promise<SimulationResult> {
  const invalid = validationFailure(() => validateScheduleDraft(draft));
  if (invalid) return invalid;

  try {
    const exists = await checkScheduledIntentExists(sourceAddress, draft.intentId);
    if (exists) {
      return {
        ok: false,
        title: "Intent already exists",
        detail: "Generate a new intent ID before creating this scheduled payment.",
      };
    }

    await simulateContractCall(
      sourceAddress,
      STELLAR_CONFIG.contracts.smartAccount,
      "create_scheduled_payment",
      [scheduledIntentScVal(draft)],
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
