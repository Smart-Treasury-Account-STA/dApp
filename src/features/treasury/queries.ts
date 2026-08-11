"use client";

import { useQuery } from "@tanstack/react-query";

import { STELLAR_CONFIG } from "@/config";
import { loadContextRules, loadOwner, loadTreasurySnapshot } from "@/lib/stellarClient";
import type { TreasuryAuthority } from "@/types";

export const treasuryKeys = {
  snapshot: (address: string) => ["treasury", "snapshot", address] as const,
  rules: (address: string) => ["treasury", "rules", address] as const,
};

export function useTreasurySnapshot(address: string | null) {
  return useQuery({
    queryKey: treasuryKeys.snapshot(address ?? "disconnected"),
    queryFn: () => loadTreasurySnapshot(address as string),
    enabled: address !== null,
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
}

export function useContextRules(address: string | null) {
  return useQuery({
    queryKey: treasuryKeys.rules(address ?? "disconnected"),
    queryFn: () => loadContextRules(address as string),
    enabled: address !== null,
    staleTime: 30_000,
  });
}

export function useTreasuryAuthority(address: string | null) {
  return useQuery<TreasuryAuthority>({
    queryKey: ["treasury", "authority", address ?? "disconnected"],
    queryFn: async () => ({
      owner: await loadOwner(address as string),
      policyAdminHint: STELLAR_CONFIG.policyAdminHint ?? null,
    }),
    enabled: address !== null,
    staleTime: 30_000,
  });
}
