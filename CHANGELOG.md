# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- The landing page and the documentation site now use the product's own design language: the same
  token names the app ships, the editorial type scale, rules and folios instead of cards, and a
  complete dark palette that follows the reader's system setting. The page content, links, and
  social-card metadata are unchanged (design brief §5.3).
- Admin documentation now uses the words staff see rather than the names the code uses: site style,
  header style, illustrations, page preview, and advanced color settings. The interface guidelines
  keep the internal names and mark them as internal.
- Updated canonical repository and GitHub Pages paths to `CenterCoopMedia/eventrunner` (#97).

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
- Ticketing provider core (spec §3.3–§3.4, #29): a provider registry dispatching on `EVENT_TICKETING_PROVIDER` with contract-checking of whatever adapter it constructs, a `none` provider, atomic webhook-dedup-and-enqueue (`ticketingWebhook` commits the delivery claim and the `ticket_sync_queue` row in one transaction) and a `processTicketSyncQueue` drain with a six-attempt bound and an operator alert on exhaustion, `ticketingVerifyOrder`/`createUserFromTicket` claim paths ending in a single-document transaction on `tickets/{externalId}`, deny-all `firestore.rules` on all three ticketing collections, and `recomputeEntitlement` — the first caller of the shared registration state machine's `isValidTransition`/`computeEntitlement` — wired as an `onTicketWritten` trigger so a refund or a new claim re-evaluates a user's whole claimed-ticket set (#32).
- Eventbrite ticketing adapter (`functions/src/ticketing/providers/eventbrite.cjs`, spec §3.3, §3.5, #30): HMAC-SHA256 webhook signature verification, `fetchOrder`/`listTickets`/`lookupByOrderNumber`, an idempotent `registerWebhook`, and `getRegistrationPrompt`; covered by a webhook→claim→entitlement end-to-end test running the real adapter against synthetic fixtures for the placed/refunded/wrong-event/unsigned cases.
- Manual/CSV ticketing adapter (`functions/src/ticketing/providers/manual.cjs`, spec §3.3, §3.5, #31) reading `tickets/{externalId}` directly, with `ticketingImportCsv` (admin-gated, dependency-free RFC 4180 parser, flexible column mapping, shared validate → normalize → dedupe → classify pipeline behind a dry-run preview) and `ticketingListTickets` admin endpoints, and an `/admin/ticketing` tab exposing provider status, the CSV import flow, and an exact-match ticket search.
- Admin registration approval (#32): `approveUser`/`revokeUser` endpoints for the two §3.4 edges no ticket can produce — admin approval pins `approvalSource: 'admin'` so it survives a later ticket refund, and revocation clears it — each checked against the shared transition table, audit-logged, and backed by an Attendees tab with per-row Approve/Revoke; `firestore.rules` pins `registrationStatus` and `approvalSource` as server-owned, denying even the account owner's own write.
- `scripts/register-ticketing-webhook.cjs` (#30): an operator command wrapping `TicketingProvider.registerWebhook()`, capability-gated so a provider without one (manual, none) exits 0 with an explanation instead of failing a checklist item; the admin ticketing-status card surfaces the resulting webhook registration state.
- Registration-prompt email flow (#33): `ticket.get_ticket`/`ticket.claim_prompt` templates (spec §6.2) driven by `TicketingProvider.getRegistrationPrompt()`'s cta_label/cta_url/provider_note, `sendRegistrationPrompt` sending them via an `onUserRegistrationPromptCreated` trigger on new-account creation across the eventbrite/manual/none matrix, and a self-service `/ticket/claim` page whose `ticketingVerifyOrder` call collapses every failure (unknown order, wrong event, address mismatch, already claimed) to the same generic 404. `init-event.cjs` seeds `email_templates` overrides for both client-visible templates (spec §5.1 step f).
- On-demand static-snapshot refresh after a CMS publish (spec §8.4 phase 5, §10 Q7, #36): a `site-publisher` Cloud Run job in the client's own project — `generate-content.cjs` → vite build → `firebase deploy --only hosting`, under the job's own service account with no GitHub coupling and no cross-project credential — provisioned by a `publisher` job in `deploy-client.yml` (per-client Artifact Registry, create-or-update of the job, and `run.invoker` on that one job for the functions runtime identity). `cmsPublish` invokes it fail-soft after the revision copy commits and tracks the outcome on the same `cmsPublishQueue` row; a `cleanupStrandedPublishRows` sweep times out rows neither party reported on. Off unless a client sets `EVENT_SITE_PUBLISHER_ENABLED`; setup, verification, rollback interaction, and cost are `docs/DEPLOY_RUNBOOK.md` §9.
- `docs/CLIENT_ONBOARDING.md`: the operator's start-to-finish checklist for standing up one client event, cross-linking `docs/DEPLOY_RUNBOOK.md` rather than repeating it (spec §5.6, #34).
- `docs/ADMIN_GUIDE.md`: staff-facing task reference for every admin surface, cross-linking the wiki handbook's narrative version (#34).
- `docs/DEPLOY_RUNBOOK.md`: a rollback section — hosting, functions, rules/indexes, content-snapshot implications, and when not to roll back (#34).
- Custom-domain naming in the operator-facing readiness output: `init-event.cjs`'s printed §5.6 Auth checklist and `scripts/lib/checklist.cjs` now name the client's custom domain when `EVENT_PUBLIC_URL` is configured, and `docs/DEPLOY_RUNBOOK.md` gets a short custom-domain/readiness note pointing at the fuller flow issue (#66 sliver).
- DCO enforcement: `CONTRIBUTING.md` documents `git commit -s` and what the sign-off attests; a credential-free `dco` CI job (`scripts/check-dco.cjs`) fails a pull request carrying an unsigned commit, fork PRs included (spec §1.5, #37).
- `RELEASING.md`: version scheme, CHANGELOG hygiene, and the tag-cutting process for this Keep a Changelog project (#37).
- Credential-free secret scanning: a `secrets` CI job runs the gitleaks CLI (checksum-verified download, no marketplace action, no license secret) over the pull request range and, on push to `main`, the full history; `.gitleaks.toml` allowlists two known-synthetic test fixture values by exact string match (#39 sliver).
- Playwright end-to-end suite on the Firebase emulators (#38): four critical journeys — OTP sign-in, CMS publish/isolation, the speaker invite pipeline, and ticket-claim-to-bookmark — seeded once per run via the same `init-event.cjs`/`seed-demo-event.cjs` operator scripts a real deployment uses, driven through `scripts/dev/run-e2e.sh` (`firebase emulators:exec` wrapping `vite`) and a new `e2e` CI job that clones the rules job's emulator/Java setup. OTP and invite-token capture reads a dedicated `E2E_MAIL_FILE` sink the console email provider appends to, replacing an unreliable scrape of colorized emulator stdout.
- `docs/POSTMARK_PROVISIONING.md`: an end-to-end Postmark account/server/stream provisioning runbook plus the missing `EMAIL_ACCOUNT_API_KEY` secret documentation in `.env.example` and the ADR/deploy-runbook secret tables (#4).

### Fixed

- Firebase deployment validation no longer requires `VITE_FIREBASE_MEASUREMENT_ID` when Google Analytics is disabled (#101).

The feature set itself is specified in [docs/adr/0001-event-platform-v1.md](docs/adr/0001-event-platform-v1.md). Ticketing (Eventbrite and manual/CSV adapters, registration approval, and the end-to-end test suite) has landed; release packaging and operator-documentation work is in progress.
