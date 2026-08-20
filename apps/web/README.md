# apps/web

Vite frontend. Not landed yet. Tracked under milestone M2 (pages-as-data, CMS, auth, schedule, theming).

Two standing rules for when it arrives:

- No hardcoded event string or hex color. Event identity comes from `packages/shared` config; colors come from `config/theme` custom properties (the ESLint hex sweep enforces this).
- Every UI surface follows [docs/interface-guidelines.md](../../docs/interface-guidelines.md) — the foundational interface, accessibility, and writing rules for this repo.

## HTTP function endpoints

The OTP sign-in flow (`src/contexts/AuthContext.jsx`) calls the deployed HTTP
functions by convention:

```
https://<region>-<project>.cloudfunctions.net/<name>
```

- `<project>` comes from `VITE_FIREBASE_PROJECT_ID`; `<region>` from
  `VITE_FIREBASE_REGION` (default `us-central1`).
- `VITE_FUNCTIONS_ORIGIN` overrides the whole origin — set it when running
  against the Functions emulator, e.g.
  `VITE_FUNCTIONS_ORIGIN=http://127.0.0.1:5001/<project>/<region>`.
