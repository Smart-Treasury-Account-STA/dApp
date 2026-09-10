# Developer Guide — Smart Treasury Account dApp

This is the operational reference for this dApp: the full user journey from
connecting a wallet through deploying, configuring, operating, and
monitoring a Smart Treasury Account, and a precise reference for every
Soroban contract entrypoint the dApp actually calls — its exact signature,
who is authorized to call it, and where in this codebase that call is
made.

It assumes familiarity with Soroban's authorization model at a high level
(`require_auth()`, `SorobanAuthorizationEntry`); the mechanics specific to
this system are explained in full in §3.

## 1. Architecture at a glance

- **Framework**: Next.js 16 (App Router), TypeScript strict mode.
- **Wallet connectivity**: Stellar Wallets Kit (`@creit.tech/stellar-wallets-kit`), Freighter and xBull, via `src/lib/wallet.ts` and `src/providers/wallet-provider.tsx`.
- **Chain interaction**: `@stellar/stellar-sdk ^16.2.0`, hand-built XDR construction throughout (`src/lib/stellarClient.ts`) — no generated per-contract client bindings, deliberately (see the `sta-sdk` package's README).
- **Contracts**: seven Soroban packages — `account_factory`, `smart_account`, `policy_engine`, `intent_registry`, `recovery_manager`, `transfer_adapter`, `split_adapter` — plus the shared, stateless `webauthn_verifier` (not used by this dApp; passkey signers are out of scope).
- **Relayer**: a self-operated Node service (`src/lib/relayer/`, `src/app/api/relayer/*`, `scripts/run-relayer.mjs`) that executes scheduled payments on behalf of every treasury it's configured as executor for.
- **Treasury registry**: an off-chain store (`src/lib/treasuryRegistry/`) recording which contract addresses belong to which deployed treasury — the only record of this mapping, since no on-chain getter exposes a `smart_account`'s pinned sub-contract addresses (see §2.2).
- **SDK**: `sta-sdk` (npm) — auth-entry construction, transaction preparation, typed event parsing, and typed state reads for the Smart Treasury Account contracts. This dApp depends on it rather than keeping a private copy; only `parseContractEvents`/`findEvent` (event decoding) are actually wired into live code paths today.

Every treasury-aware function and component in this dApp takes an optional
`contracts: ContractSet` parameter (default: the single env-configured
treasury at `NEXT_PUBLIC_SMART_ACCOUNT_ID` etc.) so the same code path
serves both the default treasury (`/`) and any number of user-deployed
ones (`/treasuries/[smartAccountId]`).

## 2. The user journey, end to end

### 2.1 Connect a wallet

`useWallet()` (`src/providers/wallet-provider.tsx`) wraps `src/lib/wallet.ts`'s
`connectWallet()`, which lazily imports the Wallets Kit, opens its
selection modal, and returns `{address, walletName, connected}`. This
state is provided app-wide (mounted in `AppProviders`), so it's already
populated whether the user starts on `/`, `/treasuries`, or a specific
treasury's console.

### 2.2 Deploy a new treasury

Entry point: `/treasuries`, the "Deploy new treasury" button →
`src/lib/deployAccount.ts`'s `deployAccount(wallet)`.

This is **Tier 1 (Guided)** deployment: the connected wallet becomes
owner, policy admin, and recovery admin together, in one on-chain call to
`account_factory.deploy_account` (§3.1). The mechanical wrinkle: that one
call requires **six separate authorization entries** for the caller (its
own body plus once inside each of the five sub-contracts' own
`initialize`), not one — `deployAccount.ts` discovers the exact shape via
a zero-auth "recording mode" simulation, then signs each discovered node
individually through the wallet. In practice this means **the wallet will
prompt for authorization up to six times** for a single "Deploy" click —
expected, not a bug.

The call deploys and wires, atomically:

1. `policy_engine`, `recovery_manager`, `transfer_adapter`, `split_adapter`, `intent_registry` (left uninitialized), and `smart_account` — six fresh contract instances, deterministically addressed from `sha256(caller || salt || per-contract tag)`.
2. `smart_account.initialize(...)`, which — via Soroban's invoker-contract shortcut — also initializes `intent_registry` with itself as admin, with **no separate authorization step**, and binds `transfer_adapter`/`split_adapter` immediately (no timelock; timelocks only apply to _changing_ an adapter on an already-operating treasury).
3. The connected wallet is registered as the sole `Signer::Delegated` under context rule `0`.
4. `guardian_threshold` is set to `1` — but **zero guardians are registered yet** (see §2.4).
5. `executor` is set to this dApp's shared relayer address (`NEXT_PUBLIC_RELAYER_EXECUTOR_ADDRESS`) so the relayer can service this treasury's scheduled payments immediately, with no separate setup step.

Once the transaction succeeds, `deployAccount.ts` decodes the returned
`DeployedAccount` struct (the transaction's `returnValue`) into the six
new contract addresses. The `/treasuries` page then registers this record
(§2.3) and navigates to `/treasuries/[smartAccountId]`.

### 2.3 Treasury registration (why, and how it's verified)

No Soroban getter exposes a `smart_account`'s pinned sub-contract
addresses — the only place that mapping exists is `DeployedAccount`'s
one-time return value. `src/lib/treasuryRegistry/` persists it
(`.treasuries/treasuries.json`) via `POST /api/treasuries`.

This route has **no admin-token gate** — instead, `verifyTreasuryOwnership`
(`src/lib/treasuryRegistry/verify.ts`) simulates
`smart_account.get_owner()` at the claimed address and confirms it
matches the claimed owner before persisting anything. A claim for a
treasury whose real on-chain owner doesn't match is rejected outright.
A second, _disagreeing_ registration claim for an already-registered
`smartAccountId` is rejected with a `TreasuryConflictError` (HTTP 409)
rather than silently accepted — since ownership alone can't prove the
claimed sub-contract addresses are the real ones, this stops a race where
a fabricated claim could otherwise squat a real treasury's registry entry.

### 2.4 Post-deploy setup

A freshly deployed treasury cannot pay anyone and has no recovery path
until this runs. None of it is required before the treasury can _receive_
funds.

- **Policy rules** (Policy section) — `policy_engine` starts with **zero**
  configured rules, so every payment fails closed until at least one
  asset, one recipient, and the `transfer`/`split` operations are
  explicitly allowed (§3.3).
- **Guardians** (Guardians section) — `add_guardian` per guardian address.
  A newly added guardian has a real **~1 day activation delay**
  (`GUARDIAN_ACTIVATION_DELAY_LEDGERS`, ~17,280 ledgers) before it counts
  toward `guardian_threshold` — this call only registers it.
- **Signers** (Signers section) — the deploying wallet is already the sole
  signer; `add_signer`/`remove_signer` manage the set from here. The dApp
  refuses to let the last signer on a rule be removed (a client-side
  guard — it would leave the treasury permanently unable to authorize
  anything).

### 2.5 Payments

- **Transfer** (Payment section) → `approveAndSubmitTransfer` →
  `smart_account.execute_transfer_payment` (§3.2).
- **Split** (Split section) → `approveAndSubmitSplit` →
  `smart_account.execute_split_payment` (§3.2) — one-to-many, with
  per-recipient policy validation matching exactly how the contract
  itself validates (one `validate_policy` call per recipient, not one for
  the whole batch), and client-side duplicate-recipient rejection
  matching the contract's own `DuplicateRecipient` check.

Both flows: policy pre-check → nonce freshness check → wallet approval
(Entry A/B, §3.4) → submit → poll to a terminal status → decoded event
summary (`TransferPaid`/`SplitPaid`) in the resulting toast, via
`sta-sdk`'s `events` module.

### 2.6 Scheduled payments

- **Create** (Schedule section) → `approveAndSubmitSchedule` →
  `smart_account.create_scheduled_payment` (§3.2). The contract **pins**
  `policy_version` and `adapter` to their current values at creation time,
  silently overwriting whatever the client submitted for those two
  fields — a later policy bump or adapter change cannot retroactively
  alter an already-approved schedule.
- **Cancel** (Schedule section, "Cancel an existing scheduled payment") →
  `approveAndSubmitCancelSchedule` → `smart_account.cancel_scheduled_payment`.
- **Queue with the relayer** — a separate, explicit action after a
  successful create (`queueRelayerJob`, `POST /api/relayer/jobs`, gated by
  a wallet session: the connected wallet signs a SEP-53 challenge once, and
  the server checks it is a signer of that treasury) — on-chain creation and
  relayer registration are two distinct steps, not one atomic action.

### 2.7 Relayer execution

The Relayer section lists jobs for the _active_ treasury only (scoped by
`smartAccountId`) and lets the connected wallet execute one job on demand,
under the same per-treasury wallet session as queueing. The scan of every
due job across **every** registered treasury (`runDueRelayerJobs`, §5) is
an operator action with no console control: a QStash schedule or
`scripts/run-relayer.mjs` (cron, systemd timer) hits `POST /api/relayer/run`
with the signed delivery or `x-relayer-token`.

### 2.8 Monitoring

- **Treasury dashboard** (Treasury section) — `status()`, policy version, latest ledger, and every contract address with an explorer link.
- **My Treasuries** (`/treasuries`) — every treasury the connected wallet owns, from the registry.
- **Signers, Guardians, Relayer jobs** — each their own section, all re-targeted automatically to whichever treasury's console is open.

## 3. Contract function reference

Every function below is one this dApp actually calls, with the exact
on-chain signature, its authorization model, and the dApp code that calls
it. Functions the contracts expose but this dApp does not use (governance,
adapter reconfiguration, most of `recovery_manager`'s active recovery
flow) are noted as out of scope at the end of each contract's table —
see the smart-contracts repo's `docs/DAPP_INTEGRATION_SPEC.md` §9 for why.

### 3.1 `account_factory`

| Function                         | Signature                                                                                                                                                               | Auth                                                                                       | Called from                        |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------- |
| `deploy_account`                 | `(caller: Address, salt: BytesN<32>, initial_signers: Vec<Signer>, initial_policies: Map<Address, Val>, guardian_threshold: u32, executor: Address) -> DeployedAccount` | `caller` — plain `Address::require_auth()`, but at **six** separate call-tree nodes (§2.2) | `src/lib/deployAccount.ts`         |
| `get_wasm_hashes`                | `() -> WasmHashes`                                                                                                                                                      | none (read)                                                                                | not called by this dApp            |
| `initialize` / `set_wasm_hashes` | admin setup                                                                                                                                                             | admin (plain)                                                                              | ops-only, not exposed in this dApp |

`DeployedAccount = {smart_account, policy_engine, intent_registry, recovery_manager, transfer_adapter, split_adapter}` (all `Address`).

### 3.2 `smart_account`

Every fund-moving or schedule-authoring entrypoint below is a **custom
account** call — `env.current_contract_address().require_auth()` — which
means the standard envelope signature does _not_ satisfy it; it requires
the Entry A/Entry B `AuthPayload` construction described in §3.4.

| Function                    | Signature                                                                                                  | Auth                                                                                                                                                               | Called from                                     |
| --------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| `execute_transfer_payment`  | `(asset: Address, destination: Address, amount: i128, nonce: u64, expected_policy_version: u32)`           | custom-account                                                                                                                                                     | `approveAndSubmitTransfer` (`stellarClient.ts`) |
| `execute_split_payment`     | `(asset: Address, recipients: Vec<Address>, amounts: Vec<i128>, nonce: u64, expected_policy_version: u32)` | custom-account                                                                                                                                                     | `approveAndSubmitSplit`                         |
| `create_scheduled_payment`  | `(intent: ScheduledIntentArgs)`                                                                            | custom-account                                                                                                                                                     | `approveAndSubmitSchedule`                      |
| `cancel_scheduled_payment`  | `(intent_id: BytesN<32>)`                                                                                  | custom-account                                                                                                                                                     | `approveAndSubmitCancelSchedule`                |
| `execute_scheduled_payment` | `(intent_id: BytesN<32>, child_sequence: u32)`                                                             | **none of its own** — deliberately permissionless; the only real check is `intent_registry.mark_child_executed`'s executor requirement, two levels deep (§3.4, §5) | `src/lib/relayer/executor.ts`                   |
| `add_signer`                | `(context_rule_id: u32, signer: Signer)`                                                                   | custom-account                                                                                                                                                     | `addSignerOperation` → `signers-section.tsx`    |
| `remove_signer`             | `(context_rule_id: u32, signer_id: u32)`                                                                   | custom-account                                                                                                                                                     | `removeSignerOperation`                         |
| `status`                    | `() -> AccountStatus {initialized, paused, frozen, policy_version_hint}`                                   | none (read)                                                                                                                                                        | `loadTreasurySnapshot`                          |
| `get_owner`                 | `() -> Address`                                                                                            | none (read)                                                                                                                                                        | `loadOwner`                                     |
| `get_context_rules_count`   | `() -> u32`                                                                                                | none (read)                                                                                                                                                        | `loadContextRules`                              |
| `get_context_rule`          | `(context_rule_id: u32) -> ContextRule`                                                                    | none (read)                                                                                                                                                        | `loadContextRules`                              |
| `get_signer_id`             | `(signer: Signer) -> u32`                                                                                  | none (read)                                                                                                                                                        | `loadSignerId`                                  |
| `is_nonce_used`             | `(nonce: u64) -> bool`                                                                                     | none (read)                                                                                                                                                        | `checkNonce`                                    |

`ScheduledIntentArgs` fields set by the caller: `intent_id`, `asset`,
`destination`, `amount`, `start_ledger`, `end_ledger`, `interval_ledgers`,
`max_executions`. Two fields the caller may set but which the contract
**silently overwrites**: `policy_version`, `adapter` (see §2.6). `Signer`
is the enum `Signer::Delegated(Address)` in this dApp (the only variant
used — `Signer::External`/passkeys are out of scope).

**Not exposed in this dApp** (governance/recovery-application surface):
`propose_adapter_change`, `apply_adapter_change`, `cancel_adapter_change`,
`freeze`, `apply_guardian_freeze`, `apply_recovery`, `transfer_ownership`,
`accept_ownership`.

### 3.3 `policy_engine`

A freshly deployed treasury's `policy_engine` has **zero rules** — every
payment fails closed until these are configured.

| Function                | Signature                                                                                                                                              | Auth                                                                             | Called from                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `validate_policy`       | `(check: PolicyCheck {operation: Symbol, asset: Address, destination: Address, amount: i128, expected_version: u32}) -> Result<(), PolicyEngineError>` | none — permissionless by design, any caller may pre-check a hypothetical payment | `simulatePolicy`, `simulateSplitPolicy`, `simulatePolicyProbe` |
| `version`               | `() -> u32`                                                                                                                                            | none (read)                                                                      | `loadTreasurySnapshot`                                         |
| `set_asset_rule`        | `(asset: Address, rule: AssetRule {enabled: bool, max_single_transfer: i128})`                                                                         | admin — **plain** `Address::require_auth()` (source-account, not custom-account) | `setAssetRuleOperation` → `policy-section.tsx`                 |
| `set_recipient_allowed` | `(recipient: Address, allowed: bool)`                                                                                                                  | admin (plain)                                                                    | `setRecipientAllowedOperation`                                 |
| `set_operation_allowed` | `(operation: Symbol, allowed: bool)`                                                                                                                   | admin (plain)                                                                    | `setOperationAllowedOperation`                                 |
| `bump_version`          | `(next_version: u32)`                                                                                                                                  | admin (plain)                                                                    | `bumpVersionOperation`                                         |

`policy_engine.admin` is set once at `initialize` (by the factory, to the
deploying caller) and **cannot be changed afterward** — no
`transfer_admin` entrypoint exists on this contract.

Relevant error codes (`PolicyEngineError`, 2000–2008): `InvalidAmount`
`#2002`, `RecipientNotAllowed` `#2004`, `AmountAboveLimit` `#2005`,
`VersionMismatch` `#2006`, `InvalidVersion` `#2007`.

### 3.4 `intent_registry`

Never called directly by the dApp's UI code except for reads — writes
happen only as internal sub-calls from `smart_account` (via the invoker
shortcut) or from the relayer's own explicit call.

| Function                      | Signature                                              | Auth                                                                                                                                                                                              | Called from                                                                                                  |
| ----------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `get_intent`                  | `(intent_id: BytesN<32>) -> ScheduledIntent`           | none (read)                                                                                                                                                                                       | `checkScheduledIntentExists`, `loadIntentPolicyVersion`, `executor.ts`                                       |
| `is_child_executed`           | `(intent_id: BytesN<32>, child_sequence: u32) -> bool` | none (read)                                                                                                                                                                                       | `executor.ts`                                                                                                |
| `mark_child_executed`         | `(intent_id: BytesN<32>, child_sequence: u32)`         | `Executor` (a plain account, set at deploy time) — `executor.require_auth()`, **two levels deep** in `execute_scheduled_payment`'s call graph, so a bare envelope signature does _not_ satisfy it | internal, reached via `smart_account.execute_scheduled_payment`; explicitly authorized in `executor.ts` (§5) |
| `cancel_intent`               | `(intent_id: BytesN<32>)`                              | admin (`smart_account`, via invoker shortcut — no separate authorization needed)                                                                                                                  | internal, via `smart_account.cancel_scheduled_payment`                                                       |
| `initialize` / `set_executor` | admin setup                                            | admin (`smart_account`, via invoker shortcut at deploy time only)                                                                                                                                 | internal, via `account_factory.deploy_account` → `smart_account.initialize`                                  |

Relevant error codes (`IntentRegistryError`, 3000–3013):
`IntentAlreadyExists` `#3002`, `ExecutionTooEarly` `#3007`,
`ExecutionExpired` `#3008`, `ChildAlreadyExecuted` `#3009`,
`ExecutionLimitReached` `#3012`, `InvalidChildSequence` `#3013` (child
sequences are 1-based; `0` is always rejected).

### 3.5 `recovery_manager`

Only guardian _registration_ is exposed in this dApp — the active
recovery flow (opening/approving/finalizing a recovery, guardian-triggered
freeze, threshold changes) is out of scope, matching
`docs/DAPP_INTEGRATION_SPEC.md` §9.

| Function       | Signature                     | Auth                                                                                         | Called from                                      |
| -------------- | ----------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `add_guardian` | `(guardian: Address)`         | admin — plain `Address::require_auth()` (same key as policy admin/owner under Tier 1 deploy) | `addGuardianOperation` → `guardians-section.tsx` |
| `is_guardian`  | `(guardian: Address) -> bool` | none (read)                                                                                  | `checkIsGuardian`                                |

Like `policy_engine`, `recovery_manager.admin` is permanent from
`initialize` — no entrypoint ever changes it.

**Not exposed in this dApp**: `open_recovery`, `approve_recovery`,
`finalize_recovery`, `request_guardian_freeze`, `apply_guardian_freeze`,
`propose_threshold_change`, `apply_threshold_change`,
`propose_remove_guardian`.

## 4. Two authorization models, and why they're different

### 4.1 Custom-account authorization (`smart_account`'s own calls)

`smart_account` implements Soroban's `CustomAccountInterface`
(`__check_auth`, composed from OpenZeppelin's `stellar-accounts` crate).
Any call that does `env.current_contract_address().require_auth()` needs
**two** authorization entries, not a normal transaction signature:

- **Entry A** — an `Address` credential for `smart_account` itself, whose
  `signature` field is not a signature at all but the contract-defined
  `AuthPayload` struct: `{signers: Map<Signer, Bytes>, context_rule_ids: Vec<u32>}`.
  No wallet interaction; assembled directly from the matched context
  rule's id.
- **Entry B** — a standard classic-account credential for the actual
  `Signer::Delegated` wallet, authorizing the _nested_
  `signer.require_auth_for_args((auth_digest,))` call that
  `smart_account`'s own `authenticate()` makes internally. This is the one
  the wallet actually signs (`signAuthEntry`), where
  `auth_digest = sha256(signature_payload || context_rule_ids.to_xdr())`.

Built in `src/lib/stellarClient.ts` (the code actually used by every
component) and, equivalently, in `sta-sdk`'s `auth` module (see that
module's own doc comment for why it hand-encodes rather than depending on
generated contract bindings).

Discovering exactly which invocation nodes need this (a plain transfer is
one node; one that moves an SAC token is two, since the SAC's own
`transfer` needs its own declared sub-invocation) is done by simulating
with **zero** auth entries attached — Soroban's "recording mode" then
reports the exact tree the host actually needs, rather than the dApp
having to restate each contract's internal call graph by hand
(`discoverTreasuryInvocation`).

### 4.2 Source-account authorization (`policy_engine`, `recovery_manager`)

`policy_engine` and `recovery_manager`'s admin-gated writes use plain
`Address::require_auth()` on an ordinary Stellar account — the wallet
just signs the prepared transaction envelope directly
(`submitAsSourceAccount`), no `AuthPayload`/context-rule construction
involved at all.

### 4.3 Executor authorization (the relayer)

`intent_registry.mark_child_executed`'s `Executor` requirement is also a
plain account, **not** `smart_account` — but it sits two levels deep in
`execute_scheduled_payment`'s call graph
(`execute_scheduled_payment -> intent_registry.mark_child_executed ->
ensure_executor`), and a bare source-account envelope signature only
covers a `require_auth()` at the _root_ of the invocation tree. This
needs its own explicit, signed classic-account entry, rooted directly at
`mark_child_executed` — confirmed against live testnet failures when
this was missing; see `src/lib/relayer/executor.ts`'s own comment on the
fix, and `sta-sdk`'s `buildExecutorAuthEntry` (in its `auth` module).

## 5. Relayer architecture

`runDueRelayerJobs` (`src/lib/relayer/executor.ts`) loops over every
tracked job across every treasury, resolving each job's own contract set
via `resolveTreasuryContracts(smartAccountId)`:

- If `smartAccountId` matches the single env-configured default treasury, its contracts come straight from `STELLAR_CONFIG` — no registry lookup needed.
- Otherwise, it's looked up in `src/lib/treasuryRegistry/store.ts`; an unregistered `smartAccountId` fails loudly rather than silently guessing.

For each due job (inside its ledger window, under its execution limit,
not already terminal), `executeRelayerJob`:

1. Re-reads `intent_registry.get_intent`/`is_child_executed` **live**, on-chain, immediately before submitting — the local job record is a cache, never trusted blindly.
2. Builds and signs the executor authorization entry (§4.3).
3. Submits `smart_account.execute_scheduled_payment(intent_id, child_sequence)`.
4. Only advances the locally tracked `child_sequence`/`execution_count` on a **confirmed on-chain SUCCESS** — an RPC-level `ERROR`/`TRY_AGAIN_LATER`/`DUPLICATE`, or a still-pending poll timeout, all leave state untouched so a retry can't double-execute.

Jobs are keyed by `(smartAccountId, intentId)`, not `intentId` alone —
two different treasuries can otherwise pick colliding random intent ids.

## 6. Codebase map

| Concern                                        | Files                                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------------------- |
| Wallet connection                              | `src/lib/wallet.ts`, `src/providers/wallet-provider.tsx`                              |
| Low-level chain calls (the code actually used) | `src/lib/stellarClient.ts`, `src/lib/treasuryWrites.ts`, `src/lib/writeAuth.ts`       |
| SDK (npm dependency, not vendored)             | `sta-sdk` — see its own README                                                        |
| Treasury deploy                                | `src/lib/deployAccount.ts`, `src/app/treasuries/page.tsx`                             |
| Treasury registry                              | `src/lib/treasuryRegistry/`, `src/app/api/treasuries/`                                |
| Per-treasury console                           | `src/features/treasury/treasury-console.tsx` and `src/features/treasury/components/*` |
| Relayer                                        | `src/lib/relayer/`, `src/app/api/relayer/*`, `scripts/run-relayer.mjs`                |
| Event decoding                                 | `sta-sdk`'s `events` module, `src/lib/receipt.ts`                                     |
| Config                                         | `src/config.ts`, `src/lib/env.ts` (env-var-driven, what the app actually runs on)     |
