import type { RelayerJobRecord } from "@/lib/relayer/types";

/**
 * Whether a relayer job has reached a state it will never leave.
 *
 * `blocked` and `executed` are the two the executor refuses to act on: it
 * restates them and returns. Everything else is a step in a run that can be
 * retried — including `executing`, which a crashed run can leave behind and
 * which must therefore stay actionable rather than trapping the job forever.
 *
 * Shared with the console so a terminal job's Execute button is disabled
 * rather than round-tripping to a server that will only tell it the same
 * thing back. Kept in its own module, free of Node and database imports, so
 * `executeRelayerJob` and the browser can hold the same definition.
 */
export function isTerminalRelayerJob(job: Pick<RelayerJobRecord, "status">): boolean {
  return job.status === "blocked" || job.status === "executed";
}
