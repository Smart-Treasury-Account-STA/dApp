import { StrKey } from "@stellar/stellar-sdk";

export type ContractSet = {
  smartAccount: string;
  policyEngine: string;
  intentRegistry: string;
  recoveryManager: string;
  transferAdapter: string;
  splitAdapter: string;
  staAsset: string;
};

export type StellarConfig = {
  rpcUrl: string;
  networkPassphrase: string;
  explorerBaseUrl: string;
  contracts: ContractSet;
  testRecipient: string;
};

export class ConfigError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid Stellar configuration:\n- ${issues.join("\n- ")}`);
    this.name = "ConfigError";
    this.issues = issues;
  }
}

type Source = Record<string, string | undefined>;

const CONTRACT_KEYS = {
  smartAccount: "NEXT_PUBLIC_SMART_ACCOUNT_ID",
  policyEngine: "NEXT_PUBLIC_POLICY_ENGINE_ID",
  intentRegistry: "NEXT_PUBLIC_INTENT_REGISTRY_ID",
  recoveryManager: "NEXT_PUBLIC_RECOVERY_MANAGER_ID",
  transferAdapter: "NEXT_PUBLIC_TRANSFER_ADAPTER_ID",
  splitAdapter: "NEXT_PUBLIC_SPLIT_ADAPTER_ID",
  staAsset: "NEXT_PUBLIC_STA_ASSET_CONTRACT_ID",
} as const satisfies Record<keyof ContractSet, string>;

export function readStellarConfig(source: Source): StellarConfig {
  const issues: string[] = [];

  function required(key: string) {
    const value = source[key]?.trim();
    if (!value) {
      issues.push(`${key} is required.`);
      return "";
    }
    return value;
  }

  function httpsUrl(key: string) {
    const value = required(key);
    if (value && !value.startsWith("https://") && !value.startsWith("http://localhost")) {
      issues.push(`${key} must be an https URL.`);
    }
    return value;
  }

  function contractId(key: string) {
    const value = required(key);
    if (value && !StrKey.isValidContract(value)) {
      issues.push(`${key} must be a Stellar contract id starting with C.`);
    }
    return value;
  }

  const rpcUrl = httpsUrl("NEXT_PUBLIC_STELLAR_RPC_URL");
  const networkPassphrase = required("NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE");
  const explorerBaseUrl = httpsUrl("NEXT_PUBLIC_STELLAR_EXPLORER_URL");

  const contracts = Object.fromEntries(
    Object.entries(CONTRACT_KEYS).map(([field, key]) => [field, contractId(key)]),
  ) as ContractSet;

  const testRecipient = required("NEXT_PUBLIC_TEST_RECIPIENT");
  if (testRecipient && !StrKey.isValidEd25519PublicKey(testRecipient)) {
    issues.push("NEXT_PUBLIC_TEST_RECIPIENT must be a Stellar account id starting with G.");
  }

  if (issues.length > 0) {
    throw new ConfigError(issues);
  }

  return { rpcUrl, networkPassphrase, explorerBaseUrl, contracts, testRecipient };
}
