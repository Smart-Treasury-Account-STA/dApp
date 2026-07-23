import {
  Address,
  BASE_FEE,
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

import { TESTNET_CONFIG } from "@/config";
import { explainContractError } from "@/lib/format";
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

const INTENT_ID_PATTERN = /^(0x)?[0-9a-fA-F]{64}$/;
const MAX_U32 = 2 ** 32 - 1;
const MAX_U64 = (1n << 64n) - 1n;

function getServer() {
  return new rpc.Server(TESTNET_CONFIG.rpcUrl);
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
    networkPassphrase: TESTNET_CONFIG.networkPassphrase,
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

function assertAddress(label: string, value: string) {
  try {
    new Address(value);
  } catch {
    throw new Error(`${label} must be a valid Stellar account or contract address.`);
  }
}

function parsePositiveBigInt(label: string, value: string) {
  try {
    const parsed = BigInt(value);
    if (parsed <= 0n) {
      throw new Error();
    }
    return parsed;
  } catch {
    throw new Error(`${label} must be a positive integer.`);
  }
}

function parseU32(label: string, value: string | number) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > MAX_U32) {
    throw new Error(`${label} must be an integer between 0 and ${MAX_U32}.`);
  }
  return parsed;
}

function validatePaymentDraft(draft: PaymentDraft) {
  assertAddress("Asset contract", draft.asset);
  assertAddress("Destination", draft.destination);
  parsePositiveBigInt("Amount", draft.amount);
  const nonce = parsePositiveBigInt("Nonce", draft.nonce);
  if (nonce > MAX_U64) {
    throw new Error("Nonce must fit in u64.");
  }
  if (!Number.isSafeInteger(draft.expectedPolicyVersion) || draft.expectedPolicyVersion < 1) {
    throw new Error("Policy version must be a positive integer.");
  }
}

function validateScheduleDraft(draft: ScheduleDraft) {
  validatePaymentDraft({ ...draft, nonce: "1" });
  if (!INTENT_ID_PATTERN.test(draft.intentId)) {
    throw new Error("Intent ID must be 32 bytes encoded as 64 hex characters.");
  }
  const startLedger = parseU32("Start ledger", draft.startLedger);
  const endLedger = parseU32("End ledger", draft.endLedger);
  const maxExecutions = parseU32("Max executions", draft.maxExecutions);
  if (maxExecutions < 1) {
    throw new Error("Max executions must be at least 1.");
  }
  if (startLedger >= endLedger) {
    throw new Error("Start ledger must be lower than end ledger.");
  }
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

function mapEntry(key: string, val: xdr.ScVal) {
  return new xdr.ScMapEntry({
    key: symbolScVal(key),
    val,
  });
}

function policyCheckScVal(draft: PaymentDraft | ScheduleDraft, operation = "transfer") {
  return xdr.ScVal.scvMap([
    mapEntry("operation", symbolScVal(operation)),
    mapEntry("asset", addressScVal(draft.asset)),
    mapEntry("destination", addressScVal(draft.destination)),
    mapEntry("amount", i128ScVal(draft.amount)),
    mapEntry("expected_version", u32ScVal(draft.expectedPolicyVersion)),
  ]);
}

function scheduledIntentScVal(draft: ScheduleDraft) {
  return xdr.ScVal.scvMap([
    mapEntry("intent_id", bytesN32ScVal(draft.intentId)),
    mapEntry("asset", addressScVal(draft.asset)),
    mapEntry("destination", addressScVal(draft.destination)),
    mapEntry("amount", i128ScVal(draft.amount)),
    mapEntry("start_ledger", u32ScVal(draft.startLedger)),
    mapEntry("end_ledger", u32ScVal(draft.endLedger)),
    mapEntry("max_executions", u32ScVal(draft.maxExecutions)),
    mapEntry("execution_count", u32ScVal(0)),
    mapEntry("policy_version", u32ScVal(draft.expectedPolicyVersion)),
    mapEntry("adapter", addressScVal(TESTNET_CONFIG.transferAdapterId)),
    mapEntry("cancelled", boolScVal(false)),
  ]);
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
      networkId: hash(Buffer.from(TESTNET_CONFIG.networkPassphrase)),
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

  return xdr.ScVal.scvMap([
    mapEntry("context_rule_ids", contextRuleIdsScVal),
    mapEntry("signers", signersMap),
  ]);
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
    address: TESTNET_CONFIG.smartAccountId,
    invocation: rootInvocation,
    nonce: entryANonce,
    signatureExpirationLedger,
    signature: smartAccountAuthPayload(signerAddress, contextRuleIdsScVal),
  });

  const entryB = addressCredentialsEntry({
    address: signerAddress,
    invocation: contractInvocation(TESTNET_CONFIG.smartAccountId, "__check_auth", [
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
  const defaultRule = rules.find((rule) =>
    rule.contextType.toLowerCase().includes("default"),
  ) ?? rules[0];

  if (!defaultRule) {
    throw new Error("No SmartAccount context rule is available for approval.");
  }
  if (defaultRule.signerCount > 0 && defaultRule.signerAddresses.length === 0) {
    throw new Error(
      "Could not verify delegated signer addresses for the matched SmartAccount rule.",
    );
  }
  if (
    defaultRule.signerAddresses.length > 0 &&
    !defaultRule.signerAddresses.includes(wallet.address)
  ) {
    throw new Error("Connected wallet is not registered as a delegated signer.");
  }

  const rootInvocation = contractInvocation(
    TESTNET_CONFIG.smartAccountId,
    functionName,
    args,
  );
  const { entryA, entryB } = buildUnsignedCustomAuthEntries({
    contextRuleIds: [defaultRule.id],
    rootInvocation,
    signerAddress: wallet.address,
    signatureExpirationLedger,
  });

  const signedEntryBXdr = await wallet.signAuthEntry(entryB.toXDR("base64"), wallet.address);
  if (!signedEntryBXdr) {
    throw new Error("Wallet did not return a signed authorization entry.");
  }

  const signedEntryB = xdr.SorobanAuthorizationEntry.fromXDR(
    signedEntryBXdr,
    "base64",
  );
  const tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: TESTNET_CONFIG.networkPassphrase,
  })
    .addOperation(
      invokeContractOperation(TESTNET_CONFIG.smartAccountId, functionName, args, [
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

  const signedTx = new Transaction(signedTxXdr, TESTNET_CONFIG.networkPassphrase);
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

  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
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
    TESTNET_CONFIG.smartAccountId,
    "status",
  );
  const version = await simulateContractCall(
    sourceAddress,
    TESTNET_CONFIG.policyEngineId,
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
    TESTNET_CONFIG.smartAccountId,
    "get_context_rules_count",
  );
  const count = Math.max(1, Number(countResult.value ?? 1));
  const rules: ContextRule[] = [];

  for (let id = 0; id < Math.min(count, 8); id += 1) {
    try {
      const result = await simulateContractCall(
        sourceAddress,
        TESTNET_CONFIG.smartAccountId,
        "get_context_rule",
        [u32ScVal(id)],
      );
      rules.push(readContextRule(id, result.value));
    } catch {
      rules.push({
        id,
        name: `Context rule ${id}`,
        contextType: "Default",
        signerCount: 1,
        signerAddresses: [],
        policyCount: 0,
      });
    }
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
    TESTNET_CONFIG.smartAccountId,
    "is_nonce_used",
    [u64ScVal(nonce)],
  );
  return Boolean(result.value);
}

export async function checkScheduledIntentExists(sourceAddress: string, intentId: string) {
  try {
    await simulateContractCall(
      sourceAddress,
      TESTNET_CONFIG.intentRegistryId,
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
  try {
    validatePaymentDraft(draft);
    await simulateContractCall(
      sourceAddress,
      TESTNET_CONFIG.policyEngineId,
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
    return {
      ok: false,
      title: "Policy simulation rejected",
      detail:
        explainContractError(message) ?? "The testnet policy engine rejected this payment.",
      diagnostic: message,
    };
  }
}

export async function simulateTransfer(
  sourceAddress: string,
  draft: PaymentDraft,
): Promise<SimulationResult> {
  try {
    validatePaymentDraft(draft);
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
      TESTNET_CONFIG.smartAccountId,
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
    return {
      ok: false,
      title: "Transfer simulation needs auth",
      detail:
        explainContractError(message) ??
        "This call requires the SmartAccount AuthPayload plus delegated signer authorization entries.",
      diagnostic: message,
    };
  }
}

export async function simulateSchedule(
  sourceAddress: string,
  draft: ScheduleDraft,
): Promise<SimulationResult> {
  try {
    validateScheduleDraft(draft);
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
      TESTNET_CONFIG.smartAccountId,
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
    return {
      ok: false,
      title: "Schedule simulation needs auth",
      detail:
        explainContractError(message) ??
        "Scheduled payment creation uses the same SmartAccount custom authorization flow as transfers.",
      diagnostic: message,
    };
  }
}
