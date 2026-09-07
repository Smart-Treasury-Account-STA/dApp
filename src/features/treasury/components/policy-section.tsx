"use client";

import { ClipboardCheck, ScrollText } from "lucide-react";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { STELLAR_CONFIG } from "@/config";
import type { ContractSet } from "@/lib/env";
import { findAmountCap, probePolicy } from "@/lib/policyProbe";
import { describeReceipt } from "@/lib/receipt";
import {
  loadIntentPolicyVersion,
  simulatePolicyProbe,
  simulateWriteOperation,
} from "@/lib/stellarClient";
import {
  bumpVersionOperation,
  setAssetRuleOperation,
  setOperationAllowedOperation,
  setRecipientAllowedOperation,
} from "@/lib/treasuryWrites";
import type { WriteOperation } from "@/lib/treasuryWrites";
import { collectWriteWarnings } from "@/lib/writeWarnings";
import { executeWriteOperation, walletSigner } from "@/lib/writeAuth";
import { fetchRelayerJobs } from "@/features/treasury/relayer-client";
import {
  validateAssetRuleDraft,
  validateOperationDraft,
  validateRecipientDraft,
  validateVersionBump,
} from "@/features/treasury/writeDrafts";
import { FormField, SectionHeader } from "@/features/treasury/components/primitives";
import { WriteConfirmDialog } from "@/features/treasury/components/write-confirm-dialog";
import type { StagedWrite } from "@/features/treasury/components/write-confirm-dialog";
import { useTreasuryAuthority, useTreasurySnapshot } from "@/features/treasury/queries";
import type { SimulationResult, WalletState } from "@/types";

/**
 * The only two operation symbols this dApp's write paths actually check
 * policy for (`execute_transfer_payment`/`execute_scheduled_payment` pass
 * "transfer", `execute_split_payment` passes "split" -- see
 * `stellarClient.ts`'s `policyCheckScVal` call sites). `set_operation_allowed`
 * itself accepts any Soroban symbol, not just these two, but presenting an
 * open text field for a two-value set this dApp actually uses is exactly
 * the kind of ambiguity ("verbes autorisés pas clair") this Select removes.
 */
const KNOWN_OPERATIONS = ["transfer", "split"] as const;

const REASON_LABEL: Record<string, string> = {
  operation: "operation not allowed",
  asset: "asset not allowed",
  recipient: "recipient not allowed",
  amount: "amount above cap",
  version: "policy version mismatch",
  unknown: "not readable",
};

export function PolicySection({
  contracts = STELLAR_CONFIG.contracts,
  onNotice,
  wallet,
}: {
  contracts?: ContractSet;
  onNotice: (notice: SimulationResult | null) => void;
  wallet: WalletState;
}) {
  const queryClient = useQueryClient();
  const snapshotQuery = useTreasurySnapshot(wallet.address, contracts);
  const authorityQuery = useTreasuryAuthority(wallet.address, contracts);
  const currentVersion = snapshotQuery.data?.policyVersion ?? 1;

  const [assetDraft, setAssetDraft] = useState({
    asset: contracts.staAsset,
    maxSingleTransfer: "10000000",
  });
  const [recipientDraft, setRecipientDraft] = useState(STELLAR_CONFIG.testRecipient);
  const [operationDraft, setOperationDraft] = useState<string>(KNOWN_OPERATIONS[0]);
  const [nextVersion, setNextVersion] = useState(String(currentVersion + 1));

  // Checks exactly the asset/recipient/operation combination currently
  // typed into the three fields below -- not a separate list to manage.
  // Editing any of those three fields and re-running this is how you see
  // whether that specific combination is allowed right now; there is
  // nothing here to lose on a refresh because there is nothing stored.
  const checkMutation = useMutation({
    mutationFn: async () => {
      if (!wallet.address) throw new Error("Connect a wallet first.");
      const simulate = simulatePolicyProbe(wallet.address, contracts);
      const input = {
        asset: assetDraft.asset,
        destination: recipientDraft,
        operation: operationDraft,
        expectedVersion: currentVersion,
      };
      const verdict = await probePolicy(simulate, { ...input, amount: "1" });
      const cap =
        verdict.allowed || verdict.reason === "recipient"
          ? await findAmountCap(simulate, input)
          : null;
      return { verdict, cap: cap === null ? null : cap.toString() };
    },
    onError: (error) =>
      onNotice({
        ok: false,
        title: "Check failed",
        detail: error instanceof Error ? error.message : String(error),
      }),
  });

  // Staged operation awaiting confirmation. The spec's pipeline is
  // validate -> guard -> simulate -> confirm -> sign -> submit; nothing reaches
  // the wallet until the operator has seen the summary and its consequences.
  const [pending, setPending] = useState<StagedWrite | null>(null);

  const stageMutation = useMutation({
    mutationFn: async (operation: WriteOperation) => {
      if (!wallet.address) throw new Error("Connect a wallet first.");
      await simulateWriteOperation(operation, wallet.address);

      const jobs = await fetchRelayerJobs(contracts.smartAccount).catch(() => []);
      const pinnedVersions = (
        await Promise.all(
          jobs.map((job) =>
            loadIntentPolicyVersion(wallet.address as string, job.intentId, contracts),
          ),
        )
      ).filter((version): version is number => version !== null);

      return {
        operation,
        warnings: collectWriteWarnings(operation, {
          currentVersion,
          pinnedVersions,
          connectedAddress: wallet.address,
          ownerAddress: authorityQuery.data?.owner ?? null,
        }),
      };
    },
    onSuccess: (staged) => setPending(staged),
    onError: (error) =>
      onNotice({
        ok: false,
        title: "Policy write rejected before signing",
        detail: error instanceof Error ? error.message : String(error),
      }),
  });

  const writeMutation = useMutation({
    mutationFn: async (operation: WriteOperation) => {
      if (!wallet.address) throw new Error("Connect a wallet first.");
      return executeWriteOperation(operation, walletSigner(wallet.address), contracts);
    },
    onSuccess: (receipt) => {
      onNotice(
        describeReceipt(receipt, {
          confirmedTitle: "Policy updated",
          submittedTitle: "Policy update submitted",
        }),
      );
      setPending(null);
      void queryClient.invalidateQueries({ queryKey: ["treasury"] });
    },
    onError: (error) => {
      onNotice({
        ok: false,
        title: "Policy write failed",
        detail: error instanceof Error ? error.message : String(error),
      });
      setPending(null);
    },
  });

  function submit(build: () => WriteOperation) {
    try {
      stageMutation.mutate(build());
    } catch (error) {
      onNotice({
        ok: false,
        title: "Invalid input",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return (
    <section id="policy" className="rounded-xl border border-border bg-card p-6">
      <SectionHeader
        eyebrow="PolicyEngine"
        icon={<ScrollText className="text-primary" size={22} />}
        title="Policy rules"
      />

      <p className="mb-2 text-xs text-muted-foreground">
        This contract exposes no read entrypoints, so its state is discovered by probing
        <code className="mx-1">validate_policy</code>. The policy admin is not readable
        on-chain: a write signed by a non-admin key fails at submission, not at simulation.
      </p>
      <p className="mb-4 text-xs text-muted-foreground">
        <strong className="text-foreground">A payment needs all three gates open at once</strong> —
        its asset, its recipient, and its operation are each checked against a separate
        allowlist further down (three independent writes, not one combined
        &ldquo;rule&rdquo;). The check below always tests whatever is currently typed into
        the <strong className="text-foreground">Asset contract</strong>,{" "}
        <strong className="text-foreground">Recipient</strong>, and{" "}
        <strong className="text-foreground">Operation</strong> fields below it — edit any of
        the three and check again to see how that combination is treated right now.
      </p>

      <div className="mb-6 rounded-lg border border-border bg-secondary p-4">
        <Button
          onClick={() => checkMutation.mutate()}
          disabled={checkMutation.isPending}
        >
          <ClipboardCheck className="size-4" />
          {checkMutation.isPending ? "Checking…" : "Check this combination"}
        </Button>

        {checkMutation.data ? (
          <p className="mt-3 text-sm">
            <code className="text-xs">{assetDraft.asset.slice(0, 9)}…</code> →{" "}
            <code className="text-xs">{recipientDraft.slice(0, 9)}…</code> ·{" "}
            {operationDraft}:{" "}
            <strong>
              {checkMutation.data.verdict.allowed
                ? "allowed"
                : REASON_LABEL[checkMutation.data.verdict.reason]}
            </strong>
            {checkMutation.data.cap !== null
              ? ` (cap: ${checkMutation.data.cap})`
              : ""}
          </p>
        ) : null}
      </div>

      <WriteConfirmDialog
        description="Signed as the transaction source with this wallet, not as a SmartAccount authorization entry."
        onCancel={() => setPending(null)}
        onSubmit={() => pending && writeMutation.mutate(pending.operation)}
        pending={pending}
        submitting={writeMutation.isPending}
      />

      <div className="mt-6 grid gap-4">
        <FormField
          label="Asset contract"
          onChange={(asset) => setAssetDraft((d) => ({ ...d, asset }))}
          value={assetDraft.asset}
        />
        <FormField
          label="Single-transfer cap"
          onChange={(maxSingleTransfer) => setAssetDraft((d) => ({ ...d, maxSingleTransfer }))}
          value={assetDraft.maxSingleTransfer}
        />
        <div className="flex gap-2">
          <Button
            onClick={() =>
              submit(() => {
                validateAssetRuleDraft({ ...assetDraft, enabled: true });
                return setAssetRuleOperation({ ...assetDraft, enabled: true, contracts });
              })
            }
          >
            Enable asset
          </Button>
          <Button
            onClick={() =>
              submit(() => {
                validateAssetRuleDraft({ ...assetDraft, enabled: false });
                return setAssetRuleOperation({ ...assetDraft, enabled: false, contracts });
              })
            }
          >
            Disable asset
          </Button>
        </div>

        <FormField label="Recipient" onChange={setRecipientDraft} value={recipientDraft} />
        <div className="flex gap-2">
          <Button
            onClick={() =>
              submit(() => {
                validateRecipientDraft({ recipient: recipientDraft, allowed: true });
                return setRecipientAllowedOperation({
                  recipient: recipientDraft,
                  allowed: true,
                  contracts,
                });
              })
            }
          >
            Allow recipient
          </Button>
          <Button
            onClick={() =>
              submit(() => {
                validateRecipientDraft({ recipient: recipientDraft, allowed: false });
                return setRecipientAllowedOperation({
                  recipient: recipientDraft,
                  allowed: false,
                  contracts,
                });
              })
            }
          >
            Remove recipient
          </Button>
        </div>

        <div className="grid gap-2">
          <Label>Operation</Label>
          <Select
            onChange={(event) => setOperationDraft(event.target.value)}
            value={operationDraft}
          >
            {KNOWN_OPERATIONS.map((operation) => (
              <option key={operation} value={operation}>
                {operation}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() =>
              submit(() => {
                validateOperationDraft({ operation: operationDraft, allowed: true });
                return setOperationAllowedOperation({
                  operation: operationDraft,
                  allowed: true,
                  contracts,
                });
              })
            }
          >
            Enable operation
          </Button>
          <Button
            onClick={() =>
              submit(() => {
                validateOperationDraft({ operation: operationDraft, allowed: false });
                return setOperationAllowedOperation({
                  operation: operationDraft,
                  allowed: false,
                  contracts,
                });
              })
            }
          >
            Disable operation
          </Button>
        </div>

        <FormField label="Next policy version" onChange={setNextVersion} value={nextVersion} />
        <Button
          onClick={() =>
            submit(() => {
              const parsed = Number(nextVersion);
              validateVersionBump({ currentVersion, nextVersion: parsed });
              return bumpVersionOperation({ nextVersion: parsed, contracts });
            })
          }
        >
          Bump policy version
        </Button>
        <p className="text-xs text-muted-foreground">
          Bumping the version rejects every payment and scheduled intent still pinned to
          version {currentVersion} with #2006. Check the relayer queue first.
        </p>
      </div>
    </section>
  );
}
