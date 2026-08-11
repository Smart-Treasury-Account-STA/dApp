import type { SimulationResult, TransactionReceipt } from "@/types";

export type ReceiptLabels = {
  /** Shown once the network has confirmed the transaction. */
  confirmedTitle: string;
  /** Shown while the outcome is still unknown. */
  submittedTitle: string;
};

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
    return {
      ok: true,
      title: labels.confirmedTitle,
      detail: "Transaction status: SUCCESS",
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
