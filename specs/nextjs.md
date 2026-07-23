# Next.js Conventions

## Required setup

- Use Next.js 16 with TypeScript and the App Router.
- Use pnpm for installs, scripts, and lockfiles.
- Enable TypeScript strict mode.
- Configure the official Next.js ESLint recommendation and Prettier.
- Make `pnpm lint`, `pnpm typecheck`, and `pnpm build` available where applicable.

## Rendering and data flow

- Prefer React Server Components by default.
- Add `'use client'` only at the smallest boundary that needs browser APIs, interactivity, client state, or client-side data fetching.
- Prefer async Server Components for server-rendered data.
- Use Server Actions for mutations that naturally belong to the application.
- Use Route Handlers for explicit HTTP endpoints, webhooks, or external consumers.
- Avoid `useEffect` for work that can happen during rendering, on the server, or in an event handler.
- Use `Suspense` and loading/error boundaries when they improve the user experience.

## Client data fetching

- Use TanStack Query for client-side asynchronous state, caching, invalidation, and mutations.
- Do not create a global fetch abstraction unless it removes real, repeated complexity.
- Keep query keys stable and colocate query logic with the feature that owns it.

## Project structure

Use `src/` by default:

```text
src/
  app/
  components/
    ui/
  features/
  hooks/
  providers/
  lib/
  services/
  actions/
  types/
  utils/
  styles/
```

Introduce `features/` once a domain has related components, hooks, actions, types, or utilities. Keep feature-specific code close together; do not turn the shared folders into dumping grounds.

## Environment variables

- Use `.env.local` for local secrets and environment-specific values.
- Never expose secrets through `NEXT_PUBLIC_` variables.
- Validate required environment variables at startup or at the boundary where they are used.
- Never hardcode credentials, API keys, or production URLs.
