import type { xdr } from '@stellar/stellar-sdk'

export type NetworkHealth = 'idle' | 'loading' | 'ready' | 'degraded'

export type TreasuryStatus = {
  initialized: boolean
  paused: boolean
  frozen: boolean
  policyVersionHint: number
}

export type ContextRule = {
  id: number
  name: string
  contextType: string
  signerCount: number
  signerAddresses: string[]
  policyCount: number
  validUntil?: number
  raw?: unknown
}

export type WalletState = {
  address: string | null
  walletName: string | null
  connected: boolean
}

export type PaymentDraft = {
  asset: string
  destination: string
  amount: string
  nonce: string
  expectedPolicyVersion: number
}

export type SplitDestination = {
  destination: string
  amount: string
}

export type SplitDraft = {
  asset: string
  destinations: SplitDestination[]
  nonce: string
  expectedPolicyVersion: number
}

export type ScheduleDraft = PaymentDraft & {
  intentId: string
  startLedger: string
  endLedger: string
  maxExecutions: string
  /**
   * Ledger-count spacing between successive executions of a recurring
   * schedule (`0` = one-shot, the only mode this dApp's UI currently
   * builds). Required by the current `intent_registry` contract's
   * `ScheduledIntentArgs` struct shape -- omitting it entirely would fail
   * `create_scheduled_payment` with a struct arity mismatch, not just
   * silently default. Optional here only so existing draft-construction
   * call sites don't all need updating at once; `scheduledIntentScVal`
   * defaults it to `0` when absent.
   */
  intervalLedgers?: string
}

export type SimulationResult = {
  ok: boolean
  /**
   * The network has neither confirmed nor rejected this yet. Not a failure —
   * `ok` stays true — but not a confirmation to report either.
   */
  pending?: boolean
  title: string
  detail: string
  diagnostic?: string
  txHash?: string
}

export type ExecutionStep = {
  label: string
  state: 'complete' | 'active' | 'pending' | 'blocked'
  detail: string
}

export type TransactionReceipt = {
  hash: string
  status: string
  latestLedger?: number
  /** This operation's contract events, when the poll reached a terminal
   * SUCCESS/FAILED status (absent while still pending/NOT_FOUND). Decode
   * with `parseContractEvents` from `sta-sdk`. */
  events?: xdr.ContractEvent[]
}

export type WalletSigning = {
  address: string
  signAuthEntry: (
    authEntryXdr: string,
    address: string
  ) => Promise<{ signature: string; signerAddress?: string } | undefined>
  signTransaction: (
    transactionXdr: string,
    address: string
  ) => Promise<{ xdr: string; signerAddress?: string } | undefined>
}

export type PolicyProbeReason =
  'operation' | 'asset' | 'destination' | 'amount' | 'version' | 'unknown'

export type PolicyProbeVerdict =
  | { allowed: true }
  | { allowed: false; reason: PolicyProbeReason; code?: number }

export type ProbeInput = {
  asset: string
  destination: string
  operation: string
  amount: string
  expectedVersion: number
}

export type TreasuryAuthority = {
  owner: string | null
  policyAdminHint: string | null
}
