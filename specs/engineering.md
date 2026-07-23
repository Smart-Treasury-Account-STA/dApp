# Engineering Standards

These instructions apply to every project unless the user explicitly overrides them. Follow them as requirements, not suggestions.

## Priorities

Build production-ready software with the following priorities, in order:

1. Simplicity
2. Readability
3. Type safety
4. Maintainability
5. Performance
6. Developer experience

Prefer straightforward, well-named code over clever abstractions. Do not over-engineer, duplicate logic, leave generated TODOs, or add unused files and dependencies.

## Baseline stack

For frontend applications, use the latest stable versions compatible with the project:

- Next.js 16
- React and TypeScript
- Next.js App Router
- Node.js LTS
- pnpm
- Tailwind CSS v4
- shadcn/ui
- next-themes
- TanStack Query
- ESLint and Prettier

Deploy to Vercel by default.

## Working rules for agents

- Start from the smallest viable architecture and dependency set.
- Check the existing project before introducing a new pattern or library.
- Keep the application runnable at every meaningful stage.
- Use stable package versions; do not select canary, beta, or release-candidate versions unless requested.
- Remove irrelevant starter boilerplate.
- Explain material trade-offs before making an ambiguous architectural choice.
- Confirm the project passes linting, type checking, and a production build before handoff.

## Quality bar

Generated code must be typed, modular, readable, easy to extend, and appropriate for production. Prefer established framework conventions to custom conventions.
