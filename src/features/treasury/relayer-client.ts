import type { CreateRelayerJobInput, RelayerJobRecord } from "@/lib/relayer/types";

function relayerHeaders(token: string) {
  return {
    "content-type": "application/json",
    "x-relayer-token": token,
  };
}

export async function fetchRelayerJobs() {
  const response = await fetch("/api/relayer/jobs", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Could not load relayer jobs.");
  }
  const payload = (await response.json()) as { jobs: RelayerJobRecord[] };
  return payload.jobs;
}

export async function queueRelayerJob(input: CreateRelayerJobInput, token: string) {
  const response = await fetch("/api/relayer/jobs", {
    method: "POST",
    headers: relayerHeaders(token),
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const payload = (await response.json()) as { error?: string };
    throw new Error(payload.error ?? "Could not queue relayer job.");
  }
  const payload = (await response.json()) as { job: RelayerJobRecord };
  return payload.job;
}

export async function executeRelayerJob(intentId: string, token: string) {
  const response = await fetch(`/api/relayer/jobs/${intentId}/execute`, {
    method: "POST",
    headers: relayerHeaders(token),
  });
  if (!response.ok) {
    const payload = (await response.json()) as { error?: string };
    throw new Error(payload.error ?? "Could not execute relayer job.");
  }
  const payload = (await response.json()) as { job: RelayerJobRecord };
  return payload.job;
}

export async function runDueRelayerJobs(token: string) {
  const response = await fetch("/api/relayer/run", {
    method: "POST",
    headers: relayerHeaders(token),
  });
  if (!response.ok) {
    const payload = (await response.json()) as { error?: string };
    throw new Error(payload.error ?? "Could not run due relayer jobs.");
  }
  const payload = (await response.json()) as { updated: RelayerJobRecord[] };
  return payload.updated;
}
