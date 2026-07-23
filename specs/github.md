# GitHub, Documentation, and CI

## Repository documentation

Every repository must contain a `README.md`. Add `LICENSE` and `CONTRIBUTING.md` when they are relevant to how the repository is shared or maintained.

The README must cover:

- What the project is and its main purpose
- Prerequisites
- Installation with pnpm
- Local development
- Available validation commands
- Environment variables, without secret values
- Deployment to Vercel
- A concise architecture overview

Keep documentation accurate as the project evolves. Do not generate placeholder documentation that does not match the codebase.

## Commit conventions

Use Conventional Commits:

```text
feat:
fix:
docs:
refactor:
perf:
test:
build:
ci:
chore:
```

Write focused commits with an imperative, descriptive subject. Do not combine unrelated changes in one commit.

## Continuous integration

Use GitHub Actions by default. The minimum workflow on pull requests and the primary branch must:

1. Install dependencies with pnpm.
2. Run linting.
3. Run type checking.
4. Run the production build.

Add tests when the project has them. Cache pnpm dependencies when it is straightforward, pin action versions appropriately, and do not expose secrets in workflow output.
