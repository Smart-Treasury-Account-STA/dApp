'use client'

import { useEffect, useState } from 'react'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, LockKeyhole, RadioTower, Workflow } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { STELLAR_CONFIG } from '@/config'
import {
  SectionHeader,
  StatusBadge,
} from '@/features/treasury/components/primitives'
import {
  closeRelayerSession,
  executeRelayerJob,
  fetchRelayerJobs,
  openRelayerSession,
  probeRelayerSession,
  runDueRelayerJobs,
} from '@/features/treasury/relayer-client'
import type { ContractSet } from '@/lib/env'
import { truncateAddress } from '@/lib/format'
import { isTerminalRelayerJob } from '@/lib/relayer/jobStatus'
import { OPERATOR_SUBJECT } from '@/lib/relayer/session'
import type { SimulationResult } from '@/types'

export function RelayerSection({
  contracts = STELLAR_CONFIG.contracts,
  onNotice,
  onSessionActiveChange,
  sessionActive,
}: {
  contracts?: ContractSet
  onNotice: (notice: SimulationResult | null) => void
  onSessionActiveChange: (active: boolean) => void
  sessionActive: boolean
}) {
  const queryClient = useQueryClient()
  // The unlock input is transient: it is cleared the instant unlock is
  // submitted and never persisted to localStorage/sessionStorage. The admin
  // token itself is exchanged for an httpOnly session cookie by the server
  // and never lives in component state that outlives the submit.
  const [relayerUnlockInput, setRelayerUnlockInput] = useState('')
  const relayerJobsQueryKey = ['relayer-jobs', contracts.smartAccount]
  // Not keyed by treasury: the session authorizes the relayer API as a whole,
  // not one treasury's jobs.
  const sessionProbeQueryKey = ['relayer-session']

  const relayerJobsQuery = useQuery({
    queryKey: relayerJobsQueryKey,
    queryFn: () => fetchRelayerJobs(contracts.smartAccount),
  })

  // The session cookie is httpOnly and outlives the page, so a fresh load has
  // to ask the server whether it is still unlocked. Without this every
  // relayer-gated control sits disabled after a refresh while the server
  // keeps accepting the calls behind them.
  const sessionProbe = useQuery({
    queryKey: sessionProbeQueryKey,
    queryFn: probeRelayerSession,
    staleTime: 30_000,
  })

  useEffect(() => {
    if (sessionProbe.data === undefined) return
    onSessionActiveChange(sessionProbe.data.active)
    // Only when the probed answer itself changes. `onSessionActiveChange` is a
    // fresh closure on every parent render, and depending on it would push
    // state upward in a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionProbe.data])

  const openRelayerSessionMutation = useMutation({
    mutationFn: openRelayerSession,
    onSuccess: () => {
      // Keep the probe's cache in step with what just happened, so a later
      // refetch or remount cannot re-assert the previous answer.
      queryClient.setQueryData(sessionProbeQueryKey, {
        active: true,
        subject: OPERATOR_SUBJECT,
      })
      onSessionActiveChange(true)
      onNotice({
        ok: true,
        title: 'Relayer session unlocked',
        detail:
          'An httpOnly session cookie was issued; the operator token was not stored in the browser.',
      })
    },
    onError: (error) => {
      queryClient.setQueryData(sessionProbeQueryKey, {
        active: false,
        subject: null,
      })
      onSessionActiveChange(false)
      onNotice({
        ok: false,
        title: 'Relayer unlock failed',
        detail: error instanceof Error ? error.message : String(error),
      })
    },
    onSettled: () => {
      // The operator token passed as this mutation's `variables` would
      // otherwise linger in the TanStack Query cache until garbage
      // collection (~5 min). Reset immediately so it doesn't stick around
      // longer than necessary.
      openRelayerSessionMutation.reset()
    },
  })
  const closeRelayerSessionMutation = useMutation({
    mutationFn: closeRelayerSession,
    onSuccess: () => {
      queryClient.setQueryData(sessionProbeQueryKey, {
        active: false,
        subject: null,
      })
      onSessionActiveChange(false)
      onNotice({
        ok: true,
        title: 'Relayer session locked',
        detail: 'The operator session cookie was cleared.',
      })
    },
  })
  const executeRelayerMutation = useMutation({
    mutationFn: (intentId: string) =>
      executeRelayerJob(contracts.smartAccount, intentId),
    onSuccess: (job) => {
      queryClient.invalidateQueries({ queryKey: relayerJobsQueryKey })
      onNotice({
        ok: job.status === 'executed',
        title:
          job.status === 'executed'
            ? 'Relayer executed payment'
            : 'Relayer updated job',
        detail: job.note,
        txHash: job.txHash,
      })
    },
    onError: (error) => {
      onNotice({
        ok: false,
        title: 'Relayer execution failed',
        detail: error instanceof Error ? error.message : String(error),
      })
    },
  })
  const runDueRelayerMutation = useMutation({
    mutationFn: runDueRelayerJobs,
    onSuccess: (jobs) => {
      queryClient.invalidateQueries({ queryKey: relayerJobsQueryKey })
      onNotice({
        ok: true,
        title: 'Relayer scan completed',
        detail: `${jobs.length} due job${jobs.length === 1 ? '' : 's'} updated.`,
      })
    },
    onError: (error) => {
      onNotice({
        ok: false,
        title: 'Relayer scan failed',
        detail: error instanceof Error ? error.message : String(error),
      })
    },
  })

  function onUnlockRelayer() {
    const token = relayerUnlockInput.trim()
    // Clear the input the instant unlock is submitted so the token never
    // lingers in component state beyond this call.
    setRelayerUnlockInput('')
    if (!token) return
    openRelayerSessionMutation.mutate(token)
  }

  return (
    <section
      id="relayer"
      className="bg-card grid gap-4 rounded-lg border p-5 shadow-sm"
    >
      <SectionHeader
        eyebrow="No custody, no bypass"
        icon={<RadioTower className="text-primary" size={22} />}
        title="Scheduled payment relayer"
      />

      <div className="bg-background grid gap-3 rounded-md border p-3">
        <Label htmlFor="relayer-token">Relayer admin token</Label>
        <div className="flex gap-2 max-sm:flex-col">
          <Input
            autoComplete="off"
            disabled={sessionActive}
            id="relayer-token"
            onChange={(event) => setRelayerUnlockInput(event.target.value)}
            placeholder={
              sessionActive
                ? 'Session unlocked'
                : 'Enter once to unlock the relayer session'
            }
            type="password"
            value={relayerUnlockInput}
          />
          {sessionActive ? (
            <Button
              disabled={closeRelayerSessionMutation.isPending}
              onClick={() => closeRelayerSessionMutation.mutate()}
              type="button"
              variant="secondary"
            >
              <LockKeyhole size={18} />
              Lock session
            </Button>
          ) : (
            <Button
              disabled={
                !relayerUnlockInput.trim() ||
                openRelayerSessionMutation.isPending
              }
              onClick={onUnlockRelayer}
              type="button"
              variant="secondary"
            >
              <KeyRound size={18} />
              Unlock session
            </Button>
          )}
          <Button
            disabled={!sessionActive || runDueRelayerMutation.isPending}
            onClick={() => runDueRelayerMutation.mutate()}
            type="button"
            variant="secondary"
          >
            <Workflow size={18} />
            Run due jobs
          </Button>
        </div>
        <span className="text-muted-foreground text-xs">
          {sessionActive
            ? 'Relayer session active via an httpOnly cookie. The token itself is not stored in the browser.'
            : 'The token is exchanged once for an httpOnly session cookie and is never kept in browser state or storage.'}
        </span>
      </div>

      {relayerJobsQuery.data?.length ? (
        <div className="grid grid-cols-3 gap-3 max-xl:grid-cols-1">
          {relayerJobsQuery.data.map((job) => (
            <div
              className="bg-background grid min-h-44 min-w-0 content-start gap-3 rounded-lg border p-4"
              key={`${job.intentId}-${job.childSequence}`}
            >
              <div className="grid gap-1">
                <strong className="font-mono text-sm" title={job.intentId}>
                  {truncateAddress(job.intentId, 8, 8)}
                </strong>
                <span className="text-muted-foreground text-sm">
                  child_sequence {job.childSequence}
                </span>
              </div>
              <StatusBadge label={job.status} />
              <p className="text-muted-foreground m-0 text-sm leading-6 wrap-anywhere">
                {job.note}
              </p>
              <small className="text-muted-foreground">
                ledgers {job.startLedger} - {job.endLedger}
              </small>
              <Button
                disabled={
                  !sessionActive ||
                  isTerminalRelayerJob(job) ||
                  executeRelayerMutation.isPending
                }
                onClick={() => executeRelayerMutation.mutate(job.intentId)}
                size="sm"
                title={
                  isTerminalRelayerJob(job)
                    ? `This job is ${job.status} and will not run again.`
                    : undefined
                }
                variant="secondary"
              >
                <RadioTower size={16} />
                Execute
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-background text-muted-foreground grid min-h-32 place-items-center rounded-lg border border-dashed p-6 text-center text-sm">
          No scheduled relayer jobs are queued yet.
        </div>
      )}
    </section>
  )
}
