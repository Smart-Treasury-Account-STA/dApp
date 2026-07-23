# Deployment and Operations

## Default platform

Deploy Next.js applications to Vercel unless the user specifies a different target.

## Delivery requirements

Before handoff, ensure the project can complete:

```bash
pnpm lint
pnpm typecheck
pnpm build
```

Do not leave build warnings or known lint/type errors unresolved. If a command is intentionally unavailable, document why and provide the closest relevant verification command.

## Vercel conventions

- Keep the application compatible with Vercel's build and runtime model.
- Configure environment variables in Vercel rather than committing secrets.
- Document required variables and whether each is needed for development, preview, or production.
- Use preview deployments for pull requests and production deployments for the primary production branch.
- Add platform-specific configuration only when it solves a demonstrated requirement.

## Reliability and security

- Fail clearly when required configuration is missing.
- Keep server-only secrets out of client bundles and logs.
- Handle expected external-service failures with useful user-facing messages and actionable server logs.
- Favor built-in Vercel and Next.js capabilities before adding operational services.
