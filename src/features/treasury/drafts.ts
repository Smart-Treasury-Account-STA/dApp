import { Address } from "@stellar/stellar-sdk";

import { LEDGER_CLOSE_SECONDS } from "@/lib/constants";
import type { PaymentDraft, ScheduleDraft, SplitDraft } from "@/types";

const INTENT_ID_PATTERN = /^(0x)?[0-9a-fA-F]{64}$/;
const MAX_U32 = 2 ** 32 - 1;
const MAX_U64 = (1n << 64n) - 1n;

function assertAddress(label: string, value: string) {
  try {
    new Address(value);
  } catch {
    throw new Error(`${label} must be a valid Stellar account or contract address.`);
  }
}

function parsePositiveBigInt(label: string, value: string) {
  try {
    const parsed = BigInt(value);
    if (parsed <= 0n) {
      throw new Error();
    }
    return parsed;
  } catch {
    throw new Error(`${label} must be a positive integer.`);
  }
}

function parseU32(label: string, value: string | number) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > MAX_U32) {
    throw new Error(`${label} must be an integer between 0 and ${MAX_U32}.`);
  }
  return parsed;
}

export function validatePaymentDraft(draft: PaymentDraft) {
  assertAddress("Asset contract", draft.asset);
  assertAddress("Destination", draft.destination);
  parsePositiveBigInt("Amount", draft.amount);
  const nonce = parsePositiveBigInt("Nonce", draft.nonce);
  if (nonce > MAX_U64) {
    throw new Error("Nonce must fit in u64.");
  }
  if (!Number.isSafeInteger(draft.expectedPolicyVersion) || draft.expectedPolicyVersion < 1) {
    throw new Error("Policy version must be a positive integer.");
  }
}

export function validateScheduleDraft(draft: ScheduleDraft) {
  validatePaymentDraft({ ...draft, nonce: "1" });
  if (!INTENT_ID_PATTERN.test(draft.intentId)) {
    throw new Error("Intent ID must be 32 bytes encoded as 64 hex characters.");
  }
  const startLedger = parseU32("Start ledger", draft.startLedger);
  const endLedger = parseU32("End ledger", draft.endLedger);
  const maxExecutions = parseU32("Max executions", draft.maxExecutions);
  parseU32("Interval ledgers", draft.intervalLedgers ?? 0);
  if (maxExecutions < 1) {
    throw new Error("Max executions must be at least 1.");
  }
  if (startLedger >= endLedger) {
    throw new Error("Start ledger must be lower than end ledger.");
  }
}

export function validateSplitDraft(draft: SplitDraft) {
  assertAddress("Asset contract", draft.asset);
  const nonce = parsePositiveBigInt("Nonce", draft.nonce);
  if (nonce > MAX_U64) {
    throw new Error("Nonce must fit in u64.");
  }
  if (!Number.isSafeInteger(draft.expectedPolicyVersion) || draft.expectedPolicyVersion < 1) {
    throw new Error("Policy version must be a positive integer.");
  }
  if (draft.recipients.length < 2) {
    throw new Error("A split needs at least two recipients — use a plain payment for one.");
  }
  draft.recipients.forEach((recipient, index) => {
    assertAddress(`Recipient ${index + 1}`, recipient.destination);
    parsePositiveBigInt(`Amount ${index + 1}`, recipient.amount);
  });
  const destinations = draft.recipients.map((recipient) => recipient.destination);
  if (new Set(destinations).size !== destinations.length) {
    throw new Error("Split recipients must be distinct addresses.");
  }
}

/**
 * Ledger-bounded schedule window.
 *
 * The defaults (120s ahead, 3600s long) are what the "Use current ledger"
 * button applies and what the schedule section's helper copy describes: at
 * {@link LEDGER_CLOSE_SECONDS}s per ledger that is +24 ledgers (two minutes)
 * to +744 ledgers (one hour later). Keep the copy in sync with these numbers.
 */
export function computeLedgerWindow(
  latestLedger: number,
  options: { startDelaySeconds?: number; durationSeconds?: number } = {},
) {
  const { startDelaySeconds = 120, durationSeconds = 3_600 } = options;
  const startLedger = latestLedger + Math.ceil(startDelaySeconds / LEDGER_CLOSE_SECONDS);
  const endLedger = startLedger + Math.ceil(durationSeconds / LEDGER_CLOSE_SECONDS);
  return { startLedger, endLedger };
}
