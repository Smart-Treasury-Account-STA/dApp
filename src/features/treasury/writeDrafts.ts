import { Address } from "@stellar/stellar-sdk";

import type { ContextRule } from "@/types";

const SYMBOL_PATTERN = /^[a-zA-Z0-9_]+$/;
const MAX_SYMBOL_LENGTH = 32;

function assertAddress(label: string, value: string) {
  try {
    new Address(value);
  } catch {
    throw new Error(`${label} must be a valid Stellar account or contract address.`);
  }
}

export function validateSignerDraft({ signerAddress }: { signerAddress: string }) {
  assertAddress("Signer", signerAddress);
}

export function validateAssetRuleDraft({
  asset,
  enabled,
  maxSingleTransfer,
}: {
  asset: string;
  enabled: boolean;
  maxSingleTransfer: string;
}) {
  assertAddress("Asset contract", asset);
  let parsed: bigint;
  try {
    parsed = BigInt(maxSingleTransfer);
  } catch {
    throw new Error("Single-transfer cap must be an integer.");
  }
  // Mirrors policy_engine::set_asset_rule, which returns InvalidAmount (#2002)
  // for an enabled rule whose cap is not positive.
  if (enabled && parsed <= 0n) {
    throw new Error("An enabled asset rule needs a positive single-transfer cap.");
  }
  if (parsed < 0n) {
    throw new Error("Single-transfer cap cannot be negative.");
  }
}

export function validateRecipientDraft({ recipient }: { recipient: string; allowed: boolean }) {
  assertAddress("Recipient", recipient);
}

export function validateOperationDraft({ operation }: { operation: string; allowed: boolean }) {
  if (operation.length === 0 || operation.length > MAX_SYMBOL_LENGTH) {
    throw new Error(`Operation must be between 1 and ${MAX_SYMBOL_LENGTH} characters.`);
  }
  if (!SYMBOL_PATTERN.test(operation)) {
    throw new Error("Operation may contain only letters, digits, and underscores.");
  }
}

export function validateVersionBump({
  currentVersion,
  nextVersion,
}: {
  currentVersion: number;
  nextVersion: number;
}) {
  if (!Number.isSafeInteger(nextVersion) || nextVersion < 1) {
    throw new Error("Next version must be a positive integer.");
  }
  // Mirrors policy_engine::bump_version, which returns InvalidVersion (#2007).
  if (nextVersion <= currentVersion) {
    throw new Error(`Next version must be greater than the current version (${currentVersion}).`);
  }
}

/**
 * Returns a blocking reason, or null when removal is safe.
 *
 * Removing the last signer of a rule leaves nobody able to satisfy the
 * SmartAccount's `__check_auth`, which would make the treasury permanently
 * unusable. Whether OpenZeppelin's `stellar-accounts` guards this on-chain is
 * unverified, so the client blocks it unconditionally.
 */
export function signerRemovalBlock(rule: ContextRule, signerId: number): string | null {
  if (rule.signerAddresses.length <= 1) {
    return "This is the only signer on the rule. Removing it would leave the treasury with no way to authorize anything, permanently.";
  }
  if (signerId < 0 || signerId >= rule.signerAddresses.length) {
    return "That signer is not part of this rule.";
  }
  return null;
}

export function isSelfRemoval(
  rule: ContextRule,
  signerId: number,
  walletAddress: string | null,
): boolean {
  if (!walletAddress) return false;
  return rule.signerAddresses[signerId] === walletAddress;
}
