import { mkdir, readFile, rename, writeFile } from "node:fs/promises";

import { StrKey } from "@stellar/stellar-sdk";

import type { CreateRelayerJobInput, RelayerJobRecord } from "@/lib/relayer/types";

type RelayerStoreFile = {
  jobs: RelayerJobRecord[];
};

const INTENT_ID_PATTERN = /^(0x)?[0-9a-fA-F]{64}$/;
const STORE_DIR = ".relayer";
const STORE_FILE = ".relayer/relayer-jobs.json";
let writeQueue = Promise.resolve();

function storePath() {
  return STORE_FILE;
}

function normalizeIntentId(intentId: string) {
  return intentId.replace(/^0x/i, "").toLowerCase();
}

// A job's real identity is (smartAccountId, intentId), not intentId alone
// -- two different treasuries could otherwise pick colliding random intent
// ids, which a single-key model would silently merge.
function jobKey(smartAccountId: string, intentId: string) {
  return `${smartAccountId}:${normalizeIntentId(intentId)}`;
}

function assertSafeInteger(name: string, value: number) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer.`);
  }
}

export function validateRelayerJobInput(input: CreateRelayerJobInput) {
  if (!StrKey.isValidContract(input.smartAccountId)) {
    throw new Error("smartAccountId must be a Stellar contract id starting with C.");
  }
  if (!INTENT_ID_PATTERN.test(input.intentId)) {
    throw new Error("Intent ID must be 32 bytes encoded as 64 hex characters.");
  }

  assertSafeInteger("startLedger", input.startLedger);
  assertSafeInteger("endLedger", input.endLedger);
  assertSafeInteger("maxExecutions", input.maxExecutions);

  if (input.maxExecutions < 1) {
    throw new Error("maxExecutions must be at least 1.");
  }
  if (input.startLedger >= input.endLedger) {
    throw new Error("startLedger must be lower than endLedger.");
  }
}

async function readStore(): Promise<RelayerStoreFile> {
  try {
    const raw = await readFile(storePath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<RelayerStoreFile>;
    return { jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [] };
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return { jobs: [] };
    }
    throw error;
  }
}

async function writeStore(store: RelayerStoreFile) {
  const target = storePath();
  await mkdir(STORE_DIR, { recursive: true });
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await rename(temp, target);
}

async function mutateStore<T>(mutate: (store: RelayerStoreFile) => Promise<T> | T) {
  const run = writeQueue.then(async () => {
    const store = await readStore();
    const result = await mutate(store);
    await writeStore(store);
    return result;
  });
  writeQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function listRelayerJobs() {
  const store = await readStore();
  return [...store.jobs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function listRelayerJobsForTreasury(smartAccountId: string) {
  const jobs = await listRelayerJobs();
  return jobs.filter((job) => job.smartAccountId === smartAccountId);
}

export async function getRelayerJob(smartAccountId: string, intentId: string) {
  const key = jobKey(smartAccountId, intentId);
  const store = await readStore();
  return store.jobs.find((job) => jobKey(job.smartAccountId, job.intentId) === key) ?? null;
}

export async function createRelayerJob(input: CreateRelayerJobInput) {
  validateRelayerJobInput(input);

  return mutateStore((store) => {
    const key = jobKey(input.smartAccountId, input.intentId);
    const existing = store.jobs.find((job) => jobKey(job.smartAccountId, job.intentId) === key);
    const now = new Date().toISOString();

    if (existing) {
      return existing;
    }

    const job: RelayerJobRecord = {
      smartAccountId: input.smartAccountId,
      intentId: normalizeIntentId(input.intentId),
      childSequence: 1,
      startLedger: input.startLedger,
      endLedger: input.endLedger,
      maxExecutions: input.maxExecutions,
      executionCount: 0,
      status: "scheduled",
      note: "Queued for executor-gated scheduled payment execution.",
      createdAt: now,
      updatedAt: now,
    };

    store.jobs.push(job);
    return job;
  });
}

export async function updateRelayerJob(
  smartAccountId: string,
  intentId: string,
  update: (job: RelayerJobRecord) => RelayerJobRecord,
) {
  return mutateStore((store) => {
    const key = jobKey(smartAccountId, intentId);
    const index = store.jobs.findIndex(
      (job) => jobKey(job.smartAccountId, job.intentId) === key,
    );
    if (index === -1) {
      throw new Error("Relayer job not found.");
    }

    const updated = update({
      ...store.jobs[index],
      updatedAt: new Date().toISOString(),
    });
    store.jobs[index] = {
      ...updated,
      intentId: normalizeIntentId(updated.intentId),
      updatedAt: new Date().toISOString(),
    };
    return store.jobs[index];
  });
}
