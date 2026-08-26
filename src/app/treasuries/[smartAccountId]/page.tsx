"use client";

import { useParams } from "next/navigation";
import Link from "next/link";

import { STELLAR_CONFIG } from "@/config";
import { TreasuryConsole } from "@/features/treasury/treasury-console";
import { useTreasury } from "@/features/treasury/queries";
import { toContractSet } from "@/lib/treasuryRegistry/types";

export default function TreasuryConsolePage() {
  const params = useParams<{ smartAccountId: string }>();
  const smartAccountId = params.smartAccountId;
  const treasuryQuery = useTreasury(smartAccountId);

  if (treasuryQuery.isPending) {
    return (
      <main className="grid min-h-screen place-items-center bg-background text-foreground">
        <p className="text-sm text-muted-foreground">Loading treasury…</p>
      </main>
    );
  }

  if (treasuryQuery.isError || !treasuryQuery.data) {
    return (
      <main className="grid min-h-screen place-items-center gap-3 bg-background p-6 text-center text-foreground">
        <p className="text-sm text-muted-foreground">
          No registered treasury was found for <code className="text-xs">{smartAccountId}</code>.
        </p>
        <Link className="text-sm underline" href="/treasuries">
          Back to My Treasuries
        </Link>
      </main>
    );
  }

  const contracts = toContractSet(treasuryQuery.data, STELLAR_CONFIG.contracts.staAsset);
  return <TreasuryConsole contracts={contracts} />;
}
