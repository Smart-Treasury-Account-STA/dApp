import { describe, expect, it } from "vitest";

import { isTerminalRelayerJob } from "./jobStatus";
import type { RelayerJobRecord } from "./types";

function job(status: RelayerJobRecord["status"]) {
  return { status };
}

describe("isTerminalRelayerJob", () => {
  it("treats the two states the executor refuses to act on as terminal", () => {
    expect(isTerminalRelayerJob(job("blocked"))).toBe(true);
    expect(isTerminalRelayerJob(job("executed"))).toBe(true);
  });

  it("leaves every in-flight state actionable", () => {
    expect(isTerminalRelayerJob(job("scheduled"))).toBe(false);
    expect(isTerminalRelayerJob(job("ready"))).toBe(false);
    expect(isTerminalRelayerJob(job("failed"))).toBe(false);
  });

  it("leaves `executing` actionable", () => {
    // A run that crashed between marking the job and submitting leaves this
    // status behind. Treating it as terminal would strand the job with no way
    // to retry it from the console.
    expect(isTerminalRelayerJob(job("executing"))).toBe(false);
  });
});
