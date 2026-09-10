# Smart Treasury Account Testnet dApp

Operator console for the Smart Treasury Account V1 deployment on Stellar testnet. The app is built for Tranche 2: wallet connection, treasury status inspection, policy preflight, nonce checks, payment simulation, scheduled-payment preparation, protected relayer queueing, and scheduled relayer execution.

The contract integration model follows the Smart Treasury Account contract specification and the deployment record published by the contract repository.

## Documentation

Architecture notes, the developer guide, and the engineering standards this repository follows are maintained outside the public repository, in the workspace `agent/` knowledge base:

- `agent/docs/dapp/technical-documentation.md`: architecture, required dApp features, services, APIs, relayer model, data model, and security boundaries.
- `agent/docs/dapp/developer-guide.md`: setup, environment configuration, local testing, wallet validation, scheduled payment testing, relayer operation, and extension workflow.
- `agent/standards/`: engineering, architecture, Next.js, UI, blockchain, deployment, and CI standards.

Operator-facing documentation ships with the production release and will live in this repository.

## Prerequisites

- Node.js LTS
- pnpm 9+
- Freighter or xBull configured for Stellar testnet

## Installation

```bash
pnpm install
```

## Local Development

```bash
pnpm dev
```

Open `http://localhost:3000/app`. The app is built with `basePath: "/app"` (see `next.config.ts`): in production the marketing site owns `smarttreasury.io` and proxies `/app/*` to this deployment, so every route, asset, and API handler carries that prefix on every origin, including the project's own Vercel domain (where `/` redirects to `/app`).

## Validation

```bash
pnpm lint
pnpm typecheck
pnpm build
```

## Relayer Runner

Start the Next.js app, configure the server-only relayer variables, then run due scheduled payments from an operator shell or scheduler:

```bash
RELAYER_APP_URL=http://localhost:3000/app pnpm relayer:run
```

The runner calls `POST <RELAYER_APP_URL>/api/relayer/run` with `x-relayer-token`. It submits only jobs whose ledger window is open, checks `intent_registry.get_intent` and `intent_registry.is_child_executed` before submission, and advances the local `childSequence` only after a terminal successful transaction.

## Scheduled Trigger (QStash)

`POST /api/relayer/run` also accepts deliveries signed by [Upstash QStash](https://upstash.com/docs/qstash), so a cron schedule can run due jobs without ever holding the admin token.

1. In the QStash console, copy the current and next signing keys into `QSTASH_CURRENT_SIGNING_KEY` and `QSTASH_NEXT_SIGNING_KEY` (Vercel, Production). Set `QSTASH_RELAYER_RUN_URL` to the exact destination registered in the next step, so a signature for any other URL is refused.
2. Register the schedule against the exact URL you pinned in `QSTASH_RELAYER_RUN_URL`. The deployment's own domain (`https://sta-dapp.vercel.app/app/...`, publicly reachable) avoids the marketing proxy hop; `https://smarttreasury.io/app/...` works too, as long as the registered URL and the pinned one are the same string. The route pins from the environment rather than from `request.url` because behind the proxy the two differ.

```bash
curl -X POST "https://qstash.upstash.io/v2/schedules/https://sta-dapp.vercel.app/app/api/relayer/run" \
  -H "Authorization: Bearer $QSTASH_TOKEN" \
  -H "Upstash-Cron: * * * * *" \
  -H "Upstash-Retries: 2" \
  -H "Upstash-Failure-Callback: https://<alert webhook>"
```

3. Every run answers `{"trigger":"qstash","checked":n,"executed":n,"updated":[...]}`, visible in the QStash logs. A `401` means the signature did not verify (wrong keys or a destination other than the pinned one), a `503` a missing variable, a `500` an RPC or database failure. Each non-2xx status triggers QStash's retries and then the failure callback, which is the place to hook an alert.
4. Retries and overlapping runs are safe by construction: the executor re-reads every intent and `intent_registry.is_child_executed` on chain before submitting, and a job is claimed with a conditional write on the store's current state, so of two runs -- the schedule and a console Execute included -- exactly one submits. A job stays with its run while `executing` is inside its five-minute lease; the console's Execute is disabled meanwhile.

A run polls each submitted transaction for up to about three minutes. Leave `Upstash-Timeout` at the plan default and keep the Vercel function's maximum duration above that window, otherwise a run cut off mid-poll leaves its job in `executing`.

## Environment Variables

Copy `.env.example` to `.env.local` when overriding deployment defaults.

All variables currently used by the browser are public Stellar testnet values:

- `NEXT_PUBLIC_STELLAR_RPC_URL`
- `NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE`
- `NEXT_PUBLIC_SMART_ACCOUNT_ID`
- `NEXT_PUBLIC_POLICY_ENGINE_ID`
- `NEXT_PUBLIC_INTENT_REGISTRY_ID`
- `NEXT_PUBLIC_RECOVERY_MANAGER_ID`
- `NEXT_PUBLIC_TRANSFER_ADAPTER_ID`
- `NEXT_PUBLIC_SPLIT_ADAPTER_ID`
- `NEXT_PUBLIC_DEFAULT_ASSET_CONTRACT_ID`
- `NEXT_PUBLIC_DEFAULT_DESTINATION`

Do not add relayer executor keys, wallet seeds, or RPC secrets to `NEXT_PUBLIC_*` variables.

Server-only relayer variables:

- `RELAYER_EXECUTOR_SECRET`: Stellar secret key for the plain executor account configured in `intent_registry`.
- `RELAYER_ADMIN_TOKEN`: the operator credential, sent as `x-relayer-token` by `pnpm relayer:run` and accepted on every relayer endpoint; also the server secret that signs wallet challenges and session cookies. Users never hold it: queue and execute are authorized by a wallet session instead.
- `RELAYER_APP_URL`: app base URL used by `pnpm relayer:run`, including the `/app` base path (`https://smarttreasury.io/app` in production).
- `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`: optional, QStash signing keys that let a schedule call the run endpoint (see above).
- `QSTASH_RELAYER_RUN_URL`: optional, the exact destination the QStash schedule was registered with; signatures for any other URL are refused.

## Architecture

- Next.js 16 App Router with TypeScript strict mode.
- Tailwind CSS v4, shadcn-style components in `src/components/ui`, and `next-themes`.
- TanStack Query provider is installed for client async state.
- Stellar reads and simulations live in `src/lib/stellarClient.ts`.
- Wallet connection is isolated in `src/lib/wallet.ts`.
- SmartAccount custom authorization planning is isolated in `src/lib/smartAccountAuth.ts`.
- Scheduled relayer queue, durable store, authorization guard, and executor logic live in `src/lib/relayer`.
- Postgres access goes through Drizzle. `src/lib/db/schema.ts` is the single source of truth for the database shape: migrations are generated from it and the stores query through it, so a column cannot exist in one place and not the other.
- The operator console lives in `src/features/treasury/treasury-console.tsx`.
- Browser calls to this app's own API routes go through `apiUrl()` in `src/lib/basePath.ts`, which prepends the base path that `next/link` and the router apply on their own.

The dApp treats `smart_account` as a Soroban custom account. Payment and scheduled-payment execution are therefore modeled as:

1. Read `policy_engine.version()` fresh.
2. Generate and check a SmartAccount nonce.
3. Simulate `policy_engine.validate_policy`.
4. Build the root invocation.
5. Assemble Entry A with the contract-specific `AuthPayload`.
6. Collect one delegated signer Entry B per required signer.
7. Prepare, submit, and track the transaction from typed contract events.

## Database

Neon Postgres through Drizzle, one branch per environment. The schema lives in
`src/lib/db/schema.ts`; migrations are generated from it into
`src/lib/db/migrations` and committed.

```bash
pnpm db:generate   # after changing the schema, writes a migration
pnpm db:migrate    # applies pending migrations to DATABASE_URL
pnpm db:baseline   # one-time, for a database whose tables predate Drizzle
```

`db:migrate` targets whatever `DATABASE_URL` points at, so each branch is
migrated separately. For a Neon branch:

```bash
DATABASE_URL="$(neon connection-string <branch> --project-id <id> \
  --database-name <db> --role-name <role>)" pnpm db:migrate
```

Store tests run against PGlite, a real Postgres in-process, migrated from
those same files. A schema change that the queries do not match therefore
fails in CI rather than in production.

## Deployment

Deploy to Vercel by default. Configure the same environment variables in Vercel project settings for preview and production deployments.

Production is reached through the marketing site (`org/marketing`), which owns `smarttreasury.io` and rewrites `/app/*` to this project's Vercel origin. That proxy needs the production deployment to be reachable without Vercel Deployment Protection, or with a protection bypass configured on the marketing side.
