import { findEvent, parseContractEvents } from "@/lib/contractEvents";
import type { SimulationResult, TransactionReceipt } from "@/types";

export type ReceiptLabels = {
  /** Shown once the network has confirmed the transaction. */
  confirmedTitle: string;
  /** Shown while the outcome is still unknown. */
  submittedTitle: string;
};

/**
 * A short, human-readable line built from whichever of this dApp's known
 * contract events actually landed in the receipt -- checked in the order a
 * signer-authored write is most likely to have produced them. Returns null
 * when there's nothing decodable (no events, or none of the topics this
 * dApp knows how to summarize), so callers can fall back to the plain
 * status line without an awkward empty append.
 */
function summarizeEvents(receipt: TransactionReceipt): string | null {
  if (!receipt.events || receipt.events.length === 0) return null;
  const parsed = parseContractEvents(receipt.events);

  const paid = findEvent(parsed, "pay_ok");
  if (paid) {
    return `Paid ${paid.amount.toString()} of ${paid.asset} to ${paid.destination}.`;
  }
  const split = findEvent(parsed, "splt_ok");
  if (split) {
    return `Split ${split.asset} across ${split.recipient_count} recipient${split.recipient_count === 1 ? "" : "s"}.`;
  }
  const scheduled = findEvent(parsed, "auto_ok");
  if (scheduled) {
    return `Executed child ${scheduled.child_sequence} of the scheduled payment: ${scheduled.amount.toString()} of ${scheduled.asset} to ${scheduled.destination}.`;
  }
  const created = findEvent(parsed, "intent");
  if (created) {
    return `Scheduled intent ${created.intent_id.toString("hex").slice(0, 8)}… created.`;
  }
  const cancelled = findEvent(parsed, "cancel");
  if (cancelled) {
    return `Scheduled intent ${cancelled.intent_id.toString("hex").slice(0, 8)}… cancelled.`;
  }

  return null;
}

/**
 * Turns a submission receipt into what the operator should be told.
 *
 * Polling waits a bounded time and then reports whatever it last saw, so a
 * receipt can come back neither confirmed nor rejected. Treating that as a
 * failure is wrong and was actively misleading: a schedule shown in red as
 * failed had in fact been confirmed on-chain two minutes later. It is not a
 * success either — nothing has been confirmed yet — so it is reported as its
 * own pending outcome, with the hash to follow it.
 */
export function describeReceipt(
  receipt: TransactionReceipt,
  labels: ReceiptLabels,
): SimulationResult {
  if (receipt.status === "SUCCESS") {
    const eventSummary = summarizeEvents(receipt);
    return {
      ok: true,
      title: labels.confirmedTitle,
      detail: eventSummary ? `${eventSummary} (SUCCESS)` : "Transaction status: SUCCESS",
      txHash: receipt.hash,
    };
  }

  if (receipt.status === "FAILED") {
    return {
      ok: false,
      title: "Transaction rejected on-chain",
      detail: "Transaction status: FAILED",
      txHash: receipt.hash,
    };
  }

  return {
    ok: true,
    pending: true,
    title: labels.submittedTitle,
    detail: `Transaction status: ${receipt.status}. It was accepted for submission and may still confirm — open the transaction to see the final result.`,
    txHash: receipt.hash,
  };
}
