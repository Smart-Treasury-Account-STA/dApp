import { xdr } from '@stellar/stellar-sdk'

import { STELLAR_CONFIG } from '@/config'
import type { ContractSet } from '@/lib/env'
import { structScVal } from '@/lib/scval'
import {
  addressScVal,
  boolScVal,
  contextTypeDefaultScVal,
  i128ScVal,
  signerDelegatedScVal,
  symbolScVal,
  u32ScVal,
} from '@/lib/stellarClient'

export type WriteStrategy = 'custom-account' | 'source-account'

export type WriteOperation = {
  id: string
  contractId: string
  functionName: string
  args: xdr.ScVal[]
  strategy: WriteStrategy
  summary: string
}

export function addSignerOperation({
  contextRuleId,
  signerAddress,
  contracts = STELLAR_CONFIG.contracts,
}: {
  contextRuleId: number
  signerAddress: string
  contracts?: ContractSet
}): WriteOperation {
  return {
    id: `add-signer:${contextRuleId}:${signerAddress}`,
    contractId: contracts.smartAccount,
    functionName: 'add_signer',
    args: [u32ScVal(contextRuleId), signerDelegatedScVal(signerAddress)],
    strategy: 'custom-account',
    summary: `Register ${signerAddress} as a delegated signer on context rule ${contextRuleId}.`,
  }
}

export function removeSignerOperation({
  contextRuleId,
  signerId,
  contracts = STELLAR_CONFIG.contracts,
}: {
  contextRuleId: number
  signerId: number
  contracts?: ContractSet
}): WriteOperation {
  return {
    id: `remove-signer:${contextRuleId}:${signerId}`,
    contractId: contracts.smartAccount,
    functionName: 'remove_signer',
    args: [u32ScVal(contextRuleId), u32ScVal(signerId)],
    strategy: 'custom-account',
    summary: `Revoke signer #${signerId} from context rule ${contextRuleId}.`,
  }
}

export function addContextRuleOperation({
  name,
  signerAddress,
  contracts = STELLAR_CONFIG.contracts,
}: {
  name: string
  signerAddress: string
  contracts?: ContractSet
}): WriteOperation {
  return {
    id: `add-context-rule:${name}:${signerAddress}`,
    contractId: contracts.smartAccount,
    functionName: 'add_context_rule',
    args: [
      contextTypeDefaultScVal(),
      xdr.ScVal.scvString(name),
      xdr.ScVal.scvVoid(), // valid_until: Option<u32> = None
      xdr.ScVal.scvVec([signerDelegatedScVal(signerAddress)]),
      xdr.ScVal.scvMap([]), // policies: none at creation -- see this plan's Global Constraints
    ],
    strategy: 'custom-account',
    summary: `Create a new, independent context rule "${name}" with ${signerAddress} as its sole signer.`,
  }
}

export function removeContextRuleOperation({
  contextRuleId,
  contracts = STELLAR_CONFIG.contracts,
}: {
  contextRuleId: number
  contracts?: ContractSet
}): WriteOperation {
  return {
    id: `remove-context-rule:${contextRuleId}`,
    contractId: contracts.smartAccount,
    functionName: 'remove_context_rule',
    args: [u32ScVal(contextRuleId)],
    strategy: 'custom-account',
    summary: `Remove context rule ${contextRuleId} entirely.`,
  }
}

export function setAssetRuleOperation({
  asset,
  enabled,
  maxSingleTransfer,
  contracts = STELLAR_CONFIG.contracts,
}: {
  asset: string
  enabled: boolean
  maxSingleTransfer: string
  contracts?: ContractSet
}): WriteOperation {
  return {
    id: `set-asset-rule:${asset}`,
    contractId: contracts.policyEngine,
    functionName: 'set_asset_rule',
    args: [
      addressScVal(asset),
      structScVal({
        enabled: boolScVal(enabled),
        max_single_transfer: i128ScVal(maxSingleTransfer),
      }),
    ],
    strategy: 'source-account',
    summary: enabled
      ? `Enable ${asset} with a single-transfer cap of ${maxSingleTransfer}.`
      : `Disable ${asset} for all transfers.`,
  }
}

/**
 * Adds or removes one address from `policy_engine`'s allowlist.
 *
 * Keeps the contract's word — the entrypoint is `set_recipient_allowed` and
 * its refusal is `RecipientNotAllowed` (#2004). Everywhere the operator can
 * see, the same address is a *destination*; the contract's spelling stops at
 * this call boundary.
 */
export function setRecipientAllowedOperation({
  allowed,
  recipient,
  contracts = STELLAR_CONFIG.contracts,
}: {
  allowed: boolean
  recipient: string
  contracts?: ContractSet
}): WriteOperation {
  return {
    id: `set-recipient:${recipient}`,
    contractId: contracts.policyEngine,
    functionName: 'set_recipient_allowed',
    args: [addressScVal(recipient), boolScVal(allowed)],
    strategy: 'source-account',
    summary: allowed
      ? `Allow payments to ${recipient}.`
      : `Remove ${recipient} from the destination allowlist.`,
  }
}

export function setOperationAllowedOperation({
  allowed,
  operation,
  contracts = STELLAR_CONFIG.contracts,
}: {
  allowed: boolean
  operation: string
  contracts?: ContractSet
}): WriteOperation {
  return {
    id: `set-operation:${operation}`,
    contractId: contracts.policyEngine,
    functionName: 'set_operation_allowed',
    args: [symbolScVal(operation), boolScVal(allowed)],
    strategy: 'source-account',
    summary: allowed
      ? `Enable the ${operation} operation.`
      : `Disable the ${operation} operation, stopping every payment that uses it.`,
  }
}

export function bumpVersionOperation({
  nextVersion,
  contracts = STELLAR_CONFIG.contracts,
}: {
  nextVersion: number
  contracts?: ContractSet
}): WriteOperation {
  return {
    id: `bump-version:${nextVersion}`,
    contractId: contracts.policyEngine,
    functionName: 'bump_version',
    args: [u32ScVal(nextVersion)],
    strategy: 'source-account',
    summary: `Raise the policy version to ${nextVersion}. Every payment or scheduled intent still pinned to an older version will be rejected with #2006.`,
  }
}

/**
 * `recovery_manager.add_guardian` -- admin-gated (plain `Address::require_auth()`,
 * the same `source-account` strategy as the policy_engine writes above, not
 * smart_account's custom AuthPayload), so only the treasury's Recovery Admin
 * (the same key as Policy Admin/Owner under Tier 1 deploy -- see
 * DAPP_INTEGRATION_SPEC.md §12.1) can add one. A newly registered guardian
 * has a ~1 day activation delay before it counts toward guardian_threshold
 * (contracts/recovery_manager/src/lib.rs's GUARDIAN_ACTIVATION_DELAY_LEDGERS) --
 * this call only registers it, it does not make it live immediately.
 */
export function addGuardianOperation({
  guardian,
  contracts = STELLAR_CONFIG.contracts,
}: {
  guardian: string
  contracts?: ContractSet
}): WriteOperation {
  return {
    id: `add-guardian:${guardian}`,
    contractId: contracts.recoveryManager,
    functionName: 'add_guardian',
    args: [addressScVal(guardian)],
    strategy: 'source-account',
    summary: `Register ${guardian} as a guardian. It activates in about a day, not immediately.`,
  }
}
