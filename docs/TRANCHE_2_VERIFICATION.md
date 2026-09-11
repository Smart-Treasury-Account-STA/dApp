# Tranche 2 Verification Report — Smart Treasury Account (STA)

**Date:** 2026-08-14
**Repos checked:** `dApp` (branch `testnet`) and `smart-contracts` (branch `v1-full-implementation`)

---

## Deliverable 1 — Testnet Smart Contracts Deployment — ✅ Satisfied

All 7 contracts (`smart_account`, `policy_engine`, `intent_registry`, `recovery_manager`, `transfer_adapter`, `split_adapter`, STA test asset SAC) deployed on Stellar testnet with published addresses and Explorer links (`docs/TESTNET_DEPLOYMENT.md` in the smart-contracts repo). Verified live, not just claimed:

- **Inspection**: `status`, `is_guardian`, `version` read back correctly against live state.
- **Policy-version pinning + nonce replay, live**: a real signer-authorized `execute_transfer_payment` was submitted on-chain — treasury balance dropped 1,000,000,000 → 995,000,000, `is_nonce_used(1)` flipped `false` → `true`.
- **Invalid actions rejected**: live `validate_policy` calls show `RecipientNotAllowed` (#2004) and `AmountAboveLimit` (#2005) correctly rejected.
- **Minor nuance**: the live invalid-rejection demo used the permissionless `validate_policy` read, not a second live _signed_ invalid execute — equivalent cases (replay, version mismatch, frozen treasury) are proven by the 120-test local suite rather than a second on-chain transaction.

## Deliverable 2 — Testnet dApp and Wallet Flow — ✅ Satisfied

Every pipeline stage is real, not stubbed (no TODO/mock markers found in `src`):

- **Wallet connection**: `@creit.tech/stellar-wallets-kit` wired end-to-end, Freighter + xBull selectable, no custom wallet/signature protocol built.
- **Treasury dashboard, signer screens, policy screens**: backed by live RPC reads/simulations.
- **Payment prep → simulate → approve → submit → track**: full pipeline including genuine SmartAccount custom authorization (Entry A root `AuthPayload` + Entry B delegated-signer digest via `__check_auth`) — the hard, contract-specific part, implemented correctly rather than faked with a plain wallet signature.
- **Contract addresses**: `.env.example` matches the deployment record exactly.
- **Scope note (confirmed on follow-up)**: the dApp configures an _existing_ treasury only — signers, policy rules, status. It does **not** create/bootstrap a new `smart_account` (no `initialize` call anywhere in `src/`). This is intentional per `smart-contracts/docs/DAPP_INTEGRATION_SPEC.md` §9, which explicitly scopes "treasury bootstrapping" to ops/CLI tooling (Deliverable 1), not the dApp — not a gap against the deliverable text, which only ever says "configure or inspect **a** treasury account."

## Deliverable 3 — Testnet Scheduled Payment Relayer — ✅ Satisfied

- Uses `@stellar/stellar-sdk`'s `rpc.Server` throughout, not a hand-built client.
- Rechecks `intent_registry.get_intent` / `is_child_executed` on-chain immediately before every submission, and enforces the ledger sequence window — the "exactly once" guarantee the deliverable is specifically about.
- Calls the hardened two-arg `execute_scheduled_payment(intent_id, child_sequence)` signature (contract resolves asset/destination/amount/policy itself, not caller-supplied).
- No custody, no policy-authority bypass — relayer key is a fee-paying, no-authority Executor only.
- Auth-gated HTTP endpoints (`x-relayer-token`) and a standalone `pnpm relayer:run` script satisfy "self-operated, not managed third-party."
- **Update (2026-08-26)**: `src/lib/relayer/executor.test.ts` was added upstream, closing the test-coverage gap previously noted here. Ran the suite directly — **18/18 tests pass**. Coverage includes: ledger-window gating (not-yet-open, expired, execution-limit-reached, all short-circuiting before any chain read), canonical on-chain override (cancelled intent, already-executed child sequence correctly advances past it without resubmitting, last-execution edge case), submission outcomes (`ERROR`/`TRY_AGAIN_LATER`/`DUPLICATE` all leave the child sequence unadvanced; only confirmed on-chain `SUCCESS` advances it), and poll-exhaustion (stays `ready`/unadvanced rather than false-failing when a tx is still unresolved after all poll attempts). Idempotency lock is in-process/file-based (fine for a single relayer instance), backstopped either way by the on-chain recheck.

---

## Bottom line

All three "how to measure completion" criteria are met on live testnet, with all three deliverables now fully satisfied including test coverage.

One remaining follow-up, not blocking:

1. If a "create new treasury" flow _in_ the dApp is wanted (currently CLI-only), that is new scope beyond what Tranche 2 committed to.
