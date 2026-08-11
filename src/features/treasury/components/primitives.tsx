"use client";

import { CheckCircle2, CircleAlert, CircleDashed, XCircle } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { STELLAR_CONFIG } from "@/config";
import type { ExecutionStep, NetworkHealth, SimulationResult } from "@/types";
import type { RelayerJobRecord } from "@/lib/relayer/types";

export function SectionHeader({
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

export function EmptyState({ description, title }: { description: string; title: string }) {
  return (
    <div className="grid min-h-32 place-items-center gap-1 rounded-lg border border-dashed bg-background p-6 text-center">
      <strong className="text-sm">{title}</strong>
      <span className="text-sm text-muted-foreground">{description}</span>
    </div>
  );
}

export function Notice({ result }: { result: SimulationResult }) {
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
            href={`${STELLAR_CONFIG.explorerBaseUrl}/tx/${result.txHash}`}
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

/**
 * Builds the standard "wallet / pending / error" fallbacks shared by every
 * section that reads chain state through a TanStack query. Returns `null` when
 * the query has settled successfully so the caller can render its own body.
 *
 * This is a plain function rather than a component on purpose: callers branch
 * on the returned value (`fallback ?? <body />`), which only works if the null
 * is produced eagerly.
 */
export function renderQueryFallback({
  connected,
  errorTitle,
  isError,
  isPending,
  error,
  pendingTitle,
  disconnectedDescription,
}: {
  connected: boolean;
  disconnectedDescription: string;
  error: unknown;
  errorTitle: string;
  isError: boolean;
  isPending: boolean;
  pendingTitle: string;
}): ReactNode {
  if (!connected) {
    return <EmptyState description={disconnectedDescription} title="Wallet not connected" />;
  }
  if (isPending) {
    return <EmptyState description="Simulating contract reads." title={pendingTitle} />;
  }
  if (isError) {
    return (
      <Notice
        result={{
          ok: false,
          title: errorTitle,
          detail: error instanceof Error ? error.message : String(error),
        }}
      />
    );
  }
  return null;
}

export function StatusPill({ health }: { health: NetworkHealth }) {
  const labels = {
    idle: "Not connected",
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

export function StatusBadge({ label }: { label: RelayerJobRecord["status"] }) {
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

export function Metric({
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

export function FormField({
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

export function TimelineStep({ step }: { step: ExecutionStep }) {
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

export function Capability({
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
