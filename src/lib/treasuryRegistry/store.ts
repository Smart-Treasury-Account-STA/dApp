import { mkdir, readFile, rename, writeFile } from "node:fs/promises";

import { StrKey } from "@stellar/stellar-sdk";

import type { CreateTreasuryInput, TreasuryRecord } from "@/lib/treasuryRegistry/types";

export { toContractSet } from "@/lib/treasuryRegistry/types";

type TreasuryStoreFile = {
  treasuries: TreasuryRecord[];
};

const TX_HASH_PATTERN = /^[0-9a-fA-F]{64}$/;
const STORE_DIR = ".treasuries";
const STORE_FILE = ".treasuries/treasuries.json";
let writeQueue = Promise.resolve();

function storePath() {
  return STORE_FILE;
}

export function validateCreateTreasuryInput(input: CreateTreasuryInput) {
  const contractFields: Array<[string, string]> = [
    ["smartAccountId", input.smartAccountId],
    ["policyEngineId", input.policyEngineId],
    ["intentRegistryId", input.intentRegistryId],
    ["recoveryManagerId", input.recoveryManagerId],
    ["transferAdapterId", input.transferAdapterId],
    ["splitAdapterId", input.splitAdapterId],
  ];
  for (const [label, value] of contractFields) {
    if (!StrKey.isValidContract(value)) {
      throw new Error(`${label} must be a Stellar contract id starting with C.`);
    }
  }

  const addressFields: Array<[string, string]> = [
    ["ownerAddress", input.ownerAddress],
    ["executorAddress", input.executorAddress],
  ];
  for (const [label, value] of addressFields) {
    if (!StrKey.isValidEd25519PublicKey(value)) {
      throw new Error(`${label} must be a Stellar account id starting with G.`);
    }
  }

  if (!TX_HASH_PATTERN.test(input.deployTxHash)) {
    throw new Error("deployTxHash must be a 64-character hex transaction hash.");
  }
}

async function readStore(): Promise<TreasuryStoreFile> {
  try {
    const raw = await readFile(storePath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<TreasuryStoreFile>;
    return { treasuries: Array.isArray(parsed.treasuries) ? parsed.treasuries : [] };
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return { treasuries: [] };
    }
    throw error;
  }
}

async function writeStore(store: TreasuryStoreFile) {
  const target = storePath();
  await mkdir(STORE_DIR, { recursive: true });
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await rename(temp, target);
}

async function mutateStore<T>(mutate: (store: TreasuryStoreFile) => Promise<T> | T) {
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

export async function listTreasuries() {
  const store = await readStore();
  return [...store.treasuries].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function listTreasuriesByOwner(ownerAddress: string) {
  const treasuries = await listTreasuries();
  return treasuries.filter((treasury) => treasury.ownerAddress === ownerAddress);
}

export async function getTreasury(smartAccountId: string) {
  const store = await readStore();
  return store.treasuries.find((treasury) => treasury.smartAccountId === smartAccountId) ?? null;
}

/**
 * Thrown when a second registration attempt for an already-registered
 * `smartAccountId` disagrees with the stored record on any field.
 *
 * `verifyTreasuryOwnership` (the endpoint's access control) can only check
 * that the claimed owner matches `smart_account.get_owner()` on-chain --
 * there is no getter to also verify the claimed policyEngineId/
 * intentRegistryId/etc are the *real* ones this specific smart_account was
 * deployed with (see toContractSet's doc comment). Anyone who has observed
 * a real deploy_account transaction knows its real owner address (public,
 * on a public ledger), so they can pass ownership verification while
 * supplying a fabricated sub-contract set. Silently returning the
 * first-registered record for a repeat call (the ordinary idempotent-create
 * pattern used elsewhere in this codebase, e.g. relayer/store.ts) would let
 * that fabricated record win a race against the legitimate deployer's own
 * registration call and stay permanently in place, undetected. Rejecting a
 * disagreeing second claim instead doesn't prevent the race outright, but
 * it turns a silent data-integrity failure into a visible one.
 */
export class TreasuryConflictError extends Error {
  constructor(smartAccountId: string) {
    super(
      `A treasury is already registered for ${smartAccountId} with different contract addresses than this request claims.`,
    );
    this.name = "TreasuryConflictError";
  }
}

function recordsMatch(a: TreasuryRecord, b: CreateTreasuryInput): boolean {
  return (
    a.policyEngineId === b.policyEngineId &&
    a.intentRegistryId === b.intentRegistryId &&
    a.recoveryManagerId === b.recoveryManagerId &&
    a.transferAdapterId === b.transferAdapterId &&
    a.splitAdapterId === b.splitAdapterId &&
    a.ownerAddress === b.ownerAddress &&
    a.executorAddress === b.executorAddress &&
    // A given smart_account address only ever gets deployed once (its
    // address is deterministic from caller+salt, and a second
    // deploy_account targeting the same derived address fails on-chain) --
    // any legitimate re-registration of the same treasury carries the same
    // deployTxHash every time, so a mismatch here is as much a signal of a
    // fabricated claim as the fields above.
    a.deployTxHash === b.deployTxHash
  );
}

export async function createTreasury(input: CreateTreasuryInput) {
  validateCreateTreasuryInput(input);

  return mutateStore((store) => {
    const existing = store.treasuries.find(
      (treasury) => treasury.smartAccountId === input.smartAccountId,
    );
    if (existing) {
      if (!recordsMatch(existing, input)) {
        throw new TreasuryConflictError(input.smartAccountId);
      }
      return existing;
    }

    const record: TreasuryRecord = {
      ...input,
      createdAt: new Date().toISOString(),
    };
    store.treasuries.push(record);
    return record;
  });
}
