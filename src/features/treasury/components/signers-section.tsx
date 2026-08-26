"use client";

import { KeyRound, Loader2, ShieldCheck, Trash2, UserPlus } from "lucide-react";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { STELLAR_CONFIG } from "@/config";
import type { ContractSet } from "@/lib/env";
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
  contracts = STELLAR_CONFIG.contracts,
  onNotice,
  wallet,
}: {
  contracts?: ContractSet;
  onNotice: (notice: SimulationResult | null) => void;
  wallet: WalletState;
}) {
  const queryClient = useQueryClient();
  const [signerAddress, setSignerAddress] = useState("");
  const [selectedRuleId, setSelectedRuleId] = useState<number | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<{ ruleId: number; index: number } | null>(
    null,
  );

  const rulesQuery = useContextRules(wallet.address, contracts);
  const authorityQuery = useTreasuryAuthority(wallet.address, contracts);
  const rules = rulesQuery.data ?? [];
  // add_signer's context_rule_id is a required contract argument, not a UI
  // convenience — there is no default rule, so the target rule must be an id
  // that actually exists on-chain. Rule ids can have gaps after a removal
  // (DAPP_INTEGRATION_SPEC.md §4), so this falls back to whichever real rule
  // sorts first rather than assuming id 0 exists.
  const targetRule: ContextRule | undefined =
    rules.find((rule) => rule.id === selectedRuleId) ?? rules[0];

  const isOwner =
    authorityQuery.data?.owner != null && authorityQuery.data.owner === wallet.address;

  const addMutation = useMutation({
    mutationFn: async () => {
      if (!wallet.address) throw new Error("Connect a wallet first.");
      if (!targetRule) throw new Error("No context rule is available.");
      validateSignerDraft({ signerAddress });
      return executeWriteOperation(
        addSignerOperation({ contextRuleId: targetRule.id, signerAddress, contracts }),
        walletSigner(wallet.address),
        contracts,
      );
    },
    onSuccess: async (receipt) => {
      onNotice(
        describeReceipt(receipt, {
          confirmedTitle: "Signer added",
          submittedTitle: "Signer submission sent",
        }),
      );
      setSignerAddress("");
      // Refetch the two queries this section actually renders directly,
      // rather than relying on invalidateQueries' prefix match to reach an
      // active observer — the write already waited for on-chain confirmation
      // (or its ~3 minute ceiling), so the read that follows should reflect
      // it immediately, not on the next 30s staleTime tick.
      await Promise.all([rulesQuery.refetch(), authorityQuery.refetch()]);
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
    mutationFn: async ({ rule, address }: { rule: ContextRule; address: string }) => {
      if (!wallet.address) throw new Error("Connect a wallet first.");
      const signerId = await loadSignerId(wallet.address, address, contracts);
      const block = signerRemovalBlock(rule, rule.signerAddresses.indexOf(address));
      if (block) throw new Error(block);
      return executeWriteOperation(
        removeSignerOperation({ contextRuleId: rule.id, signerId, contracts }),
        walletSigner(wallet.address),
        contracts,
      );
    },
    onSuccess: async (receipt) => {
      onNotice(
        describeReceipt(receipt, {
          confirmedTitle: "Signer revoked",
          submittedTitle: "Signer revocation submitted",
        }),
      );
      setPendingRemoval(null);
      await Promise.all([rulesQuery.refetch(), authorityQuery.refetch()]);
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
                        ) : pendingRemoval?.ruleId === rule.id && pendingRemoval.index === index ? (
                          <span className="flex gap-2">
                            <Button
                              onClick={() => removeMutation.mutate({ rule, address })}
                              disabled={removeMutation.isPending}
                            >
                              {removeMutation.isPending ? (
                                <Loader2 className="size-4 animate-spin" />
                              ) : null}
                              {self ? "Remove my own key" : "Confirm revoke"}
                            </Button>
                            <Button onClick={() => setPendingRemoval(null)}>Cancel</Button>
                          </span>
                        ) : (
                          <Button onClick={() => setPendingRemoval({ ruleId: rule.id, index })}>
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
            <div className="grid gap-2">
              <Label>Context rule</Label>
              <Select
                value={targetRule ? String(targetRule.id) : ""}
                onChange={(event) => setSelectedRuleId(Number(event.target.value))}
                disabled={rules.length === 0}
              >
                {rules.length === 0 ? <option value="">No context rule is loaded yet.</option> : null}
                {rules.map((rule) => (
                  <option key={rule.id} value={rule.id}>
                    Rule {rule.id} · {rule.name} ({rule.signerAddresses.length} signer
                    {rule.signerAddresses.length === 1 ? "" : "s"})
                  </option>
                ))}
              </Select>
            </div>
            <FormField
              label="New delegated signer"
              onChange={setSignerAddress}
              value={signerAddress}
            />
            <Button
              onClick={() => addMutation.mutate()}
              disabled={addMutation.isPending || signerAddress.length === 0 || !targetRule}
            >
              {addMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <UserPlus className="size-4" />
              )}
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
