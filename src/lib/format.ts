export function truncateAddress(value?: string | null, head = 7, tail = 6) {
  if (!value) return "Not connected";
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

export function formatNumber(value: number | string) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return new Intl.NumberFormat("en-US").format(numeric);
}

export function makeNonce() {
  const high = BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));
  const nonce =
    (high ^ BigInt(Date.now())) & ((BigInt(1) << BigInt(62)) - BigInt(1));
  return nonce.toString();
}

export function makeIntentId() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export type SimulationFailureKind =
  /** The contract ran and returned one of its own error codes. */
  | "contract"
  /** The call is well-formed but not authorized yet — expected during preflight. */
  | "authorization"
  /** The arguments never converted to host values. A client-side defect. */
  | "encoding"
  /** The network answered, but this client could not read the reply. */
  | "response"
  | "unknown";

export type SimulationFailure = {
  kind: SimulationFailureKind;
  /**
   * True only when the contract itself ran and returned an error code. False
   * for host-level, encoding, transport, and response-parsing failures, which
   * mean the call never reached the contract's own checks.
   */
  rejectedByContract: boolean;
  detail: string;
};

/**
 * Classifies a failed simulation so the UI never reports a client-side bug as
 * a policy decision. Attributing an encoding error to "the policy engine
 * rejected this payment" reads as working enforcement and hides the defect.
 */
export function describeSimulationFailure(message: string): SimulationFailure {
  const contractCode = message.match(/Error\(Contract, #(\d+)\)/);
  if (contractCode) {
    return {
      kind: "contract",
      rejectedByContract: true,
      detail:
        explainContractError(message) ??
        `Contract rejected with code #${contractCode[1]}.`,
    };
  }

  if (/Error\(Auth/.test(message)) {
    return {
      kind: "authorization",
      rejectedByContract: false,
      detail:
        "The call is well-formed but not yet authorized. It needs the SmartAccount AuthPayload entry plus one signed entry per required delegated signer.",
    };
  }

  if (/Error\((Object|Value|Storage|Context|WasmVm|Budget|Crypto|Events)/.test(message)) {
    return {
      kind: "encoding",
      rejectedByContract: false,
      detail:
        "The request could not be encoded for the contract, so the network rejected it before any policy check ran. This is a client-side fault, not a policy decision.",
    };
  }

  if (/Bad union switch|XDR|unknown type|Cannot read/i.test(message)) {
    return {
      kind: "response",
      rejectedByContract: false,
      detail:
        "The network answered, but the response could not be read by this client. This usually means contract state was archived and the reply carries a restore preamble.",
    };
  }

  return {
    kind: "unknown",
    rejectedByContract: false,
    detail:
      "The simulation could not be completed. This is a network or client fault, not a policy decision.",
  };
}

export function explainContractError(message: string) {
  const match = message.match(/#(\d{4})/);
  if (!match) return null;
  const code = Number(match[1]);
  const errors: Record<number, string> = {
    2003: "Asset is not allowlisted by policy.",
    2004: "Destination is not allowlisted by policy.",
    2005: "Amount is above the configured single-transfer cap.",
    2006: "Policy version changed. Refresh policy and ask the signer to review again.",
    2008: "This operation is disabled by policy.",
    3007: "Execution window is not open yet.",
    3008: "Execution window already expired.",
    3009: "This child execution was already consumed.",
    3012: "Scheduled execution limit has been reached.",
    8002: "Treasury is paused.",
    8003: "Treasury is frozen.",
    8005: "Nonce has already been used.",
  };
  return errors[code] ?? `Contract rejected with code #${code}.`;
}
