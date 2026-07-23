# TypeScript and Coding Style

## Functional programming

Use functions, not classes. Do not introduce classes, inheritance, decorators, or object-oriented frameworks unless the user explicitly requests an exception.

Prefer:

- Pure functions where practical
- Composition over inheritance
- Immutable updates
- Small, focused modules
- Explicit inputs and outputs
- Discriminated unions for state and error variants

## TypeScript

- Enable and preserve strict TypeScript settings.
- Prefer `type` declarations; use `interface` only when declaration merging or extension is genuinely needed.
- Do not use `any`. Use `unknown`, type guards, generics, or precise types instead.
- Use `satisfies` and `as const` when they preserve useful inference.
- Model nullable, loading, error, and success states explicitly.
- Avoid unsafe type assertions; narrow values at their boundaries.

## Imports and naming

- Prefer configured absolute imports such as `@/components`, `@/features`, `@/lib`, and `@/types`.
- Keep imports consistently ordered: external modules, internal aliases, then relative modules; keep type-only imports explicit.
- Choose names that explain purpose. Avoid vague names such as `data`, `utils`, `helpers`, or `manager` when a domain-specific name is possible.
- Export only the public API a module needs to expose.

## Formatting and linting

- Use the official Next.js-recommended ESLint configuration plus Prettier.
- Let Prettier own formatting and ESLint own code-quality rules; resolve conflicts through the standard integration.
- Format code automatically through the project's editor or scripts.
- Do not disable lint or type rules globally to avoid fixing an issue. Use a narrow, documented exception only when justified.
