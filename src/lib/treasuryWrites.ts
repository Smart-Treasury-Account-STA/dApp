import type { xdr } from "@stellar/stellar-sdk";

import { STELLAR_CONFIG } from "@/config";
import { structScVal } from "@/lib/scval";
import {
  addressScVal,
  boolScVal,
  i128ScVal,
  signerDelegatedScVal,
  symbolScVal,
  u32ScVal,
} from "@/lib/stellarClient";

export type WriteStrategy = "custom-account" | "source-account";

export type WriteOperation = {
  id: string;
  contractId: string;
  functionName: string;
  args: xdr.ScVal[];
  strategy: WriteStrategy;
  summary: string;
};

export function addSignerOperation({
  contextRuleId,
  signerAddress,
}: {
  contextRuleId: number;
  signerAddress: string;
}): WriteOperation {
  return {
    id: `add-signer:${contextRuleId}:${signerAddress}`,
    contractId: STELLAR_CONFIG.contracts.smartAccount,
    functionName: "add_signer",
    args: [u32ScVal(contextRuleId), signerDelegatedScVal(signerAddress)],
    strategy: "custom-account",
    summary: `Register ${signerAddress} as a delegated signer on context rule ${contextRuleId}.`,
  };
}

export function removeSignerOperation({
  contextRuleId,
  signerId,
}: {
  contextRuleId: number;
  signerId: number;
}): WriteOperation {
  return {
    id: `remove-signer:${contextRuleId}:${signerId}`,
    contractId: STELLAR_CONFIG.contracts.smartAccount,
    functionName: "remove_signer",
    args: [u32ScVal(contextRuleId), u32ScVal(signerId)],
    strategy: "custom-account",
    summary: `Revoke signer #${signerId} from context rule ${contextRuleId}.`,
  };
}

export function setAssetRuleOperation({
  asset,
  enabled,
  maxSingleTransfer,
}: {
  asset: string;
  enabled: boolean;
  maxSingleTransfer: string;
}): WriteOperation {
  return {
    id: `set-asset-rule:${asset}`,
    contractId: STELLAR_CONFIG.contracts.policyEngine,
    functionName: "set_asset_rule",
    args: [
      addressScVal(asset),
      structScVal({
        enabled: boolScVal(enabled),
        max_single_transfer: i128ScVal(maxSingleTransfer),
      }),
    ],
    strategy: "source-account",
    summary: enabled
      ? `Enable ${asset} with a single-transfer cap of ${maxSingleTransfer}.`
      : `Disable ${asset} for all transfers.`,
  };
}

export function setRecipientAllowedOperation({
  allowed,
  recipient,
}: {
  allowed: boolean;
  recipient: string;
}): WriteOperation {
  return {
    id: `set-recipient:${recipient}`,
    contractId: STELLAR_CONFIG.contracts.policyEngine,
    functionName: "set_recipient_allowed",
    args: [addressScVal(recipient), boolScVal(allowed)],
    strategy: "source-account",
    summary: allowed
      ? `Allow payments to ${recipient}.`
      : `Remove ${recipient} from the recipient allowlist.`,
  };
}

export function setOperationAllowedOperation({
  allowed,
  operation,
}: {
  allowed: boolean;
  operation: string;
}): WriteOperation {
  return {
    id: `set-operation:${operation}`,
    contractId: STELLAR_CONFIG.contracts.policyEngine,
    functionName: "set_operation_allowed",
    args: [symbolScVal(operation), boolScVal(allowed)],
    strategy: "source-account",
    summary: allowed
      ? `Enable the ${operation} operation.`
      : `Disable the ${operation} operation, stopping every payment that uses it.`,
  };
}

export function bumpVersionOperation({
  nextVersion,
}: {
  nextVersion: number;
}): WriteOperation {
  return {
    id: `bump-version:${nextVersion}`,
    contractId: STELLAR_CONFIG.contracts.policyEngine,
    functionName: "bump_version",
    args: [u32ScVal(nextVersion)],
    strategy: "source-account",
    summary: `Raise the policy version to ${nextVersion}. Every payment or scheduled intent still pinned to an older version will be rejected with #2006.`,
  };
}
