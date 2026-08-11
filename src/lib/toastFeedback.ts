import type { SimulationResult } from "@/types";

export type ToastFeedback = {
  kind: "success" | "error";
  title: string;
  description: string;
  explorerUrl: string | null;
};

/**
 * Maps a `SimulationResult` to what a toast needs to show.
 *
 * The header notice panel this replaced kept the diagnostic in its own
 * `<code>` block and the transaction hash as an explorer link — both real
 * information, not decoration. A toast has no room for the full diagnostic
 * (often a multi-line HostError dump), so only its first line — the actual
 * error name — is folded into the description; the rest was event-log detail
 * nobody read at a glance anyway.
 */
export function buildToastFeedback(
  result: SimulationResult,
  explorerBaseUrl: string,
): ToastFeedback {
  const diagnosticSummary = result.diagnostic?.split("\n")[0];
  const description = diagnosticSummary
    ? `${result.detail}\n${diagnosticSummary}`
    : result.detail;

  return {
    kind: result.ok ? "success" : "error",
    title: result.title,
    description,
    explorerUrl: result.txHash ? `${explorerBaseUrl}/tx/${result.txHash}` : null,
  };
}
