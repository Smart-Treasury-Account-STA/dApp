import { STELLAR_CONFIG } from '@/config'
import type { ContractSet } from '@/lib/env'
import { loadContextRules } from '@/lib/stellarClient'
import { resolveTreasuryContracts } from '@/lib/treasuryRegistry/resolveContracts'

/**
 * The addresses allowed to queue relayer work for a treasury.
 *
 * This mirrors the chain rather than inventing a stricter rule of its own.
 * `create_scheduled_payment` -- the call that actually approves a scheduled
 * payment on-chain -- is gated by
 * `env.current_contract_address().require_auth()`, so it is smart_account's
 * signer/context-rule system that decides who may approve one, not the
 * separate `owner` field. Owner-only here would lock out a signer whose
 * approval the ledger already accepted, in a multi-signer treasury.
 *
 * A rule counts when it could cover a call on the smart_account itself:
 * `Default` (which `get_validated_context_by_id` matches against any context)
 * or `CallContract` naming this smart_account. A rule scoped to some other
 * contract -- an adapter, say -- cannot authorize this call and is skipped.
 *
 * Two deliberate imprecisions, both permissive, both harmless here. Rule
 * policies are not evaluated: they run on-chain against the actual call, and
 * a rule carrying one may still reject there. And an expired rule is dropped,
 * but nothing re-reads the set mid-request.
 *
 * Being permissive costs nothing real. This route creates no authority: it
 * re-reads an intent the chain already accepted and tells the relayer to
 * watch it. The approval that moves money happened at
 * `create_scheduled_payment`, under the contract's own check.
 */
export async function loadTreasurySigners(
  contracts: ContractSet,
  now = Math.floor(Date.now() / 1000)
): Promise<Set<string>> {
  const rules = await loadContextRules(
    // Any account the network knows works: the source only has to exist so a
    // simulated transaction can be built. See lib/simulationSource.ts.
    STELLAR_CONFIG.defaultDestination,
    contracts
  )

  const authorized = new Set<string>()
  for (const rule of rules) {
    if (rule.validUntil !== undefined && rule.validUntil < now) continue
    if (!coversSmartAccountCall(rule.contextType, contracts.smartAccount)) {
      continue
    }
    for (const address of rule.signerAddresses) authorized.add(address)
  }
  return authorized
}

/**
 * `readContextRule` stringifies the raw enum, so `Default` arrives as
 * `"Default"` and a scoped rule as `"CallContract,C..."`. Matching on the
 * contract id being present is enough and survives either spelling.
 */
function coversSmartAccountCall(contextType: string, smartAccount: string) {
  if (contextType.startsWith('Default')) return true
  return (
    contextType.startsWith('CallContract') && contextType.includes(smartAccount)
  )
}

/** Whether `address` may queue relayer work for `smartAccountId`. */
export async function mayQueueForTreasury(
  address: string,
  smartAccountId: string
): Promise<boolean> {
  const contracts = await resolveTreasuryContracts(smartAccountId)
  const signers = await loadTreasurySigners(contracts)
  return signers.has(address)
}
