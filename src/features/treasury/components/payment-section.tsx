"use client";

import {
  ClipboardCheck,
  KeyRound,
  Loader2,
  RefreshCcw,
  SendHorizontal,
  Wallet,
} from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { useMutation } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { NETWORK, STELLAR_CONFIG } from "@/config";
import { describeAssetReadiness, totalRequested } from "@/lib/assetHolding";
import type { AssetHolding } from "@/lib/assetHolding";
import type { ContractSet } from "@/lib/env";
import { makeNonce } from "@/lib/format";
import { describeReceipt } from "@/lib/receipt";
import {
  approveAndSubmitTransfer,
  checkNonce,
  simulatePolicy,
  simulateTransfer,
} from "@/lib/stellarClient";
import { signAuthEntry, signTransaction } from "@/lib/wallet";
import type { PaymentDraft, SimulationResult, WalletState } from "@/types";
import { FormField, SectionHeader } from "@/features/treasury/components/primitives";

export function PaymentSection({
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
  draft: PaymentDraft;
  onDraftChange: Dispatch<SetStateAction<PaymentDraft>>;
  onNotice: (notice: SimulationResult | null) => void;
  wallet: WalletState;
}) {
  const readiness = assetHolding
    ? describeAssetReadiness(assetHolding, totalRequested([draft.amount]))
    : null;
  const blocked = readiness && !readiness.ready ? readiness : null;

  const submitTransferMutation = useMutation({
    mutationFn: async () => {
      if (!wallet.address) {
        throw new Error("Connect an authorized Stellar wallet before submission.");
      }
      return approveAndSubmitTransfer(
        {
          address: wallet.address,
          signAuthEntry,
          signTransaction,
        },
        draft,
        contracts,
      );
    },
    onMutate: () => {
      onNotice({
        ok: true,
        title: "Wallet approval requested",
        detail:
          "Approve the SmartAccount authorization entry, then approve the prepared transaction envelope.",
      });
    },
    onSuccess: (receipt) => {
      onNotice(
        describeReceipt(receipt, {
          confirmedTitle: "Payment confirmed",
          submittedTitle: "Payment submitted",
        }),
      );
      onDraftChange((current) => ({ ...current, nonce: makeNonce() }));
    },
    onError: (error) => {
      onNotice({
        ok: false,
        title: "Payment submission failed",
        detail: error instanceof Error ? error.message : String(error),
      });
    },
  });

  async function onPolicyCheck() {
    const source = wallet.address ?? STELLAR_CONFIG.testDestination;
    onNotice(await simulatePolicy(source, draft, contracts));
  }

  async function onTransferSimulation() {
    const source = wallet.address ?? STELLAR_CONFIG.testDestination;
    onNotice(await simulateTransfer(source, draft, contracts));
  }

  async function onNonceCheck() {
    try {
      const source = wallet.address ?? STELLAR_CONFIG.testDestination;
      const used = await checkNonce(source, draft.nonce, contracts);
      onNotice({
        ok: !used,
        title: used ? "Nonce already consumed" : "Nonce is fresh",
        detail: used
          ? "Generate another nonce before preparing this payment."
          : `smart_account.is_nonce_used returned false on ${NETWORK.name}.`,
      });
    } catch (error) {
      onNotice({
        ok: false,
        title: "Nonce check failed",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return (
    <div id="payment" className="grid gap-4 rounded-lg border bg-card p-5 shadow-sm">
      <SectionHeader
        eyebrow="Prepare -> simulate -> approve"
        icon={<SendHorizontal className="text-primary" size={22} />}
        title="SAC payment"
      />

      <FormField
        label="Asset contract"
        onChange={(asset) => onDraftChange((current) => ({ ...current, asset }))}
        value={draft.asset}
      />
      <FormField
        label="Destination"
        onChange={(destination) => onDraftChange((current) => ({ ...current, destination }))}
        value={draft.destination}
      />
      <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
        <FormField
          label="Amount"
          onChange={(amount) => onDraftChange((current) => ({ ...current, amount }))}
          value={draft.amount}
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
      <FormField
        action={
          <Button
            onClick={() => onDraftChange((current) => ({ ...current, nonce: makeNonce() }))}
            size="icon"
            title="Generate nonce"
            type="button"
            variant="secondary"
          >
            <RefreshCcw size={16} />
          </Button>
        }
        label="Nonce"
        onChange={(nonce) => onDraftChange((current) => ({ ...current, nonce }))}
        value={draft.nonce}
      />

      {/* The token's own gate, checked before any policy this project owns. */}
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
        <Button onClick={onNonceCheck} variant="secondary">
          <KeyRound size={18} />
          Nonce check
        </Button>
        <Button onClick={onTransferSimulation}>
          <SendHorizontal size={18} />
          Simulate
        </Button>
        <Button
          disabled={!wallet.connected || submitTransferMutation.isPending || blocked !== null}
          onClick={() => submitTransferMutation.mutate()}
          title={blocked?.message}
        >
          {submitTransferMutation.isPending ? (
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
