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
- `NEXT_PUBLIC_STA_ASSET_CONTRACT_ID`
- `NEXT_PUBLIC_TEST_RECIPIENT`

Do not add relayer executor keys, wallet seeds, or RPC secrets to `NEXT_PUBLIC_*` variables.

Server-only relayer variables:

- `RELAYER_EXECUTOR_SECRET`: Stellar secret key for the plain executor account configured in `intent_registry`.
- `RELAYER_ADMIN_TOKEN`: required token for relayer queue, execute, and run endpoints through `x-relayer-token`.
- `RELAYER_APP_URL`: app base URL used by `pnpm relayer:run`, including the `/app` base path (`https://smarttreasury.io/app` in production).

## Architecture

- Next.js 16 App Router with TypeScript strict mode.
- Tailwind CSS v4, shadcn-style components in `src/components/ui`, and `next-themes`.
- TanStack Query provider is installed for client async state.
- Stellar reads and simulations live in `src/lib/stellarClient.ts`.
- Wallet connection is isolated in `src/lib/wallet.ts`.
- SmartAccount custom authorization planning is isolated in `src/lib/smartAccountAuth.ts`.
- Scheduled relayer queue, durable store, authorization guard, and executor logic live in `src/lib/relayer`.
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

## Deployment

Deploy to Vercel by default. Configure the same environment variables in Vercel project settings for preview and production deployments.

Production is reached through the marketing site (`org/marketing`), which owns `smarttreasury.io` and rewrites `/app/*` to this project's Vercel origin. That proxy needs the production deployment to be reachable without Vercel Deployment Protection, or with a protection bypass configured on the marketing side.
