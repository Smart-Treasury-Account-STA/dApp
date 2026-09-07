"use client";

import { KeyRound, Loader2, Plus, ShieldCheck, Trash2, UserPlus } from "lucide-react";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { STELLAR_CONFIG } from "@/config";
import type { ContractSet } from "@/lib/env";
import { explainSmartAccountError, truncateAddress } from "@/lib/format";
import { describeReceipt } from "@/lib/receipt";
import { loadSignerId, simulateWriteOperation } from "@/lib/stellarClient";
import { computeWeakestRule } from "@/lib/treasurySecurity";
import {
  addContextRuleOperation,
  addSignerOperation,
  removeContextRuleOperation,
  removeSignerOperation,
} from "@/lib/treasuryWrites";
import type { WriteOperation } from "@/lib/treasuryWrites";
import { collectWriteWarnings } from "@/lib/writeWarnings";
import { executeWriteOperation, walletSigner } from "@/lib/writeAuth";
import {
  isSelfRemoval,
  ruleRemovalBlock,
  signerRemovalBlock,
  validateContextRuleDraft,
  validateSignerDraft,
} from "@/features/treasury/writeDrafts";
import { FormField, SectionHeader } from "@/features/treasury/components/primitives";
import { WriteConfirmDialog } from "@/features/treasury/components/write-confirm-dialog";
import type { StagedWrite } from "@/features/treasury/components/write-confirm-dialog";
import { useContextRules, useTreasuryAuthority } from "@/features/treasury/queries";
import type { ContextRule, SimulationResult, WalletState } from "@/types";

/** `add_signer`/`remove_signer` reject with a raw `smart_account`
 * (SmartAccountError) code -- explainSmartAccountError translates it;
 * anything else (validation errors like "Connect a wallet first.",
 * network failures) passes through unchanged since it's already a plain
 * sentence. */
function describeSignerError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return explainSmartAccountError(error.message) ?? error.message;
}

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
  const [newRuleName, setNewRuleName] = useState("");
  const [newRuleSigner, setNewRuleSigner] = useState("");
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

  // Staged operation awaiting confirmation. The spec's pipeline is
  // validate -> guard -> simulate -> confirm -> sign -> submit; nothing reaches
  // the wallet until the operator has seen the summary and its consequences.
  const [pending, setPending] = useState<StagedWrite | null>(null);

  const stageMutation = useMutation({
    mutationFn: async (input: { operation: WriteOperation; targetRule?: ContextRule }) => {
      if (!wallet.address) throw new Error("Connect a wallet first.");
      await simulateWriteOperation(input.operation, wallet.address);
      return {
        operation: input.operation,
        warnings: collectWriteWarnings(input.operation, {
          currentVersion: 1, // signer/rule writes don't touch policy version -- see collectWriteWarnings' own checks, all gated on functionName
          pinnedVersions: [],
          connectedAddress: wallet.address,
          ownerAddress: authorityQuery.data?.owner ?? null,
          targetRule: input.targetRule,
          allRules: rules,
        }),
      };
    },
    onSuccess: (staged) => setPending(staged),
    onError: (error) =>
      onNotice({
        ok: false,
        title: "Write rejected before signing",
        detail: describeSignerError(error),
      }),
  });

  // The sole submit path for every staged signer write (add or remove --
  // see task-6's ruling: one generic submit mutation, not one per operation
  // kind). `functionName` rides along on the mutation's return value purely
  // so onSuccess can pick an accurate notice title; the submit call itself
  // doesn't care which operation it's signing.
  const addMutation = useMutation({
    mutationFn: async () => {
      if (!wallet.address) throw new Error("Connect a wallet first.");
      if (!pending) throw new Error("Nothing is staged to submit.");
      const receipt = await executeWriteOperation(
        pending.operation,
        walletSigner(wallet.address),
        contracts,
      );
      return { receipt, functionName: pending.operation.functionName };
    },
    onSuccess: async ({ receipt, functionName }) => {
      const titles =
        functionName === "remove_signer"
          ? { confirmedTitle: "Signer revoked", submittedTitle: "Signer revocation submitted" }
          : functionName === "add_context_rule"
            ? { confirmedTitle: "Rule created", submittedTitle: "Rule creation submitted" }
            : functionName === "remove_context_rule"
              ? { confirmedTitle: "Rule removed", submittedTitle: "Rule removal submitted" }
              : { confirmedTitle: "Signer added", submittedTitle: "Signer submission sent" };
      onNotice(describeReceipt(receipt, titles));
      setSignerAddress("");
      setNewRuleName("");
      setNewRuleSigner("");
      setPending(null);
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
        title: "Signer write failed",
        detail: describeSignerError(error),
      });
      setPending(null);
    },
  });

  // Resolves the on-chain signer id (remove_signer's contract argument,
  // distinct from the signer's address) before staging, then stages through
  // the same stageMutation the "Add signer" button uses. `signerRemovalBlock`
  // is re-checked here as a defensive guard: the button that reaches this is
  // already gated on it not blocking, but rule data can shift between render
  // and click.
  async function stageSignerRemoval(rule: ContextRule, address: string, index: number) {
    try {
      if (!wallet.address) throw new Error("Connect a wallet first.");
      const block = signerRemovalBlock(rule, index);
      if (block) throw new Error(block);
      const signerId = await loadSignerId(wallet.address, address, contracts);
      stageMutation.mutate({
        operation: removeSignerOperation({ contextRuleId: rule.id, signerId, contracts }),
        targetRule: rule,
      });
    } catch (error) {
      onNotice({
        ok: false,
        title: "Could not stage removal",
        detail: describeSignerError(error),
      });
    }
  }

  // Stages a whole-rule removal through the same stageMutation pipeline.
  // `ruleRemovalBlock` is re-checked here as a defensive guard, mirroring
  // `stageSignerRemoval` above: the button that reaches this is already
  // gated on it not blocking, but rule data can shift between render and
  // click.
  function stageRuleRemoval(rule: ContextRule) {
    const block = ruleRemovalBlock(rules, rule.id);
    if (block) {
      onNotice({ ok: false, title: "Could not stage removal", detail: block });
      return;
    }
    stageMutation.mutate({
      operation: removeContextRuleOperation({ contextRuleId: rule.id, contracts }),
      targetRule: rule,
    });
  }

  return (
    <section id="signers" className="rounded-xl border border-border bg-card p-6">
      <SectionHeader
        eyebrow="SmartAccount authorization"
        icon={<ShieldCheck className="text-primary" size={22} />}
        title="Signers and rules"
      />

      {rules.length > 0 ? (
        <div className="mb-4 rounded-lg border border-border bg-secondary p-3 text-sm">
          {(() => {
            const { weakestUnanimousRule, policyGatedRuleIds } = computeWeakestRule(rules);
            return (
              <>
                {weakestUnanimousRule ? (
                  <p>
                    <strong>Weakest path to full control:</strong> {weakestUnanimousRule.requiredSigners}{" "}
                    signature{weakestUnanimousRule.requiredSigners === 1 ? "" : "s"} (Rule{" "}
                    {weakestUnanimousRule.id} · {weakestUnanimousRule.name})
                  </p>
                ) : (
                  <p>
                    <strong>Weakest path to full control:</strong> every rule has a policy attached —
                    exact threshold not readable here.
                  </p>
                )}
                {policyGatedRuleIds.length > 0 ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {policyGatedRuleIds.length} rule{policyGatedRuleIds.length === 1 ? "" : "s"} (
                    {policyGatedRuleIds.join(", ")}) also carr
                    {policyGatedRuleIds.length === 1 ? "ies" : "y"} a policy — check each individually.
                  </p>
                ) : null}
              </>
            );
          })()}
        </div>
      ) : null}

      {!wallet.address ? (
        <p className="text-sm text-muted-foreground">
          Connect a wallet to read the signer set.
        </p>
      ) : (
        <>
          <p className="mb-4 text-sm text-muted-foreground">
            {isOwner
              ? "This wallet is the treasury owner."
              : `Treasury owner is ${truncateAddress(authorityQuery.data?.owner)}. Writes here are authorized by the SmartAccount: any wallet registered as a signer on a valid context rule below can act, not only the owner.`}
          </p>

          {rules.map((rule) => {
            const ruleBlock = ruleRemovalBlock(rules, rule.id);
            return (
              <div key={rule.id} className="mb-4 rounded-lg border border-border p-4">
                <div className="mb-1 flex items-center justify-between">
                  <strong className="text-sm">
                    Rule {rule.id} · {rule.name}
                  </strong>
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{rule.contextType}</span>
                    {ruleBlock ? (
                      // Short label, full reason on hover: the rule-level and
                      // signer-level blocks end in the same sentence, and a
                      // fresh one-rule/one-signer treasury hits both at once,
                      // so printing them in full stacks the same warning twice.
                      // `rule` came out of `rules`, so the only reachable
                      // reason here is the last-rule one.
                      <span className="text-xs text-muted-foreground" title={ruleBlock}>
                        Only rule — cannot be removed
                      </span>
                    ) : (
                      <Button
                        disabled={stageMutation.isPending}
                        onClick={() => stageRuleRemoval(rule)}
                        size="sm"
                        variant="ghost"
                      >
                        Remove this rule
                      </Button>
                    )}
                  </span>
                </div>
                <span className="mb-2 block text-xs text-muted-foreground">
                  {rule.policyCount === 0
                    ? `ALL ${rule.signerCount} signer${rule.signerCount === 1 ? "" : "s"} required (no threshold set)`
                    : `Policy-gated (${rule.policyCount} polic${rule.policyCount === 1 ? "y" : "ies"} attached — exact threshold not readable here)`}
                </span>
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
                            // Short label, full reason on hover -- see the
                            // rule-level block above. `index` comes from this
                            // rule's own signer list, so the only reachable
                            // reason here is the last-signer one.
                            <span className="text-xs text-muted-foreground" title={block}>
                              Only signer — cannot be revoked
                            </span>
                          ) : pendingRemoval?.ruleId === rule.id && pendingRemoval.index === index ? (
                            <span className="flex gap-2">
                              <Button
                                disabled={stageMutation.isPending}
                                onClick={() => {
                                  setPendingRemoval(null);
                                  void stageSignerRemoval(rule, address, index);
                                }}
                              >
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
            );
          })}

          <div className="mt-6 rounded-lg border border-dashed border-border p-4">
            <strong className="text-sm">Create a new, independent rule</strong>
            <p className="mt-1 text-xs text-muted-foreground">
              Not a helper or a limited role: this signer gets full, independent power over this
              treasury, equal to every other rule&apos;s signers — because any one satisfied rule
              authorizes anything. This treasury becomes only as secure as this new rule. Use this
              only when you want a genuinely separate, co-equal path to control (e.g. a second
              team with its own key) — not to add a backup signer to an existing rule (use &ldquo;Add
              signer&rdquo; below for that).
            </p>
            <div className="mt-3 grid gap-3">
              <FormField label="Rule name" onChange={setNewRuleName} value={newRuleName} />
              <FormField label="Signer address" onChange={setNewRuleSigner} value={newRuleSigner} />
              <Button
                onClick={() => {
                  try {
                    validateContextRuleDraft({ name: newRuleName, signerAddress: newRuleSigner });
                    stageMutation.mutate({
                      operation: addContextRuleOperation({
                        name: newRuleName,
                        signerAddress: newRuleSigner,
                        contracts,
                      }),
                    });
                  } catch (error) {
                    onNotice({
                      ok: false,
                      title: "Invalid input",
                      detail: error instanceof Error ? error.message : String(error),
                    });
                  }
                }}
                disabled={
                  stageMutation.isPending || newRuleName.length === 0 || newRuleSigner.length === 0
                }
              >
                <Plus className="size-4" />
                Create rule
              </Button>
            </div>
          </div>

          <div className="mt-6 grid gap-3">
            <strong className="text-sm">Add signer to an existing rule</strong>
            <p className="text-xs text-muted-foreground">
              Gives this signer whatever role that rule already grants — a co-signer, not a new
              independent power. To grant full, independent control instead, use &ldquo;Create a
              new, independent rule&rdquo; above.
            </p>
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
                    Rule {rule.id} · {rule.name} ({rule.signerCount} signer
                    {rule.signerCount === 1 ? "" : "s"})
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
              onClick={() => {
                try {
                  validateSignerDraft({ signerAddress });
                  if (!targetRule) throw new Error("No context rule is available.");
                  stageMutation.mutate({
                    operation: addSignerOperation({
                      contextRuleId: targetRule.id,
                      signerAddress,
                      contracts,
                    }),
                    targetRule,
                  });
                } catch (error) {
                  onNotice({
                    ok: false,
                    title: "Invalid input",
                    detail: error instanceof Error ? error.message : String(error),
                  });
                }
              }}
              disabled={stageMutation.isPending || signerAddress.length === 0 || !targetRule}
            >
              {stageMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <UserPlus className="size-4" />
              )}
              {stageMutation.isPending ? "Checking…" : "Add signer"}
            </Button>
            <p className="text-xs text-muted-foreground">
              Simulation cannot confirm authorization. The wallet signature is what proves it.
            </p>
          </div>

          <WriteConfirmDialog
            description="Signed via the SmartAccount authorization entry, using whichever context rule this wallet is registered under."
            onCancel={() => setPending(null)}
            onSubmit={() => pending && addMutation.mutate()}
            pending={pending}
            submitting={addMutation.isPending}
          />
        </>
      )}
    </section>
  );
}
