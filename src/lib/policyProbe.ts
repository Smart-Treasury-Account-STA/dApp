import type { PolicyProbeReason, PolicyProbeVerdict, ProbeInput } from "@/types";

export type SimulatePolicyFn = (input: ProbeInput) => Promise<void>;

const CODE_TO_REASON: Record<number, PolicyProbeReason> = {
  2003: "asset",
  2004: "recipient",
  2005: "amount",
  2006: "version",
  2008: "operation",
};

export function classifyProbeFailure(message: string): PolicyProbeVerdict {
  const match = message.match(/Error\(Contract, #(\d+)\)/);
  if (!match) {
    return { allowed: false, reason: "unknown" };
  }
  const code = Number(match[1]);
  const reason = CODE_TO_REASON[code];
  return reason
    ? { allowed: false, reason, code }
    : { allowed: false, reason: "unknown", code };
}

export async function probePolicy(
  simulate: SimulatePolicyFn,
  input: ProbeInput,
): Promise<PolicyProbeVerdict> {
  try {
    await simulate(input);
    return { allowed: true };
  } catch (error) {
    return classifyProbeFailure(error instanceof Error ? error.message : String(error));
  }
}

/**
 * Discovers the asset's `max_single_transfer` by probing.
 *
 * `validate_policy` checks the amount cap before the recipient, so the
 * destination is irrelevant here and a disallowed one does not disturb the
 * search. Escalates by powers of ten to bracket the cap, then bisects. Returns
 * null when the rejection is on some other dimension, which means the cap is
 * not observable.
 */
export async function findAmountCap(
  simulate: SimulatePolicyFn,
  input: Omit<ProbeInput, "amount">,
): Promise<bigint | null> {
  const accepts = async (amount: bigint) => {
    const verdict = await probePolicy(simulate, { ...input, amount: amount.toString() });
    if (verdict.allowed || verdict.reason === "recipient") return true;
    if (verdict.reason === "amount") return false;
    return null;
  };

  let low = 0n;
  let high: bigint | null = null;
  let candidate = 1n;

  for (let step = 0; step < 40 && high === null; step += 1) {
    const result = await accepts(candidate);
    if (result === null) return null;
    if (result) {
      low = candidate;
      candidate *= 10n;
    } else {
      high = candidate;
    }
  }

  if (high === null) return null;
  let confirmedHigh: bigint = high;

  while (confirmedHigh - low > 1n) {
    const middle = low + (confirmedHigh - low) / 2n;
    const result = await accepts(middle);
    if (result === null) return null;
    if (result) {
      low = middle;
    } else {
      confirmedHigh = middle;
    }
  }

  return low === 0n ? null : low;
}
