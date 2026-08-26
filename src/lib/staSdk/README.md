# Vendored Smart Treasury Account SDK (`sta-sdk`)

This directory is a faithful, in-repo port of the smart-contracts repo's
own TypeScript SDK (`sdk/packages/core`, published internally as
`sta-sdk`) — the auth-entry construction, payment/schedule preparation
helpers, typed event parsing, and typed state reads for the Smart Treasury
Account contracts.

## Why vendored, not depended on

The upstream SDK's `auth.ts`/`payments.ts`/`state.ts` are built on
generated per-contract clients (`@sta/*-bindings`, from
`stellar contract bindings typescript`) that are:

- Not published anywhere this dApp (deployed on Vercel) could install from.
- Pinned to `@stellar/stellar-sdk ^14.5.0`, while this dApp runs `^16.2.0`
  — loading two majors of the same classes (`Address`, `xdr.ScVal`, ...) in
  one bundle risks `instanceof` mismatches between them.

So each module here re-implements the same logic directly against
`@stellar/stellar-sdk` (v16, the version this dApp already uses), rather
than importing the generated bindings. Every adaptation is called out in
that module's own doc comment — the important one: `auth.ts`'s
`AuthPayload` struct encoding is hand-built against the verified real
struct shape (matching what `stellarClient.ts` already proved correct,
live) instead of derived from a generated client's `Spec`.

## Files

| File | Ported from | Notes |
|---|---|---|
| `config.ts` | `sdk/packages/core/src/config.ts` | Testnet populated; `buildMainnetConfig` ready for real mainnet addresses once deployed (none exist yet). |
| `auth.ts` | `sdk/packages/core/src/auth.ts` | Entry A/Entry B (`smart_account`'s custom `AuthPayload`) and the relayer's non-root executor authorization. |
| `payments.ts` | `sdk/packages/core/src/payments.ts` | prepare → simulate → sign+submit+poll for transfer/split/scheduled payments and relayer execution. |
| `state.ts` | `sdk/packages/core/src/state.ts` | Typed reads: `AccountStatus`, `ContextRule`, `ScheduledIntent`, `RecoveryRequest`, `WasmHashes` — verified directly against the real `#[contracttype]` struct definitions (including the vendored `stellar-accounts` OZ crate for `ContextRule`), not reconstructed from observed JSON. |
| `events.ts` | `sdk/packages/core/src/events.ts` | Typed `#[contractevent]` parsing — the one module with no generated-bindings dependency at all, ported unchanged. |

## Relationship to this dApp's own operational code

This module is a standalone, self-contained port — it does not import
from `@/lib/stellarClient`, `@/config`, or any other dApp-specific module
(only `@/lib/scval`'s `structScVal`, a generic, dependency-free leaf
utility). `@/lib/staSdk/events` is the one piece actually wired into the
running app today (`receipt.ts`'s and `relayer/executor.ts`'s decoded
status summaries) — the rest exists as a complete, correct, independently
usable reference implementation of the upstream SDK's API, matching its
module boundaries and function signatures as closely as the
generated-bindings constraint above allows.

Keep this in sync by hand if the upstream SDK or the source contracts'
`#[contractevent]`/struct definitions change — there is no automated link
between the two repos.
