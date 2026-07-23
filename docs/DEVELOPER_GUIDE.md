# Developer Guide

This guide explains how to set up, test, operate, and continue building the Smart Treasury Account testnet dApp.

## 1. Prerequisites

Install:

- Node.js LTS
- pnpm 9+
- A Stellar testnet wallet such as Freighter or xBull
- Access to the deployed testnet contract IDs
- A funded Stellar testnet account for wallet testing
- A funded Stellar testnet executor account for relayer testing

The reference smart contract documentation is expected at:

- `/home/mohamed/smart-contracts/docs/DAPP_INTEGRATION_SPEC.md`
- `/home/mohamed/smart-contracts/docs/TESTNET_DEPLOYMENT.md`

## 2. Install Dependencies

```bash
pnpm install
```

## 3. Configure Environment

Copy the example file:

```bash
cp .env.example .env.local
```

For normal UI development, the public testnet defaults are already present in `.env.example`.

For relayer testing, set:

```bash
RELAYER_EXECUTOR_SECRET=<stellar testnet executor secret>
RELAYER_ADMIN_TOKEN=<strong local token>
RELAYER_APP_URL=http://localhost:3000
```

Rules:

- Keep `RELAYER_EXECUTOR_SECRET` server-side only.
- Keep `RELAYER_ADMIN_TOKEN` server-side or operator-only.
- Never put secrets in `NEXT_PUBLIC_*` variables.
- Do not commit `.env.local`.

## 4. Run the dApp

```bash
pnpm dev
```

Open:

```text
http://localhost:3000
```

Expected first screen:

- Left navigation with Treasury, Payment, Schedule, and Relayer sections.
- Wallet connect button.
- Testnet contract links.
- Treasury status cards.
- Payment preparation form.
- Scheduled payment form.
- Relayer job panel.

## 5. Required Validation Commands

Run these before every handoff:

```bash
pnpm lint
pnpm typecheck
pnpm build
```

Expected result:

- ESLint exits with code 0.
- TypeScript exits with code 0.
- Next production build exits with code 0.
- Build output lists these routes:
  - `/`
  - `/_not-found`
  - `/api/relayer/jobs`
  - `/api/relayer/jobs/[intentId]/execute`
  - `/api/relayer/run`

## 6. Manual UI Test Plan

### Treasury Read Test

1. Start the dApp.
2. Click `Refresh testnet`.
3. Confirm treasury status, policy version, latest ledger, and contract links load.
4. Confirm failures show a visible notice instead of breaking the page.

### Wallet Connection Test

1. Configure Freighter or xBull for Stellar testnet.
2. Click `Connect wallet`.
3. Select the wallet.
4. Confirm the connected public key appears in the operator wallet panel.
5. Confirm the dApp does not ask for seed phrases or private keys.

### Policy Check Test

1. Enter a valid asset contract, destination, amount, nonce, and policy version.
2. Click `Policy check`.
3. Confirm accepted inputs show `Policy simulation passed`.
4. Change the destination or amount to a value that violates policy.
5. Confirm the dApp shows a rejected policy notice.

### Nonce Check Test

1. Click the nonce refresh button.
2. Click `Nonce check`.
3. Confirm a fresh nonce shows `Nonce is fresh`.
4. After a successful payment, confirm the UI generates a new nonce.

### Transfer Simulation Test

1. Prepare a valid payment.
2. Click `Simulate`.
3. Confirm the dApp reports either structural validity or an expected custom-auth requirement.
4. Confirm validation errors appear before wallet approval for invalid addresses, amount, policy version, or nonce.

### Transfer Submission Test

1. Connect an authorized delegated signer wallet.
2. Prepare a valid payment.
3. Click `Approve & submit`.
4. Approve the SmartAccount authorization entry in the wallet.
5. Approve the prepared transaction envelope in the wallet.
6. Confirm the result notice shows transaction status and hash.
7. Open the transaction link in Stellar Expert testnet explorer.

Expected rejection cases:

- Connected wallet is not a delegated signer.
- SmartAccount signer addresses cannot be verified.
- Nonce is already used.
- Policy simulation rejects the payment.
- RPC returns `ERROR`, `TRY_AGAIN_LATER`, or `DUPLICATE`.

## 7. Scheduled Payment Test Plan

### Schedule Simulation

1. Click `Use current ledger`.
2. Confirm start and end ledger fields populate.
3. Enter a valid amount and max executions.
4. Click the intent refresh button to generate a new intent ID.
5. Click `Simulate schedule`.
6. Confirm the dApp validates:
   - 64-character hex intent ID
   - valid asset and destination
   - positive amount
   - valid start and end ledgers
   - `startLedger < endLedger`
   - `maxExecutions >= 1`
   - intent does not already exist

### Schedule Creation

1. Connect an authorized delegated signer wallet.
2. Prepare a valid schedule.
3. Click `Approve & create`.
4. Approve the SmartAccount authorization entry.
5. Approve the prepared transaction envelope.
6. Confirm the dApp reports `Scheduled payment created`.
7. Confirm the UI shows the confirmed intent as ready to queue.

### Queue the Schedule

1. Enter the relayer admin token in the Relayer section.
2. Click `Queue relayer`.
3. Confirm the job appears in the relayer panel.
4. Confirm `.relayer/relayer-jobs.json` exists after queueing.
5. Confirm the stored job includes:
   - `intentId`
   - `childSequence`
   - `startLedger`
   - `endLedger`
   - `maxExecutions`
   - `executionCount`
   - `status`
   - `note`
   - timestamps

Important: the API reads canonical schedule values from `intent_registry.get_intent`; it does not trust browser-supplied ledger bounds.

## 8. Relayer Operation

### Run Due Jobs From the UI

1. Enter the relayer admin token.
2. Click `Run due jobs`.
3. Confirm the job status updates.
4. Confirm the child sequence advances only after terminal success or confirmed already-consumed child state.

### Run Due Jobs From the Command Line

Keep the app running, then execute:

```bash
RELAYER_APP_URL=http://localhost:3000 pnpm relayer:run
```

For cron-style operation, call this command on a short interval that is appropriate for testnet ledger timing.

### Relayer Safety Checks

Before submitting a scheduled payment, the relayer checks:

- Current ledger is within the execution window.
- `executionCount < maxExecutions`.
- The on-chain intent exists.
- The on-chain intent is not cancelled.
- The current child sequence has not already executed.

After submission:

- `SUCCESS` advances `childSequence` and `executionCount`.
- `FAILED` stores failure status and does not advance `childSequence`.
- `TRY_AGAIN_LATER` leaves the job ready for retry.
- `DUPLICATE` leaves the job ready for recheck and retry.
- Pending timeout leaves the job ready and keeps the same child sequence.

## 9. API Testing With curl

Set:

```bash
export RELAYER_TOKEN=<RELAYER_ADMIN_TOKEN>
```

List jobs:

```bash
curl -sS http://localhost:3000/api/relayer/jobs
```

Queue a confirmed intent:

```bash
curl -sS \
  -X POST http://localhost:3000/api/relayer/jobs \
  -H "content-type: application/json" \
  -H "x-relayer-token: $RELAYER_TOKEN" \
  -d '{"intentId":"<64 hex chars>","startLedger":1,"endLedger":2,"maxExecutions":1}'
```

Run due jobs:

```bash
curl -sS \
  -X POST http://localhost:3000/api/relayer/run \
  -H "x-relayer-token: $RELAYER_TOKEN"
```

Execute one job:

```bash
curl -sS \
  -X POST http://localhost:3000/api/relayer/jobs/<intentId>/execute \
  -H "x-relayer-token: $RELAYER_TOKEN"
```

Expected unauthorized behavior:

- Missing token returns an error.
- Wrong token returns an error.
- Missing `RELAYER_ADMIN_TOKEN` returns a service configuration error for mutation endpoints.

## 10. Development Workflow

Before changing code:

1. Read `docs/TECHNICAL_DOCUMENTATION.md`.
2. Read the relevant source file listed in the source map.
3. Check the smart contract integration spec if touching contract calls or auth entry construction.

When changing frontend behavior:

1. Keep controls aligned with the existing UI primitives.
2. Keep operator flows dense and direct.
3. Preserve wallet and relayer security boundaries.
4. Validate inputs before wallet prompts.
5. Test responsive layout manually on narrow and wide screens.

When changing Stellar transaction logic:

1. Validate local input first.
2. Simulate or read canonical contract state before signing.
3. Keep network passphrase explicit.
4. Treat all wallet, RPC, and contract responses as untrusted.
5. Handle `ERROR`, `TRY_AGAIN_LATER`, `DUPLICATE`, `FAILED`, `SUCCESS`, and pending states deliberately.
6. Do not advance local replay state until terminal success or confirmed on-chain consumption.

When changing relayer logic:

1. Keep executor secret server-only.
2. Require relayer admin token for queue and execution mutations.
3. Read canonical intent data from `intent_registry`.
4. Check `is_child_executed` before spending executor fees.
5. Keep child sequence advancement conservative.
6. Preserve durable job status and notes.

## 11. Extension Roadmap

The current dApp covers the Tranche 2 testnet operator flow. Future development can add:

- Signer-management write screens.
- Policy-management write screens.
- Scheduled payment cancellation UI.
- Split payment UI.
- Recovery manager UI.
- Relayer job retry policy configuration.
- Relayer job history and event timeline.
- Contract event indexing.
- Database-backed relayer queue for multi-instance deployment.
- Automated integration tests with mocked Stellar RPC and wallet adapters.
- End-to-end browser tests for connect, simulate, submit, queue, and run flows.

## 12. Handoff Checklist

Before handing work to another developer:

- Update `.env.example` if variables changed.
- Update this guide if commands, routes, or flows changed.
- Run `pnpm lint`.
- Run `pnpm typecheck`.
- Run `pnpm build`.
- Manually test wallet connection if wallet code changed.
- Manually test relayer API authorization if relayer code changed.
- Confirm no secrets are committed.
