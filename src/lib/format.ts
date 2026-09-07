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

/**
 * Explains a `smart_account` signer/context-rule management error
 * (OpenZeppelin's `stellar-accounts` `SmartAccountError`, code range
 * 3000-3016).
 *
 * Deliberately a separate map from `explainContractError` above, not an
 * addition to it: `intent_registry`'s own `IntentRegistryError` (also
 * documented in the 3000s -- see `DAPP_INTEGRATION_SPEC.md` §10.3) uses
 * the *same* numeric codes for unrelated meanings (its own `#3007` is
 * "execution window is not open yet", not "duplicate signer"). Soroban
 * doesn't enforce error-code uniqueness across contracts, so a single
 * flat code->message map applied regardless of which contract raised the
 * error would silently show the wrong explanation. Call this only for
 * errors from signer/context-rule calls (`add_signer`, `remove_signer`,
 * `add_context_rule`, ...); use `explainContractError` for payment/
 * policy/schedule calls.
 */
export function explainSmartAccountError(message: string) {
  const match = message.match(/#(\d{4})/);
  if (!match) return null;
  const code = Number(match[1]);
  const errors: Record<number, string> = {
    3000: "That context rule does not exist.",
    3002: "This context could not be validated against any rule.",
    3003: "External signer verification failed.",
    3004: "A rule needs at least one signer or one policy — this would leave it with neither.",
    3005: "That rule's valid-until ledger is already in the past.",
    3006: "That signer is not part of this rule.",
    3007: "That address is already a signer on this rule.",
    3008: "That policy is not attached to this rule.",
    3009: "That policy is already attached to this rule.",
    3010: "This rule already has the maximum number of signers.",
    3011: "This rule already has the maximum number of policies.",
    3012: "An internal counter for this rule has reached its maximum value.",
    3013: "That signer's key data is too large.",
    3014: "Internal error: context_rule_ids length mismatch.",
    3015: "That name is too long.",
    3016: "That signer is not authorized for any selected context rule.",
  };
  return errors[code] ?? `Contract rejected with code #${code}.`;
}
