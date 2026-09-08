import { loadSmartAccountLinks } from "@/lib/stellarClient";
import type { SmartAccountLinks } from "@/lib/stellarClient";
import type { TreasuryRecord } from "@/lib/treasuryRegistry/types";

/** Claimed field -> the instance-storage field it must equal. `executorAddress`
 * and `deployTxHash` are deliberately absent; see the doc comment below. */
const CHECKED_FIELDS: Array<{
  claim: keyof TreasuryRecord;
  link: keyof SmartAccountLinks;
  label: string;
}> = [
  { claim: "ownerAddress", link: "owner", label: "owner" },
  { claim: "policyEngineId", link: "policyEngine", label: "policy engine" },
  { claim: "intentRegistryId", link: "intentRegistry", label: "intent registry" },
  { claim: "recoveryManagerId", link: "recoveryManager", label: "recovery manager" },
  { claim: "transferAdapterId", link: "transferAdapter", label: "transfer adapter" },
  { claim: "splitAdapterId", link: "splitAdapter", label: "split adapter" },
];

/**
 * The access control for treasury registration: rather than an admin token
 * (unlike `/api/relayer/*`), anyone claiming to have deployed a treasury must
 * prove it against the chain.
 *
 * This used to check only that the claimed owner matched
 * `smart_account.get_owner()`. That was not enough. A deploy transaction is
 * public, so its real owner and smart_account address are knowable by anyone
 * who watched the ledger -- an attacker could pass the owner check while
 * supplying a **fabricated** policy engine, intent registry, recovery manager
 * or adapter, and the dApp would then route that treasury's calls to contracts
 * of their choosing. The store's primary key stops two rows existing, but it
 * cannot tell which of two claimants is honest.
 *
 * So every address the dApp will later *call* is now checked against the
 * smart_account's own instance storage, which is where it records what it is
 * actually wired to. A fabricated claim no longer needs to lose a race to be
 * rejected; it is simply false.
 *
 * Two fields stay unverified, on purpose:
 *
 * - `executorAddress` lives in the intent_registry's storage, not the smart
 *   account's. It is checkable, at the cost of a second ledger read against a
 *   contract this function would first have to trust -- and a wrong executor
 *   cannot misdirect a call, it can only fail to service one.
 * - `deployTxHash` is audit metadata the dApp never calls. It is also not
 *   durably checkable: the transaction leaves the RPC's ~7 day history, after
 *   which no amount of reading can confirm it.
 */
export async function verifyTreasuryRegistration(record: TreasuryRecord): Promise<void> {
  const links = await loadSmartAccountLinks(record.smartAccountId);

  if (!links) {
    throw new Error(
      `Treasury registration could not be verified: no contract instance exists at ${record.smartAccountId}.`,
    );
  }

  const mismatches = CHECKED_FIELDS.filter(
    ({ claim, link }) => links[link] !== record[claim],
  ).map(
    ({ claim, link, label }) =>
      `${label} is ${links[link] ?? "unset"} on-chain, not the claimed ${String(record[claim])}`,
  );

  if (mismatches.length > 0) {
    throw new Error(
      `Treasury registration could not be verified for ${record.smartAccountId}: ${mismatches.join("; ")}.`,
    );
  }
}
