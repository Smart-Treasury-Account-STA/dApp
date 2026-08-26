export type RelayerJobRecord = {
  /**
   * Which treasury's intent_registry/smart_account this job belongs to.
   * Combined with `intentId` as the store's lookup/idempotency key — two
   * different treasuries can otherwise pick colliding random intent ids,
   * which a single-key model would silently merge.
   */
  smartAccountId: string;
  intentId: string;
  childSequence: number;
  startLedger: number;
  endLedger: number;
  maxExecutions: number;
  executionCount: number;
  status: "scheduled" | "ready" | "executing" | "executed" | "blocked" | "failed";
  note: string;
  txHash?: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateRelayerJobInput = {
  smartAccountId: string;
  intentId: string;
  startLedger: number;
  endLedger: number;
  maxExecutions: number;
};

export type RelayerRunResult = {
  checked: number;
  executed: number;
  updated: RelayerJobRecord[];
};
