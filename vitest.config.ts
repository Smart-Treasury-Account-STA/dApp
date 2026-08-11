import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // `src/config.ts` validates the public Stellar configuration at import
    // time and throws when it is incomplete, so any test that transitively
    // imports it needs a valid set. These mirror `.env.example`.
    env: {
      NEXT_PUBLIC_STELLAR_RPC_URL: "https://soroban-testnet.stellar.org",
      NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
      NEXT_PUBLIC_STELLAR_EXPLORER_URL: "https://stellar.expert/explorer/testnet",
      NEXT_PUBLIC_SMART_ACCOUNT_ID:
        "CB4KZJ3I4XANE6GWPAMXCNXQ34PTQWPXVKFBBMLNKV25GAOXQC7RQUMS",
      NEXT_PUBLIC_POLICY_ENGINE_ID:
        "CC5FSUNWBNH3EIEELHO3A4ZPJZRAZCVMFNP3PVXO2YBWDNNLTFLWBVHC",
      NEXT_PUBLIC_INTENT_REGISTRY_ID:
        "CDHTNPBXUMPCKUJ76HQ767MDRD4IVRRH4H5DOF4JUOO36QKSV4GXFRMR",
      NEXT_PUBLIC_RECOVERY_MANAGER_ID:
        "CALI5XJASA66LKZPF3ZF7HOLGOFUWZYIHB6SENXCZ5Y7QVT7UQKKR6UM",
      NEXT_PUBLIC_TRANSFER_ADAPTER_ID:
        "CAX766XYR56WO7Y4HFOHYQUO5AIN5QLHAHKJ3DINXM2WUQY5UE7KGE26",
      NEXT_PUBLIC_SPLIT_ADAPTER_ID:
        "CAFTFU2E4MGZT6BLCVN2FAQB6GIBJRR5ICI7C7LZEMACBDUUTQKVHHV3",
      NEXT_PUBLIC_STA_ASSET_CONTRACT_ID:
        "CCOUVA654JH2V6B7LNTKHJP5DF3QA553RS2IIWXSGPDFH2N3QILIVU5L",
      NEXT_PUBLIC_TEST_RECIPIENT:
        "GAK3XILRBYBMBOCZMSLL2CLR6WPQLEIOC6ZCYYPTE4OIAX3PCFFO2YMU",
    },
  },
});
