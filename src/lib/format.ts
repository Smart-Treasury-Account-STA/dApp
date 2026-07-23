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
