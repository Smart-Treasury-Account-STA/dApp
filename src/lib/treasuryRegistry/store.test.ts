import { beforeEach, describe, expect, it, vi } from "vitest";

const fsState = vi.hoisted(() => ({ file: null as string | null }));

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(async () => undefined),
  readFile: vi.fn(async () => {
    if (fsState.file === null) {
      const error = new Error("ENOENT") as NodeJS.ErrnoException;
      error.code = "ENOENT";
      throw error;
    }
    return fsState.file;
  }),
  writeFile: vi.fn(async (_path: string, contents: string) => {
    fsState.file = contents;
  }),
  rename: vi.fn(async () => undefined),
}));

import {
  createTreasury,
  getTreasury,
  listTreasuries,
  listTreasuriesByOwner,
  toContractSet,
  TreasuryConflictError,
  validateCreateTreasuryInput,
} from "@/lib/treasuryRegistry/store";
import type { CreateTreasuryInput } from "@/lib/treasuryRegistry/types";

// Real testnet addresses (distinct contract instances / accounts) --
// StrKey validates a real base32 checksum, not just the leading character,
// so a synthetic "C" + padding string fails validation.
const CONTRACTS = {
  SMART: "CD6GY4UUTNPW4TUV7LDL5SELN4BBHJG4KDDT3W6G23DY6XCGM75MULMQ",
  SMART2: "CB4KZJ3I4XANE6GWPAMXCNXQ34PTQWPXVKFBBMLNKV25GAOXQC7RQUMS",
  A: "CCOP7NRMST5K6TL7FBDMX25LDEPW3DSFBOGBIKVFIDNAAZY7GBMVP3M4",
  B: "CAFIATSIZQSBILZJWVT4PVDXPVITJHLP6LPAVKDRHCA7I7XPZSLTRPUS",
  C: "CCHC4YKVYS3CAZUOUYWYTEMQ6TZDW75WB2BGENUC2CDWDX5RH7NMKZWU",
  POLICY: "CBRYGIR3ORDW5LE6J7AVPSKRNTMRUYHD6FVPHQMJGPQLQ5FQUZ2U6GFH",
  INTENT: "CBQA7UI7QN6RN4IZT7WPDHWTK2OO7J4FH2KMCVJGKMKVFGDURD63UQ7U",
  RECOVERY: "CAQQTRRYNXIQGFVNCTMTBJDXW3PN7O44KPT7GWCCE4FRKTOHDBCWGUZO",
  XFER: "CC5FSUNWBNH3EIEELHO3A4ZPJZRAZCVMFNP3PVXO2YBWDNNLTFLWBVHC",
  SPLIT: "CDHTNPBXUMPCKUJ76HQ767MDRD4IVRRH4H5DOF4JUOO36QKSV4GXFRMR",
  STA: "CCOUVA654JH2V6B7LNTKHJP5DF3QA553RS2IIWXSGPDFH2N3QILIVU5L",
} as const;
const ACCOUNTS = {
  OWNER: "GCWFJKLE45TMVZS42TMIYKAORKGBWE74753YPOSCC5ESJR2G2UMBXBDB",
  OWNER1: "GDU3LDGZOCJIB6MIKQWK5AICFFEWVC2FJ2BDEVXG37XXSKWIZ7OXVCAS",
  OWNER2: "GDXVIRLSBDKT7EZM2RM3FH26W3TPF77IJ7GZBA5IOA6ZJBTW26NNO3AV",
  DIFFERENT: "GAK3XILRBYBMBOCZMSLL2CLR6WPQLEIOC6ZCYYPTE4OIAX3PCFFO2YMU",
  NOBODY: "GBR3Q5ZGBZC5IIUAWMNDXNMWWTISFRNVKCIOO5L7U44GOZJMOVR467VM",
  EXEC: "GBFOESUTANPJZVQUZVKC5YCS4FB6AE5SX2R3JEDRK5JHKR22JXV4VNIV",
} as const;

function input(overrides: Partial<CreateTreasuryInput> = {}): CreateTreasuryInput {
  return {
    smartAccountId: CONTRACTS.SMART,
    policyEngineId: CONTRACTS.POLICY,
    intentRegistryId: CONTRACTS.INTENT,
    recoveryManagerId: CONTRACTS.RECOVERY,
    transferAdapterId: CONTRACTS.XFER,
    splitAdapterId: CONTRACTS.SPLIT,
    ownerAddress: ACCOUNTS.OWNER,
    executorAddress: ACCOUNTS.EXEC,
    deployTxHash: "a".repeat(64),
    ...overrides,
  };
}

beforeEach(() => {
  fsState.file = null;
});

describe("validateCreateTreasuryInput", () => {
  it("accepts a well formed input", () => {
    expect(() => validateCreateTreasuryInput(input())).not.toThrow();
  });

  it("rejects a malformed contract id", () => {
    expect(() => validateCreateTreasuryInput(input({ smartAccountId: "not-a-contract" }))).toThrow(
      /smartAccountId/,
    );
  });

  it("rejects a malformed owner address", () => {
    expect(() => validateCreateTreasuryInput(input({ ownerAddress: "not-an-account" }))).toThrow(
      /ownerAddress/,
    );
  });

  it("rejects a malformed deploy tx hash", () => {
    expect(() => validateCreateTreasuryInput(input({ deployTxHash: "short" }))).toThrow(
      /deployTxHash/,
    );
  });
});

describe("createTreasury", () => {
  it("persists a new record and returns it", async () => {
    const record = await createTreasury(input());
    expect(record.smartAccountId).toBe(CONTRACTS.SMART);
    expect(record.createdAt).toBeTruthy();

    const stored = await getTreasury(CONTRACTS.SMART);
    expect(stored).toEqual(record);
  });

  it("is idempotent by smartAccountId — an identical second create returns the original record unchanged", async () => {
    const first = await createTreasury(input());
    const second = await createTreasury(input());

    expect(second).toEqual(first);
    const all = await listTreasuries();
    expect(all).toHaveLength(1);
  });

  it("rejects a second claim for an already-registered smartAccountId whose fields disagree with the stored record", async () => {
    // The registration endpoint's access control (verifyTreasuryOwnership)
    // can only confirm the claimed owner matches on-chain get_owner() -- it
    // cannot verify the claimed sub-contract addresses are the *real* ones
    // pinned to this smart_account (no on-chain getter exists for that). A
    // silent idempotent-return here would let a fabricated second claim win
    // a race against the legitimate deployer's own registration and stick
    // around undetected -- this must reject loudly instead.
    await createTreasury(input());
    await expect(createTreasury(input({ ownerAddress: ACCOUNTS.DIFFERENT }))).rejects.toThrow(
      TreasuryConflictError,
    );

    const stored = await getTreasury(CONTRACTS.SMART);
    expect(stored?.ownerAddress).toBe(ACCOUNTS.OWNER);
  });

  it("does not collide across two different treasuries", async () => {
    await createTreasury(input());
    await createTreasury(input({ smartAccountId: CONTRACTS.SMART2 }));

    const all = await listTreasuries();
    expect(all).toHaveLength(2);
  });
});

describe("listTreasuriesByOwner", () => {
  it("returns only treasuries owned by the given address", async () => {
    await createTreasury(input({ smartAccountId: CONTRACTS.A, ownerAddress: ACCOUNTS.OWNER1 }));
    await createTreasury(input({ smartAccountId: CONTRACTS.B, ownerAddress: ACCOUNTS.OWNER2 }));
    await createTreasury(input({ smartAccountId: CONTRACTS.C, ownerAddress: ACCOUNTS.OWNER1 }));

    const owner1Treasuries = await listTreasuriesByOwner(ACCOUNTS.OWNER1);
    expect(owner1Treasuries.map((t) => t.smartAccountId).sort()).toEqual(
      [CONTRACTS.A, CONTRACTS.C].sort(),
    );
  });

  it("returns an empty list for an owner with no treasuries", async () => {
    await createTreasury(input());
    expect(await listTreasuriesByOwner(ACCOUNTS.NOBODY)).toEqual([]);
  });
});

describe("toContractSet", () => {
  it("maps a record's *Id fields to ContractSet's field names, and takes staAsset separately", async () => {
    const record = await createTreasury(input());
    const contracts = toContractSet(record, CONTRACTS.STA);

    expect(contracts).toEqual({
      smartAccount: record.smartAccountId,
      policyEngine: record.policyEngineId,
      intentRegistry: record.intentRegistryId,
      recoveryManager: record.recoveryManagerId,
      transferAdapter: record.transferAdapterId,
      splitAdapter: record.splitAdapterId,
      staAsset: CONTRACTS.STA,
    });
  });
});
