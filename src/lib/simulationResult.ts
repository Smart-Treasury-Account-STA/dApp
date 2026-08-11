import type { SimulationResult } from "@/types";

/**
 * Runs a client-side draft validator and turns a rejection into a result the
 * UI can show as-is.
 *
 * Validation failures must not travel through `describeSimulationFailure`:
 * that classifier reads contract error codes and host error shapes out of an
 * RPC reply, and anything it does not recognise becomes a generic "the
 * simulation could not be completed". Applied to a validator's message, it
 * discards the one sentence that actually tells the operator what to change.
 *
 * Returns null when the draft is valid, so callers read as
 * `const invalid = validationFailure(...); if (invalid) return invalid;`.
 */
export function validationFailure(validate: () => void): SimulationResult | null {
  try {
    validate();
    return null;
  } catch (error) {
    return {
      ok: false,
      title: "Check the form before simulating",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}
