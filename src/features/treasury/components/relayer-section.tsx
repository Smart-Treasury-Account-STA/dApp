"use client";

import { KeyRound, LockKeyhole, RadioTower, Workflow } from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SimulationResult } from "@/types";
import {
  closeRelayerSession,
  executeRelayerJob,
  fetchRelayerJobs,
  openRelayerSession,
  runDueRelayerJobs,
} from "@/features/treasury/relayer-client";
import { SectionHeader, StatusBadge } from "@/features/treasury/components/primitives";

export function RelayerSection({
  onNotice,
  onSessionActiveChange,
  sessionActive,
}: {
  onNotice: (notice: SimulationResult | null) => void;
  onSessionActiveChange: (active: boolean) => void;
  sessionActive: boolean;
}) {
  const queryClient = useQueryClient();
  // The unlock input is transient: it is cleared the instant unlock is
  // submitted and never persisted to localStorage/sessionStorage. The admin
  // token itself is exchanged for an httpOnly session cookie by the server
  // and never lives in component state that outlives the submit.
  const [relayerUnlockInput, setRelayerUnlockInput] = useState("");

  const relayerJobsQuery = useQuery({
    queryKey: ["relayer-jobs"],
    queryFn: fetchRelayerJobs,
  });

  const openRelayerSessionMutation = useMutation({
    mutationFn: openRelayerSession,
    onSuccess: () => {
      onSessionActiveChange(true);
      onNotice({
        ok: true,
        title: "Relayer session unlocked",
        detail:
          "An httpOnly session cookie was issued; the operator token was not stored in the browser.",
      });
    },
    onError: (error) => {
      onSessionActiveChange(false);
      onNotice({
        ok: false,
        title: "Relayer unlock failed",
        detail: error instanceof Error ? error.message : String(error),
      });
    },
    onSettled: () => {
      // The operator token passed as this mutation's `variables` would
      // otherwise linger in the TanStack Query cache until garbage
      // collection (~5 min). Reset immediately so it doesn't stick around
      // longer than necessary.
      openRelayerSessionMutation.reset();
    },
  });
  const closeRelayerSessionMutation = useMutation({
    mutationFn: closeRelayerSession,
    onSuccess: () => {
      onSessionActiveChange(false);
      onNotice({
        ok: true,
        title: "Relayer session locked",
        detail: "The operator session cookie was cleared.",
      });
    },
  });
  const executeRelayerMutation = useMutation({
    mutationFn: (intentId: string) => executeRelayerJob(intentId),
    onSuccess: (job) => {
      queryClient.invalidateQueries({ queryKey: ["relayer-jobs"] });
      onNotice({
        ok: job.status === "executed",
        title: job.status === "executed" ? "Relayer executed payment" : "Relayer updated job",
        detail: job.note,
        txHash: job.txHash,
      });
    },
    onError: (error) => {
      onNotice({
        ok: false,
        title: "Relayer execution failed",
        detail: error instanceof Error ? error.message : String(error),
      });
    },
  });
  const runDueRelayerMutation = useMutation({
    mutationFn: runDueRelayerJobs,
    onSuccess: (jobs) => {
      queryClient.invalidateQueries({ queryKey: ["relayer-jobs"] });
      onNotice({
        ok: true,
        title: "Relayer scan completed",
        detail: `${jobs.length} due job${jobs.length === 1 ? "" : "s"} updated.`,
      });
    },
    onError: (error) => {
      onNotice({
        ok: false,
        title: "Relayer scan failed",
        detail: error instanceof Error ? error.message : String(error),
      });
    },
  });

  function onUnlockRelayer() {
    const token = relayerUnlockInput.trim();
    // Clear the input the instant unlock is submitted so the token never
    // lingers in component state beyond this call.
    setRelayerUnlockInput("");
    if (!token) return;
    openRelayerSessionMutation.mutate(token);
  }

  return (
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
            disabled={sessionActive}
            id="relayer-token"
            onChange={(event) => setRelayerUnlockInput(event.target.value)}
            placeholder={
              sessionActive ? "Session unlocked" : "Enter once to unlock the relayer session"
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
              disabled={!relayerUnlockInput.trim() || openRelayerSessionMutation.isPending}
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
        <span className="text-xs text-muted-foreground">
          {sessionActive
            ? "Relayer session active via an httpOnly cookie. The token itself is not stored in the browser."
            : "The token is exchanged once for an httpOnly session cookie and is never kept in browser state or storage."}
        </span>
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
                disabled={!sessionActive || executeRelayerMutation.isPending}
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
  );
}
