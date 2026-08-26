import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/config", () => ({
  STELLAR_CONFIG: {
    contracts: { staAsset: "CSTAASSET0000000000000000000000000000000000000000000000" },
  },
}));

const loadOwnerMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/stellarClient", () => ({ loadOwner: loadOwnerMock }));

import { verifyTreasuryOwnership } from "@/lib/treasuryRegistry/verify";
import type { TreasuryRecord } from "@/lib/treasuryRegistry/types";

const SMART_ACCOUNT_ID = "CD6GY4UUTNPW4TUV7LDL5SELN4BBHJG4KDDT3W6G23DY6XCGM75MULMQ";
const OWNER = "GCWFJKLE45TMVZS42TMIYKAORKGBWE74753YPOSCC5ESJR2G2UMBXBDB";
const SOMEONE_ELSE = "GDU3LDGZOCJIB6MIKQWK5AICFFEWVC2FJ2BDEVXG37XXSKWIZ7OXVCAS";

function record(overrides: Partial<TreasuryRecord> = {}): TreasuryRecord {
  return {
    smartAccountId: SMART_ACCOUNT_ID,
    policyEngineId: "CCOP7NRMST5K6TL7FBDMX25LDEPW3DSFBOGBIKVFIDNAAZY7GBMVP3M4",
    intentRegistryId: "CAFIATSIZQSBILZJWVT4PVDXPVITJHLP6LPAVKDRHCA7I7XPZSLTRPUS",
    recoveryManagerId: "CCHC4YKVYS3CAZUOUYWYTEMQ6TZDW75WB2BGENUC2CDWDX5RH7NMKZWU",
    transferAdapterId: "CBRYGIR3ORDW5LE6J7AVPSKRNTMRUYHD6FVPHQMJGPQLQ5FQUZ2U6GFH",
    splitAdapterId: "CBQA7UI7QN6RN4IZT7WPDHWTK2OO7J4FH2KMCVJGKMKVFGDURD63UQ7U",
    ownerAddress: OWNER,
    executorAddress: "GBFOESUTANPJZVQUZVKC5YCS4FB6AE5SX2R3JEDRK5JHKR22JXV4VNIV",
    deployTxHash: "a".repeat(64),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  loadOwnerMock.mockReset();
});

describe("verifyTreasuryOwnership", () => {
  it("resolves without throwing when the on-chain owner matches the claimed owner", async () => {
    loadOwnerMock.mockResolvedValue(OWNER);
    await expect(verifyTreasuryOwnership(record())).resolves.toBeUndefined();
    expect(loadOwnerMock).toHaveBeenCalledWith(
      OWNER,
      expect.objectContaining({ smartAccount: SMART_ACCOUNT_ID }),
    );
  });

  it("throws when the on-chain owner does not match the claimed owner", async () => {
    loadOwnerMock.mockResolvedValue(SOMEONE_ELSE);
    await expect(verifyTreasuryOwnership(record())).rejects.toThrow(/could not be verified/i);
  });

  it("throws when the contract has no owner at all (e.g. not actually initialized)", async () => {
    loadOwnerMock.mockResolvedValue(null);
    await expect(verifyTreasuryOwnership(record())).rejects.toThrow(/could not be verified/i);
  });
});
