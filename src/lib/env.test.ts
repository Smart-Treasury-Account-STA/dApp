import { describe, expect, it } from "vitest";

import { ConfigError, readStellarConfig } from "@/lib/env";

const contract = "CB4KZJ3I4XANE6GWPAMXCNXQ34PTQWPXVKFBBMLNKV25GAOXQC7RQUMS";
const account = "GAK3XILRBYBMBOCZMSLL2CLR6WPQLEIOC6ZCYYPTE4OIAX3PCFFO2YMU";

function source(overrides: Record<string, string | undefined> = {}) {
  return {
    NEXT_PUBLIC_STELLAR_RPC_URL: "https://soroban-testnet.stellar.org",
    NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
    NEXT_PUBLIC_STELLAR_EXPLORER_URL: "https://stellar.expert/explorer/testnet",
    NEXT_PUBLIC_SMART_ACCOUNT_ID: contract,
    NEXT_PUBLIC_POLICY_ENGINE_ID: contract,
    NEXT_PUBLIC_INTENT_REGISTRY_ID: contract,
    NEXT_PUBLIC_RECOVERY_MANAGER_ID: contract,
    NEXT_PUBLIC_TRANSFER_ADAPTER_ID: contract,
    NEXT_PUBLIC_SPLIT_ADAPTER_ID: contract,
    NEXT_PUBLIC_STA_ASSET_CONTRACT_ID: contract,
    NEXT_PUBLIC_TEST_RECIPIENT: account,
    ...overrides,
  };
}

describe("readStellarConfig", () => {
  it("returns a typed config for a valid source", () => {
    const config = readStellarConfig(source());
    expect(config.contracts.smartAccount).toBe(contract);
    expect(config.networkPassphrase).toBe("Test SDF Network ; September 2015");
  });

  it("rejects a missing variable", () => {
    expect(() =>
      readStellarConfig(source({ NEXT_PUBLIC_SMART_ACCOUNT_ID: undefined })),
    ).toThrow(ConfigError);
  });

  it("rejects a malformed contract id", () => {
    expect(() =>
      readStellarConfig(source({ NEXT_PUBLIC_POLICY_ENGINE_ID: "not-a-contract" })),
    ).toThrow(/NEXT_PUBLIC_POLICY_ENGINE_ID/);
  });

  it("rejects an account id where a contract id is required", () => {
    expect(() =>
      readStellarConfig(source({ NEXT_PUBLIC_INTENT_REGISTRY_ID: account })),
    ).toThrow(/NEXT_PUBLIC_INTENT_REGISTRY_ID/);
  });

  it("rejects a non https rpc url", () => {
    expect(() =>
      readStellarConfig(source({ NEXT_PUBLIC_STELLAR_RPC_URL: "ftp://rpc" })),
    ).toThrow(/NEXT_PUBLIC_STELLAR_RPC_URL/);
  });

  it("resolves optional accountFactoryId/relayerExecutorAddress to null when absent, without throwing", () => {
    const config = readStellarConfig(source());
    expect(config.accountFactoryId).toBeNull();
    expect(config.relayerExecutorAddress).toBeNull();
  });

  it("accepts valid optional accountFactoryId/relayerExecutorAddress when present", () => {
    const config = readStellarConfig(
      source({
        NEXT_PUBLIC_ACCOUNT_FACTORY_ID: contract,
        NEXT_PUBLIC_RELAYER_EXECUTOR_ADDRESS: account,
      }),
    );
    expect(config.accountFactoryId).toBe(contract);
    expect(config.relayerExecutorAddress).toBe(account);
  });

  it("rejects a malformed accountFactoryId/relayerExecutorAddress when present", () => {
    expect(() =>
      readStellarConfig(source({ NEXT_PUBLIC_ACCOUNT_FACTORY_ID: "not-a-contract" })),
    ).toThrow(/NEXT_PUBLIC_ACCOUNT_FACTORY_ID/);
    expect(() =>
      readStellarConfig(source({ NEXT_PUBLIC_RELAYER_EXECUTOR_ADDRESS: "not-an-account" })),
    ).toThrow(/NEXT_PUBLIC_RELAYER_EXECUTOR_ADDRESS/);
  });

  it("reports every invalid key at once", () => {
    try {
      readStellarConfig(
        source({
          NEXT_PUBLIC_SMART_ACCOUNT_ID: "bad",
          NEXT_PUBLIC_POLICY_ENGINE_ID: "bad",
        }),
      );
      throw new Error("expected ConfigError");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).issues).toHaveLength(2);
    }
  });
});
