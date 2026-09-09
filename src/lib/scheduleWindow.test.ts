import { describe, expect, it } from "vitest";

import { MIN_LEAD_LEDGERS, inspectScheduleWindow } from "./scheduleWindow";

const latestLedger = 1_000;

function inspect(startLedger: number, endLedger: number, latest = latestLedger) {
  return inspectScheduleWindow({ startLedger, endLedger, latestLedger: latest });
}

describe("inspectScheduleWindow", () => {
  it("says nothing about a window that opens comfortably ahead", () => {
    expect(inspect(1_100, 1_800)).toEqual([]);
  });

  it("blocks a window that closes before it opens", () => {
    // Reachable now that the two bounds are picked as independent dates:
    // nothing stops an operator choosing a closing moment before the opening
    // one, and `validateScheduleDraft` would only name ledger fields the form
    // no longer shows.
    const notices = inspect(1_800, 1_100);

    expect(notices).toHaveLength(1);
    expect(notices[0].level).toBe("error");
    expect(notices[0].message).toMatch(/before it opens/i);
  });

  it("blocks a single-ledger window that opens and closes at once", () => {
    expect(inspect(1_100, 1_100)[0]).toMatchObject({ level: "error" });
  });

  it("blocks a window that has already closed", () => {
    // `execute_scheduled_payment` can never fire inside it, so creating the
    // intent only spends fees. This is the one case worth refusing outright.
    const notices = inspect(900, 999);

    expect(notices).toHaveLength(1);
    expect(notices[0].level).toBe("error");
    expect(notices[0].message).toMatch(/already closed/i);
  });

  it("treats the end ledger itself as still open", () => {
    expect(inspect(900, 1_000)).toEqual([
      expect.objectContaining({ level: "warning", message: expect.stringMatching(/already open/i) }),
    ]);
  });

  it("warns, without blocking, about a window that is already open", () => {
    const notices = inspect(900, 1_800);

    expect(notices).toHaveLength(1);
    expect(notices[0].level).toBe("warning");
  });

  it("warns when the window opens too soon to queue and execute", () => {
    const notices = inspect(latestLedger + MIN_LEAD_LEDGERS - 1, 1_800);

    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ level: "warning" });
    expect(notices[0].message).toMatch(/relayer/i);
  });

  it("stops warning about lead time at the threshold", () => {
    expect(inspect(latestLedger + MIN_LEAD_LEDGERS, 1_800)).toEqual([]);
  });

  it("reports only the closed window when the whole thing is in the past", () => {
    // "Already open" is true of a closed window too, and saying both would
    // bury the one that matters.
    const notices = inspect(800, 900);

    expect(notices.map((notice) => notice.level)).toEqual(["error"]);
  });

  it("says nothing when the current ledger is not known yet", () => {
    // A disconnected wallet or an in-flight first read must not render as
    // "your window has closed".
    expect(inspect(1_100, 1_800, 0)).toEqual([]);
  });

  it("says nothing about a half-typed window", () => {
    expect(inspect(Number.NaN, 1_800)).toEqual([]);
    expect(inspect(1_100, Number.NaN)).toEqual([]);
  });
});
