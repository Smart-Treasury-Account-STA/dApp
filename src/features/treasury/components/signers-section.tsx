"use client";

import { KeyRound, ShieldCheck, Trash2, UserPlus } from "lucide-react";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { truncateAddress } from "@/lib/format";
import { describeReceipt } from "@/lib/receipt";
import { loadSignerId } from "@/lib/stellarClient";
import { addSignerOperation, removeSignerOperation } from "@/lib/treasuryWrites";
import { executeWriteOperation, walletSigner } from "@/lib/writeAuth";
import {
  isSelfRemoval,
  signerRemovalBlock,
  validateSignerDraft,
} from "@/features/treasury/writeDrafts";
import { FormField, SectionHeader } from "@/features/treasury/components/primitives";
import { useContextRules, useTreasuryAuthority } from "@/features/treasury/queries";
import type { ContextRule, SimulationResult, WalletState } from "@/types";

export function SignersSection({
  onNotice,
  wallet,
}: {
  onNotice: (notice: SimulationResult | null) => void;
  wallet: WalletState;
}) {
  const queryClient = useQueryClient();
  const [signerAddress, setSignerAddress] = useState("");
  const [pendingRemoval, setPendingRemoval] = useState<number | null>(null);

  const rulesQuery = useContextRules(wallet.address);
  const authorityQuery = useTreasuryAuthority(wallet.address);
  const rules = rulesQuery.data ?? [];
  const rootRule: ContextRule | undefined = rules[0];

  const isOwner =
    authorityQuery.data?.owner != null && authorityQuery.data.owner === wallet.address;

  const addMutation = useMutation({
    mutationFn: async () => {
      if (!wallet.address) throw new Error("Connect a wallet first.");
      if (!rootRule) throw new Error("No context rule is available.");
      validateSignerDraft({ signerAddress });
      return executeWriteOperation(
        addSignerOperation({ contextRuleId: rootRule.id, signerAddress }),
        walletSigner(wallet.address),
      );
    },
    onSuccess: (receipt) => {
      onNotice(
        describeReceipt(receipt, {
          confirmedTitle: "Signer added",
          submittedTitle: "Signer submission sent",
        }),
      );
      setSignerAddress("");
      void queryClient.invalidateQueries({ queryKey: ["treasury"] });
    },
    onError: (error) => {
      onNotice({
        ok: false,
        title: "Could not add signer",
        detail: error instanceof Error ? error.message : String(error),
      });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (address: string) => {
      if (!wallet.address) throw new Error("Connect a wallet first.");
      if (!rootRule) throw new Error("No context rule is available.");
      const signerId = await loadSignerId(wallet.address, address);
      const block = signerRemovalBlock(rootRule, rootRule.signerAddresses.indexOf(address));
      if (block) throw new Error(block);
      return executeWriteOperation(
        removeSignerOperation({ contextRuleId: rootRule.id, signerId }),
        walletSigner(wallet.address),
      );
    },
    onSuccess: (receipt) => {
      onNotice(
        describeReceipt(receipt, {
          confirmedTitle: "Signer revoked",
          submittedTitle: "Signer revocation submitted",
        }),
      );
      setPendingRemoval(null);
      void queryClient.invalidateQueries({ queryKey: ["treasury"] });
    },
    onError: (error) => {
      onNotice({
        ok: false,
        title: "Could not revoke signer",
        detail: error instanceof Error ? error.message : String(error),
      });
      setPendingRemoval(null);
    },
  });

  return (
    <section id="signers" className="rounded-xl border border-border bg-card p-6">
      <SectionHeader
        eyebrow="SmartAccount authorization"
        icon={<ShieldCheck className="text-primary" size={22} />}
        title="Signers and rules"
      />

      {!wallet.address ? (
        <p className="text-sm text-muted-foreground">
          Connect a wallet to read the signer set.
        </p>
      ) : (
        <>
          <p className="mb-4 text-sm text-muted-foreground">
            {isOwner
              ? "This wallet is the treasury owner."
              : `Treasury owner is ${truncateAddress(authorityQuery.data?.owner)}. Writes signed by another key will be rejected on submission.`}
          </p>

          {rules.map((rule) => (
            <div key={rule.id} className="mb-4 rounded-lg border border-border p-4">
              <div className="mb-2 flex items-center justify-between">
                <strong className="text-sm">
                  Rule {rule.id} · {rule.name}
                </strong>
                <span className="text-xs text-muted-foreground">{rule.contextType}</span>
              </div>
              {rule.signerAddresses.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No delegated signer addresses could be read for this rule.
                </p>
              ) : (
                <ul className="grid gap-2">
                  {rule.signerAddresses.map((address, index) => {
                    const block = signerRemovalBlock(rule, index);
                    const self = isSelfRemoval(rule, index, wallet.address);
                    return (
                      <li
                        key={address}
                        className="flex items-center justify-between gap-2 text-sm"
                      >
                        <span className="flex items-center gap-2">
                          <KeyRound className="size-4" />
                          <code className="text-xs">{truncateAddress(address)}</code>
                          {self ? (
                            <span className="text-xs text-muted-foreground">(this wallet)</span>
                          ) : null}
                        </span>
                        {block ? (
                          <span className="text-xs text-muted-foreground">{block}</span>
                        ) : pendingRemoval === index ? (
                          <span className="flex gap-2">
                            <Button
                              onClick={() => removeMutation.mutate(address)}
                              disabled={removeMutation.isPending}
                            >
                              {self ? "Remove my own key" : "Confirm revoke"}
                            </Button>
                            <Button onClick={() => setPendingRemoval(null)}>Cancel</Button>
                          </span>
                        ) : (
                          <Button onClick={() => setPendingRemoval(index)}>
                            <Trash2 className="size-4" /> Revoke
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ))}

          <div className="grid gap-3">
            <FormField
              label="New delegated signer"
              onChange={setSignerAddress}
              value={signerAddress}
            />
            <Button
              onClick={() => addMutation.mutate()}
              disabled={addMutation.isPending || signerAddress.length === 0}
            >
              <UserPlus className="size-4" />
              {addMutation.isPending ? "Awaiting wallet…" : "Add signer"}
            </Button>
            <p className="text-xs text-muted-foreground">
              Simulation cannot confirm authorization. The wallet signature is what proves it.
            </p>
          </div>
        </>
      )}
    </section>
  );
}
