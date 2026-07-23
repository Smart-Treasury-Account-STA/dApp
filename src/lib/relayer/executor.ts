import {
  BASE_FEE,
  Contract,
  Keypair,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { Buffer } from "buffer";

import { TESTNET_CONFIG } from "@/config";
import { getRelayerJob, listRelayerJobs, updateRelayerJob } from "@/lib/relayer/store";
import type {
  CreateRelayerJobInput,
  RelayerJobRecord,
  RelayerRunResult,
} from "@/lib/relayer/types";

type IntentRegistryState = {
  cancelled?: boolean;
  end_ledger?: number;
  endLedger?: number;
  execution_count?: number;
  executionCount?: number;
  intent_id?: unknown;
  intentId?: unknown;
  max_executions?: number;
  maxExecutions?: number;
  start_ledger?: number;
  startLedger?: number;
};

function bytesN32ScVal(hex: string) {
  const normalized = hex.replace(/^0x/, "");
  const parts = normalized.match(/.{1,2}/g) ?? [];
  const bytes = Buffer.from(parts.map((byte) => parseInt(byte, 16)));
  if (bytes.length !== 32) {
    throw new Error("Intent ID must be 32 bytes encoded as 64 hex characters.");
  }
  return xdr.ScVal.scvBytes(bytes);
}

function u32ScVal(value: number) {
  return nativeToScVal(value, { type: "u32" });
}

function getExecutorKeypair() {
  const secret = process.env.RELAYER_EXECUTOR_SECRET;
  if (!secret) {
    throw new Error("RELAYER_EXECUTOR_SECRET is not configured.");
  }
  return Keypair.fromSecret(secret);
}

function isSimulationError(
  simulation: rpc.Api.SimulateTransactionResponse,
): simulation is rpc.Api.SimulateTransactionErrorResponse {
  return "error" in simulation;
}

async function simulateContractCall(
  server: rpc.Server,
  sourceAddress: string,
  contractId: string,
  method: string,
  args: xdr.ScVal[] = [],
) {
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
  if (isSimulationError(simulation)) {
    throw new Error(simulation.error);
  }
  return simulation.result?.retval ? scValToNative(simulation.result.retval) : null;
}

function numeric(value: unknown, fallback: number) {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") return Number(value);
  return fallback;
}

async function readIntentState(
  server: rpc.Server,
  sourceAddress: string,
  job: RelayerJobRecord,
) {
  const intentId = bytesN32ScVal(job.intentId);
  const intent = (await simulateContractCall(
    server,
    sourceAddress,
    TESTNET_CONFIG.intentRegistryId,
    "get_intent",
    [intentId],
  )) as IntentRegistryState | null;
  const childExecuted = Boolean(
    await simulateContractCall(
      server,
      sourceAddress,
      TESTNET_CONFIG.intentRegistryId,
      "is_child_executed",
      [intentId, u32ScVal(job.childSequence)],
    ),
  );

  return {
    cancelled: Boolean(intent?.cancelled),
    childExecuted,
    executionCount: numeric(
      intent?.execution_count ?? intent?.executionCount,
      job.executionCount,
    ),
    maxExecutions: numeric(intent?.max_executions ?? intent?.maxExecutions, job.maxExecutions),
  };
}

export async function readQueueableScheduledIntent(
  intentId: string,
): Promise<CreateRelayerJobInput> {
  const server = new rpc.Server(TESTNET_CONFIG.rpcUrl);
  const executor = getExecutorKeypair();
  const sourceAddress = executor.publicKey();
  const intent = (await simulateContractCall(
    server,
    sourceAddress,
    TESTNET_CONFIG.intentRegistryId,
    "get_intent",
    [bytesN32ScVal(intentId)],
  )) as IntentRegistryState | null;

  if (!intent) {
    throw new Error("Scheduled intent was not found on-chain.");
  }
  if (intent.cancelled) {
    throw new Error("Scheduled intent is cancelled on-chain.");
  }

  return {
    intentId,
    startLedger: numeric(intent.start_ledger ?? intent.startLedger, 0),
    endLedger: numeric(intent.end_ledger ?? intent.endLedger, 0),
    maxExecutions: numeric(intent.max_executions ?? intent.maxExecutions, 0),
  };
}

function isTerminal(job: RelayerJobRecord) {
  return job.status === "blocked" || job.status === "executed";
}

export async function executeRelayerJob(job: RelayerJobRecord) {
  const server = new rpc.Server(TESTNET_CONFIG.rpcUrl);
  const latestLedger = await server.getLatestLedger();

  if (job.executionCount >= job.maxExecutions) {
    return updateRelayerJob(job.intentId, (current) => ({
      ...current,
      status: "blocked",
      note: "Execution limit reached.",
    }));
  }
  if (latestLedger.sequence < job.startLedger) {
    return updateRelayerJob(job.intentId, (current) => ({
      ...current,
      status: "scheduled",
      note: `Execution window opens at ledger ${job.startLedger}.`,
    }));
  }
  if (latestLedger.sequence > job.endLedger) {
    return updateRelayerJob(job.intentId, (current) => ({
      ...current,
      status: "blocked",
      note: "Execution window expired.",
    }));
  }

  const executor = getExecutorKeypair();
  const sourceAddress = executor.publicKey();
  const intentState = await readIntentState(server, sourceAddress, job);

  if (intentState.cancelled) {
    return updateRelayerJob(job.intentId, (current) => ({
      ...current,
      status: "blocked",
      executionCount: intentState.executionCount,
      note: "Scheduled intent is cancelled on-chain.",
    }));
  }
  if (intentState.childExecuted) {
    return updateRelayerJob(job.intentId, (current) => ({
      ...current,
      childSequence: current.childSequence + 1,
      executionCount: Math.max(current.executionCount, intentState.executionCount),
      status:
        intentState.executionCount >= Math.min(current.maxExecutions, intentState.maxExecutions)
          ? "executed"
          : "ready",
      note: "Child sequence was already consumed on-chain; local relayer state was advanced.",
    }));
  }

  await updateRelayerJob(job.intentId, (current) => ({
    ...current,
    status: "executing",
    note: "Submitting executor-signed scheduled payment.",
  }));

  const source = await server.getAccount(sourceAddress);
  const contract = new Contract(TESTNET_CONFIG.smartAccountId);
  const tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: TESTNET_CONFIG.networkPassphrase,
  })
    .addOperation(
      contract.call(
        "execute_scheduled_payment",
        bytesN32ScVal(job.intentId),
        u32ScVal(job.childSequence),
      ),
    )
    .setTimeout(120)
    .build();

  const prepared = await server.prepareTransaction(tx);
  prepared.sign(executor);
  const sent = await server.sendTransaction(prepared);

  if (sent.status === "ERROR") {
    return updateRelayerJob(job.intentId, (current) => ({
      ...current,
      status: "failed",
      note: "RPC rejected the executor transaction.",
      txHash: sent.hash,
    }));
  }
  if (sent.status === "TRY_AGAIN_LATER") {
    return updateRelayerJob(job.intentId, (current) => ({
      ...current,
      status: "ready",
      note: "RPC asked the relayer to retry later. Child sequence was not advanced.",
    }));
  }
  if (sent.status === "DUPLICATE") {
    return updateRelayerJob(job.intentId, (current) => ({
      ...current,
      status: "ready",
      note: "RPC reported a duplicate submission. Child sequence will be rechecked before retry.",
      txHash: sent.hash,
    }));
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const result = await server.getTransaction(sent.hash);
    if (result.status === "SUCCESS") {
      return updateRelayerJob(job.intentId, (current) => ({
        ...current,
        status:
          current.executionCount + 1 >= Math.min(current.maxExecutions, intentState.maxExecutions)
            ? "executed"
            : "ready",
        executionCount: current.executionCount + 1,
        childSequence: current.childSequence + 1,
        note: "Scheduled payment executed exactly once for the consumed child sequence.",
        txHash: sent.hash,
      }));
    }
    if (result.status === "FAILED") {
      return updateRelayerJob(job.intentId, (current) => ({
        ...current,
        status: "failed",
        note: "Executor transaction failed on-chain. Child sequence was not advanced.",
        txHash: sent.hash,
      }));
    }
  }

  return updateRelayerJob(job.intentId, (current) => ({
    ...current,
    status: "ready",
    note: "Transaction submitted and still pending. Child sequence was not advanced.",
    txHash: sent.hash,
  }));
}

export async function executeRelayerJobById(intentId: string) {
  const job = await getRelayerJob(intentId);
  if (!job) {
    throw new Error("Relayer job not found.");
  }
  return executeRelayerJob(job);
}

export async function runDueRelayerJobs(limit = 5): Promise<RelayerRunResult> {
  const server = new rpc.Server(TESTNET_CONFIG.rpcUrl);
  const latestLedger = await server.getLatestLedger();
  const jobs = await listRelayerJobs();
  const dueJobs = jobs
    .filter(
      (job) =>
        !isTerminal(job) &&
        job.status !== "executing" &&
        job.executionCount < job.maxExecutions &&
        latestLedger.sequence >= job.startLedger &&
        latestLedger.sequence <= job.endLedger,
    )
    .slice(0, limit);
  const updated: RelayerJobRecord[] = [];

  for (const job of dueJobs) {
    updated.push(await executeRelayerJob(job));
  }

  return {
    checked: jobs.length,
    executed: updated.filter((job) => job.status === "executed").length,
    updated,
  };
}
