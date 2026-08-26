import type { xdr } from "@stellar/stellar-sdk";

import { STELLAR_CONFIG } from "@/config";
import type { ContractSet } from "@/lib/env";
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
  contracts = STELLAR_CONFIG.contracts,
}: {
  contextRuleId: number;
  signerAddress: string;
  contracts?: ContractSet;
}): WriteOperation {
  return {
    id: `add-signer:${contextRuleId}:${signerAddress}`,
    contractId: contracts.smartAccount,
    functionName: "add_signer",
    args: [u32ScVal(contextRuleId), signerDelegatedScVal(signerAddress)],
    strategy: "custom-account",
    summary: `Register ${signerAddress} as a delegated signer on context rule ${contextRuleId}.`,
  };
}

export function removeSignerOperation({
  contextRuleId,
  signerId,
  contracts = STELLAR_CONFIG.contracts,
}: {
  contextRuleId: number;
  signerId: number;
  contracts?: ContractSet;
}): WriteOperation {
  return {
    id: `remove-signer:${contextRuleId}:${signerId}`,
    contractId: contracts.smartAccount,
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
  contracts = STELLAR_CONFIG.contracts,
}: {
  asset: string;
  enabled: boolean;
  maxSingleTransfer: string;
  contracts?: ContractSet;
}): WriteOperation {
  return {
    id: `set-asset-rule:${asset}`,
    contractId: contracts.policyEngine,
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
  contracts = STELLAR_CONFIG.contracts,
}: {
  allowed: boolean;
  recipient: string;
  contracts?: ContractSet;
}): WriteOperation {
  return {
    id: `set-recipient:${recipient}`,
    contractId: contracts.policyEngine,
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
  contracts = STELLAR_CONFIG.contracts,
}: {
  allowed: boolean;
  operation: string;
  contracts?: ContractSet;
}): WriteOperation {
  return {
    id: `set-operation:${operation}`,
    contractId: contracts.policyEngine,
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
  contracts = STELLAR_CONFIG.contracts,
}: {
  nextVersion: number;
  contracts?: ContractSet;
}): WriteOperation {
  return {
    id: `bump-version:${nextVersion}`,
    contractId: contracts.policyEngine,
    functionName: "bump_version",
    args: [u32ScVal(nextVersion)],
    strategy: "source-account",
    summary: `Raise the policy version to ${nextVersion}. Every payment or scheduled intent still pinned to an older version will be rejected with #2006.`,
  };
}
