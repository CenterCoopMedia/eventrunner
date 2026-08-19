# apps/web

Vite frontend. Not landed yet. Tracked under milestone M2 (pages-as-data, CMS, auth, schedule, theming).

Two standing rules for when it arrives:

- No hardcoded event string or hex color. Event identity comes from `packages/shared` config; colors come from `config/theme` custom properties (the ESLint hex sweep enforces this).
- Every UI surface follows [docs/interface-guidelines.md](../../docs/interface-guidelines.md) — the foundational interface, accessibility, and writing rules for this repo.
