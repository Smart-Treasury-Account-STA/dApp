"use client";

import {
  CalendarClock,
  CheckCircle2,
  CircleDashed,
  Loader2,
  RadioTower,
  RefreshCcw,
  Wallet,
  Workflow,
  XCircle,
} from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { STELLAR_CONFIG } from "@/config";
import { LEDGER_CLOSE_SECONDS } from "@/lib/constants";
import type { ContractSet } from "@/lib/env";
import { makeIntentId, truncateAddress } from "@/lib/format";
import { describeReceipt } from "@/lib/receipt";
import {
  approveAndSubmitCancelSchedule,
  approveAndSubmitSchedule,
  getLatestLedger,
  simulateSchedule,
} from "@/lib/stellarClient";
import { signAuthEntry, signTransaction } from "@/lib/wallet";
import type { ScheduleDraft, SimulationResult, WalletState } from "@/types";
import type { CreateRelayerJobInput } from "@/lib/relayer/types";
import { computeLedgerWindow } from "@/features/treasury/drafts";
import { queueRelayerJob } from "@/features/treasury/relayer-client";
import { FormField, SectionHeader } from "@/features/treasury/components/primitives";

export function ScheduleSection({
  contracts = STELLAR_CONFIG.contracts,
  draft,
  onDraftChange,
  onNotice,
  relayerSessionActive,
  wallet,
}: {
  contracts?: ContractSet;
  draft: ScheduleDraft;
  onDraftChange: Dispatch<SetStateAction<ScheduleDraft>>;
  onNotice: (notice: SimulationResult | null) => void;
  relayerSessionActive: boolean;
  wallet: WalletState;
}) {
  const queryClient = useQueryClient();
  const [createdScheduleJob, setCreatedScheduleJob] =
    useState<CreateRelayerJobInput | null>(null);
  const [cancelIntentId, setCancelIntentId] = useState("");

  const submitScheduleMutation = useMutation({
    mutationFn: async () => {
      if (!wallet.address) {
        throw new Error("Connect an authorized Stellar wallet before submission.");
      }
      return approveAndSubmitSchedule(
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
        title: "Schedule approval requested",
        detail:
          "Approve the SmartAccount authorization entry and the prepared schedule transaction.",
      });
    },
    onSuccess: (receipt) => {
      const relayerJob: CreateRelayerJobInput = {
        smartAccountId: contracts.smartAccount,
        intentId: draft.intentId,
        startLedger: Number(draft.startLedger),
        endLedger: Number(draft.endLedger),
        maxExecutions: Number(draft.maxExecutions),
      };
      onNotice(
        describeReceipt(receipt, {
          confirmedTitle: "Scheduled payment created",
          submittedTitle: "Schedule submitted",
        }),
      );
      if (receipt.status === "SUCCESS") {
        setCreatedScheduleJob(relayerJob);
        onDraftChange((current) => ({
          ...current,
          intentId: makeIntentId(),
        }));
      }
    },
    onError: (error) => {
      onNotice({
        ok: false,
        title: "Schedule submission failed",
        detail: error instanceof Error ? error.message : String(error),
      });
    },
  });

  const queueRelayerJobMutation = useMutation({
    mutationFn: () => {
      if (!createdScheduleJob) {
        throw new Error("Create the scheduled payment on-chain before queueing it.");
      }
      return queueRelayerJob(createdScheduleJob);
    },
    onSuccess: (job) => {
      queryClient.invalidateQueries({ queryKey: ["relayer-jobs"] });
      onNotice({
        ok: true,
        title: "Relayer job queued",
        detail: `Intent ${job.intentId.slice(0, 8)} is queued with child_sequence ${job.childSequence}.`,
      });
    },
    onError: (error) => {
      onNotice({
        ok: false,
        title: "Could not queue relayer job",
        detail: error instanceof Error ? error.message : String(error),
      });
    },
  });

  const cancelScheduleMutation = useMutation({
    mutationFn: async () => {
      if (!wallet.address) {
        throw new Error("Connect an authorized Stellar wallet before submission.");
      }
      return approveAndSubmitCancelSchedule(
        { address: wallet.address, signAuthEntry, signTransaction },
        cancelIntentId,
        contracts,
      );
    },
    onMutate: () => {
      onNotice({
        ok: true,
        title: "Cancellation approval requested",
        detail: "Approve the SmartAccount authorization entry to cancel this scheduled payment.",
      });
    },
    onSuccess: (receipt) => {
      onNotice(
        describeReceipt(receipt, {
          confirmedTitle: "Scheduled payment cancelled",
          submittedTitle: "Cancellation submitted",
        }),
      );
      if (receipt.status === "SUCCESS") {
        setCancelIntentId("");
      }
    },
    onError: (error) => {
      onNotice({
        ok: false,
        title: "Cancellation failed",
        detail: error instanceof Error ? error.message : String(error),
      });
    },
  });

  async function onScheduleSimulation() {
    const source = wallet.address ?? STELLAR_CONFIG.testRecipient;
    onNotice(await simulateSchedule(source, draft, contracts));
  }

  function onScheduleSubmit() {
    setCreatedScheduleJob(null);
    submitScheduleMutation.mutate();
  }

  async function onUseLedgerWindow() {
    try {
      const ledger = await getLatestLedger();
      const { startLedger, endLedger } = computeLedgerWindow(ledger);
      onDraftChange((current) => ({
        ...current,
        startLedger: String(startLedger),
        endLedger: String(endLedger),
      }));
    } catch (error) {
      onNotice({
        ok: false,
        title: "Ledger lookup failed",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return (
    <section id="schedule" className="grid gap-4 rounded-lg border bg-card p-5 shadow-sm">
      <SectionHeader
        eyebrow="Ledger-bounded automation"
        icon={<CalendarClock className="text-primary" size={22} />}
        title="Scheduled payment"
      />

      <div className="grid grid-cols-5 gap-3 max-xl:grid-cols-2 max-sm:grid-cols-1">
        <FormField
          action={
            <Button
              onClick={() =>
                onDraftChange((current) => ({ ...current, intentId: makeIntentId() }))
              }
              size="icon"
              title="Generate intent ID"
              type="button"
              variant="secondary"
            >
              <RefreshCcw size={16} />
            </Button>
          }
          label="Intent ID"
          onChange={(intentId) => onDraftChange((current) => ({ ...current, intentId }))}
          value={draft.intentId}
        />
        <FormField
          label="Amount"
          onChange={(amount) => onDraftChange((current) => ({ ...current, amount }))}
          value={draft.amount}
        />
        <FormField
          label="Start ledger"
          onChange={(startLedger) => onDraftChange((current) => ({ ...current, startLedger }))}
          value={draft.startLedger}
        />
        <FormField
          label="End ledger"
          onChange={(endLedger) => onDraftChange((current) => ({ ...current, endLedger }))}
          value={draft.endLedger}
        />
        <FormField
          label="Max executions"
          onChange={(maxExecutions) =>
            onDraftChange((current) => ({ ...current, maxExecutions }))
          }
          value={draft.maxExecutions}
        />
        <FormField
          label="Interval ledgers"
          onChange={(intervalLedgers) =>
            onDraftChange((current) => ({ ...current, intervalLedgers }))
          }
          value={draft.intervalLedgers ?? "0"}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={onUseLedgerWindow} variant="secondary">
          <Workflow size={18} />
          Use current ledger
        </Button>
        <Button onClick={onScheduleSimulation}>
          <CalendarClock size={18} />
          Simulate schedule
        </Button>
        <Button
          disabled={!wallet.connected || submitScheduleMutation.isPending}
          onClick={onScheduleSubmit}
        >
          {submitScheduleMutation.isPending ? (
            <Loader2 className="animate-spin" size={18} />
          ) : (
            <Wallet size={18} />
          )}
          Approve & create
        </Button>
        <Button
          disabled={
            !createdScheduleJob || !relayerSessionActive || queueRelayerJobMutation.isPending
          }
          onClick={() => queueRelayerJobMutation.mutate()}
          variant="secondary"
        >
          <RadioTower size={18} />
          Queue relayer
        </Button>
      </div>

      {createdScheduleJob ? (
        <div className="flex items-start gap-2 rounded-md bg-secondary p-3 text-sm text-muted-foreground">
          <CheckCircle2 className="mt-0.5 shrink-0 text-primary" size={18} />
          <span>
            Intent {truncateAddress(createdScheduleJob.intentId, 8, 8)} is confirmed and ready
            to queue for ledgers {createdScheduleJob.startLedger} -{" "}
            {createdScheduleJob.endLedger}.
          </span>
        </div>
      ) : null}

      <div className="flex items-start gap-2 rounded-md bg-secondary p-3 text-sm text-muted-foreground">
        <CircleDashed className="mt-0.5 shrink-0 text-primary" size={18} />
        <span>
          Ledger windows are approximate in wall-clock terms. At about{" "}
          {LEDGER_CLOSE_SECONDS}s per ledger, the default window starts near two minutes from
          now and lasts one hour.
        </span>
      </div>

      <div className="grid gap-3 rounded-md border bg-background p-3">
        <span className="text-xs font-semibold uppercase text-muted-foreground">
          Cancel an existing scheduled payment
        </span>
        <FormField
          label="Intent ID to cancel"
          onChange={setCancelIntentId}
          value={cancelIntentId}
        />
        <Button
          disabled={
            !wallet.connected || cancelIntentId.length === 0 || cancelScheduleMutation.isPending
          }
          onClick={() => cancelScheduleMutation.mutate()}
          variant="secondary"
        >
          {cancelScheduleMutation.isPending ? (
            <Loader2 className="animate-spin" size={18} />
          ) : (
            <XCircle size={18} />
          )}
          Cancel scheduled payment
        </Button>
      </div>
    </section>
  );
}
