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
- Attendee accounts and profiles: server-owned `users/{uid}` documents seeded at sign-in (`registrationStatus` from the four-value §3.4 vocabulary, `speakerId` replacing `isSpeaker`/`sessionIds`), a `users_public` projection trigger that publishes only public-safe fields and rewrites badges to the intersection with `config/badges`, and a self-update rule that denies every server-owned field (spec §3.4, §4.1, §4.5, #17).
- Directory privacy enforced in `firestore.rules`, not the UI: `attendees_only` profiles are readable only by a requester whose own account shows approved, speaker, or admin — previously any authenticated pending account could enumerate the directory — with emulator tests pinning each branch.
- Attendee-facing profile surfaces: first-sign-in profile setup, profile editing, the attendee directory, individual profile pages, and a profile sidebar, all behind `config/features.attendeeDirectory` / `publicAttendeeProfiles`.
- One canonical `speakers/{speakerId}` store replacing the name-joined tri-sync: admin `createSpeaker`/`updateSpeaker`/`deleteSpeaker` endpoints, a one-way `speakers_public` projection trigger, and referential integrity enforced at the three write seams — session saves reject a `speakerIds` entry naming a missing speaker, `deleteSpeaker` unlinks every session, draft, and account link in one transaction (refusing above the transaction limit and naming the `status: 'removed'` soft delete as the fallback), and the `users.speakerId` ↔ `speakers.uid` pair is set or cleared in a single commit. No reverse trigger, no `sessionInfo` map, no periodic reconciliation (spec §4.3, #20).
- Admin speakers list and create/edit/delete form; the public speaker directory and the generated content snapshot now render the `speakers_public` projection, so speaker email addresses and invite tokens cannot reach the browser bundle.
- Three self-hosted open-license (SIL OFL 1.1) font sets under `apps/web/public/fonts/` and neutral placeholder branding assets under `apps/web/public/branding/` — no font CDN or product-identity leakage at runtime.
- Media library and the hardened Storage rules (spec §8.5, §9, #24): `profile-photos/{uid}/**` is the only client-writable namespace — owner-bound, image-only, under 2 MiB — while `cms-images/`, `branding/`, and `speaker-photos/` accept writes only from admin-verified server endpoints, `session-materials/` stays closed on both verbs, and everything else is denied. `mediaUpload`, `mediaDelete`, `mediaUpdateMetadata`, and `scanMediaUsage` index every upload in `media_assets` and report which content documents reference an asset, so a delete warns instead of blanking a live page.
- Admin Media tab: a browsable library per namespace with upload, alt-text editing, and delete-with-usage-warning, plus a reusable `ImagePicker` that now backs the Branding tab's five logo slots (closing its upload TODO) and an owner-bound photo field on the attendee profile.
- `scripts/dev/login-smoke.mjs`: a Playwright-driven, credential-free live smoke test for the emailed-code sign-in flow against the Firebase emulators.
- `functions` emulator wired into `firebase.json` alongside `firestore`/`auth`/`storage` for the local dev loop.

The feature set itself is specified in [docs/adr/0001-event-platform-v1.md](docs/adr/0001-event-platform-v1.md). Remaining Phase 2 modules have not landed yet.
