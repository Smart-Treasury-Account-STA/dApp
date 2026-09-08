"use client";

import { ClipboardCheck, Loader2, Plus, Split, Trash2, Wallet } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { useMutation } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { STELLAR_CONFIG } from "@/config";
import { describeAssetReadiness, totalRequested } from "@/lib/assetHolding";
import type { AssetHolding } from "@/lib/assetHolding";
import type { ContractSet } from "@/lib/env";
import { makeNonce } from "@/lib/format";
import { describeReceipt } from "@/lib/receipt";
import { approveAndSubmitSplit, simulateSplit, simulateSplitPolicy } from "@/lib/stellarClient";
import { signAuthEntry, signTransaction } from "@/lib/wallet";
import type { SimulationResult, SplitDraft, WalletState } from "@/types";
import { FormField, SectionHeader } from "@/features/treasury/components/primitives";

function emptyDestination() {
  return { destination: "", amount: "" };
}

export function SplitSection({
  assetHolding,
  contracts = STELLAR_CONFIG.contracts,
  draft,
  onDraftChange,
  onNotice,
  wallet,
}: {
  /** Null while loading or disconnected — an unknown holding never blocks. */
  assetHolding: AssetHolding | null;
  contracts?: ContractSet;
  draft: SplitDraft;
  onDraftChange: Dispatch<SetStateAction<SplitDraft>>;
  onNotice: (notice: SimulationResult | null) => void;
  wallet: WalletState;
}) {
  // Checked against the split's own total, not just "can it send anything":
  // a treasury with a balance can still be short for this particular batch.
  const readiness = assetHolding
    ? describeAssetReadiness(
        assetHolding,
        totalRequested(draft.destinations.map((entry) => entry.amount)),
      )
    : null;
  const blocked = readiness && !readiness.ready ? readiness : null;

  const submitSplitMutation = useMutation({
    mutationFn: async () => {
      if (!wallet.address) {
        throw new Error("Connect an authorized Stellar wallet before submission.");
      }
      return approveAndSubmitSplit(
        { address: wallet.address, signAuthEntry, signTransaction },
        draft,
        contracts,
      );
    },
    onMutate: () => {
      onNotice({
        ok: true,
        title: "Split approval requested",
        detail:
          "Approve the SmartAccount authorization entry and the prepared split transaction.",
      });
    },
    onSuccess: (receipt) => {
      onNotice(
        describeReceipt(receipt, {
          confirmedTitle: "Split payment confirmed",
          submittedTitle: "Split payment submitted",
        }),
      );
      if (receipt.status === "SUCCESS") {
        onDraftChange((current) => ({ ...current, nonce: makeNonce() }));
      }
    },
    onError: (error) => {
      onNotice({
        ok: false,
        title: "Split submission failed",
        detail: error instanceof Error ? error.message : String(error),
      });
    },
  });

  async function onPolicyCheck() {
    if (!wallet.address) return;
    onNotice(await simulateSplitPolicy(wallet.address, draft, contracts));
  }

  async function onSplitSimulation() {
    const source = wallet.address ?? STELLAR_CONFIG.testDestination;
    onNotice(await simulateSplit(source, draft, contracts));
  }

  function updateDestination(index: number, field: "destination" | "amount", value: string) {
    onDraftChange((current) => ({
      ...current,
      destinations: current.destinations.map((entry, i) =>
        i === index ? { ...entry, [field]: value } : entry,
      ),
    }));
  }

  function addDestination() {
    onDraftChange((current) => ({
      ...current,
      destinations: [...current.destinations, emptyDestination()],
    }));
  }

  function removeDestination(index: number) {
    onDraftChange((current) => ({
      ...current,
      destinations: current.destinations.filter((_, i) => i !== index),
    }));
  }

  return (
    <div id="split" className="grid gap-4 rounded-lg border bg-card p-5 shadow-sm">
      <SectionHeader
        eyebrow="One-to-many SAC payment"
        icon={<Split className="text-primary" size={22} />}
        title="Split payment"
      />

      <FormField
        label="Asset contract"
        onChange={(asset) => onDraftChange((current) => ({ ...current, asset }))}
        value={draft.asset}
      />

      <div className="grid gap-3">
        {draft.destinations.map((entry, index) => (
          <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2 max-sm:grid-cols-1" key={index}>
            <FormField
              label={`Destination ${index + 1}`}
              onChange={(value) => updateDestination(index, "destination", value)}
              value={entry.destination}
            />
            <FormField
              label="Amount"
              onChange={(value) => updateDestination(index, "amount", value)}
              value={entry.amount}
            />
            <Button
              disabled={draft.destinations.length <= 2}
              onClick={() => removeDestination(index)}
              size="icon"
              title="Remove destination"
              type="button"
              variant="secondary"
            >
              <Trash2 size={16} />
            </Button>
          </div>
        ))}
        <Button className="justify-self-start" onClick={addDestination} type="button" variant="secondary">
          <Plus size={16} />
          Add destination
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
        <FormField
          label="Nonce"
          onChange={(nonce) => onDraftChange((current) => ({ ...current, nonce }))}
          value={draft.nonce}
        />
        <FormField
          label="Policy version"
          onChange={(value) =>
            onDraftChange((current) => ({
              ...current,
              expectedPolicyVersion: Number(value) || 1,
            }))
          }
          value={String(draft.expectedPolicyVersion)}
        />
      </div>

      {/* The token's own gate, checked before any policy this project owns.
          Shown here as well as in the Treasury panel because this is where the
          operator is about to act, and because only here is the requested
          total known. */}
      {blocked ? (
        <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs leading-relaxed text-warning">
          {blocked.message} Policy check and simulation still work — they read
          the policy engine, which is a separate gate.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button onClick={onPolicyCheck} variant="secondary">
          <ClipboardCheck size={18} />
          Policy check
        </Button>
        <Button onClick={onSplitSimulation}>
          <Split size={18} />
          Simulate
        </Button>
        <Button
          disabled={!wallet.connected || submitSplitMutation.isPending || blocked !== null}
          onClick={() => submitSplitMutation.mutate()}
          title={blocked?.message}
        >
          {submitSplitMutation.isPending ? (
            <Loader2 className="animate-spin" size={18} />
          ) : (
            <Wallet size={18} />
          )}
          Approve & submit
        </Button>
      </div>
    </div>
  );
}
