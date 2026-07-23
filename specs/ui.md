# UI and Styling Standards

## Required UI stack

- Use Tailwind CSS v4 for styling.
- Use shadcn/ui as the component foundation.
- Use next-themes for light, dark, and system theme support.

Do not introduce another CSS framework, component library, CSS-in-JS solution, or theming system unless the user explicitly asks for it or the existing project already depends on it.

## Implementation rules

- Reuse and compose shadcn/ui primitives before creating a bespoke component.
- Keep application components in `src/components/` or the owning feature; retain shadcn components in `src/components/ui/`.
- Use Tailwind utility classes and the project's `cn` utility for conditional class composition.
- Extend design tokens through Tailwind and CSS variables instead of scattering arbitrary values.
- Preserve accessible semantics, keyboard navigation, visible focus states, labels, and sufficient color contrast.
- Make responsive behavior intentional; test small and large layouts rather than assuming a desktop design scales down.
- Support system theme by default and prevent theme flashes during initial render.

## Component quality

- Keep components focused and composable.
- Prefer props and composition over deeply nested configuration objects.
- Avoid premature design-system abstractions.
- Provide clear loading, empty, error, disabled, and success states when relevant.
