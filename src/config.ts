import type { ContractSet } from '@/lib/env'
import { readStellarConfig } from '@/lib/env'
import { describeNetwork } from '@/lib/network'

export const STELLAR_CONFIG = {
  ...readStellarConfig({
    NEXT_PUBLIC_STELLAR_RPC_URL: process.env.NEXT_PUBLIC_STELLAR_RPC_URL,
    NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE:
      process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE,
    NEXT_PUBLIC_STELLAR_EXPLORER_URL:
      process.env.NEXT_PUBLIC_STELLAR_EXPLORER_URL,
    NEXT_PUBLIC_SMART_ACCOUNT_ID: process.env.NEXT_PUBLIC_SMART_ACCOUNT_ID,
    NEXT_PUBLIC_POLICY_ENGINE_ID: process.env.NEXT_PUBLIC_POLICY_ENGINE_ID,
    NEXT_PUBLIC_INTENT_REGISTRY_ID: process.env.NEXT_PUBLIC_INTENT_REGISTRY_ID,
    NEXT_PUBLIC_RECOVERY_MANAGER_ID:
      process.env.NEXT_PUBLIC_RECOVERY_MANAGER_ID,
    NEXT_PUBLIC_TRANSFER_ADAPTER_ID:
      process.env.NEXT_PUBLIC_TRANSFER_ADAPTER_ID,
    NEXT_PUBLIC_SPLIT_ADAPTER_ID: process.env.NEXT_PUBLIC_SPLIT_ADAPTER_ID,
    NEXT_PUBLIC_STA_ASSET_CONTRACT_ID:
      process.env.NEXT_PUBLIC_STA_ASSET_CONTRACT_ID,
    NEXT_PUBLIC_TEST_RECIPIENT: process.env.NEXT_PUBLIC_TEST_RECIPIENT,
    NEXT_PUBLIC_ACCOUNT_FACTORY_ID: process.env.NEXT_PUBLIC_ACCOUNT_FACTORY_ID,
    NEXT_PUBLIC_RELAYER_EXECUTOR_ADDRESS:
      process.env.NEXT_PUBLIC_RELAYER_EXECUTOR_ADDRESS,
  }),
  // Optional: policy_engine's admin is not readable on-chain (Task 5 of the
  // write-screens plan), so this is only ever a hint for the UI, never
  // validated against. Absent by default — nothing warns or blocks without it.
  policyAdminHint: process.env.NEXT_PUBLIC_POLICY_ADMIN_HINT ?? null,
}

/**
 * The Stellar network this deployment talks to, resolved from the configured
 * passphrase. Every network name the UI shows comes from here, so a testnet
 * deployment cannot label itself mainnet or the reverse.
 */
export const NETWORK = describeNetwork(STELLAR_CONFIG.networkPassphrase)

export function buildContractList(contracts: ContractSet) {
  return [
    ['Smart Account', contracts.smartAccount],
    ['Policy Engine', contracts.policyEngine],
    ['Intent Registry', contracts.intentRegistry],
    ['Recovery Manager', contracts.recoveryManager],
    ['Transfer Adapter', contracts.transferAdapter],
    ['Split Adapter', contracts.splitAdapter],
    ['STA Asset', contracts.staAsset],
  ] as const
}

export const CONTRACTS = buildContractList(STELLAR_CONFIG.contracts)
