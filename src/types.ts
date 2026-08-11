export type NetworkHealth = "idle" | "loading" | "ready" | "degraded";

export type TreasuryStatus = {
  initialized: boolean;
  paused: boolean;
  frozen: boolean;
  policyVersionHint: number;
};

export type ContextRule = {
  id: number;
  name: string;
  contextType: string;
  signerCount: number;
  signerAddresses: string[];
  policyCount: number;
  validUntil?: number;
  raw?: unknown;
};

export type WalletState = {
  address: string | null;
  walletName: string | null;
  connected: boolean;
};

export type PaymentDraft = {
  asset: string;
  destination: string;
  amount: string;
  nonce: string;
  expectedPolicyVersion: number;
};

export type ScheduleDraft = PaymentDraft & {
  intentId: string;
  startLedger: string;
  endLedger: string;
  maxExecutions: string;
};

export type SimulationResult = {
  ok: boolean;
  /**
   * The network has neither confirmed nor rejected this yet. Not a failure —
   * `ok` stays true — but not a confirmation to report either.
   */
  pending?: boolean;
  title: string;
  detail: string;
  diagnostic?: string;
  txHash?: string;
};

export type ExecutionStep = {
  label: string;
  state: "complete" | "active" | "pending" | "blocked";
  detail: string;
};

export type TransactionReceipt = {
  hash: string;
  status: string;
  latestLedger?: number;
};

export type WalletSigning = {
  address: string;
  signAuthEntry: (
    authEntryXdr: string,
    address: string,
  ) => Promise<{ signature: string; signerAddress?: string } | undefined>;
  signTransaction: (transactionXdr: string, address: string) => Promise<string | undefined>;
};

export type PolicyProbeReason =
  | "operation"
  | "asset"
  | "recipient"
  | "amount"
  | "version"
  | "unknown";

export type PolicyProbeVerdict =
  | { allowed: true }
  | { allowed: false; reason: PolicyProbeReason; code?: number };

export type ProbeInput = {
  asset: string;
  destination: string;
  operation: string;
  amount: string;
  expectedVersion: number;
};
