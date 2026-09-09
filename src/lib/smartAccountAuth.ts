import { findAuthorizingPath } from '@/lib/treasurySecurity'
import type {
  ContextRule,
  ExecutionStep,
  PaymentDraft,
  WalletState,
} from '@/types'

export type SmartAccountAuthPlan = {
  rootInvocation: string
  contextRuleIds: number[]
  nonce: string
  expirationLedgers: number
  requiredDelegatedSigners: string[]
  steps: ExecutionStep[]
}

/**
 * Picks the context rule to authorize under for a given signer.
 *
 * This id is written into the AuthPayload (`context_rule_ids` in
 * `stellarClient.ts`'s `smartAccountAuthPayload`), so the contract validates
 * against *this* rule and no other. Nothing scans for "some rule that works":
 * whatever this returns is what the signature is checked against.
 *
 * A treasury can carry several rules that are all `Default` — the context type
 * does not distinguish them — so matching on the type alone always returns the
 * first one and ignores which rule the connected wallet is actually registered
 * in. That silently builds an AuthPayload pinned to a rule the signer is not
 * part of, which the contract then refuses.
 *
 * Among the signer's own rules, one this wallet can satisfy alone wins, then
 * one whose policy might accept a single signature, and only then one that
 * provably needs co-signers. Order matters because this dApp submits exactly
 * one authorization entry: picking the first listed match instead would pin a
 * wallet to a two-signer rule and guarantee a rejection while a working rule
 * sat right next to it. The ranking is `findAuthorizingPath`'s, deliberately —
 * `collectWriteWarnings` warns about the rule chosen here, so the two must
 * agree or the dialog names a rule the submission does not use.
 *
 * The type-then-first fallback is kept for the disconnected case, and for a
 * wallet on no readable rule, so the UI still has a rule to describe.
 */
export function selectRuleForSigner(
  rules: ContextRule[],
  signerAddress: string | null
): ContextRule | null {
  const path = findAuthorizingPath(rules, signerAddress)
  const owned = path.soleSignerRule ?? path.policyGatedRules[0] ?? path.rules[0]
  if (owned) {
    return owned
  }

  return (
    rules.find((rule) => rule.contextType.toLowerCase().includes('default')) ??
    rules[0] ??
    null
  )
}

export function buildTransferAuthPlan(
  draft: PaymentDraft,
  wallet: WalletState,
  rules: ContextRule[]
): SmartAccountAuthPlan {
  const selectedRule = selectRuleForSigner(rules, wallet.address)
  const requiredDelegatedSigners = selectedRule?.signerAddresses ?? []
  const walletCanApprove =
    Boolean(wallet.address) &&
    (requiredDelegatedSigners.length === 0 ||
      requiredDelegatedSigners.includes(wallet.address ?? ''))

  return {
    rootInvocation:
      'smart_account.execute_transfer_payment(asset, destination, amount, nonce, expected_policy_version)',
    contextRuleIds: selectedRule ? [selectedRule.id] : [],
    nonce: draft.nonce,
    expirationLedgers: 100,
    requiredDelegatedSigners,
    steps: [
      {
        label: 'Root auth payload',
        state: selectedRule ? 'complete' : 'blocked',
        detail: selectedRule
          ? `Entry A uses context rule ${selectedRule.id} and embeds an AuthPayload map.`
          : 'No context rule was loaded from smart_account.',
      },
      {
        label: 'Delegated signer digest',
        state: walletCanApprove ? 'active' : 'blocked',
        detail: walletCanApprove
          ? 'Entry B signs sha256(signature_payload || context_rule_ids_xdr) for __check_auth.'
          : 'Connected wallet is not listed as a delegated signer for the selected rule.',
      },
      {
        label: 'Prepared transaction',
        state: 'pending',
        detail:
          'Attach Entry A plus one signed Entry B per required delegated signer before prepareTransaction.',
      },
      {
        label: 'Submit and track',
        state: 'pending',
        detail:
          'Poll getTransaction and resolve status from pay_ok / intent / exec events.',
      },
    ],
  }
}
