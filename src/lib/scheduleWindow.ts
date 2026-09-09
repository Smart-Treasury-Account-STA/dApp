/**
 * What is wrong with a scheduled payment's ledger window, before it is signed.
 *
 * `validateScheduleDraft` only knows the draft, so the one thing it can check
 * is `start < end`. Everything that actually decides whether the payment will
 * ever fire is a comparison against the *current* ledger, which the draft does
 * not carry: a window can be perfectly well-formed and already over.
 *
 * Kept separate from validation because only one of these is a refusal. A
 * closed window is provably useless and costs fees to create; the rest are
 * situations an operator may well want on purpose.
 */

import { LEDGER_CLOSE_SECONDS } from "@/lib/constants";

/**
 * How much lead time a window needs before "queue it, then execute it" stops
 * being realistic — one minute at {@link LEDGER_CLOSE_SECONDS}s per ledger.
 * Queueing is a second click and a round trip after creation confirms.
 */
export const MIN_LEAD_LEDGERS = 12;

export type ScheduleWindowNotice = {
  level: "error" | "warning";
  message: string;
};

export function inspectScheduleWindow({
  startLedger,
  endLedger,
  latestLedger,
}: {
  startLedger: number;
  endLedger: number;
  latestLedger: number;
}): ScheduleWindowNotice[] {
  if (
    !Number.isFinite(startLedger) ||
    !Number.isFinite(endLedger) ||
    !Number.isFinite(latestLedger) ||
    latestLedger <= 0
  ) {
    return [];
  }

  // Checked before anything about the current ledger: a window whose end
  // precedes its start is malformed rather than late, and saying "already
  // closed" would send the operator to move the wrong bound. Reachable since
  // the two bounds became independently picked dates.
  if (startLedger >= endLedger) {
    return [
      {
        level: "error",
        message: "This window closes before it opens. Move the closing moment after the opening one.",
      },
    ];
  }

  // Both bounds are inclusive on-chain: `mark_child_executed` refuses only
  // `sequence < start_ledger` and `sequence > end_ledger`, so a window whose
  // end equals the current ledger is still live for this one ledger.
  if (endLedger < latestLedger) {
    return [
      {
        level: "error",
        message: `This window is already closed — ledger ${latestLedger} is past its end at ${endLedger}. The payment could never execute.`,
      },
    ];
  }

  if (startLedger <= latestLedger) {
    return [
      {
        level: "warning",
        message: `This window is already open at ledger ${latestLedger}. The payment becomes executable as soon as it is queued.`,
      },
    ];
  }

  const lead = startLedger - latestLedger;
  if (lead < MIN_LEAD_LEDGERS) {
    return [
      {
        level: "warning",
        message: `This window opens in about ${lead * LEDGER_CLOSE_SECONDS}s. Creating and queueing it with the relayer may take longer than that.`,
      },
    ];
  }

  return [];
}
