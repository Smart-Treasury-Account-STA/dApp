import { STELLAR_CONFIG } from "@/config";
import { loadOwner } from "@/lib/stellarClient";
import { toContractSet } from "@/lib/treasuryRegistry/store";
import type { TreasuryRecord } from "@/lib/treasuryRegistry/types";

/**
 * The access control for treasury registration: rather than an admin
 * token (unlike `/api/relayer/*`), anyone claiming to have deployed a
 * treasury must prove it by having their claimed owner address actually
 * match `smart_account.get_owner()` on-chain. A caller who didn't deploy
 * the claimed contract can't produce a matching read.
 *
 * Uses the claimed owner's own address as the simulation's fee-source
 * account -- it's guaranteed to be a real, funded testnet account, since it
 * just signed the live `deploy_account` transaction that produced this
 * record.
 */
export async function verifyTreasuryOwnership(record: TreasuryRecord): Promise<void> {
  const contracts = toContractSet(record, STELLAR_CONFIG.contracts.staAsset);
  const owner = await loadOwner(record.ownerAddress, contracts);

  if (owner !== record.ownerAddress) {
    throw new Error(
      `Treasury ownership could not be verified: smart_account.get_owner() at ${record.smartAccountId} returned ${owner ?? "null"}, not the claimed owner ${record.ownerAddress}.`,
    );
  }
}
