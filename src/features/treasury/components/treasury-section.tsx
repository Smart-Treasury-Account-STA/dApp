'use client'

import {
  ClipboardCheck,
  ExternalLink,
  KeyRound,
  LockKeyhole,
  RadioTower,
  ShieldCheck,
  Split,
  Workflow,
} from 'lucide-react'

import { Separator } from '@/components/ui/separator'
import { STELLAR_CONFIG, buildContractList } from '@/config'
import {
  Capability,
  EmptyState,
  Metric,
  SectionHeader,
  StatusPill,
  TimelineStep,
  renderQueryFallback,
} from '@/features/treasury/components/primitives'
import type { AssetReadiness } from '@/lib/assetHolding'
import type { ContractSet } from '@/lib/env'
import { formatNumber, truncateAddress } from '@/lib/format'
import type { SmartAccountAuthPlan } from '@/lib/smartAccountAuth'
import type { ContextRule, NetworkHealth, TreasuryStatus } from '@/types'

export type TreasurySnapshot = {
  status: TreasuryStatus
  policyVersion: number
  latestLedger: number
}

export function TreasurySection({
  assetReadiness,
  connected,
  contracts = STELLAR_CONFIG.contracts,
  error,
  health,
  isError,
  isPending,
  snapshot,
}: {
  /** Null while the holding is still loading, or when no wallet is connected. */
  assetReadiness: AssetReadiness | null
  connected: boolean
  contracts?: ContractSet
  error: unknown
  health: NetworkHealth
  isError: boolean
  isPending: boolean
  snapshot: TreasurySnapshot | null
}) {
  const treasuryLocked = snapshot
    ? snapshot.status.paused ||
      snapshot.status.frozen ||
      !snapshot.status.initialized
    : false

  const fallback = renderQueryFallback({
    connected,
    disconnectedDescription: 'Connect a wallet to read treasury state.',
    error,
    errorTitle: 'Treasury read failed',
    isError,
    isPending,
    pendingTitle: 'Reading treasury state',
  })

  return (
    <section
      id="treasury"
      className="bg-card grid gap-4 rounded-lg border p-5 shadow-sm"
    >
      <SectionHeader
        eyebrow="Deployed V1 contracts"
        icon={<StatusPill health={health} />}
        title="Treasury state"
      />

      {fallback ??
        (snapshot === null ? (
          <EmptyState
            description="Simulating contract reads."
            title="Reading treasury state"
          />
        ) : (
          <div className="grid grid-cols-4 gap-3 max-xl:grid-cols-2 max-sm:grid-cols-1">
            <Metric
              icon={<ShieldCheck size={20} />}
              label="Smart account"
              tone={snapshot.status.initialized ? 'good' : 'bad'}
              value={
                snapshot.status.initialized ? 'Initialized' : 'Not initialized'
              }
            />
            <Metric
              icon={<LockKeyhole size={20} />}
              label="Spend guard"
              tone={treasuryLocked ? 'bad' : 'good'}
              value={treasuryLocked ? 'Locked' : 'Active'}
            />
            <Metric
              icon={<ClipboardCheck size={20} />}
              label="Policy version"
              tone="neutral"
              value={String(snapshot.policyVersion)}
            />
            <Metric
              icon={<Workflow size={20} />}
              label="Latest ledger"
              tone="neutral"
              value={formatNumber(snapshot.latestLedger)}
            />
          </div>
        ))}

      {/* The token contract's own gate, which nothing in `status` reflects: a
          treasury the issuer has not authorized and one that is merely empty
          look identical there, and the difference only surfaces as a failed
          payment. Kept out of the Metric grid because it needs a sentence, not
          a value. */}
      {assetReadiness && !assetReadiness.ready ? (
        <div className="border-warning/40 bg-warning/10 text-warning rounded-md border p-3 text-sm">
          <strong>
            Asset {truncateAddress(contracts.defaultAsset)}:{' '}
            {assetReadiness.reason === 'missing'
              ? 'no trustline'
              : assetReadiness.reason === 'deauthorized'
                ? 'not authorized'
                : 'no balance'}
            .
          </strong>{' '}
          {assetReadiness.message} No payment, split or scheduled execution of
          this asset can succeed from this treasury until that is resolved.
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2 max-lg:grid-cols-1">
        {buildContractList(contracts).map(([name, address]) => (
          <a
            className="bg-background hover:bg-secondary flex min-h-12 items-center justify-between gap-3 rounded-md border px-3 text-sm transition-colors"
            href={`${STELLAR_CONFIG.explorerBaseUrl}/contract/${address}`}
            key={address}
            rel="noreferrer"
            target="_blank"
          >
            <span className="font-semibold">{name}</span>
            <code className="text-muted-foreground text-xs">
              {truncateAddress(address, 9, 7)}
            </code>
            <ExternalLink size={16} />
          </a>
        ))}
      </div>
    </section>
  )
}

export function ApprovalPlanSection({
  authPlan,
  connected,
  error,
  isError,
  isPending,
  rules,
}: {
  authPlan: SmartAccountAuthPlan
  connected: boolean
  error: unknown
  isError: boolean
  isPending: boolean
  rules: ContextRule[]
}) {
  const fallback = renderQueryFallback({
    connected,
    disconnectedDescription:
      'Connect a wallet to load context rules from the smart account.',
    error,
    errorTitle: 'Context rules read failed',
    isError,
    isPending,
    pendingTitle: 'Reading context rules',
  })

  return (
    <div className="bg-card grid gap-4 rounded-lg border p-5 shadow-sm">
      <SectionHeader
        eyebrow="Custom account authorization"
        icon={<KeyRound className="text-primary" size={22} />}
        title="Approval plan"
      />

      <div className="grid gap-2">
        {fallback ??
          (rules.length === 0 ? (
            <EmptyState
              description="The smart account has no context rules configured."
              title="No context rules configured"
            />
          ) : (
            rules.map((rule) => (
              <div
                className="bg-background grid grid-cols-[88px_1fr] gap-x-3 gap-y-1 rounded-md border p-3 text-sm"
                key={rule.id}
              >
                <strong>Rule {rule.id}</strong>
                <span>{rule.contextType}</span>
                <small className="text-muted-foreground col-start-2">
                  {rule.signerCount} signer{rule.signerCount === 1 ? '' : 's'} ·{' '}
                  {rule.policyCount} policy attachment
                  {rule.policyCount === 1 ? '' : 's'}
                </small>
              </div>
            ))
          ))}
      </div>

      <Separator />

      <div className="grid gap-1">
        {authPlan.steps.map((step) => (
          <TimelineStep key={step.label} step={step} />
        ))}
      </div>
    </div>
  )
}

export function CapabilitiesSection() {
  return (
    <section className="bg-card mb-4 grid gap-4 rounded-lg border p-5 shadow-sm">
      <div>
        <span className="text-muted-foreground mb-1 block text-xs font-bold uppercase">
          Implementation boundary
        </span>
        <h2 className="text-lg font-semibold">What this dApp enforces</h2>
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
  )
}
