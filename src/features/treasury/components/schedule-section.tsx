"use client";

import {
  AlertTriangle,
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
import type { ComponentProps, Dispatch, SetStateAction } from "react";
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
  ScheduledIntentExistsError,
  simulateSchedule,
} from "@/lib/stellarClient";
import { signAuthEntry, signTransaction } from "@/lib/wallet";
import type { ScheduleDraft, SimulationResult, WalletState } from "@/types";
import type { CreateRelayerJobInput } from "@/lib/relayer/types";
import { computeLedgerWindow } from "@/features/treasury/drafts";
import { queueRelayerJob } from "@/features/treasury/relayer-client";
import { treasuryKeys, useScheduledIntents } from "@/features/treasury/queries";
import { describeIntentStatus } from "@/lib/scheduledIntents";
import type { IntentStatus, ScheduledIntentRecord } from "@/lib/scheduledIntents";
import {
  describeLedgerOffset,
  estimateLedgerTime,
  fromDatetimeLocalValue,
  ledgerForTime,
  retentionDays,
  toDatetimeLocalValue,
} from "@/lib/ledgerClock";
import type { LedgerClock } from "@/lib/ledgerClock";
import { inspectScheduleWindow } from "@/lib/scheduleWindow";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { FormField, SectionHeader } from "@/features/treasury/components/primitives";

/** `computeLedgerWindow`'s own defaults, restated as the selects' initial
 * choice so the two cannot drift apart silently. */
const DEFAULT_START_DELAY_SECONDS = 120;
const DEFAULT_DURATION_SECONDS = 3_600;

const START_DELAY_CHOICES = [
  { seconds: 60, label: "1 minute" },
  { seconds: DEFAULT_START_DELAY_SECONDS, label: "2 minutes" },
  { seconds: 600, label: "10 minutes" },
  { seconds: 3_600, label: "1 hour" },
  { seconds: 86_400, label: "1 day" },
];

const DURATION_CHOICES = [
  { seconds: 600, label: "10 minutes" },
  { seconds: DEFAULT_DURATION_SECONDS, label: "1 hour" },
  { seconds: 21_600, label: "6 hours" },
  { seconds: 86_400, label: "1 day" },
  { seconds: 604_800, label: "7 days" },
];

const INTENT_STATUS_VARIANTS = {
  active: "success",
  pending: "info",
  expired: "warning",
  exhausted: "default",
  cancelled: "destructive",
  unknown: "warning",
} satisfies Record<IntentStatus, ComponentProps<typeof Badge>["variant"]>;

/**
 * A ledger as a local date plus how far off it is, or a plain "unknown" when
 * the record carried no window.
 *
 * Both halves earn their place: the date answers "did this already happen",
 * the offset answers "how soon", and neither is readable as a bare ledger
 * number. Every value is an estimate — see `@/lib/ledgerClock`.
 */
function formatLedgerMoment(ledger: number | null, clock: LedgerClock): string {
  const at = estimateLedgerTime(ledger, clock);
  if (!at) return "unknown";
  return `~${at.toLocaleString()} (${describeLedgerOffset(ledger, clock)})`;
}

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

  const intentsQuery = useScheduledIntents(wallet.address, contracts);
  const intentsQueryKey = treasuryKeys.scheduledIntents(
    wallet.address ?? "disconnected",
    contracts.intentRegistry,
  );
  const intents = intentsQuery.data?.intents ?? [];
  // The ledger the listing was read at, not a fresher one: every status below
  // is a comparison against the window the same response reported.
  const latestIntentLedger = intentsQuery.data?.latestLedger ?? 0;
  const intentClock = intentsQuery.data?.clock ?? {
    referenceLedger: 0,
    referenceCloseTime: 0,
  };
  const eventRetentionDays = retentionDays(intentsQuery.data?.retentionLedgers);

  const [startDelaySeconds, setStartDelaySeconds] = useState(String(DEFAULT_START_DELAY_SECONDS));
  const [durationSeconds, setDurationSeconds] = useState(String(DEFAULT_DURATION_SECONDS));
  // Pinned at each fresh ledger read, never recomputed from `Date.now()` on
  // render: a clock whose close time advanced while its ledger stayed put
  // would make every displayed time creep forward on its own.
  const [windowClock, setWindowClock] = useState<LedgerClock | null>(null);

  // Ledgers only ever increase, so the more recent of the two reads is the
  // honest reference. The listing's is 15s stale at worst; the form's is
  // whatever the last window action fetched.
  const formClock =
    windowClock && windowClock.referenceLedger >= intentClock.referenceLedger
      ? windowClock
      : intentClock;

  // Only once both fields hold a real ledger: a half-typed window would render
  // a date that moves under the operator on every keystroke.
  const draftWindow =
    /^\d+$/.test(draft.startLedger) && /^\d+$/.test(draft.endLedger)
      ? { startLedger: Number(draft.startLedger), endLedger: Number(draft.endLedger) }
      : null;
  const windowNotices = draftWindow
    ? inspectScheduleWindow({ ...draftWindow, latestLedger: formClock.referenceLedger })
    : [];
  const windowBlocked = windowNotices.some((notice) => notice.level === "error");

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
        queryClient.invalidateQueries({ queryKey: intentsQueryKey });
        onDraftChange((current) => ({
          ...current,
          intentId: makeIntentId(),
        }));
      }
    },
    onError: (error) => {
      // A spent intent ID is the one failure the form can clear on its own,
      // and the only one where leaving the draft untouched guarantees the
      // same failure on the next click.
      if (error instanceof ScheduledIntentExistsError) {
        onDraftChange((current) => ({ ...current, intentId: makeIntentId() }));
      }
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

  /**
   * Queues any listed intent, not only the one created in this page's life.
   *
   * The other queue path reads `createdScheduleJob`, which is React state: a
   * refresh, or coming back later, leaves an intent that exists on-chain with
   * no way to reach the relayer at all. The server re-reads the canonical
   * record before writing the job, so the row's own numbers are only a
   * payload.
   */
  const queueIntentMutation = useMutation({
    mutationFn: (intent: ScheduledIntentRecord) =>
      queueRelayerJob({
        smartAccountId: contracts.smartAccount,
        intentId: intent.intentId,
        startLedger: intent.startLedger ?? 0,
        endLedger: intent.endLedger ?? 0,
        maxExecutions: intent.maxExecutions ?? 1,
      }),
    onSuccess: (job) => {
      queryClient.invalidateQueries({ queryKey: ["relayer-jobs"] });
      onNotice({
        ok: true,
        title: "Relayer job queued",
        detail: `Intent ${job.intentId.slice(0, 8)} is queued with child_sequence ${job.childSequence}. Execute it from the Relayer panel.`,
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
        queryClient.invalidateQueries({ queryKey: intentsQueryKey });
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
    const source = wallet.address ?? STELLAR_CONFIG.testDestination;
    onNotice(await simulateSchedule(source, draft, contracts));
  }

  function onScheduleSubmit() {
    setCreatedScheduleJob(null);
    submitScheduleMutation.mutate();
  }

  /**
   * Reads the current ledger and pins it as the conversion reference.
   *
   * Every wall-clock control converts against a ledger fetched at the moment
   * it runs. Reusing the listing's cached one would let a window drift by
   * however long the panel had been open before the operator touched it, and
   * the ledger is the value that gets signed.
   */
  async function withFreshClock(apply: (clock: LedgerClock) => void) {
    try {
      const clock: LedgerClock = {
        referenceLedger: await getLatestLedger(),
        referenceCloseTime: Math.floor(Date.now() / 1000),
      };
      setWindowClock(clock);
      apply(clock);
    } catch (error) {
      onNotice({
        ok: false,
        title: "Ledger lookup failed",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  function onUseLedgerWindow() {
    return withFreshClock((clock) => {
      const { startLedger, endLedger } = computeLedgerWindow(clock.referenceLedger, {
        startDelaySeconds: Number(startDelaySeconds),
        durationSeconds: Number(durationSeconds),
      });
      onDraftChange((current) => ({
        ...current,
        startLedger: String(startLedger),
        endLedger: String(endLedger),
      }));
    });
  }

  function onPickWindowMoment(field: "startLedger" | "endLedger", value: string) {
    const at = fromDatetimeLocalValue(value);
    if (!at) return;
    return withFreshClock((clock) => {
      const ledger = ledgerForTime(at, clock);
      if (ledger === null) return;
      onDraftChange((current) => ({ ...current, [field]: String(ledger) }));
    });
  }

  function windowMomentValue(ledger: string) {
    const at = /^\d+$/.test(ledger) ? estimateLedgerTime(Number(ledger), formClock) : null;
    return at ? toDatetimeLocalValue(at) : "";
  }

  return (
    <section id="schedule" className="grid gap-4 rounded-lg border bg-card p-5 shadow-sm">
      <SectionHeader
        eyebrow="Ledger-bounded automation"
        icon={<CalendarClock className="text-primary" size={22} />}
        title="Scheduled payment"
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

      <div className="grid gap-3 rounded-md border bg-background p-3">
        <span className="text-xs font-semibold uppercase text-muted-foreground">
          Window — pick it in wall-clock terms, sign it in ledgers
        </span>

        <div className="grid grid-cols-4 gap-3 max-xl:grid-cols-2 max-sm:grid-cols-1">
          <div className="grid gap-2">
            <Label>Starts in</Label>
            <Select
              onChange={(event) => setStartDelaySeconds(event.target.value)}
              value={startDelaySeconds}
            >
              {START_DELAY_CHOICES.map((choice) => (
                <option key={choice.seconds} value={choice.seconds}>
                  {choice.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Lasts</Label>
            <Select
              onChange={(event) => setDurationSeconds(event.target.value)}
              value={durationSeconds}
            >
              {DURATION_CHOICES.map((choice) => (
                <option key={choice.seconds} value={choice.seconds}>
                  {choice.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Opens at</Label>
            <Input
              onChange={(event) => onPickWindowMoment("startLedger", event.target.value)}
              type="datetime-local"
              value={windowMomentValue(draft.startLedger)}
            />
          </div>
          <div className="grid gap-2">
            <Label>Closes at</Label>
            <Input
              onChange={(event) => onPickWindowMoment("endLedger", event.target.value)}
              type="datetime-local"
              value={windowMomentValue(draft.endLedger)}
            />
          </div>
        </div>

        <small className="text-muted-foreground">
          Both rows write into the ledger fields above, which stay the values that get signed.
          Each conversion reads the current ledger first, so a form left open does not drift.
        </small>

        {draftWindow ? (
          <small className="text-muted-foreground">
            This window opens {formatLedgerMoment(draftWindow.startLedger, formClock)} and closes{" "}
            {formatLedgerMoment(draftWindow.endLedger, formClock)}.
          </small>
        ) : null}

        {windowNotices.map((notice) => (
          <div
            className={
              notice.level === "error"
                ? "flex items-start gap-2 rounded-md bg-red-100 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200"
                : "flex items-start gap-2 rounded-md bg-amber-100 p-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200"
            }
            key={notice.message}
          >
            <AlertTriangle className="mt-0.5 shrink-0" size={18} />
            <span>{notice.message}</span>
          </div>
        ))}
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
          disabled={!wallet.connected || windowBlocked || submitScheduleMutation.isPending}
          onClick={onScheduleSubmit}
          title={windowBlocked ? "This window has already closed." : undefined}
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

      <div className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase text-muted-foreground">
            Scheduled payments on this treasury
          </span>
          <Button
            disabled={!wallet.connected || intentsQuery.isFetching}
            onClick={() => intentsQuery.refetch()}
            size="sm"
            variant="secondary"
          >
            {intentsQuery.isFetching ? (
              <Loader2 className="animate-spin" size={16} />
            ) : (
              <RefreshCcw size={16} />
            )}
            Refresh
          </Button>
        </div>

        {intents.length ? (
          <div className="grid grid-cols-2 gap-3 max-xl:grid-cols-1">
            {intents.map((intent) => {
              const status = describeIntentStatus(intent, latestIntentLedger);
              return (
                <div
                  className="grid content-start gap-2 rounded-lg border bg-background p-4"
                  key={intent.intentId}
                >
                  <div className="flex items-center justify-between gap-2">
                    <strong className="font-mono text-sm" title={intent.intentId}>
                      {truncateAddress(intent.intentId, 8, 8)}
                    </strong>
                    <Badge className="w-fit" variant={INTENT_STATUS_VARIANTS[status]}>
                      {status}
                    </Badge>
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {intent.amount === null ? "amount unreadable" : String(intent.amount)} to{" "}
                    <span title={intent.destination ?? undefined}>
                      {truncateAddress(intent.destination, 7, 6)}
                    </span>
                  </span>
                  <small className="grid gap-0.5 text-muted-foreground">
                    <span>
                      opens {formatLedgerMoment(intent.startLedger, intentClock)} · closes{" "}
                      {formatLedgerMoment(intent.endLedger, intentClock)}
                    </span>
                    <span>
                      ledgers {intent.startLedger ?? "?"} - {intent.endLedger ?? "?"} ·{" "}
                      {intent.executionCount ?? "?"}/{intent.maxExecutions ?? "?"} executions ·
                      policy v{intent.policyVersion ?? "?"}
                    </span>
                  </small>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      disabled={
                        !relayerSessionActive ||
                        intent.unreadable ||
                        intent.startLedger === null ||
                        intent.endLedger === null ||
                        status === "cancelled" ||
                        status === "expired" ||
                        status === "exhausted" ||
                        queueIntentMutation.isPending
                      }
                      onClick={() => queueIntentMutation.mutate(intent)}
                      size="sm"
                      title={
                        relayerSessionActive
                          ? undefined
                          : "Unlock the relayer session first, in the Relayer panel."
                      }
                      variant="secondary"
                    >
                      <RadioTower size={16} />
                      Queue relayer
                    </Button>
                    <Button
                      disabled={status === "cancelled" || intent.unreadable}
                      onClick={() => setCancelIntentId(intent.intentId)}
                      size="sm"
                      variant="secondary"
                    >
                      <XCircle size={16} />
                      Load into cancel form
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="grid min-h-32 place-items-center rounded-lg border border-dashed bg-background p-6 text-center text-sm text-muted-foreground">
            {wallet.connected
              ? "No scheduled payment was created on this treasury within the RPC event window."
              : "Connect a wallet to list this treasury's scheduled payments."}
          </div>
        )}

        <div className="flex items-start gap-2 rounded-md bg-secondary p-3 text-sm text-muted-foreground">
          <CircleDashed className="mt-0.5 shrink-0 text-primary" size={18} />
          <span>
            <code>intent_registry</code> has no listing entrypoint, so this reads the ids from
            its <code>IntentCreated</code> events and the state from <code>get_intent</code>.
            RPC keeps events for a rolling window
            {eventRetentionDays === null ? "" : ` of about ${eventRetentionDays} days`}: an older
            intent disappears from this list while staying valid on-chain and executable by the
            relayer. Times are estimated at {LEDGER_CLOSE_SECONDS}s per ledger, so they drift the
            further ahead they reach.
            {intentsQuery.data?.truncated
              ? " This scan hit its page limit, so the list may be incomplete."
              : ""}
          </span>
        </div>
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
