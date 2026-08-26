import type { ContractSet } from "@/lib/env";

export type TreasuryRecord = {
  smartAccountId: string;
  policyEngineId: string;
  intentRegistryId: string;
  recoveryManagerId: string;
  transferAdapterId: string;
  splitAdapterId: string;
  ownerAddress: string;
  executorAddress: string;
  deployTxHash: string;
  createdAt: string;
};

export type CreateTreasuryInput = {
  smartAccountId: string;
  policyEngineId: string;
  intentRegistryId: string;
  recoveryManagerId: string;
  transferAdapterId: string;
  splitAdapterId: string;
  ownerAddress: string;
  executorAddress: string;
  deployTxHash: string;
};

/**
 * Maps a stored record to the `ContractSet` shape the read/write layer
 * (`stellarClient.ts`, `treasuryWrites.ts`) expects. Pure and dependency-free
 * (no `node:fs/promises`, unlike `treasuryRegistry/store.ts`) specifically so
 * client components can import it directly. `staAsset` isn't part of
 * `account_factory.deploy_account`'s `DeployedAccount` return value -- this
 * dApp only ever deals with one test asset, so every treasury shares the
 * globally configured one. A deliberate scope assumption, not a bug.
 */
export function toContractSet(record: TreasuryRecord, staAsset: string): ContractSet {
  return {
    smartAccount: record.smartAccountId,
    policyEngine: record.policyEngineId,
    intentRegistry: record.intentRegistryId,
    recoveryManager: record.recoveryManagerId,
    transferAdapter: record.transferAdapterId,
    splitAdapter: record.splitAdapterId,
    staAsset,
  };
}
