# Event platform v1 — feature triage decision record

**Date:** 2026-08-16
**Status:** Decided (Joe, via structured triage interview). Adopted in `jamditis/cjs2026#536`.
**Scope:** Extraction of the CJS2026 codebase into this repository: a white-label event CMS platform.

---

## Operating model (decided up front)

| Question | Decision |
|---|---|
| Distribution | **Deploy-per-client, operator-run.** Each client event gets its own Firebase project; Joe/CCM deploys and operates it. Clients never touch code. |
| Repo strategy | **New clean repo; extract into it.** CJS2026 stays untouched as the live production site and reference implementation. "Cut" below means *not ported*, never deleted from this repo. |
| Buyers | Nonprofit/journalism orgs, universities/institutions, agencies/event producers. All three buy on "my staff can run this without a developer" — the admin CMS is the product. |
| Timeline | Deliberate, 1–3 months to a sellable v1. Budget exists for the config layer and provider abstractions; no budget for speculative architecture. |
| Open source | **Yes — public repo, Apache-2.0.** Customers and contributors file issues, feature requests, and bug reports in the open. Clients realistically never self-host — they buy the platform *because* it's operated for them. Revenue is therefore the service layer, sold by CCM/Montclair in tiers: (1) fully managed deployments (deploy-per-client), (2) paid setup/onboarding engagements, (3) paid support/on-call retainers. The code is free under Apache-2.0; the **trademark is the exclusivity lever** (Apache-2.0 §6 excludes trademark rights — no one else can market hosting under the platform's name). Repo lives under a CCM-owned GitHub organization; the operator retains owner-level admin so releases and branch protection don't depend on third-party availability. **Pre-launch legal checklist:** settle copyright ownership (personal vs CCM vs Montclair State — university IP policy applies) before the LICENSE file exists, since the owner is the entity granting the license and holding the mark; trademark screen on the name. |
| Name | **Run of Show** (working name — `runofshow`). Generic industry term: low infringement risk, weak exclusivity, contested SEO; trademark screen and domain acquisition (`runofshow.org`/`.events`; `.com` likely unavailable) before public launch. |

---

## Ported — core platform

| Feature | Notes |
|---|---|
| Block-based CMS (cmsContent, editors, version history, publish flow) | The product core. Strip embedded chat-lifecycle hooks and Airtable sync from the CMS functions. `BLOCK_TYPES` is genuinely generic; `PAGE_CONFIGS` needs a schema layer so pages/fields aren't CJS vocabulary (see architecture work #2). |
| Schedule / sessions / bookmarks | Core. `SessionCard` is the convergence point — expect edits there for every feature that was cut. `syncBookmarkCountToAirtable` trigger dies with Airtable. **Direct Google Calendar sync is not ported**: `Schedule.jsx` requests the `calendar.events` OAuth scope and writes through the Calendar API, which required Google consent-screen verification for the CJS project — a per-client verification burden that doesn't scale under deploy-per-client. v1 ships ICS download + calendar-link URLs instead. |
| Speaker display + invite/accept/profile-wizard/approval pipeline | A genuine selling point — ports, but **only after the single-source-of-truth collapse** (architecture work #6). |
| Attendee directory, profiles, `users`/`users_public` projection | The PII-projection split is good design; keep it. |
| Sponsors / organizations | Core. |
| Auth: Google OAuth + **6-digit OTP codes** | OTP kept because it's the path that beats MS 365/EOP quarantining — and universities/nonprofits are exactly the MS-365-heavy buyer. **Magic links dropped** (the quarantine-prone path). Login = Google or emailed code. Two follow-ons the cut requires: (a) `SpeakerAccept.jsx`'s email sign-in path currently calls `sendCustomMagicLink` — speaker acceptance is rebuilt on the OTP flow; (b) the shared infrastructure OTP rides on (rate-limit bucket, the `magic_links` collection as the OTP challenge store, the expiry-cleanup job) is retained — the saving is the link-specific endpoints only, not the full ~500-line block. |
| Session materials | **Keep the feature, redesign the implementation**: single collection + public projection (per the #433 design), replacing the current 4-collection shape (raw + projection + URL vault + denormalized counts) and its reconciler cron. Embargo (post-session auto-release) stays. |
| Session emoji reactions | Kept — aggregate counts, no user-generated text, near-zero moderation surface. Split the backend block it shares with `bookmarkSession` before porting. |
| Media library — plumbing **and** browser tab | Upload/crop plumbing is load-bearing for CMS images and profile photos. The browsable `/admin/media` library ports too — "where did my logo go" is a real support-ticket generator for non-technical staff. Skip the one-off `backfillMediaAssets`. **Port includes mandatory Storage-rules hardening**: today `cms-images/**` is writable by any authenticated user and `profile-photos/{userId}/**` does not require `request.auth.uid == userId` — admin/owner checks are UI-layer only. The new rules (or server-authorized upload functions) enforce owner/admin authorization server-side. |
| Error telemetry (client capture, benign filter, `system_errors`, PII redaction, dashboard) | Ported as **operator advantage** — it's how the operator learns a client site is broken before the client does. The benign-filter tuning (SafeLinks noise, stale-bundle chunk errors) transfers to every deployment. Alert delivery reroutes through the notification abstraction (no hardcoded Pi calls). |
| Schedule PDF generation | Every organizer asks for this — but it is **not** yet generic: `buildSchedulePdf` (functions/index.js:13521) hardcodes the CJS2026 title, dates, venue text, colors, and a fixed two-bucket `day 1`/`day 2` structure. Port includes config-driven header/branding and arbitrary day grouping. |
| `updatesMeta` SSR (per-post OG tags) | Small, self-contained, marketing polish clients notice. |
| Live-updates dashboard card | Card + `live_updates` collection port; **fed by a simple admin form, not Slack** (see cuts). |
| Feedback inbox | Port the user-facing bug/feedback modal → Firestore queue → plain admin review tab. No Telegram, no auto-fix buttons (see cuts). |
| Badge system | Ports **with a scope correction**: the current mechanism is attendee-self-assigned — `useBadgeManager` lets users pick predefined badges *and create public free-text custom badges*; admins only render them. v1 keeps self-selection from the predefined per-event set (definitions move to config/seed) and **cuts free-text custom badges** — they're a user-generated-content moderation surface, the same class this plan already cut with social posts. Admin-assigned badges are a possible later addition, not a v1 requirement. |
| Ticketing | **Provider adapter interface.** Eventbrite is provider #1 (ported behind the seam); **manual/CSV import is provider #2**, which doubles as the no-ticketing fallback. This is the largest planned backend refactor (~15% of functions/index.js today) because ticket state currently *is* the account-approval gate. The provider's event ID becomes a single required adapter config value — today it's hardcoded twice under two different names (`EVENTBRITE_EVENT_ID` and `CJS2026_EVENT_ID`), and order verification rejects any other event. Webhook registration with the provider is an explicit provisioning step. |

## Not ported (cut from v1)

| Feature | Size left behind | Rationale |
|---|---|---|
| Video generator + Remotion pipeline | ~13,900 lines, 7 npm deps, entire TS toolchain | Zero inbound coupling; biggest cheap win. Includes repo-root orphans (`VideoGenerator.jsx`, playground HTML), `imageProxy`, video template functions. |
| Full email broadcast suite | ~5,200 lines | **Cut now, rebuild simple later.** v1 ships transactional email only. A provider-backed "send announcement to attendees" feature is v1.1 roadmap, built on the new email abstraction — not ported from the `EmailComposer` + queue/chunked-resume machinery. Note: the TipTap packages are **not** shed by this cut — `RichTextEditor.jsx` (used by the ported CMS editors) and `SpeakerEmailTemplateModal.jsx` (ported speaker pipeline) import them, so TipTap stays in the dependency tree. What this cut avoids is the bulk-sender reputation/volume burden, not sender-domain setup — see the provisioning note below. |
| Invoice generator | ~2,580 lines | CCM-specific sponsor-billing logic; direct-Firestore; zero coupling. Clients use real invoicing tools. |
| Airtable sync (all of it) | ~500 runtime lines, 548 refs, 6 scripts | Vestigial mirror; Firestore has been the source of truth since Jan 2026. De-secrets six unrelated functions. |
| Custom magic links | ~500 lines | The quarantine-prone email-auth path; OTP supersedes it. |
| Social posts / feeds / notifications inbox / moderation | ~1,530 lines minus reactions | Never fully launched for CJS2026. Removes an entire moderation/liability surface buyers would have to staff. `onPostCreated` is the only writer of `notifications` — the notifications concept goes with it. |
| Speaker–organizer chat / session Q&A | ~650 lines + lifecycle hooks | Email suffices; cutting it also cleans the chat-thread lifecycle hooks out of the core CMS create/update/delete functions being ported anyway. |
| Slack live-updates ingestion | ~830 lines, 4 secrets | Kills a per-client Slack-app provisioning step. The dashboard card survives, admin-form-fed. |
| Telegram triage / jawn-ops auto-fix pipeline | — | **Stays private operator tooling**, pointed at client deployments from outside the product. Never a product dependency. `telegramMessageId` fields do not enter the new data model. |
| `Local.jsx` city guide, `CampusMap.jsx` | ~1,900 lines | Hand-coded Philadelphia content. Venue/city content becomes CMS-seeded per event. **`Travel.jsx` (548 lines) is triaged separately and ports**: the travel/venue page is one of the seeded default pages, but it goes fully CMS-driven — its hardcoded fallback content (Temple, Philadelphia hotels, SEPTA/airport directions, parking) is stripped, replaced by a complete per-event travel schema with synthetic placeholder seed content, so an incomplete seed can never surface another event's directions. |
| One-off scripts, print/PPTX pipeline, legacy docs | ~125 of 135 scripts | Only the ~10 reusable ops tools port (`generate-from-firestore`, `firebase-init` helper, admin-grant, favicon gen, etc.). |

**Rough total not ported: ~28,000+ lines and roughly a dozen npm dependencies** (the Remotion/video set and gif.js; TipTap stays — see broadcast row). Required secrets drop from 13 (7 vendors) to roughly 3–4 per deployment: Firebase service account, email-provider key, Eventbrite token + webhook key *only when that provider is enabled*. The broadcast-unsubscribe HMAC is **not** carried into v1 — it serves only the cut broadcast machinery and returns with the v1.1 announcements feature.

**Per-client provisioning still includes sender-domain verification.** Cutting broadcasts does not remove email deliverability work from onboarding: OTP sign-in codes and all transactional mail send from the client's own sender address, so each new client domain must be verified and authenticated (SPF, DKIM, and a DMARC policy) with the email provider before launch — otherwise emailed-code login gets quarantined. This is a required item on the client onboarding checklist (architecture work #3 and the phase-5 runbook).

---

## Mandatory architecture work (the v1 backbone)

Ordered roughly by dependency, not priority — all are required.

1. **Event config layer.** Identity, dates, venue, timezone, domains, sender address/name, legal/postal footer, admin bootstrap emails (currently duplicated in 4 files), social handles, hashtag. One typed config module + Firestore `config` doc; nothing event-specific hardcoded in components or functions. The audits found ~1,300 domain/project-ID string sites and 96/177 src files carrying CJS tokens — this layer is what makes that number reach zero in the new repo.
2. **Fresh-event bootstrap.** The single most product-defining gap: today an empty Firestore → blank site, and all 23 seed scripts seed CJS copy. Build a generic CMS seed schema + `init-event` script (creates cmsContent skeleton, default pages, placeholder branding, first admin). Includes making `PAGE_CONFIGS` schema-driven so new pages don't require code edits. Two additions the seed must cover: (a) **per-client legal pages** — today's `PrivacyPolicy.jsx` and `TermsOfService.jsx` hardcode CCM/Montclair as operator, describe magic-link auth, and name Eventbrite regardless of the configured provider; the seed ships provider-aware privacy/terms templates flagged for the client's legal review, never another organization's terms. (b) **Manual Firebase Auth provisioning steps** the deploy cannot automate — enabling the Google sign-in provider and registering the client's custom domain as an authorized domain — belong on the init checklist, not the phase-5 runbook.
3. **Email provider abstraction.** `sendEmailViaNotify()` is already a clean seam (17 call sites). Define a provider interface; adapters: Pi notify-service (operator's), Postmark or SES (client-facing default). All transactional mail flows through it.
4. **Notification/alert abstraction.** The `/alert`, `/cjs-error`, Telegram paths that bypass the email seam get one operator-notification interface (webhook/email sinks). Product code never calls `notify.amditis.tech` or Telegram directly.
5. **Tokenized transactional email templates.** The 8 hardcoded builders (welcome, get-ticket, OTP, speaker invite/acceptance/confirmation, bug-report, unmatched-ticket) become token-substituted templates — the get-ticket email is currently a 2,000-char literal containing SEPTA directions and Philadelphia hotel names.
6. **Speaker single source of truth.** Collapse `users` / `cmsSpeakers` / `cmsSchedule.speakers` tri-sync into one canonical store + derived views. Deletes ~2,000 backend lines, 2 drift-detector crons, and 8 reconciliation scripts with no user-visible loss.
7. **Ticketing provider interface.** Registration state machine decoupled from Eventbrite; Eventbrite + manual/CSV adapters (see Ported table).
8. **Deploy pipeline per client.** Parameterize the workflows (project ID via repo vars, no hardcoded probe URLs), make CI actually run the test suites (none run today), deploy `firestore.indexes.json` + `storage.rules` (today undocumented manual steps), and redesign the CMS-publish flow (currently a `repository_dispatch` into `jamditis/cjs2026` via personal PAT) for per-client repos or direct deploys.
9. **Backend modularization.** `functions/index.js` is 19,396 lines with 4% extracted. Porting = extracting: each feature moves into a domain module in the new repo; no monolith reconstitution. The 16,805-line test mirror ports section-by-section alongside (~1:1 test-edit budget per backend line), and CJS-specific string assertions get genericized against the config layer.
10. **Public-repo hygiene.** The new repo is public from day one, which raises the sanitation bar beyond "clean history": no PII, client data, real attendee fixtures, personal email addresses, or personal-infrastructure references (Pi hostnames, Telegram chat IDs, `amditis.tech`, `houseofjawn`) anywhere — including tests, fixtures, comments, and docs. Operator-specific adapters (the Pi notify relay) live outside the public repo, expressed generically (a "custom webhook" email/notifier adapter type that the operator configures privately). CI and the full test suite must run credential-free (Firebase emulators, no live-project secrets) so external contributors can run checks on forks. LICENSE (Apache-2.0) and SECURITY.md must exist from the repo's **first public commit** — source published without a license grants no Apache permissions and is merely source-visible, so the copyright-ownership question gates repo creation itself, not phase 5. The rest of the community scaffolding (CONTRIBUTING.md, issue/PR templates, code of conduct, public demo instance with synthetic data) ships by phase 5.

## Explicitly deferred (v1.1+ roadmap)

- Simple announcements email (on the provider abstraction)
- Additional ticketing adapters beyond Eventbrite + CSV
- Full social layer, speaker chat — only if a client pays for them
- Multi-tenant single-deployment architecture (deploy-per-client is the model until scale demands otherwise)

---

## Phase plan (proposed)

1. **Architecture spec** — new repo layout, config schema, provider interfaces, seed schema, module map. Written before any porting begins.
2. **Scaffold + core port** — new repo, config layer, CMS + schedule + auth (Google/OTP) + attendee profiles, bootstrap script, **tokenized auth/transactional email templates** (the OTP and welcome builders currently hardcode CJS branding, dates, and URLs — the phase-2 milestone requires event-neutral sign-in mail, so template tokenization cannot wait for phase 4), and a **working email provider adapter** — the interface alone (phase 1) sends nothing; the Postmark/SES adapter, its per-client credentials, and sender-domain verification are phase-2 deliverables because OTP login depends on them. Milestone: *a fresh Firebase project boots to a working generic event site, including event-neutral emailed-code login through the configured provider.*
3. **Feature port wave** — speakers (post-SoT-collapse), materials (redesigned), media library, reactions, badges, telemetry, PDF (with the config-driven header/day-grouping rework), updatesMeta, live-updates card, feedback inbox. Each feature's transactional emails tokenize **with the feature**: the speaker invite/acceptance/confirmation templates (which hardcode event name, dates, Philadelphia details, sender, and URLs today) land here with the speaker port — a non-CJS deployment must be able to exercise the phase-3 invite pipeline without sending wrong-event mail.
4. **Ticketing adapter** — last because everything else stabilizes the ground it stands on. Its registration emails are **provider-owned, not just tokenized**: today `notifyNewUserSignup` sends every unmatched non-speaker a get-ticket email whose call-to-action is "buy on Eventbrite" — impossible under the manual/CSV provider. The adapter supplies (or suppresses) the registration CTA and URL per provider.
5. **Packaging** — deploy runbook, per-client provisioning checklist, admin user guide, demo instance.

This document is the triage contract the implementation phases build against.
