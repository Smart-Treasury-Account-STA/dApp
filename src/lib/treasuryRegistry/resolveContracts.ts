import { STELLAR_CONFIG } from '@/config'
import type { ContractSet } from '@/lib/env'
import { getTreasury, toContractSet } from '@/lib/treasuryRegistry/store'

/**
 * Resolves which treasury's contract set an id belongs to. The registry
 * (populated at deploy time, since no on-chain getter exposes a treasury's
 * pinned sub-contract addresses) is the source of truth for any
 * dApp-deployed treasury; the single env-configured default treasury isn't
 * in the registry at all (nothing ever registers it), so it's synthesized
 * directly from STELLAR_CONFIG when the smartAccountId matches it --
 * covering the default treasury with zero migration/seed step.
 *
 * Shared rather than duplicated: the relayer resolves a job's contracts this
 * way, and so does the authorization check that decides who may queue one.
 * Two copies would be two chances to forget the default treasury.
 */
export async function resolveTreasuryContracts(
  smartAccountId: string
): Promise<ContractSet> {
  if (smartAccountId === STELLAR_CONFIG.contracts.smartAccount) {
    return STELLAR_CONFIG.contracts
  }

  const treasury = await getTreasury(smartAccountId)
  if (!treasury) {
    throw new Error(
      `No registered treasury found for smart_account ${smartAccountId}.`
    )
  }
  return toContractSet(treasury, STELLAR_CONFIG.contracts.defaultAsset)
}
