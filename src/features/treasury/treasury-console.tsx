"use client";

import {
  Activity,
  CalendarClock,
  LogOut,
  Moon,
  RadioTower,
  RefreshCcw,
  SendHorizontal,
  ShieldCheck,
  Sun,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { STELLAR_CONFIG } from "@/config";
import { computeLedgerWindow } from "@/features/treasury/drafts";
import { makeIntentId, makeNonce, truncateAddress } from "@/lib/format";
import { buildTransferAuthPlan } from "@/lib/smartAccountAuth";
import { buildToastFeedback } from "@/lib/toastFeedback";
import { connectWallet, disconnectWallet } from "@/lib/wallet";
import type {
  NetworkHealth,
  PaymentDraft,
  ScheduleDraft,
  SimulationResult,
  WalletState,
} from "@/types";
import { useContextRules, useTreasurySnapshot } from "@/features/treasury/queries";
import { PaymentSection } from "@/features/treasury/components/payment-section";
import { RelayerSection } from "@/features/treasury/components/relayer-section";
import { ScheduleSection } from "@/features/treasury/components/schedule-section";
import {
  ApprovalPlanSection,
  CapabilitiesSection,
  TreasurySection,
} from "@/features/treasury/components/treasury-section";

const initialWallet: WalletState = {
  address: null,
  walletName: null,
  connected: false,
};

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
  const { setTheme, resolvedTheme } = useTheme();
  const [wallet, setWallet] = useState<WalletState>(initialWallet);
  const [notice, setNotice] = useState<SimulationResult | null>(null);
  const [relayerSessionActive, setRelayerSessionActive] = useState(false);
  const [paymentDraft, setPaymentDraft] = useState<PaymentDraft>({
    asset: STELLAR_CONFIG.contracts.staAsset,
    destination: STELLAR_CONFIG.testRecipient,
    amount: "5000000",
    nonce: makeNonce(),
    expectedPolicyVersion: 1,
  });
  const [scheduleDraft, setScheduleDraft] = useState<ScheduleDraft>({
    asset: STELLAR_CONFIG.contracts.staAsset,
    destination: STELLAR_CONFIG.testRecipient,
    amount: "1000000",
    nonce: makeNonce(),
    expectedPolicyVersion: 1,
    intentId: makeIntentId(),
    startLedger: "0",
    endLedger: "0",
    maxExecutions: "1",
  });

  const snapshotQuery = useTreasurySnapshot(wallet.address);
  const rulesQuery = useContextRules(wallet.address);

  const policyVersion = snapshotQuery.data?.policyVersion ?? null;
  const latestLedger = snapshotQuery.data?.latestLedger ?? null;
  const rules = useMemo(() => rulesQuery.data ?? [], [rulesQuery.data]);

  const health: NetworkHealth = !wallet.connected
    ? "idle"
    : snapshotQuery.isPending
      ? "loading"
      : snapshotQuery.isError
        ? "degraded"
        : "ready";

  const authPlan = useMemo(
    () => buildTransferAuthPlan(paymentDraft, wallet, rules),
    [paymentDraft, rules, wallet],
  );

  // Raise every notice as a toast. The actions that produce one sit far down a
  // 3000px page, so a fixed header panel was invisible to whoever just
  // clicked; the toast follows them wherever they are on the page instead.
  // buildToastFeedback folds the diagnostic's first line and an explorer link
  // into it, so removing the header panel does not silently drop that detail.
  useEffect(() => {
    if (!notice) return;
    const feedback = buildToastFeedback(notice, STELLAR_CONFIG.explorerBaseUrl);
    const show =
      feedback.kind === "success"
        ? toast.success
        : feedback.kind === "warning"
          ? toast.warning
          : toast.error;
    show(feedback.title, {
      description: feedback.description,
      action: feedback.explorerUrl
        ? {
            label: "View transaction",
            onClick: () => window.open(feedback.explorerUrl as string, "_blank"),
          }
        : undefined,
    });
  }, [notice]);

  // Seed both drafts' expectedPolicyVersion, and the schedule draft's ledger
  // window, from the live on-chain state the first time it's successfully
  // read for a given wallet, so the operator doesn't have to hand-copy the
  // policy version from the "Policy version" Metric or click "Use current
  // ledger" before a first "Simulate schedule". Keyed by address (not a
  // one-shot flag) so reconnecting a different wallet resyncs once, but this
  // never clobbers an in-progress manual edit on subsequent refetches of the
  // same wallet's snapshot.
  const syncedPolicyVersionAddressRef = useRef<string | null>(null);
  useEffect(() => {
    if (policyVersion === null || latestLedger === null) return;
    if (syncedPolicyVersionAddressRef.current === wallet.address) return;
    syncedPolicyVersionAddressRef.current = wallet.address;
    setPaymentDraft((draft) => ({ ...draft, expectedPolicyVersion: policyVersion }));
    setScheduleDraft((draft) => {
      const next = { ...draft, expectedPolicyVersion: policyVersion };
      if (draft.startLedger === "0" && draft.endLedger === "0") {
        const { startLedger, endLedger } = computeLedgerWindow(latestLedger);
        next.startLedger = String(startLedger);
        next.endLedger = String(endLedger);
      }
      return next;
    });
  }, [latestLedger, policyVersion, wallet.address]);

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

  function onDisconnectWallet() {
    disconnectWallet();
    setWallet(initialWallet);
    setNotice({
      ok: true,
      title: "Wallet disconnected",
      detail: "Treasury reads are paused until a wallet is connected again.",
    });
  }

  async function onRefreshState() {
    setNotice(null);
    snapshotQuery.refetch();
    rulesQuery.refetch();
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
          <strong className="break-all">{truncateAddress(wallet.address)}</strong>
          {wallet.connected ? (
            <Button onClick={onDisconnectWallet}>
              <LogOut size={18} />
              Disconnect
            </Button>
          ) : (
            <Button onClick={onConnectWallet}>
              <Wallet size={18} />
              Connect
            </Button>
          )}
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
              disabled={snapshotQuery.isFetching || rulesQuery.isFetching}
              onClick={onRefreshState}
              variant="secondary"
            >
              <RefreshCcw size={18} />
              Refresh testnet
            </Button>
          </div>
        </header>

        <TreasurySection
          connected={wallet.connected}
          error={snapshotQuery.error}
          health={health}
          isError={snapshotQuery.isError}
          isPending={snapshotQuery.isPending}
          snapshot={snapshotQuery.data ?? null}
        />

        <section className="grid grid-cols-[minmax(0,1.08fr)_minmax(340px,0.92fr)] gap-5 max-xl:grid-cols-1">
          <PaymentSection
            draft={paymentDraft}
            onDraftChange={setPaymentDraft}
            onNotice={setNotice}
            wallet={wallet}
          />

          <ApprovalPlanSection
            authPlan={authPlan}
            connected={wallet.connected}
            error={rulesQuery.error}
            isError={rulesQuery.isError}
            isPending={rulesQuery.isPending}
            rules={rules}
          />
        </section>

        <ScheduleSection
          draft={scheduleDraft}
          onDraftChange={setScheduleDraft}
          onNotice={setNotice}
          relayerSessionActive={relayerSessionActive}
          wallet={wallet}
        />

        <RelayerSection
          onNotice={setNotice}
          onSessionActiveChange={setRelayerSessionActive}
          sessionActive={relayerSessionActive}
        />

        <CapabilitiesSection />
      </section>
    </main>
  );
}
