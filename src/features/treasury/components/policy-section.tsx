"use client";

import { ClipboardCheck, ScrollText } from "lucide-react";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { STELLAR_CONFIG } from "@/config";
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
import type { WriteWarning } from "@/lib/writeWarnings";
import { executeWriteOperation, walletSigner } from "@/lib/writeAuth";
import { fetchRelayerJobs } from "@/features/treasury/relayer-client";
import {
  validateAssetRuleDraft,
  validateOperationDraft,
  validateRecipientDraft,
  validateVersionBump,
} from "@/features/treasury/writeDrafts";
import { FormField, SectionHeader } from "@/features/treasury/components/primitives";
import { useTreasuryAuthority, useTreasurySnapshot } from "@/features/treasury/queries";
import type { PolicyProbeVerdict, SimulationResult, WalletState } from "@/types";

type ProbeRow = {
  asset: string;
  destination: string;
  operation: string;
  verdict?: PolicyProbeVerdict;
  cap?: string | null;
};

const REASON_LABEL: Record<string, string> = {
  operation: "operation not allowed",
  asset: "asset not allowed",
  recipient: "recipient not allowed",
  amount: "amount above cap",
  version: "policy version mismatch",
  unknown: "not readable",
};

export function PolicySection({
  onNotice,
  wallet,
}: {
  onNotice: (notice: SimulationResult | null) => void;
  wallet: WalletState;
}) {
  const queryClient = useQueryClient();
  const snapshotQuery = useTreasurySnapshot(wallet.address);
  const authorityQuery = useTreasuryAuthority(wallet.address);
  const currentVersion = snapshotQuery.data?.policyVersion ?? 1;

  const [rows, setRows] = useState<ProbeRow[]>([
    {
      asset: STELLAR_CONFIG.contracts.staAsset,
      destination: STELLAR_CONFIG.testRecipient,
      operation: "transfer",
    },
  ]);
  const [assetDraft, setAssetDraft] = useState({
    asset: STELLAR_CONFIG.contracts.staAsset,
    maxSingleTransfer: "10000000",
  });
  const [recipientDraft, setRecipientDraft] = useState(STELLAR_CONFIG.testRecipient);
  const [operationDraft, setOperationDraft] = useState("transfer");
  const [nextVersion, setNextVersion] = useState(String(currentVersion + 1));

  const probeMutation = useMutation({
    mutationFn: async () => {
      if (!wallet.address) throw new Error("Connect a wallet first.");
      const simulate = simulatePolicyProbe(wallet.address);
      return Promise.all(
        rows.map(async (row) => {
          const verdict = await probePolicy(simulate, {
            asset: row.asset,
            destination: row.destination,
            operation: row.operation,
            amount: "1",
            expectedVersion: currentVersion,
          });
          const cap =
            verdict.allowed || verdict.reason === "recipient"
              ? await findAmountCap(simulate, {
                  asset: row.asset,
                  destination: row.destination,
                  operation: row.operation,
                  expectedVersion: currentVersion,
                })
              : null;
          return { ...row, verdict, cap: cap === null ? null : cap.toString() };
        }),
      );
    },
    onSuccess: (next) => setRows(next),
    onError: (error) =>
      onNotice({
        ok: false,
        title: "Probe failed",
        detail: error instanceof Error ? error.message : String(error),
      }),
  });

  // Staged operation awaiting confirmation. The spec's pipeline is
  // validate -> guard -> simulate -> confirm -> sign -> submit; nothing reaches
  // the wallet until the operator has seen the summary and its consequences.
  const [pending, setPending] = useState<{
    operation: WriteOperation;
    warnings: WriteWarning[];
  } | null>(null);

  const stageMutation = useMutation({
    mutationFn: async (operation: WriteOperation) => {
      if (!wallet.address) throw new Error("Connect a wallet first.");
      await simulateWriteOperation(operation, wallet.address);

      const jobs = await fetchRelayerJobs().catch(() => []);
      const pinnedVersions = (
        await Promise.all(
          jobs.map((job) => loadIntentPolicyVersion(wallet.address as string, job.intentId)),
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
      return executeWriteOperation(operation, walletSigner(wallet.address));
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

      <p className="mb-4 text-xs text-muted-foreground">
        This contract exposes no read entrypoints, so its state is discovered by probing
        <code className="mx-1">validate_policy</code>. The policy admin is not readable
        on-chain: a write signed by a non-admin key fails at submission, not at simulation.
      </p>

      <div className="mb-6 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground">
              <th className="py-2">Asset</th>
              <th>Recipient</th>
              <th>Operation</th>
              <th>Verdict</th>
              <th>Cap</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.asset}:${row.destination}:${row.operation}`}>
                <td className="py-2"><code className="text-xs">{row.asset.slice(0, 9)}…</code></td>
                <td><code className="text-xs">{row.destination.slice(0, 9)}…</code></td>
                <td>{row.operation}</td>
                <td>
                  {row.verdict === undefined
                    ? "—"
                    : row.verdict.allowed
                      ? "allowed"
                      : REASON_LABEL[row.verdict.reason]}
                </td>
                <td>{row.cap ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Button onClick={() => probeMutation.mutate()} disabled={probeMutation.isPending}>
        <ClipboardCheck className="size-4" />
        {probeMutation.isPending ? "Probing…" : "Probe live policy"}
      </Button>

      {pending ? (
        <div className="mt-6 rounded-lg border border-border bg-secondary p-4">
          <strong className="text-sm">Confirm this change</strong>
          <p className="mt-1 text-sm">{pending.operation.summary}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            Signed as the transaction source with this wallet, not as a SmartAccount
            authorization entry.
          </p>
          {pending.warnings.length > 0 ? (
            <ul className="mt-3 grid gap-1">
              {pending.warnings.map((warning) => (
                <li key={warning.message} className="text-xs text-destructive">
                  {warning.message}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="mt-4 flex gap-2">
            <Button
              onClick={() => writeMutation.mutate(pending.operation)}
              disabled={writeMutation.isPending}
            >
              {writeMutation.isPending ? "Awaiting wallet…" : "Sign and submit"}
            </Button>
            <Button onClick={() => setPending(null)}>Cancel</Button>
          </div>
        </div>
      ) : null}

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
                return setAssetRuleOperation({ ...assetDraft, enabled: true });
              })
            }
          >
            Enable asset
          </Button>
          <Button
            onClick={() =>
              submit(() => {
                validateAssetRuleDraft({ ...assetDraft, enabled: false });
                return setAssetRuleOperation({ ...assetDraft, enabled: false });
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
                return setRecipientAllowedOperation({ recipient: recipientDraft, allowed: true });
              })
            }
          >
            Allow recipient
          </Button>
          <Button
            onClick={() =>
              submit(() => {
                validateRecipientDraft({ recipient: recipientDraft, allowed: false });
                return setRecipientAllowedOperation({ recipient: recipientDraft, allowed: false });
              })
            }
          >
            Remove recipient
          </Button>
        </div>

        <FormField label="Operation" onChange={setOperationDraft} value={operationDraft} />
        <div className="flex gap-2">
          <Button
            onClick={() =>
              submit(() => {
                validateOperationDraft({ operation: operationDraft, allowed: true });
                return setOperationAllowedOperation({ operation: operationDraft, allowed: true });
              })
            }
          >
            Enable operation
          </Button>
          <Button
            onClick={() =>
              submit(() => {
                validateOperationDraft({ operation: operationDraft, allowed: false });
                return setOperationAllowedOperation({ operation: operationDraft, allowed: false });
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
              return bumpVersionOperation({ nextVersion: parsed });
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
