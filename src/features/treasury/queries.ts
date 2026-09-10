'use client'

import { useQuery } from '@tanstack/react-query'

import { STELLAR_CONFIG } from '@/config'
import {
  fetchMyTreasuries,
  fetchTreasury,
} from '@/features/treasury/treasuryRegistryClient'
import type { ContractSet } from '@/lib/env'
import {
  loadAssetHolding,
  loadContextRules,
  loadOwner,
  loadScheduledIntents,
  loadTreasurySnapshot,
} from '@/lib/stellarClient'
import type { TreasuryAuthority } from '@/types'

// Keyed by both the connected wallet address AND the treasury's own
// smart_account id -- `address` alone identifies which key is reading, not
// which treasury's contracts are being read. One wallet operating more than
// one treasury would otherwise collide on the same cache entry.
export const treasuryKeys = {
  snapshot: (address: string, smartAccountId: string) =>
    ['treasury', 'snapshot', address, smartAccountId] as const,
  rules: (address: string, smartAccountId: string) =>
    ['treasury', 'rules', address, smartAccountId] as const,
  authority: (address: string, smartAccountId: string) =>
    ['treasury', 'authority', address, smartAccountId] as const,
  assetHolding: (address: string, holder: string, assetContractId: string) =>
    ['treasury', 'assetHolding', address, holder, assetContractId] as const,
  scheduledIntents: (address: string, intentRegistryId: string) =>
    ['treasury', 'scheduledIntents', address, intentRegistryId] as const,
}

export function useTreasurySnapshot(
  address: string | null,
  contracts: ContractSet = STELLAR_CONFIG.contracts
) {
  return useQuery({
    queryKey: treasuryKeys.snapshot(
      address ?? 'disconnected',
      contracts.smartAccount
    ),
    queryFn: () => loadTreasurySnapshot(address as string, contracts),
    enabled: address !== null,
    staleTime: 10_000,
    refetchInterval: 30_000,
  })
}

/**
 * The treasury's own balance and authorization for an asset — the token
 * contract's gate, which is checked before any policy this project owns and
 * is invisible in `TreasuryStatus`.
 *
 * Defaults to the treasury itself as holder, which is what every payment
 * screen needs: funds leave the smart account, never the connected wallet.
 */
export function useAssetHolding(
  address: string | null,
  contracts: ContractSet = STELLAR_CONFIG.contracts,
  holder?: string
) {
  const target = holder ?? contracts.smartAccount
  return useQuery({
    queryKey: treasuryKeys.assetHolding(
      address ?? 'disconnected',
      target,
      contracts.defaultAsset
    ),
    queryFn: () =>
      loadAssetHolding(address as string, target, contracts.defaultAsset),
    enabled: address !== null,
    staleTime: 15_000,
  })
}

/**
 * Every scheduled payment the registry still has creation events for.
 *
 * Keyed on the registry rather than the smart account: the ids come from that
 * contract's event stream, and two treasuries never share one. Not polled --
 * an intent's state changes only when someone creates, cancels, or executes
 * one, and each of those paths invalidates this key itself.
 */
export function useScheduledIntents(
  address: string | null,
  contracts: ContractSet = STELLAR_CONFIG.contracts
) {
  return useQuery({
    queryKey: treasuryKeys.scheduledIntents(
      address ?? 'disconnected',
      contracts.intentRegistry
    ),
    queryFn: () => loadScheduledIntents(address as string, contracts),
    enabled: address !== null,
    staleTime: 15_000,
  })
}

export function useContextRules(
  address: string | null,
  contracts: ContractSet = STELLAR_CONFIG.contracts
) {
  return useQuery({
    queryKey: treasuryKeys.rules(
      address ?? 'disconnected',
      contracts.smartAccount
    ),
    queryFn: () => loadContextRules(address as string, contracts),
    enabled: address !== null,
    staleTime: 30_000,
  })
}

export function useTreasury(smartAccountId: string | null) {
  return useQuery({
    queryKey: ['treasuries', 'one', smartAccountId ?? 'none'],
    queryFn: () => fetchTreasury(smartAccountId as string),
    enabled: smartAccountId !== null,
    staleTime: Infinity, // A deployed treasury's contract set never changes.
    retry: false,
  })
}

export function useMyTreasuries(ownerAddress: string | null) {
  return useQuery({
    queryKey: ['treasuries', 'mine', ownerAddress ?? 'disconnected'],
    queryFn: () => fetchMyTreasuries(ownerAddress as string),
    enabled: ownerAddress !== null,
    staleTime: 30_000,
  })
}

export function useTreasuryAuthority(
  address: string | null,
  contracts: ContractSet = STELLAR_CONFIG.contracts
) {
  return useQuery<TreasuryAuthority>({
    queryKey: treasuryKeys.authority(
      address ?? 'disconnected',
      contracts.smartAccount
    ),
    queryFn: async () => ({
      owner: await loadOwner(address as string, contracts),
      policyAdminHint: STELLAR_CONFIG.policyAdminHint ?? null,
    }),
    enabled: address !== null,
    staleTime: 30_000,
  })
}
