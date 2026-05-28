# Frontend Implementation Guide

Use this document for work in `apps/web`, especially React, Vite, tldraw shapes, CSS, i18n, and browser verification.

## Architecture

- `apps/web` is a Vite React app.
- `packages/shared` owns shared contracts, constants, validation helpers, image presets, provider types, Agent events, and plan schema types.
- `apps/api` is the source of API behavior. Do not duplicate server rules in the web app when a shared contract or endpoint response already exists.
- The Vite dev server defaults to `http://localhost:5173` and proxies `/api` to `http://127.0.0.1:8787`. Override with `VITE_WEB_PORT`, `PORT`, `HOST`, or `VITE_API_PROXY_TARGET` in the repository root `.env`; see `docs/PROVIDER_SETUP.md`.

## React Rules

- Keep components close to their feature area: `features/canvas`, `features/agent`, `features/gallery`, `features/home`, and `features/provider-config`.
- Prefer shared types from `@gpt-image-canvas/shared` over local redefinitions.
- Avoid module-level mutable UI state unless it is an intentional cache and safe across the app lifetime.
- Use lazy initialization for expensive state, `useMemo` for expensive derived values, and `useCallback` where stable references matter for child components or effects.
- Split effects by responsibility. Put user-triggered logic in event handlers rather than effects when possible.
- Use primitive effect dependencies where practical. Avoid object literals, arrays, or inline functions that cause repeated effects.
- Use `startTransition` or deferred state for non-urgent updates that could make typing, canvas interaction, or scrolling feel sticky.

## Performance Rules

- Avoid async waterfalls. Start independent requests together and resolve them with `Promise.all` when the results do not depend on each other.
- Cache repeated metadata reads carefully. Existing caches for asset metadata and previews should stay bounded by actual UI needs.
- Keep canvas work responsive. Avoid heavy synchronous loops in render paths, tldraw shape rendering, pointer handlers, and WebSocket event handlers.
- Prefer direct imports over broad barrel imports for heavy libraries.
- Load heavy optional UI only when it is needed. Existing lazy/Suspense patterns are the right direction for non-critical panels.

## CSS And Layout

- Use the existing CSS files under `apps/web/src/styles` and the tokens in `tokens.css`.
- Add new CSS in the smallest relevant stylesheet. Do not bury feature-specific styles in global files unless the style is truly shared.
- Use stable dimensions for buttons, toolbars, counters, thumbnails, plan cards, and tldraw overlay controls so state changes do not resize the layout.
- Prefer grid and flex wrappers with `gap` over one-off margins on children.
- Keep responsive behavior content-driven. Mobile drawers, side panels, and dialogs must fit without horizontal scrolling.
- Use `docs/design-docs/interaction-quality.md` for UI polish rules: explicit transition properties, `scale(0.96)` press feedback where useful, tabular numbers for dynamic metadata, neutral image outlines, and minimum `40px` hit areas for compact controls.
- Use `docs/design-docs/motion-recipes.md` for reusable state transitions such as dropdowns, modals, panel reveals, icon swaps, text swaps, counters, page steps, and intentional resize.
- Do not add `motion` or `framer-motion` only for micro-interactions. This repo currently uses CSS transitions for polish.

## i18n

- Add user-visible strings to `apps/web/src/shared/i18n/index.tsx` for both `zh-CN` and `en`.
- Do not hard-code visible strings in components unless the string is a brand, file extension, model ID, or API value.
- Keep API error codes stable and map them to localized messages at the UI boundary.

## tldraw

- Custom shape utilities must keep props serializable and compatible with saved project snapshots.
- Plan nodes and placeholder nodes should remain inspectable on the canvas, not hidden scratch state.
- When adding canvas assets, keep asset IDs, metadata URLs, preview URLs, and download URLs consistent with API routes.
- Do not break snapshot restore. Test save and reload behavior when changing shape props or project state.

## Browser Verification

For UI stories:

1. Run `pnpm dev`.
2. Open `http://localhost:5173`, or the configured `VITE_WEB_PORT` URL.
3. Verify the changed workflow in a browser.
4. Check one desktop viewport and one mobile viewport.
5. For canvas work, confirm selected references, generated placeholders, plan nodes, and asset previews render correctly.

Run `pnpm typecheck` and `pnpm build` before completing a code story.
