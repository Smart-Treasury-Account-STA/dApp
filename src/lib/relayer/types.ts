export type RelayerJobRecord = {
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
