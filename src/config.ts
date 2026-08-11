import { readStellarConfig } from "@/lib/env";

export const STELLAR_CONFIG = readStellarConfig({
  NEXT_PUBLIC_STELLAR_RPC_URL: process.env.NEXT_PUBLIC_STELLAR_RPC_URL,
  NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE:
    process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE,
  NEXT_PUBLIC_STELLAR_EXPLORER_URL: process.env.NEXT_PUBLIC_STELLAR_EXPLORER_URL,
  NEXT_PUBLIC_SMART_ACCOUNT_ID: process.env.NEXT_PUBLIC_SMART_ACCOUNT_ID,
  NEXT_PUBLIC_POLICY_ENGINE_ID: process.env.NEXT_PUBLIC_POLICY_ENGINE_ID,
  NEXT_PUBLIC_INTENT_REGISTRY_ID: process.env.NEXT_PUBLIC_INTENT_REGISTRY_ID,
  NEXT_PUBLIC_RECOVERY_MANAGER_ID: process.env.NEXT_PUBLIC_RECOVERY_MANAGER_ID,
  NEXT_PUBLIC_TRANSFER_ADAPTER_ID: process.env.NEXT_PUBLIC_TRANSFER_ADAPTER_ID,
  NEXT_PUBLIC_SPLIT_ADAPTER_ID: process.env.NEXT_PUBLIC_SPLIT_ADAPTER_ID,
  NEXT_PUBLIC_STA_ASSET_CONTRACT_ID: process.env.NEXT_PUBLIC_STA_ASSET_CONTRACT_ID,
  NEXT_PUBLIC_TEST_RECIPIENT: process.env.NEXT_PUBLIC_TEST_RECIPIENT,
});

export const CONTRACTS = [
  ["Smart Account", STELLAR_CONFIG.contracts.smartAccount],
  ["Policy Engine", STELLAR_CONFIG.contracts.policyEngine],
  ["Intent Registry", STELLAR_CONFIG.contracts.intentRegistry],
  ["Recovery Manager", STELLAR_CONFIG.contracts.recoveryManager],
  ["Transfer Adapter", STELLAR_CONFIG.contracts.transferAdapter],
  ["Split Adapter", STELLAR_CONFIG.contracts.splitAdapter],
  ["STA Test Asset", STELLAR_CONFIG.contracts.staAsset],
] as const;
