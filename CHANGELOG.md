# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Public repository under the Center for Cooperative Media, Apache-2.0.
- Shared workspace package: deploy-env validation, event config schema, lifecycle clock, event-timezone time helpers, registration state machine, badge validation, slug and URL-safety utilities.
- Day-one legal and community files: LICENSE, NOTICE, SECURITY.md, CODE_OF_CONDUCT.md, CONTRIBUTING.md, issue and pull request templates.
- Credential-free CI for the shared-package test suite.
- Product site on GitHub Pages.
- Three-workspace layout: `apps/web` and `functions` join `packages/shared` as npm workspaces (spec §1.1–1.2).
- ESLint flat config with the hex-literal ban and its three-path allowlist (spec §7.6) plus `react-hooks/rules-of-hooks`.
- Firestore and Storage security-rules tests running on the Firebase emulators, and CI lint + rules jobs — still credential-free and fork-runnable (spec §8.1).
- CMS content endpoints under the two-revision publish model: draft-only create/update/delete, version history reads, and the chunked resumable publish pipeline over the six publishable collections and their `_drafts` siblings (spec §8.4, #12).
- Pages-as-data and live-updates admin endpoints: `cmsSavePage`/`cmsDeletePage` against the block-type registry, `cmsSaveUpdate`/`cmsDeleteUpdate`, all writing drafts only (spec §5.2, #13).
- Validated `config/*` writers — `updateEventConfig`, `updateFeatures`, `updateTheme`, `updateBadges` — gated by the server-only admin list, rejecting deploy-mirrored read-only fields, with audit rows on every write (spec §1.3, #14).
- `apps/web` foundation: Vite 5 + React 18 + Tailwind 3 attendee site with a committed synthetic snapshot (`src/generated/`) for zero-network first paint, an `EventConfigProvider` → `AuthProvider` → `ContentProvider` → `ToastProvider` provider chain overlaying live `config/*` and published CMS collections (`?preview=1` for drafts, gated by `firestore.rules`), and the runtime theming chain — `theme.css` RGB-triple custom properties overridden live by a `<style id="event-theme-runtime">` tag from `config/theme` (spec §2.4, §7.2–7.5, #11, #12, #13, #16).
- Pages, Schedule, Speakers, and Sponsors surfaces, plus a block-type renderer registry covering all eight CMS block types, config-driven event-timezone schedule times, sanitized rich text/URLs, and a Google-popup + emailed-code sign-in page.
- Three self-hosted open-license (SIL OFL 1.1) font sets under `apps/web/public/fonts/` and neutral placeholder branding assets under `apps/web/public/branding/` — no font CDN or product-identity leakage at runtime.
- `scripts/dev/login-smoke.mjs`: a Playwright-driven, credential-free live smoke test for the emailed-code sign-in flow against the Firebase emulators.
- `functions` emulator wired into `firebase.json` alongside `firestore`/`auth`/`storage` for the local dev loop.

The feature set itself is specified in [docs/adr/0001-event-platform-v1.md](docs/adr/0001-event-platform-v1.md). Remaining Phase 2 modules have not landed yet.
