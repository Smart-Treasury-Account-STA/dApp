'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { RadioTower } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { STELLAR_CONFIG } from '@/config'
import {
  SectionHeader,
  StatusBadge,
} from '@/features/treasury/components/primitives'
import { useRelayerJobs } from '@/features/treasury/queries'
import {
  ensureRelayerSession,
  executeRelayerJob,
} from '@/features/treasury/relayer-client'
import type { ContractSet } from '@/lib/env'
import { truncateAddress } from '@/lib/format'
import {
  isRelayerJobInFlight,
  isTerminalRelayerJob,
} from '@/lib/relayer/jobStatus'
import { signMessage } from '@/lib/wallet'
import type { SimulationResult, WalletState } from '@/types'

export function RelayerSection({
  contracts = STELLAR_CONFIG.contracts,
  onNotice,
  wallet,
}: {
  contracts?: ContractSet
  onNotice: (notice: SimulationResult | null) => void
  wallet: WalletState
}) {
  const queryClient = useQueryClient()
  const relayerJobsQueryKey = ['relayer-jobs', contracts.smartAccount]

  const relayerJobsQuery = useRelayerJobs(contracts.smartAccount)

  /**
   * Same on-demand authentication as the Schedule panel's queue buttons: the
   * server decides, per treasury, whether this wallet may execute, so the
   * panel only has to make sure a session exists. `ensureRelayerSession`
   * skips the signature prompt when one already does.
   *
   * There is no operator unlock here any more. Due jobs run on a schedule
   * (QStash) or from the CLI, and both of those hold the admin token;
   * nothing a user does from the console needs it.
   */
  async function authenticateForExecution() {
    if (!wallet.address) {
      throw new Error('Connect a wallet before executing relayer work.')
    }
    await ensureRelayerSession(wallet.address, (message) =>
      signMessage(message, wallet.address as string)
    )
  }

  const executeRelayerMutation = useMutation({
    mutationFn: async (intentId: string) => {
      await authenticateForExecution()
      return executeRelayerJob(contracts.smartAccount, intentId)
    },
    onSuccess: (job) => {
      queryClient.invalidateQueries({ queryKey: relayerJobsQueryKey })
      // The server hands the job back untouched when another run holds it:
      // say so, rather than a generic update that reads like this click did
      // something.
      if (isRelayerJobInFlight(job)) {
        onNotice({
          ok: false,
          title: 'Relayer is already executing this job',
          detail:
            'Another relayer run is submitting it. Reload in a few seconds to see the outcome.',
        })
        return
      }
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

      <p className="text-muted-foreground m-0 text-sm leading-6">
        Queued jobs run automatically once their ledger window opens. Execute
        runs one now instead of waiting; your wallet signs a message to prove it
        may act on this treasury, and nothing moves that the treasury did not
        already approve on-chain.
      </p>

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
              {job.txHash ? (
                <a
                  className="text-sm font-semibold underline underline-offset-4"
                  href={`${STELLAR_CONFIG.explorerBaseUrl}/tx/${job.txHash}`}
                  rel="noreferrer"
                  target="_blank"
                  title={job.txHash}
                >
                  View transaction
                </a>
              ) : null}
              <Button
                disabled={
                  !wallet.address ||
                  isTerminalRelayerJob(job) ||
                  isRelayerJobInFlight(job) ||
                  executeRelayerMutation.isPending
                }
                onClick={() => executeRelayerMutation.mutate(job.intentId)}
                size="sm"
                title={
                  isTerminalRelayerJob(job)
                    ? `This job is ${job.status} and will not run again.`
                    : isRelayerJobInFlight(job)
                      ? 'A relayer run is submitting this job right now. Reload in a few seconds.'
                      : !wallet.address
                        ? 'Connect a wallet to execute.'
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
