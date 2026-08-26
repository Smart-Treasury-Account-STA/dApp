"use client";

import { Loader2, ShieldAlert, ShieldCheck, UserPlus } from "lucide-react";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { STELLAR_CONFIG } from "@/config";
import type { ContractSet } from "@/lib/env";
import { truncateAddress } from "@/lib/format";
import { describeReceipt } from "@/lib/receipt";
import { checkIsGuardian } from "@/lib/stellarClient";
import { addGuardianOperation } from "@/lib/treasuryWrites";
import { executeWriteOperation, walletSigner } from "@/lib/writeAuth";
import { validateGuardianDraft } from "@/features/treasury/writeDrafts";
import { FormField, SectionHeader } from "@/features/treasury/components/primitives";
import { useTreasuryAuthority } from "@/features/treasury/queries";
import type { SimulationResult, WalletState } from "@/types";

export function GuardiansSection({
  contracts = STELLAR_CONFIG.contracts,
  onNotice,
  wallet,
}: {
  contracts?: ContractSet;
  onNotice: (notice: SimulationResult | null) => void;
  wallet: WalletState;
}) {
  const authorityQuery = useTreasuryAuthority(wallet.address, contracts);
  const [guardianAddress, setGuardianAddress] = useState("");
  const [checkAddress, setCheckAddress] = useState("");
  const [checkResult, setCheckResult] = useState<boolean | null>(null);

  const isOwner =
    authorityQuery.data?.owner != null && authorityQuery.data.owner === wallet.address;

  const addMutation = useMutation({
    mutationFn: async () => {
      if (!wallet.address) throw new Error("Connect a wallet first.");
      validateGuardianDraft({ guardian: guardianAddress });
      return executeWriteOperation(
        addGuardianOperation({ guardian: guardianAddress, contracts }),
        walletSigner(wallet.address),
        contracts,
      );
    },
    onSuccess: (receipt) => {
      onNotice(
        describeReceipt(receipt, {
          confirmedTitle: "Guardian registered",
          submittedTitle: "Guardian registration submitted",
        }),
      );
      setGuardianAddress("");
    },
    onError: (error) => {
      onNotice({
        ok: false,
        title: "Could not register guardian",
        detail: error instanceof Error ? error.message : String(error),
      });
    },
  });

  const checkMutation = useMutation({
    mutationFn: async () => {
      if (!wallet.address) throw new Error("Connect a wallet first.");
      validateGuardianDraft({ guardian: checkAddress });
      return checkIsGuardian(wallet.address, checkAddress, contracts);
    },
    onSuccess: (result) => setCheckResult(result),
    onError: (error) => {
      setCheckResult(null);
      onNotice({
        ok: false,
        title: "Guardian check failed",
        detail: error instanceof Error ? error.message : String(error),
      });
    },
  });

  return (
    <section id="guardians" className="rounded-xl border border-border bg-card p-6">
      <SectionHeader
        eyebrow="RecoveryManager"
        icon={<ShieldAlert className="text-primary" size={22} />}
        title="Guardians"
      />

      <p className="mb-4 text-xs text-muted-foreground">
        A freshly deployed treasury has zero guardians — recovery is unusable until at least
        one is added. Adding a guardian is admin-gated (the same key as Owner/Policy Admin
        under a Tier 1 deploy). A newly added guardian activates in about a day
        (<code>GUARDIAN_ACTIVATION_DELAY_LEDGERS</code>), not immediately — this call only
        registers it.
      </p>

      {!wallet.address ? (
        <p className="text-sm text-muted-foreground">Connect a wallet to manage guardians.</p>
      ) : (
        <>
          <p className="mb-4 text-sm text-muted-foreground">
            {isOwner
              ? "This wallet is the treasury owner and can register guardians."
              : `Treasury owner is ${truncateAddress(authorityQuery.data?.owner)}. A write signed by another key will be rejected on submission.`}
          </p>

          <div className="grid gap-3">
            <FormField
              label="Guardian address"
              onChange={setGuardianAddress}
              value={guardianAddress}
            />
            <Button
              onClick={() => addMutation.mutate()}
              disabled={addMutation.isPending || guardianAddress.length === 0}
            >
              {addMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <UserPlus className="size-4" />
              )}
              {addMutation.isPending ? "Awaiting wallet…" : "Add guardian"}
            </Button>
          </div>

          <div className="mt-6 grid gap-3 border-t border-border pt-4">
            <FormField label="Check an address" onChange={setCheckAddress} value={checkAddress} />
            <Button
              onClick={() => checkMutation.mutate()}
              disabled={checkMutation.isPending || checkAddress.length === 0}
              variant="secondary"
            >
              <ShieldCheck className="size-4" />
              {checkMutation.isPending ? "Checking…" : "Check is_guardian"}
            </Button>
            {checkResult !== null ? (
              <p className="text-sm text-muted-foreground">
                {checkResult ? "This address is a registered guardian." : "This address is not a registered guardian."}
              </p>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}
