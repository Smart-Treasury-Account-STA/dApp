"use client";

import {
  Activity,
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  CircleDashed,
  ClipboardCheck,
  ExternalLink,
  KeyRound,
  LockKeyhole,
  Moon,
  RadioTower,
  RefreshCcw,
  SendHorizontal,
  ShieldCheck,
  Split,
  Sun,
  Wallet,
  Workflow,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTheme } from "next-themes";
import type { ComponentProps, ReactNode } from "react";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { CONTRACTS, LEDGER_CLOSE_SECONDS, TESTNET_CONFIG } from "@/config";
import { formatNumber, makeIntentId, makeNonce, truncateAddress } from "@/lib/format";
import { buildTransferAuthPlan } from "@/lib/smartAccountAuth";
import {
  approveAndSubmitSchedule,
  approveAndSubmitTransfer,
  checkNonce,
  getLatestLedger,
  loadContextRules,
  loadTreasurySnapshot,
  simulatePolicy,
  simulateSchedule,
  simulateTransfer,
} from "@/lib/stellarClient";
import { connectWallet } from "@/lib/wallet";
import { signAuthEntry, signTransaction } from "@/lib/wallet";
import type {
  ContextRule,
  ExecutionStep,
  NetworkHealth,
  PaymentDraft,
  ScheduleDraft,
  SimulationResult,
  TreasuryStatus,
  WalletState,
} from "@/types";
import {
  executeRelayerJob,
  fetchRelayerJobs,
  queueRelayerJob,
  runDueRelayerJobs,
} from "@/features/treasury/relayer-client";
import type { CreateRelayerJobInput, RelayerJobRecord } from "@/lib/relayer/types";

const initialWallet: WalletState = {
  address: null,
  walletName: null,
  connected: false,
};

const demoStatus: TreasuryStatus = {
  initialized: true,
  paused: false,
  frozen: false,
  policyVersionHint: 0,
};

const demoRules: ContextRule[] = [
  {
    id: 0,
    name: "Founding delegated signer",
    contextType: "Default",
    signerCount: 1,
    signerAddresses: [],
    policyCount: 0,
  },
];

const navItems: {
  href: string;
  icon: LucideIcon;
  label: string;
}[] = [
  { href: "#treasury", icon: Activity, label: "Treasury" },
  { href: "#payment", icon: SendHorizontal, label: "Payment" },
  { href: "#schedule", icon: CalendarClock, label: "Schedule" },
  { href: "#relayer", icon: RadioTower, label: "Relayer" },
];

export function TreasuryConsole() {
  const queryClient = useQueryClient();
  const { setTheme, resolvedTheme } = useTheme();
  const [wallet, setWallet] = useState<WalletState>(initialWallet);
  const [health, setHealth] = useState<NetworkHealth>("idle");
  const [status, setStatus] = useState<TreasuryStatus>(demoStatus);
  const [policyVersion, setPolicyVersion] = useState(1);
  const [latestLedger, setLatestLedger] = useState<number | null>(null);
  const [rules, setRules] = useState<ContextRule[]>(demoRules);
  const [notice, setNotice] = useState<SimulationResult | null>(null);
  const [relayerToken, setRelayerToken] = useState("");
  const [createdScheduleJob, setCreatedScheduleJob] =
    useState<CreateRelayerJobInput | null>(null);
  const [paymentDraft, setPaymentDraft] = useState<PaymentDraft>({
    asset: TESTNET_CONFIG.staAssetContractId,
    destination: TESTNET_CONFIG.testRecipient,
    amount: "5000000",
    nonce: makeNonce(),
    expectedPolicyVersion: 1,
  });
  const [scheduleDraft, setScheduleDraft] = useState<ScheduleDraft>({
    asset: TESTNET_CONFIG.staAssetContractId,
    destination: TESTNET_CONFIG.testRecipient,
    amount: "1000000",
    nonce: makeNonce(),
    expectedPolicyVersion: 1,
    intentId: makeIntentId(),
    startLedger: "0",
    endLedger: "0",
    maxExecutions: "1",
  });

  const authPlan = useMemo(
    () => buildTransferAuthPlan(paymentDraft, wallet, rules),
    [paymentDraft, rules, wallet],
  );
  const treasuryLocked = status.paused || status.frozen || !status.initialized;
  const relayerJobsQuery = useQuery({
    queryKey: ["relayer-jobs"],
    queryFn: fetchRelayerJobs,
  });
  const refreshStateMutation = useMutation({
    mutationFn: async () => {
      const source = wallet.address ?? TESTNET_CONFIG.testRecipient;
      const snapshot = await loadTreasurySnapshot(source);
      const nextRules = await loadContextRules(source);
      return { snapshot, nextRules };
    },
    onMutate: () => {
      setHealth("loading");
      setNotice(null);
    },
    onSuccess: ({ snapshot, nextRules }) => {
      setStatus(snapshot.status);
      setPolicyVersion(snapshot.policyVersion);
      setLatestLedger(snapshot.latestLedger);
      setRules(nextRules.length > 0 ? nextRules : demoRules);
      setPaymentDraft((draft) => ({
        ...draft,
        expectedPolicyVersion: snapshot.policyVersion,
      }));
      setScheduleDraft((draft) => ({
        ...draft,
        expectedPolicyVersion: snapshot.policyVersion,
        startLedger:
          draft.startLedger === "0" ? String(snapshot.latestLedger + 24) : draft.startLedger,
        endLedger:
          draft.endLedger === "0" ? String(snapshot.latestLedger + 744) : draft.endLedger,
      }));
      setHealth("ready");
    },
    onError: (error) => {
      setHealth("degraded");
      setNotice({
        ok: false,
        title: "Testnet read failed",
        detail:
          error instanceof Error
            ? error.message
            : "Could not read the deployed contracts. Demo values remain visible.",
      });
    },
  });
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
        paymentDraft,
      );
    },
    onMutate: () => {
      setNotice({
        ok: true,
        title: "Wallet approval requested",
        detail:
          "Approve the SmartAccount authorization entry, then approve the prepared transaction envelope.",
      });
    },
    onSuccess: (receipt) => {
      setNotice({
        ok: receipt.status === "SUCCESS",
        title: receipt.status === "SUCCESS" ? "Payment confirmed" : "Payment submitted",
        detail: `Transaction status: ${receipt.status}`,
        txHash: receipt.hash,
      });
      setPaymentDraft((draft) => ({ ...draft, nonce: makeNonce() }));
    },
    onError: (error) => {
      setNotice({
        ok: false,
        title: "Payment submission failed",
        detail: error instanceof Error ? error.message : String(error),
      });
    },
  });
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
        scheduleDraft,
      );
    },
    onMutate: () => {
      setNotice({
        ok: true,
        title: "Schedule approval requested",
        detail:
          "Approve the SmartAccount authorization entry and the prepared schedule transaction.",
      });
    },
    onSuccess: (receipt) => {
      const relayerJob: CreateRelayerJobInput = {
        intentId: scheduleDraft.intentId,
        startLedger: Number(scheduleDraft.startLedger),
        endLedger: Number(scheduleDraft.endLedger),
        maxExecutions: Number(scheduleDraft.maxExecutions),
      };
      setNotice({
        ok: receipt.status === "SUCCESS",
        title:
          receipt.status === "SUCCESS"
            ? "Scheduled payment created"
            : "Schedule submitted",
        detail: `Transaction status: ${receipt.status}`,
        txHash: receipt.hash,
      });
      if (receipt.status === "SUCCESS") {
        setCreatedScheduleJob(relayerJob);
        setScheduleDraft((draft) => ({
          ...draft,
          intentId: makeIntentId(),
        }));
      }
    },
    onError: (error) => {
      setNotice({
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
      if (!relayerToken.trim()) {
        throw new Error("Enter the relayer admin token before queueing.");
      }
      return queueRelayerJob(createdScheduleJob, relayerToken.trim());
    },
    onSuccess: (job) => {
      queryClient.invalidateQueries({ queryKey: ["relayer-jobs"] });
      setNotice({
        ok: true,
        title: "Relayer job queued",
        detail: `Intent ${job.intentId.slice(0, 8)} is queued with child_sequence ${job.childSequence}.`,
      });
    },
    onError: (error) => {
      setNotice({
        ok: false,
        title: "Could not queue relayer job",
        detail: error instanceof Error ? error.message : String(error),
      });
    },
  });
  const executeRelayerMutation = useMutation({
    mutationFn: (intentId: string) => {
      if (!relayerToken.trim()) {
        throw new Error("Enter the relayer admin token before execution.");
      }
      return executeRelayerJob(intentId, relayerToken.trim());
    },
    onSuccess: (job) => {
      queryClient.invalidateQueries({ queryKey: ["relayer-jobs"] });
      setNotice({
        ok: job.status === "executed",
        title: job.status === "executed" ? "Relayer executed payment" : "Relayer updated job",
        detail: job.note,
        txHash: job.txHash,
      });
    },
    onError: (error) => {
      setNotice({
        ok: false,
        title: "Relayer execution failed",
        detail: error instanceof Error ? error.message : String(error),
      });
    },
  });
  const runDueRelayerMutation = useMutation({
    mutationFn: () => {
      if (!relayerToken.trim()) {
        throw new Error("Enter the relayer admin token before running due jobs.");
      }
      return runDueRelayerJobs(relayerToken.trim());
    },
    onSuccess: (jobs) => {
      queryClient.invalidateQueries({ queryKey: ["relayer-jobs"] });
      setNotice({
        ok: true,
        title: "Relayer scan completed",
        detail: `${jobs.length} due job${jobs.length === 1 ? "" : "s"} updated.`,
      });
    },
    onError: (error) => {
      setNotice({
        ok: false,
        title: "Relayer scan failed",
        detail: error instanceof Error ? error.message : String(error),
      });
    },
  });

  async function onConnectWallet() {
    setNotice(null);
    try {
      const connected = await connectWallet();
      setWallet(connected);
      setNotice({
        ok: true,
        title: "Wallet connected",
        detail: `${truncateAddress(connected.address)} is connected on Stellar testnet.`,
      });
    } catch (error) {
      setNotice({
        ok: false,
        title: "Wallet connection failed",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function onRefreshState() {
    refreshStateMutation.mutate();
  }

  async function onPolicyCheck() {
    const source = wallet.address ?? TESTNET_CONFIG.testRecipient;
    setNotice(await simulatePolicy(source, paymentDraft));
  }

  async function onTransferSimulation() {
    const source = wallet.address ?? TESTNET_CONFIG.testRecipient;
    setNotice(await simulateTransfer(source, paymentDraft));
  }

  async function onNonceCheck() {
    try {
      const source = wallet.address ?? TESTNET_CONFIG.testRecipient;
      const used = await checkNonce(source, paymentDraft.nonce);
      setNotice({
        ok: !used,
        title: used ? "Nonce already consumed" : "Nonce is fresh",
        detail: used
          ? "Generate another nonce before preparing this payment."
          : "smart_account.is_nonce_used returned false on testnet.",
      });
    } catch (error) {
      setNotice({
        ok: false,
        title: "Nonce check failed",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function onScheduleSimulation() {
    const source = wallet.address ?? TESTNET_CONFIG.testRecipient;
    setNotice(await simulateSchedule(source, scheduleDraft));
  }

  function onTransferSubmit() {
    submitTransferMutation.mutate();
  }

  function onScheduleSubmit() {
    setCreatedScheduleJob(null);
    submitScheduleMutation.mutate();
  }

  function onQueueRelayerJob() {
    queueRelayerJobMutation.mutate();
  }

  function onRunDueRelayerJobs() {
    runDueRelayerMutation.mutate();
  }

  async function onUseLedgerWindow() {
    try {
      const ledger = await getLatestLedger();
      setLatestLedger(ledger);
      setScheduleDraft((draft) => ({
        ...draft,
        startLedger: String(ledger + 24),
        endLedger: String(ledger + 744),
      }));
    } catch (error) {
      setNotice({
        ok: false,
        title: "Ledger lookup failed",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return (
    <main className="grid min-h-screen grid-cols-[280px_minmax(0,1fr)] bg-background text-foreground max-lg:grid-cols-1">
      <aside className="sticky top-0 flex h-screen flex-col gap-7 bg-slate-950 p-6 text-slate-50 max-lg:static max-lg:h-auto">
        <div className="flex items-center gap-3">
          <ShieldCheck className="text-emerald-300" size={26} />
          <div>
            <strong className="block">STA Console</strong>
            <span className="text-xs text-slate-400">Stellar testnet</span>
          </div>
        </div>

        <nav className="grid gap-2 max-lg:grid-cols-4 max-sm:grid-cols-1" aria-label="Sections">
          {navItems.map(({ href, icon: Icon, label }) => (
            <a
              className="flex min-h-10 items-center gap-2 rounded-md px-3 text-sm text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
              href={href}
              key={href}
            >
              <Icon size={18} />
              {label}
            </a>
          ))}
        </nav>

        <div className="mt-auto grid gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4 max-lg:mt-0">
          <span className="text-xs font-semibold uppercase text-slate-400">Operator wallet</span>
          <strong>{truncateAddress(wallet.address)}</strong>
          <Button onClick={onConnectWallet}>
            <Wallet size={18} />
            Connect
          </Button>
        </div>
      </aside>

      <section className="grid content-start gap-5 p-7 max-sm:p-4">
        <header className="flex min-h-20 items-center justify-between gap-4 max-sm:flex-col max-sm:items-start">
          <div>
            <span className="mb-1 block text-xs font-bold uppercase text-muted-foreground">
              Tranche 2 deliverable console
            </span>
            <h1 className="text-3xl font-semibold tracking-normal max-sm:text-2xl">
              Smart Treasury Account operations
            </h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
              size="icon"
              variant="secondary"
              title="Toggle theme"
            >
              {/*
                Both icons are rendered and the active one is selected by the
                `dark` class that next-themes sets on <html> before first paint.
                Branching on `resolvedTheme` here hydrates mismatched: it is
                undefined on the server and during the first client render.
              */}
              <Sun aria-hidden className="hidden dark:block" size={18} />
              <Moon aria-hidden className="dark:hidden" size={18} />
            </Button>
            <Button
              disabled={refreshStateMutation.isPending}
              onClick={onRefreshState}
              variant="secondary"
            >
              <RefreshCcw size={18} />
              Refresh testnet
            </Button>
          </div>
        </header>

        {notice ? <Notice result={notice} /> : null}

        <section id="treasury" className="grid gap-4 rounded-lg border bg-card p-5 shadow-sm">
          <SectionHeader
            eyebrow="Deployed V1 contracts"
            icon={<StatusPill health={health} />}
            title="Treasury state"
          />

          <div className="grid grid-cols-4 gap-3 max-xl:grid-cols-2 max-sm:grid-cols-1">
            <Metric
              icon={<ShieldCheck size={20} />}
              label="Smart account"
              tone={status.initialized ? "good" : "bad"}
              value={status.initialized ? "Initialized" : "Not initialized"}
            />
            <Metric
              icon={<LockKeyhole size={20} />}
              label="Spend guard"
              tone={treasuryLocked ? "bad" : "good"}
              value={treasuryLocked ? "Locked" : "Active"}
            />
            <Metric
              icon={<ClipboardCheck size={20} />}
              label="Policy version"
              tone="neutral"
              value={String(policyVersion)}
            />
            <Metric
              icon={<Workflow size={20} />}
              label="Latest ledger"
              tone="neutral"
              value={latestLedger ? formatNumber(latestLedger) : "Load live"}
            />
          </div>

          <div className="grid grid-cols-2 gap-2 max-lg:grid-cols-1">
            {CONTRACTS.map(([name, address]) => (
              <a
                className="flex min-h-12 items-center justify-between gap-3 rounded-md border bg-background px-3 text-sm transition-colors hover:bg-secondary"
                href={`https://stellar.expert/explorer/testnet/contract/${address}`}
                key={address}
                rel="noreferrer"
                target="_blank"
              >
                <span className="font-semibold">{name}</span>
                <code className="text-xs text-muted-foreground">
                  {truncateAddress(address, 9, 7)}
                </code>
                <ExternalLink size={16} />
              </a>
            ))}
          </div>
        </section>

        <section className="grid grid-cols-[minmax(0,1.08fr)_minmax(340px,0.92fr)] gap-5 max-xl:grid-cols-1">
          <div id="payment" className="grid gap-4 rounded-lg border bg-card p-5 shadow-sm">
            <SectionHeader
              eyebrow="Prepare -> simulate -> approve"
              icon={<SendHorizontal className="text-primary" size={22} />}
              title="SAC payment"
            />

            <FormField
              label="Asset contract"
              onChange={(asset) => setPaymentDraft((draft) => ({ ...draft, asset }))}
              value={paymentDraft.asset}
            />
            <FormField
              label="Destination"
              onChange={(destination) =>
                setPaymentDraft((draft) => ({ ...draft, destination }))
              }
              value={paymentDraft.destination}
            />
            <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
              <FormField
                label="Amount"
                onChange={(amount) => setPaymentDraft((draft) => ({ ...draft, amount }))}
                value={paymentDraft.amount}
              />
              <FormField
                label="Policy version"
                onChange={(value) =>
                  setPaymentDraft((draft) => ({
                    ...draft,
                    expectedPolicyVersion: Number(value) || 1,
                  }))
                }
                value={String(paymentDraft.expectedPolicyVersion)}
              />
            </div>
            <FormField
              action={
                <Button
                  onClick={() =>
                    setPaymentDraft((draft) => ({ ...draft, nonce: makeNonce() }))
                  }
                  size="icon"
                  title="Generate nonce"
                  type="button"
                  variant="secondary"
                >
                  <RefreshCcw size={16} />
                </Button>
              }
              label="Nonce"
              onChange={(nonce) => setPaymentDraft((draft) => ({ ...draft, nonce }))}
              value={paymentDraft.nonce}
            />

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
                disabled={!wallet.connected || submitTransferMutation.isPending}
                onClick={onTransferSubmit}
              >
                <Wallet size={18} />
                Approve & submit
              </Button>
            </div>
          </div>

          <div className="grid gap-4 rounded-lg border bg-card p-5 shadow-sm">
            <SectionHeader
              eyebrow="Custom account authorization"
              icon={<KeyRound className="text-primary" size={22} />}
              title="Approval plan"
            />

            <div className="grid gap-2">
              {rules.map((rule) => (
                <div className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-1 rounded-md border bg-background p-3 text-sm" key={rule.id}>
                  <strong>Rule {rule.id}</strong>
                  <span>{rule.contextType}</span>
                  <small className="col-start-2 text-muted-foreground">
                    {rule.signerCount} signer{rule.signerCount === 1 ? "" : "s"} ·{" "}
                    {rule.policyCount} policy attachment{rule.policyCount === 1 ? "" : "s"}
                  </small>
                </div>
              ))}
            </div>

            <Separator />

            <div className="grid gap-1">
              {authPlan.steps.map((step) => (
                <TimelineStep key={step.label} step={step} />
              ))}
            </div>
          </div>
        </section>

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
                    setScheduleDraft((draft) => ({ ...draft, intentId: makeIntentId() }))
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
              onChange={(intentId) =>
                setScheduleDraft((draft) => ({ ...draft, intentId }))
              }
              value={scheduleDraft.intentId}
            />
            <FormField
              label="Amount"
              onChange={(amount) => setScheduleDraft((draft) => ({ ...draft, amount }))}
              value={scheduleDraft.amount}
            />
            <FormField
              label="Start ledger"
              onChange={(startLedger) =>
                setScheduleDraft((draft) => ({ ...draft, startLedger }))
              }
              value={scheduleDraft.startLedger}
            />
            <FormField
              label="End ledger"
              onChange={(endLedger) =>
                setScheduleDraft((draft) => ({ ...draft, endLedger }))
              }
              value={scheduleDraft.endLedger}
            />
            <FormField
              label="Max executions"
              onChange={(maxExecutions) =>
                setScheduleDraft((draft) => ({ ...draft, maxExecutions }))
              }
              value={scheduleDraft.maxExecutions}
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
              <Wallet size={18} />
              Approve & create
            </Button>
            <Button
              disabled={
                !createdScheduleJob ||
                !relayerToken.trim() ||
                queueRelayerJobMutation.isPending
              }
              onClick={onQueueRelayerJob}
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
                Intent {truncateAddress(createdScheduleJob.intentId, 8, 8)} is confirmed and
                ready to queue for ledgers {createdScheduleJob.startLedger} -{" "}
                {createdScheduleJob.endLedger}.
              </span>
            </div>
          ) : null}

          <div className="flex items-start gap-2 rounded-md bg-secondary p-3 text-sm text-muted-foreground">
            <CircleDashed className="mt-0.5 shrink-0 text-primary" size={18} />
            <span>
              Ledger windows are approximate in wall-clock terms. At about{" "}
              {LEDGER_CLOSE_SECONDS}s per ledger, the default window starts near two
              minutes from now and lasts one hour.
            </span>
          </div>
        </section>

        <section id="relayer" className="grid gap-4 rounded-lg border bg-card p-5 shadow-sm">
          <SectionHeader
            eyebrow="No custody, no bypass"
            icon={<RadioTower className="text-primary" size={22} />}
            title="Scheduled payment relayer"
          />

          <div className="grid gap-3 rounded-md border bg-background p-3">
            <Label htmlFor="relayer-token">Relayer admin token</Label>
            <div className="flex gap-2 max-sm:flex-col">
              <Input
                autoComplete="off"
                id="relayer-token"
                onChange={(event) => setRelayerToken(event.target.value)}
                placeholder="Required for queue and run"
                type="password"
                value={relayerToken}
              />
              <Button
                disabled={!relayerToken.trim() || runDueRelayerMutation.isPending}
                onClick={onRunDueRelayerJobs}
                type="button"
                variant="secondary"
              >
                <Workflow size={18} />
                Run due jobs
              </Button>
            </div>
          </div>

          {relayerJobsQuery.data?.length ? (
            <div className="grid grid-cols-3 gap-3 max-xl:grid-cols-1">
              {relayerJobsQuery.data.map((job) => (
                <div
                  className="grid min-h-44 content-start gap-3 rounded-lg border bg-background p-4"
                  key={`${job.intentId}-${job.childSequence}`}
                >
                  <div className="grid gap-1">
                    <strong>{job.intentId}</strong>
                    <span className="text-sm text-muted-foreground">
                      child_sequence {job.childSequence}
                    </span>
                  </div>
                  <StatusBadge label={job.status} />
                  <p className="m-0 text-sm leading-6 text-muted-foreground">{job.note}</p>
                  <small className="text-muted-foreground">
                    ledgers {job.startLedger} - {job.endLedger}
                  </small>
                  <Button
                    disabled={!relayerToken.trim() || executeRelayerMutation.isPending}
                    onClick={() => executeRelayerMutation.mutate(job.intentId)}
                    size="sm"
                    variant="secondary"
                  >
                    <RadioTower size={16} />
                    Execute
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid min-h-32 place-items-center rounded-lg border border-dashed bg-background p-6 text-center text-sm text-muted-foreground">
              No scheduled relayer jobs are queued yet.
            </div>
          )}
        </section>

        <section className="mb-4 grid gap-4 rounded-lg border bg-card p-5 shadow-sm">
          <div>
            <span className="mb-1 block text-xs font-bold uppercase text-muted-foreground">
              Implementation boundary
            </span>
            <h2 className="text-lg font-semibold">What this dApp enforces for Tranche 2</h2>
          </div>
          <div className="grid grid-cols-4 gap-3 max-xl:grid-cols-2 max-sm:grid-cols-1">
            <Capability
              icon={<ShieldCheck size={20} />}
              text="Reads policy_engine.version fresh and pins expected_policy_version into payment drafts."
              title="Policy pinning"
            />
            <Capability
              icon={<KeyRound size={20} />}
              text="Generates u64 nonces, checks smart_account.is_nonce_used, and keeps scheduled child_sequence separate."
              title="Replay protection"
            />
            <Capability
              icon={<Split size={20} />}
              text="Models Entry A AuthPayload and Entry B delegated signer approvals as first-class execution steps."
              title="Custom auth ready"
            />
            <Capability
              icon={<RadioTower size={20} />}
              text="Treats relayer execution as executor-gated status work, never as a custody or policy bypass path."
              title="Relayer guardrails"
            />
          </div>
        </section>
      </section>
    </main>
  );
}

function SectionHeader({
  eyebrow,
  icon,
  title,
}: {
  eyebrow: string;
  icon: ReactNode;
  title: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <span className="mb-1 block text-xs font-bold uppercase text-muted-foreground">
          {eyebrow}
        </span>
        <h2 className="text-lg font-semibold tracking-normal">{title}</h2>
      </div>
      {icon}
    </div>
  );
}

function Notice({ result }: { result: SimulationResult }) {
  const Icon = result.ok ? CheckCircle2 : XCircle;
  return (
    <div
      className={`flex items-start gap-3 rounded-lg border p-4 text-sm ${
        result.ok
          ? "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
          : "border-red-200 bg-red-50 text-red-950 dark:border-red-900 dark:bg-red-950 dark:text-red-100"
      }`}
    >
      <Icon className="mt-0.5 shrink-0" size={20} />
      <div className="grid gap-1">
        <strong>{result.title}</strong>
        <span>{result.detail}</span>
        {result.txHash ? (
          <a
            className="font-semibold underline underline-offset-4"
            href={`https://stellar.expert/explorer/testnet/tx/${result.txHash}`}
            rel="noreferrer"
            target="_blank"
          >
            View transaction
          </a>
        ) : null}
        {result.diagnostic ? <code className="text-xs">{result.diagnostic}</code> : null}
      </div>
    </div>
  );
}

function StatusPill({ health }: { health: NetworkHealth }) {
  const labels = {
    idle: "Demo state",
    loading: "Reading RPC",
    ready: "Live testnet",
    degraded: "RPC degraded",
  } satisfies Record<NetworkHealth, string>;
  const variants = {
    idle: "default",
    loading: "info",
    ready: "success",
    degraded: "destructive",
  } satisfies Record<NetworkHealth, ComponentProps<typeof Badge>["variant"]>;

  return <Badge variant={variants[health]}>{labels[health]}</Badge>;
}

function StatusBadge({
  label,
}: {
  label: RelayerJobRecord["status"];
}) {
  const variants = {
    scheduled: "warning",
    ready: "info",
    executed: "success",
    blocked: "destructive",
    executing: "info",
    failed: "destructive",
  } satisfies Record<
    RelayerJobRecord["status"],
    ComponentProps<typeof Badge>["variant"]
  >;

  return (
    <Badge className="w-fit" variant={variants[label]}>
      {label}
    </Badge>
  );
}

function Metric({
  icon,
  label,
  value,
  tone,
}: {
  icon: ReactNode;
  label: string;
  tone: "good" | "bad" | "neutral";
  value: string;
}) {
  const toneClass = {
    good: "text-emerald-700 dark:text-emerald-300",
    bad: "text-red-700 dark:text-red-300",
    neutral: "text-foreground",
  } satisfies Record<"good" | "bad" | "neutral", string>;

  return (
    <div className="grid min-h-28 content-start gap-2 rounded-lg border bg-background p-4">
      <span className="text-primary">{icon}</span>
      <span className="text-sm text-muted-foreground">{label}</span>
      <strong className={toneClass[tone]}>{value}</strong>
    </div>
  );
}

function FormField({
  action,
  label,
  onChange,
  value,
}: {
  action?: ReactNode;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input value={value} onChange={(event) => onChange(event.target.value)} />
        {action}
      </div>
    </div>
  );
}

function TimelineStep({ step }: { step: ExecutionStep }) {
  const icons = {
    complete: <CheckCircle2 size={18} />,
    active: <CircleAlert size={18} />,
    pending: <CircleDashed size={18} />,
    blocked: <XCircle size={18} />,
  } satisfies Record<ExecutionStep["state"], ReactNode>;
  const colors = {
    complete: "text-emerald-600",
    active: "text-amber-600",
    pending: "text-muted-foreground",
    blocked: "text-red-600",
  } satisfies Record<ExecutionStep["state"], string>;

  return (
    <div className="flex items-start gap-3 py-2">
      <span className={colors[step.state]}>{icons[step.state]}</span>
      <div className="grid gap-1">
        <strong className="text-sm">{step.label}</strong>
        <span className="text-sm leading-6 text-muted-foreground">{step.detail}</span>
      </div>
    </div>
  );
}

function Capability({
  icon,
  text,
  title,
}: {
  icon: ReactNode;
  text: string;
  title: string;
}) {
  return (
    <div className="grid min-h-36 content-start gap-2 rounded-lg border bg-background p-4">
      <span className="text-primary">{icon}</span>
      <strong>{title}</strong>
      <span className="text-sm leading-6 text-muted-foreground">{text}</span>
    </div>
  );
}
