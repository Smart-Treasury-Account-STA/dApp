# Architecture and Repository Strategy

Choose the lightest repository structure that fits the product. Do not introduce a monorepo, separate repository, package, service, or abstraction without a clear ownership or reuse need.

## Repository choice

### Single repository

Use a single repository for a small, cohesive application or when one deployable is the clear product boundary.

### Monorepo

Use a pnpm workspace and Turborepo when multiple applications or packages are tightly coupled, share release cadence, and benefit from atomic changes. Typical candidates are a web app plus shared UI, SDK, configuration, or contract packages.

Keep the workspace intentionally small. A possible shape is:

```text
apps/
  web/
packages/
  ui/
  config/
  sdk/
```

Create a package only when it has a real consumer and a clear boundary.

### Multiple repositories

Use separate repositories in the GitHub organization when components have independent ownership, permissions, release cycles, visibility, or deployment lifecycles. Common examples include an application, public SDK, API, MCP server, documentation site, and examples.

Document the contract between repositories: versioning, release ownership, compatibility expectations, and local development workflow.

## Code organization

- Prefer feature-oriented modules as the application grows.
- Keep shared utilities narrow, generic, and well named.
- Define boundaries around domains and external systems, not around speculative layers.
- Avoid circular dependencies and hidden global state.
- Prefer explicit dependency injection through function arguments when a dependency needs to vary.
- Keep server-only code separate from client code and prevent server secrets from crossing the client boundary.
