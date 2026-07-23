# Smart Treasury Account dApp Technical Documentation

This document describes the Smart Treasury Account testnet dApp, its required features, services, integration boundaries, and implementation structure. It is intended for developers who need to maintain, test, audit, or extend the dApp.

## Product Scope

The dApp is an operator console for a Stellar testnet Smart Treasury Account deployment. It supports the Tranche 2 testnet deliverables:

- Inspect deployed treasury contracts on Stellar testnet.
- Connect a Stellar wallet through Stellar Wallets Kit.
- Read treasury status, policy version, context rules, and current ledger state.
- Prepare SAC-based treasury payments.
- Run policy and nonce preflight checks.
- Build SmartAccount custom authorization entries.
- Request wallet approval for delegated signer authorization and prepared transaction envelopes.
- Submit transfer payments to Stellar testnet and track transaction status.
- Prepare scheduled payment intents with ledger-bounded execution windows.
- Create scheduled payment intents through the same SmartAccount authorization model.
- Queue confirmed scheduled intents for relayer execution.
- Run a self-operated relayer that submits due scheduled payments without custodying treasury assets.
- Track relayer job state, child sequence, execution count, transaction hash, and failure notes.

The dApp does not deploy contracts. Contract deployment and address records are maintained in the smart contract repository documentation referenced by the README.

## Application Stack

- Next.js 16 App Router
- React 19
- TypeScript strict mode
- Tailwind CSS v4
- shadcn-style local UI primitives
- TanStack Query for client async state
- `@stellar/stellar-sdk` for Stellar RPC, transaction building, simulation, submission, and polling
- `@creit.tech/stellar-wallets-kit` for Freighter and xBull wallet connectivity

## Source Map

| Path | Responsibility |
| --- | --- |
| `src/app/page.tsx` | Loads the operator console. |
| `src/features/treasury/treasury-console.tsx` | Main dApp UI, wallet actions, payment forms, schedule form, relayer controls, notices, and status panels. |
| `src/features/treasury/relayer-client.ts` | Browser client for relayer API calls. |
| `src/lib/wallet.ts` | Stellar Wallets Kit connection, wallet selection, auth-entry signing, and transaction signing. |
| `src/lib/stellarClient.ts` | Stellar RPC reads, simulations, SmartAccount custom auth construction, payment submission, schedule creation, and receipt polling. |
| `src/lib/smartAccountAuth.ts` | Human-readable SmartAccount approval plan for the UI. |
| `src/lib/relayer/auth.ts` | Server-side relayer admin token enforcement. |
| `src/lib/relayer/store.ts` | Durable JSON job queue, validation, atomic writes, and serialized mutations. |
| `src/lib/relayer/executor.ts` | Scheduled payment execution, canonical intent reads, child execution checks, transaction submission, and batch due-job runner. |
| `src/app/api/relayer/jobs/route.ts` | List and queue relayer jobs. Queueing is protected and uses canonical on-chain intent data. |
| `src/app/api/relayer/jobs/[intentId]/execute/route.ts` | Protected manual execution endpoint for one queued job. |
| `src/app/api/relayer/run/route.ts` | Protected batch runner endpoint for due scheduled jobs. |
| `scripts/run-relayer.mjs` | Command-line runner for cron, local testing, or operator-triggered scheduled execution. |
| `src/config.ts` | Public testnet RPC, contract IDs, asset ID, and test recipient defaults. |

## Required dApp Features

### Wallet Connection

The dApp connects to Stellar testnet wallets through Stellar Wallets Kit. Required wallet behavior:

- Show wallet selection when supported.
- Read the connected public key.
- Use testnet network passphrase.
- Support `signAuthEntry` for delegated signer authorization.
- Support `signTransaction` for the prepared transaction envelope.
- Never expose private keys or seed phrases to the browser app.

Implementation: `src/lib/wallet.ts`

### Treasury Dashboard

The dashboard must display:

- SmartAccount initialized state.
- Paused/frozen state.
- Current policy version.
- Latest Stellar ledger.
- Deployed contract IDs with links to Stellar Expert testnet explorer.
- Context rule summary, signer counts, and policy attachments.

Implementation: `loadTreasurySnapshot`, `loadContextRules`, and the dashboard sections in `treasury-console.tsx`.

### Policy and Nonce Preflight

Before payment submission, the dApp must:

- Validate addresses and numeric input locally.
- Read the fresh policy engine version.
- Simulate `policy_engine.validate_policy`.
- Check `smart_account.is_nonce_used`.
- Reject used nonces before wallet approval.
- Pin `expectedPolicyVersion` in payment drafts.

Implementation: `validatePaymentDraft`, `simulatePolicy`, `checkNonce`, and `approveAndSubmitTransfer`.

### SAC Payment Execution

The payment flow must:

- Prepare asset contract, destination, amount, nonce, and expected policy version.
- Build the `execute_transfer_payment` root invocation.
- Construct SmartAccount custom authorization entries.
- Request wallet signature for the delegated signer auth entry.
- Prepare the transaction through Stellar RPC.
- Request wallet signature for the prepared transaction envelope.
- Submit the transaction and poll for terminal status.
- Treat `ERROR`, `TRY_AGAIN_LATER`, and `DUPLICATE` explicitly.

Implementation: `signAndSubmitContractInvocation` and `approveAndSubmitTransfer`.

### Scheduled Payment Creation

The scheduled payment flow must:

- Validate a 32-byte intent ID.
- Validate amount, asset, destination, start ledger, end ledger, and max executions.
- Ensure `startLedger < endLedger`.
- Ensure `maxExecutions >= 1`.
- Check that the intent ID does not already exist on-chain.
- Simulate creation before submission.
- Submit `create_scheduled_payment` through the SmartAccount custom authorization path.
- Record the confirmed intent locally for relayer queueing only after transaction success.

Implementation: `validateScheduleDraft`, `simulateSchedule`, `checkScheduledIntentExists`, and `approveAndSubmitSchedule`.

### Relayer Queue

The relayer queue must:

- Require `RELAYER_ADMIN_TOKEN` for mutation endpoints.
- Accept queue requests only after a confirmed scheduled intent exists.
- Read canonical schedule bounds from `intent_registry.get_intent`.
- Reject cancelled or missing intents.
- Persist jobs in `.relayer/relayer-jobs.json`.
- Normalize intent IDs to lowercase hex without `0x`.
- Serialize writes inside the process to reduce duplicate-click and retry races.
- Track `childSequence`, `executionCount`, `status`, `note`, `txHash`, `createdAt`, and `updatedAt`.

Implementation: `src/lib/relayer/store.ts`, `src/app/api/relayer/jobs/route.ts`.

### Scheduled Payment Relayer

The relayer service must:

- Run server-side only.
- Use `RELAYER_EXECUTOR_SECRET` for the plain executor account configured in `intent_registry`.
- Never custody treasury assets.
- Never bypass SmartAccount policy checks.
- Check current ledger against `startLedger` and `endLedger`.
- Check execution count against max executions.
- Read `intent_registry.get_intent`.
- Read `intent_registry.is_child_executed`.
- Submit `smart_account.execute_scheduled_payment(intent_id, child_sequence)` only when due.
- Advance local `childSequence` only after terminal success or confirmed already-consumed child state.
- Leave `childSequence` unchanged on RPC retry, duplicate, pending, or failed states.
- Store transaction hash and operational notes.

Implementation: `src/lib/relayer/executor.ts`, `src/app/api/relayer/run/route.ts`, `scripts/run-relayer.mjs`.

## API Reference

### `GET /api/relayer/jobs`

Returns the persisted relayer queue.

Response:

```json
{
  "jobs": []
}
```

### `POST /api/relayer/jobs`

Queues a confirmed scheduled intent. Requires header:

```text
x-relayer-token: <RELAYER_ADMIN_TOKEN>
```

Request body:

```json
{
  "intentId": "64 hex characters",
  "startLedger": 0,
  "endLedger": 0,
  "maxExecutions": 1
}
```

The server uses the request body only to validate shape and identify the intent. It reads canonical `startLedger`, `endLedger`, and `maxExecutions` from `intent_registry.get_intent` before persistence.

### `POST /api/relayer/jobs/[intentId]/execute`

Runs one queued job immediately if eligible. Requires `x-relayer-token`.

This endpoint is useful for manual testnet validation. Scheduled operation should use `POST /api/relayer/run` or `pnpm relayer:run`.

### `POST /api/relayer/run`

Runs up to five due jobs in one server-side pass. Requires `x-relayer-token`.

Response:

```json
{
  "checked": 1,
  "executed": 1,
  "updated": []
}
```

## Data Model

Relayer jobs are stored as JSON records:

```ts
type RelayerJobRecord = {
  intentId: string;
  childSequence: number;
  startLedger: number;
  endLedger: number;
  maxExecutions: number;
  executionCount: number;
  status: "scheduled" | "ready" | "executing" | "executed" | "blocked" | "failed";
  note: string;
  txHash?: string;
  createdAt: string;
  updatedAt: string;
};
```

For testnet, the JSON store is sufficient for a single running app instance. For multi-instance deployments, replace it with a transactional database or durable queue and preserve the same state transitions.

## Environment Variables

Public browser variables:

- `NEXT_PUBLIC_STELLAR_RPC_URL`
- `NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE`
- `NEXT_PUBLIC_SMART_ACCOUNT_ID`
- `NEXT_PUBLIC_POLICY_ENGINE_ID`
- `NEXT_PUBLIC_INTENT_REGISTRY_ID`
- `NEXT_PUBLIC_RECOVERY_MANAGER_ID`
- `NEXT_PUBLIC_TRANSFER_ADAPTER_ID`
- `NEXT_PUBLIC_SPLIT_ADAPTER_ID`
- `NEXT_PUBLIC_STA_ASSET_CONTRACT_ID`
- `NEXT_PUBLIC_TEST_RECIPIENT`

Server-only variables:

- `RELAYER_EXECUTOR_SECRET`: Stellar secret key for the executor account.
- `RELAYER_ADMIN_TOKEN`: required token for relayer queue, execute, and run endpoints.
- `RELAYER_APP_URL`: base URL used by `pnpm relayer:run`.

Do not add executor keys, wallet seeds, RPC secrets, or admin tokens to `NEXT_PUBLIC_*` variables.

## Security Boundaries

- Browser code can read public contract IDs and public RPC URLs only.
- Wallet signatures remain under wallet control.
- Relayer admin token is required for relayer mutations.
- Executor secret is server-only.
- Relayer cannot change asset, destination, amount, policy version, adapter, or execution window because scheduled execution uses canonical intent state on-chain.
- Replay protection is enforced through interactive nonces and scheduled child sequence checks.
- The dApp performs client-side validation for operator ergonomics, but contract checks remain the final authority.

## Known Operational Limits

- The queue store is local JSON for testnet and single-instance operation.
- The runner executes a bounded batch of due jobs per call.
- The UI supports the primary payment and scheduled payment flow; split payments, cancellation UI, recovery UI, and signer-management write screens are extension areas.
- Live wallet support depends on wallet implementation of `signAuthEntry` and `signTransaction`.
