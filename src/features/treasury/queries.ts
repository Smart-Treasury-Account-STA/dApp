"use client";

import { useQuery } from "@tanstack/react-query";

import { loadContextRules, loadTreasurySnapshot } from "@/lib/stellarClient";

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
