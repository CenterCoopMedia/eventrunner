# Run of Show — v1 architecture specification

**Date:** 2026-08-16
**Status:** Adopted. Merged as `jamditis/cjs2026#536` and copied here as the platform ADR.
**Builds against:** `docs/plans/2026-08-16-event-platform-v1-triage.md`
**Reference implementation:** `jamditis/cjs2026` (live Collaborative Journalism Summit site). This repository is the extract.

This spec turns the triage decision record into an implementable architecture. Every decision
in the record is treated as settled. Where this document names current behavior, it was read
out of the code at the commit above, not out of the repository's prose documentation (which is
dated in places — see §11).

Terminology: **operator** = the party running deployments (CCM). **client** = the organization
whose event is deployed. **deployment** = one Firebase project serving one client event.

---

## 1. Repo layout

### 1.1 Workspaces vs flat

**Decision: npm workspaces, three workspaces.** The current repo is already two package graphs
(`package.json` + `functions/package.json`, two lockfiles, two Vitest configs) glued together by
convention. Workspaces make that explicit and, more importantly, let one module be imported by
both the browser bundle and the Cloud Functions runtime without copy-paste. Today that copy-paste
is real and load-bearing: `functions/helpers.js` carries `parseSessionDatetime` / `nowInET` /
`isSessionPast` as an explicitly documented duplicate of `src/utils/calendarUtils.js`, and
`ADMIN_EMAILS` is copied into four files. A shared workspace kills both classes.

The cost is the ESM/CJS boundary: `apps/web` is ESM (Vite), `functions` is CommonJS
(`firebase-functions` v2 on Node 22). The shared package is therefore authored in CommonJS with a
hand-written ESM shim and a conditional `exports` map:

```jsonc
// packages/shared/package.json
{
  "name": "shared",
  "private": true,
  "type": "commonjs",
  "exports": {
    ".":            { "require": "./src/index.cjs", "import": "./src/index.mjs" },
    "./config":     { "require": "./src/config/index.cjs", "import": "./src/config/index.mjs" },
    "./time":       { "require": "./src/time.cjs", "import": "./src/time.mjs" }
  }
}
```

Each `.mjs` is a two-line named re-export of its `.cjs` sibling. No transpile, no bundler plugin, no
TypeScript toolchain.

**Firebase will not upload a workspace sibling, and this is the part that breaks if it is left
implicit.** A functions deploy uploads only the configured `functions.source` directory. A root-level
`node_modules/shared` symlink into `packages/shared` is not inside that directory, does not survive
the upload, and is not resolvable by the remote `npm install` — the deploy succeeds and the functions
crash at cold start with `Cannot find module 'shared'`. A monorepo-aware bundler would solve it; the
no-transpile constraint says otherwise.

**Resolution: a `prepare-functions` pack step, run by `firebase.json`'s predeploy hook.**

```jsonc
// firebase.json
"functions": {
  "source": "functions",
  "codebase": "default",
  "predeploy": ["npm --prefix \"$PROJECT_DIR\" run prepare:functions"],
  "ignore": ["node_modules", ".git", "vendor/*.tgz.tmp", "**/*.test.cjs"]
}
```

```jsonc
// functions/package.json
"dependencies": {
  "shared": "file:./vendor/shared.tgz",
  "firebase-admin": "...", "firebase-functions": "..."
}
```

`npm run prepare:functions` is three commands: `npm pack packages/shared`, move the tarball to
`functions/vendor/shared.tgz`, `npm install --prefix functions --package-lock-only`. The tarball is
gitignored and regenerated deterministically; `functions/package-lock.json` pins its integrity hash,
so a stale tarball is a lockfile mismatch rather than a silent version skew. Because it is a
`predeploy` hook, `firebase deploy` from an operator's laptop gets the same treatment as CI — the
failure mode this closes is precisely the one where CI is correct and a local deploy is not.

CI wiring: the `shared` job in `deploy-client.yml` (§8.1) runs `prepare:functions` before the
`functions` job, and `packages/shared/**` is in that job's paths filter so a shared-code change
actually triggers a functions deploy. Local development is unaffected — the emulator resolves the
workspace symlink normally, and `npm run dev:emulators` runs `prepare:functions` first so what runs
locally is what deploys.

Two alternatives considered and rejected: physically relocating `packages/shared` under `functions/`
and having Vite import upward (works, but inverts the dependency — the web app then depends on the
backend directory, and `apps/web` cannot be built or published without `functions/` present); and an
isolate/bundle step (`esbuild --bundle` into `functions/`), which is the transpile step the
constraint rules out.

### 1.2 Directory structure

```
run-of-show/
├── LICENSE                          # Apache-2.0 — DAY ONE, first public commit (§1.5)
├── NOTICE                           # Apache-2.0 §4(d) attribution — day one
├── SECURITY.md                      # disclosure policy — DAY ONE, first public commit (§1.5)
├── README.md                        # what it is, how to deploy one, screenshots of the demo
├── CONTRIBUTING.md                  # dev setup on emulators, test commands, PR expectations
├── CODE_OF_CONDUCT.md               # Contributor Covenant 2.1
├── CHANGELOG.md                     # Keep-a-Changelog, tagged releases
├── package.json                     # workspaces: apps/web, functions, packages/shared
├── package-lock.json                # single lockfile at root
├── firebase.json                    # hosting/functions/firestore/storage/emulators
├── firestore.rules
├── firestore.indexes.json
├── storage.rules
├── .env.example                     # deploy-time env vars, documented (§2.1)
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                   # credential-free: lint + unit + rules tests on emulators
│   │   ├── deploy.yml               # per-client, environment-scoped, secrets required
│   │   └── preview.yml              # PR preview channel; skips cleanly on forks
│   ├── ISSUE_TEMPLATE/{bug_report.yml,feature_request.yml,config.yml}
│   └── pull_request_template.md
├── apps/
│   └── web/
│       ├── index.html
│       ├── vite.config.js
│       ├── tailwind.config.js
│       ├── src/
│       │   ├── main.jsx             # router + provider nesting
│       │   ├── firebase.js
│       │   ├── config/              # client-side event config accessors (§2.4)
│       │   ├── generated/           # build output of generate-content (committed demo copy)
│       │   │   ├── siteContent.js
│       │   │   ├── scheduleData.js
│       │   │   ├── organizationsData.js
│       │   │   ├── eventConfig.js
│       │   │   └── theme.css
│       │   ├── contexts/            # Auth, UserProfile, SessionBookmark, Content, Toast, EventConfig
│       │   ├── pages/               # 24 pages (§9)
│       │   ├── components/
│       │   │   ├── admin/
│       │   │   ├── speaker/
│       │   │   └── cms/             # CMSManager, EditorLayoutRenderer, block editors
│       │   ├── hooks/
│       │   ├── services/
│       │   └── utils/
│       └── public/
│           ├── fonts/               # self-hosted woff2 for the bundled font sets (§7.4)
│           └── branding/            # neutral placeholder logo/OG assets used before seeding
├── functions/
│   ├── package.json                 # depends on shared via file:./vendor/shared.tgz (§1.1)
│   ├── package-lock.json            # pins the packed shared tarball's integrity hash
│   ├── vendor/                      # gitignored; shared.tgz written by prepare:functions
│   ├── index.js                     # export barrel ONLY — no logic, no handler bodies
│   └── src/                         # domain modules (§1.3)
├── packages/
│   └── shared/
│       └── src/
│           ├── config/              # config schema, defaults, validation, lifecycle clock
│           ├── time.cjs             # event-timezone wall-clock helpers (§9, replaces the dupe)
│           ├── registration.cjs     # registration state machine + access predicates
│           ├── badges.cjs           # badge-set validation against per-event config
│           ├── slug.cjs
│           └── urlSafety.cjs
├── scripts/
│   ├── lib/firebase-init.cjs        # credential resolution (project-neutral, §9)
│   ├── init-event.cjs               # bootstrap a fresh deployment (§5)
│   ├── generate-content.cjs         # Firestore -> apps/web/src/generated/*
│   ├── grant-admin.cjs
│   ├── seed-demo-event.cjs          # synthetic demo data for the public demo instance
│   ├── verify-sender-domain.cjs     # queries the email provider for SPF/DKIM status
│   ├── register-ticketing-webhook.cjs
│   ├── export-attendees.cjs
│   ├── generate-favicons.cjs
│   └── check-console-errors.mjs
├── tests/
│   ├── firestore.rules.test.js
│   ├── storage.rules.test.js
│   └── e2e/                         # Playwright, runs against emulators in CI
└── docs/
    ├── ARCHITECTURE.md
    ├── DEPLOY_RUNBOOK.md
    ├── CLIENT_ONBOARDING.md         # the provisioning checklist (§5.6)
    ├── ADMIN_GUIDE.md
    └── adr/                         # architecture decision records, starting with this spec
```

**Naming and the trademark screen.** The name "Run of Show" appears in `README.md`, `LICENSE`
header prose, `CODE_OF_CONDUCT.md`, and the GitHub repo name — nowhere else. Workspace package
names are unscoped and generic (`web`, `functions`, `shared`). Firestore config keys use `event.*`
and `config/*`. Env vars are prefixed `EVENT_` / `VITE_EVENT_`. A rename after a trademark screen
is then a repo rename plus four prose files.

### 1.3 Backend module map

`functions/index.js` becomes an export barrel. Nothing else. Handler bodies live in
`functions/src/<domain>/`, each module exporting `{ handlers, internals }` where `internals`
carries the pure functions the test file drives directly (the `_*Internals` pattern already in
use here, formalized).

| Module | Files | v1 exports | Notes |
|---|---|---|---|
| `core/` | `firestore.cjs`, `http.cjs`, `auth.cjs`, `errors.cjs`, `config.cjs` | — | CORS + `verifyAuthToken` + `requireAdmin` + config loader/cache. No handlers. |
| `auth/` | `otp.cjs`, `challenges.cjs` | `sendOtpCode`, `verifyOtpCode`, `cleanupExpiredAuthChallenges` | OTP only. Rate-limit bucket and challenge store retained (§9). |
| `cms/` | `content.cjs`, `pages.cjs`, `versions.cjs`, `publish.cjs`, `updates.cjs` | `cmsCreateContent`, `cmsUpdateContent`, `cmsDeleteContent`, `cmsGetVersionHistory`, `cmsSavePage`, `cmsDeletePage`, `cmsPublish`, `cmsGetPublishQueue`, `cmsUpdatePublishStatus`, `cmsSaveUpdate`, `cmsDeleteUpdate`, `getSiteContent` | Chat-lifecycle hooks and Airtable sync stripped. `cmsSavePage`/`cmsDeletePage` are new — pages become data (§5.2). |
| `media/` | `upload.cjs`, `metadata.cjs`, `usage.cjs` | `mediaUpload`, `mediaDelete`, `mediaUpdateMetadata`, `scanMediaUsage` | Server-authorized uploads (§8.5). `backfillMediaAssets` not ported. |
| `schedule/` | `sessions.cjs`, `bookmarks.cjs`, `reactions.cjs`, `pdf.cjs` | `bookmarkSession`, `reactToSession`, `submitSessionChangeRequest`, `generateSchedulePdf` | `bookmarkSession`/`reactToSession` split out of the shared block they occupy today. |
| `speakers/` | `invites.cjs`, `profile.cjs`, `approval.cjs`, `projection.cjs` | `sendSpeakerInvite`, `validateSpeakerInvite`, `acceptSpeakerInvite`, `resendSpeakerInvite`, `cancelSpeakerInvite`, `getSpeakerInvites`, `updateSpeakerProfile`, `approveSpeaker`, `saveSpeakerEmailTemplate`, `getSpeakerEmailTemplate`, `onSpeakerWritten` | Post single-source-of-truth collapse (§4.3). |
| `materials/` | `store.cjs`, `review.cjs`, `access.cjs`, `projection.cjs` | `uploadSessionMaterial`, `addSessionMaterialLink`, `updateSessionMaterial`, `deleteSessionMaterial`, `setMaterialReviewStatus`, `getSessionMaterialUrl`, `syncSessionMaterialPublic` | Two collections, not four (§4.4). |
| `ticketing/` | `index.cjs` (registry), `registration.cjs`, `webhook.cjs`, `providers/eventbrite.cjs`, `providers/manual.cjs` | `ticketingWebhook`, `ticketingSync`, `ticketingVerifyOrder`, `ticketingImportCsv`, `processTicketSyncQueue`, `createUserFromTicket`, `getTicketingStatus` | Webhook dedup centralized here (§3.3). |
| `email/` | `send.cjs`, `templates.cjs`, `render.cjs`, `providers/{postmark,webhook,console}.cjs` | `emailDeliveryWebhook` | One send path. No queues (§3.1). |
| `notify/` | `operator.cjs`, `sinks/{webhook,email}.cjs` | — | Called by other modules; no HTTP exports. |
| `telemetry/` | `clientErrors.cjs`, `systemErrors.cjs`, `benignFilter.cjs` | `logClientError`, `resolveSystemErrors`, `onSystemErrorCreated` | Alert delivery via `notify/` only. |
| `users/` | `lifecycle.cjs`, `projection.cjs` | `onUserCreated`, `syncUserPublic`, `maintainProfileComplete` | |
| `admin/` | `roles.cjs`, `config.cjs`, `stats.cjs`, `feedback.cjs`, `liveUpdates.cjs`, `exports.cjs` | `grantAdminRole`, `revokeAdminRole`, `getAdminUsers`, `updateEventConfig`, `updateFeatures`, `updateTheme`, `updateBadges`, `getSystemStats`, `exportAttendees`, `saveEditRequest`, `getEditRequests`, `submitFeedback`, `getFeedback`, `saveLiveUpdate`, `deleteLiveUpdate` | `admin/config.cjs` is the **only** writer of `config/*` — see below |
| `public/` | `signup.cjs`, `health.cjs`, `og.cjs` | `saveEmailSignup`, `health`, `updatesMeta` | |
| `maintenance/` | `cleanup.cjs` | `cleanupStaleData` | Biweekly. Sweeps expired auth challenges, rate-limit docs, resolved telemetry, terminal publish-queue rows. |

Roughly **60 deployable exports**, down from 106. No module exceeds ~800 lines; any file that
grows past that splits before merge (enforced by review, not tooling).

**Config writes need handlers, or the admin panel cannot function.** `config/*` is
`allow write: if false` for clients (§2.2), and the Branding tab (§7.3), the Settings tab, the
badge editor, and the feature toggles all edit it. Without server endpoints those tabs are
read-only. `admin/config.cjs` supplies four validated writers — or one `updateConfig` with a
document allowlist, which is the same thing with a wider signature — and each:

1. Requires admin, via `requireAdmin(req)`.
2. Rejects any document id outside `{event, features, theme, badges}`. `config/bootstrap` and
   `config/providers` are **not** writable from the panel: bootstrap is the admin-list seed, and
   providers mirrors Tier A.
3. **Rejects writes to deploy-mirrored read-only fields** with a specific error naming the field —
   `providers.*`, anything sourced from Tier A env (project id, region, public URL, provider
   selection, `externalEventId`), and `sender.domainVerified` / `domainVerifiedAt`, which only
   `verify-sender-domain.cjs` may set. An admin who could edit `domainVerified` could mark an
   unauthenticated sender domain verified and silently break OTP delivery for the whole event.
4. Validates shape against the schema in `packages/shared/src/config/` — timezone is a real IANA
   zone, `days[]` ids are unique and dates parse, theme colors are hex, badge ids are unique — and
   writes a `cmsVersionHistory`-style audit row plus an `admin_logs` entry.

The test mirror ports the same way: `functions/src/<domain>/<file>.test.cjs` next to each module.
The current 16,805-line `functions/index.test.js` is split section-by-section as each module lands,
and CJS-specific string assertions are rewritten against a fixture config object rather than
literal strings ("CJS2026 full schedule", "May 14-15, 2026", `summit.collaborativejournalism.org`).

### 1.4 Scripts that port

Ten of 135. Every one routes credentials through `scripts/lib/firebase-init.cjs`, which loses its
hardcoded `projectId: 'cjs2026'` and `STORAGE_BUCKET = 'cjs2026.firebasestorage.app'` in favor of
`EVENT_FIREBASE_PROJECT_ID` / `EVENT_STORAGE_BUCKET` env reads with a `firebase.json`-adjacent
`.firebaserc` fallback.

| Script | From | Change |
|---|---|---|
| `lib/firebase-init.cjs` | same | project/bucket from env, not constants |
| `generate-content.cjs` | `generate-from-firestore.cjs` | adds `config/*` → `eventConfig.js` + `theme.css`; drops the inline `initFirebase()` duplicate in favor of `lib/firebase-init.cjs` |
| `grant-admin.cjs` | `grant-admin-access.cjs` | email arg instead of hardcoded list |
| `generate-favicons.cjs` | `generate-favicon-ico.cjs` | reads branding slot from config |
| `export-attendees.cjs` | `exportAttendees` CF + ad-hoc scripts | operator-side CSV/JSON dump |
| `check-console-errors.mjs` | same | base URL from env |
| `init-event.cjs` | new | §5 |
| `seed-demo-event.cjs` | new | synthetic data only |
| `verify-sender-domain.cjs` | new | wraps `EmailProvider.verifySenderDomain()` |
| `register-ticketing-webhook.cjs` | new | wraps `TicketingProvider.registerWebhook()` |

The 23 CJS-copy seed scripts, 6 Airtable scripts, 8 speaker reconciliation scripts, all backfills,
and the print/PPTX pipeline do not port.

### 1.5 Community scaffolding

Two of these files exist in the **first public commit**; the rest may follow by phase 5.

**Day one — blocking on repo creation:**

- **LICENSE** — Apache-2.0 verbatim. Source published without a license file grants no Apache
  permissions; it is merely source-visible, and anyone who forks it in that window has no license
  grant to rely on. The copyright line names the entity granting the license, so the ownership
  question in the decision record's pre-launch legal checklist **gates creating the repository**,
  not phase 5. Scaffold private until it resolves.
- **SECURITY.md** — private disclosure to a dedicated address (not a personal mailbox), 3-business-day
  acknowledgement, 90-day coordinated disclosure default, explicit scope statement that operator-run
  client deployments are out of scope for public reports and must be routed to the operator. No
  bounty. Names the supported version line (latest tagged release only). Day one because a public
  repo with no disclosure route gets its first vulnerability report in a GitHub issue.
- **NOTICE** — attribution file required by §4(d) for downstream redistribution. Day one alongside
  LICENSE, since it is part of the license grant's mechanics.

**By phase 5:**

- **README.md** — a placeholder ships day one; the real one (deploy instructions, demo link,
  screenshots) lands with packaging.
- **CONTRIBUTING.md** — emulator-first dev loop (`npm run dev:emulators`), the three test commands,
  the rule that no PR may add a hardcoded event string or hex literal, DCO sign-off, and the
  statement that `ticket_sync_queue` is the only queue in the system (see §10, question 9).
- **CODE_OF_CONDUCT.md** — Contributor Covenant 2.1, enforcement address matching SECURITY.md's
  domain.
- **Issue templates** — bug report (deployment version, browser, whether operator-run or fork),
  feature request, and a `config.yml` that routes support questions for operator-run deployments to
  a support address instead of the issue tracker.
- **Public demo instance** — synthetic event seeded by `scripts/seed-demo-event.cjs` (§5.4).

---

## 2. Event configuration layer

Two tiers. Tier A is what a deployment needs before Firestore exists. Tier B is everything a client
admin can change afterward without a developer.

### 2.1 Tier A — deploy-time config (environment variables)

No per-client file is committed to the public repo. Deploy-time values live as GitHub **Environment**
variables and secrets, one environment per client deployment. `.env.example` documents the full set;
`packages/shared/src/config/deploy.cjs` validates it and fails the build loudly on a missing key
(the current build already does a one-off version of this for `VITE_FIREBASE_MEASUREMENT_ID`).

| Variable | Kind | Consumer | Notes |
|---|---|---|---|
| `EVENT_SLUG` | var | build, functions | lowercase identifier, e.g. `cjs2027`. Used in log lines and Storage prefixes. |
| `EVENT_FIREBASE_PROJECT_ID` | var | build, scripts, deploy | |
| `EVENT_FIREBASE_REGION` | var | functions | default `us-central1` |
| `EVENT_HOSTING_SITE` | var | deploy | Firebase Hosting site ID |
| `EVENT_PUBLIC_URL` | var | build, functions | canonical origin, e.g. `https://summit.example.org`. Replaces the `SITE_URL` constant at `functions/index.js:13`. |
| `EVENT_STORAGE_BUCKET` | var | build, functions, scripts | |
| `EVENT_ALLOWED_ORIGINS` | var | functions | comma-separated; replaces the hardcoded `ALLOWED_ORIGINS` array at `functions/index.js:38` |
| `EVENT_EMAIL_PROVIDER` | var | functions | `postmark` \| `webhook` \| `console` |
| `EVENT_TICKETING_PROVIDER` | var | functions | `eventbrite` \| `manual` \| `none` |
| `EVENT_TICKETING_EVENT_ID` | var | functions | the single value that today is hardcoded twice, as `EVENTBRITE_EVENT_ID` (`functions/index.js:126`) and `CJS2026_EVENT_ID` (`functions/index.js:4353`) |
| `EVENT_OPERATOR_NOTIFIER` | var | functions | `webhook` \| `email` \| `none` |
| `VITE_FIREBASE_*` (7) | var | build | unchanged set from `apps/web/src/firebase.js` |
| `VITE_EVENT_PUBLIC_URL` | var | build | mirrors `EVENT_PUBLIC_URL` into the bundle |
| `FIREBASE_SERVICE_ACCOUNT` | secret | deploy, generate-content | |
| `EMAIL_PROVIDER_API_KEY` | secret | functions | Secret Manager via `defineSecret` |
| `EMAIL_WEBHOOK_BASIC_AUTH` | secret | functions | `user:pass` for the delivery-event endpoint; only when provider is `postmark` **and** delivery ingest is enabled (§3.1) |
| `EMAIL_WEBHOOK_URL` / `EMAIL_WEBHOOK_SECRET` | secret | functions | only when provider is `webhook` |
| `TICKETING_API_TOKEN` | secret | functions | only when ticketing provider is not `none` |
| `TICKETING_WEBHOOK_SECRET` | secret | functions | only when the provider implements `registerWebhook` (§3.3) — `eventbrite` today, never `manual` |
| `OPERATOR_WEBHOOK_URL` / `OPERATOR_WEBHOOK_SECRET` | secret | functions | only when notifier is `webhook` |

Secret surface at maximum: **7 secrets**. A deployment with `manual` ticketing and `console`/`webhook`
email runs on 2–3. Not present anywhere: broadcast unsubscribe HMAC, Airtable key, Slack's four,
Telegram's two, GitHub PAT, deploy secret.

### 2.2 Tier B — runtime event config (Firestore)

Five documents under `config/`. All are readable by anyone (they drive the public site) except
`config/bootstrap`, which is server-only. All are `allow write: if false` for clients; the only
writers are the validated admin endpoints in `admin/config.cjs` (§1.3) and the init/verification
scripts.

```ts
// config/event
{
  name: string,                    // "2027 Collaborative Journalism Summit"
  shortName: string,               // "CJS2027" — used in email subjects, PDF header
  tagline: string,
  timezone: string,                // IANA, e.g. "America/New_York" — replaces every hardcoded
                                   // "America/New_York" in functions and calendar utils
  days: Array<{                    // ordered; arbitrary length replaces the day1/day2 pair
    id: string,                    // "day-1" — stable key used by cmsSchedule.dayId
    label: string,                 // "Thursday, May 14"
    date: string,                  // "2027-05-13" (ISO date, event-local)
    startTime: string,             // "09:00"
    endTime: string                // "17:00"
  }>,
  registration: {
    opensAt: string | null,        // ISO datetime, event-local
    closesAt: string | null,
    externalUrl: string | null     // ticket purchase URL surfaced in CTAs
  },
  venue: {
    name: string, addressLine1: string, addressLine2: string | null,
    city: string, region: string, postalCode: string, country: string,
    mapUrl: string | null
  },
  sender: {                        // outbound identity
    email: string,                 // "summit@example.org"
    name: string,                  // "Example Summit"
    replyTo: string | null,
    domainVerified: boolean,       // written by verify-sender-domain.cjs / provider check
    domainVerifiedAt: string | null
  },
  legal: {
    operatorName: string,          // organization operating the event
    postalAddressHtml: string,     // CAN-SPAM footer block; replaces CCM_POSTAL_ADDRESS_HTML
    supportEmail: string,
    conductEmail: string,
    reviewRequired: boolean        // true until the client clears seeded legal templates (§5.5)
  },
  social: {
    hashtag: string | null,
    handles: Array<{ platform: string, handle: string, url: string }>
  },
  announcedAt: string | null,      // ISO datetime. Null = the event is not announced (phase 'draft').
                                   // Set by an admin when the site goes public. Dates alone cannot
                                   // express this: a fully configured days[] is equally consistent
                                   // with "seeded yesterday, nobody has seen it" and "announced
                                   // last month". See §2.5.
  archivedAt: string | null,       // ISO datetime. The one manual lifecycle flag: set by an admin
                                   // from Settings when the client is done with the site. Every
                                   // other phase boundary in getEventPhase() (§2.5) is derived from
                                   // days[] and registration; `archived` is an editorial decision,
                                   // so it cannot be a clock reading. Null on a fresh deployment.
  seo: {
    description: string,
    defaultOgImagePath: string,    // Storage path in the branding/ slot set
    organizerName: string,
    organizerUrl: string | null
  },
  updatedAt: Timestamp, updatedBy: string
}
```

```ts
// config/features        — booleans only; every one defaults false except the first four
{
  schedule: true, speakers: true, sponsors: true, attendeeDirectory: true,
  sessionBookmarks: boolean, sessionReactions: boolean, sessionMaterials: boolean,
  badges: boolean, liveUpdates: boolean, feedbackInbox: boolean,
  schedulePdf: boolean, icsExport: boolean, updates: boolean,
  autoApproveTicketHolders: boolean,   // ticketed -> approved without admin action
  publicAttendeeProfiles: boolean
}

// config/theme           — §7
// config/badges          — { categories: [ { id, label, maxPicks, badges: [ {id, label, emoji, description} ] } ] }
// config/providers       — non-secret provider settings
{
  email:     { provider: 'postmark'|'webhook'|'console', messageStream: string | null },
  ticketing: { provider: 'eventbrite'|'manual'|'none', externalEventId: string | null,
               webhookRegisteredAt: string | null, webhookId: string | null },
  notifier:  { sink: 'webhook'|'email'|'none', operatorEmail: string | null }
}

// config/bootstrap       — server-only (allow read, write: if false)
{ adminEmails: string[], createdAt: Timestamp }
```

Tier A wins on conflict for anything that appears in both (project ID, provider selection): Tier B
copies exist only so the admin UI can display them read-only.

### 2.3 Mapping today's hardcoded values

| Today | Location | Tier |
|---|---|---|
| `SITE_URL` | `functions/index.js:13` | A (`EVENT_PUBLIC_URL`) |
| `ALLOWED_ORIGINS` | `functions/index.js:38` | A (`EVENT_ALLOWED_ORIGINS`) |
| `EVENTBRITE_EVENT_ID`, `CJS2026_EVENT_ID` | `functions/index.js:126`, `:4353` | A (`EVENT_TICKETING_EVENT_ID`), mirrored to `config/providers.ticketing.externalEventId` |
| `ADMIN_EMAILS` ×4 | `functions/helpers.js:160`, `src/contexts/UserProfileContext.jsx:35`, `src/pages/Dashboard.jsx:51`, `src/pages/SpeakerDashboard.jsx:28` | B (`config/bootstrap.adminEmails`, server-only — §5.4) |
| `CCM_POSTAL_ADDRESS_HTML`, `getEmailFooter` copy | `functions/helpers.js:76,138` | B (`config/event.legal`) |
| `SESSION_DATE_BY_DAY` (`Day 1`→`2026-05-14`) | `functions/helpers.js:215` | B (`config/event.days[]`) |
| `'America/New_York'` in `nowInET` | `functions/helpers.js:260` | B (`config/event.timezone`) |
| `SUMMIT_END` / `hasSummitEnded()` | `src/utils/summitStatus.js:17` | B (derived — §2.5) |
| `eventJsonLd` (name, dates, venue, organizer, Eventbrite offer URL) | `src/components/SEO.jsx:6-44` | B (`config/event`) |
| PDF header title/subtitle/colors | `functions/index.js:13574-13581` | B (`config/event` + `config/theme`) |
| `DEFAULT_UNMATCHED_ACCOUNT_CALLOUT_*` | `functions/helpers.js:86,123` | template (§6) |
| Brand hex in `tailwind.config.js` + `:root` in `src/index.css` | both | B (`config/theme`, §7) |
| `storageBucket`, `projectId` in `scripts/lib/firebase-init.cjs:24,60` | script | A |

### 2.4 How config reaches each consumer

**Cloud Functions.** `core/config.cjs` exposes `getEventConfig()` — one in-memory cache per
container, 5-minute TTL, seeded from Tier A env for the handful of fields that exist there. Same
shape as the existing `contentCache` at `functions/index.js:130`. Any handler that needs config
awaits it; no module-scope reads, because a module-scope read runs at deploy analysis time when
Firestore is not reachable.

**Frontend.** Two paths, deliberately:

1. **Build-time snapshot.** `scripts/generate-content.cjs` writes `apps/web/src/generated/eventConfig.js`
   alongside `siteContent.js` / `scheduleData.js` / `organizationsData.js`. This is what renders on
   first paint and what the SEO/OG tags are built from. `config/bootstrap` is never emitted into the
   bundle.
2. **Runtime refresh.** `EventConfigProvider` (new context, outermost) subscribes to `config/event`,
   `config/features`, `config/theme`, and `config/badges`, and overlays them on the snapshot. Feature
   toggles, lifecycle dates, and theme changes therefore take effect without a rebuild.
3. **Content at runtime.** `ContentProvider` subscribes to the **published** content collections
   (`cmsContent`, `cmsSchedule`, `cmsOrganizations`, `cmsTimeline`, `cmsUpdates`, `cmsPages`),
   overlaying the snapshot the same way. Editors work against a separate draft revision that is
   never anonymously readable, and publishing copies draft to published — the two-revision model in
   §8.4. `ContentProvider` takes a read source (`published` | `draft`) so admin preview can point at
   the draft revision; the rules, not the client, enforce who may do that.

This split is what lets §8.4 replace the current `repository_dispatch` publish flow. It also makes
CI credential-free: the committed `apps/web/src/generated/*` files hold the synthetic demo event, so
`npm run build` succeeds with no service account. Deploy-time generation writes to an out-of-tree
directory instead of overwriting those committed files (§8.6).

### 2.5 Event lifecycle clock

`src/utils/summitStatus.js` (a hardcoded `SUMMIT_END` Date and a `hasSummitEnded()` boolean) is
replaced by a pure function in `packages/shared/src/config/lifecycle.cjs`, used identically by web
and functions:

```ts
type EventPhase = 'draft' | 'announced' | 'registration_open' | 'registration_closed'
                | 'in_progress' | 'ended' | 'archived'

function getEventPhase(eventConfig, now = new Date()): EventPhase
function isDayPast(eventConfig, dayId, now): boolean
function isSessionPast(eventConfig, session, now): boolean   // replaces functions/helpers.js:300
```

**`getEventPhase` must be total and deterministic, including on null dates.** Two of the seven
phases are editorial rather than chronological — dates cannot distinguish "seeded but not announced"
from "announced", and nothing in a calendar says "we are done with this site" — so each has an
explicit timestamp field (`announcedAt`, `archivedAt`, §2.2). Evaluation order, first match wins:

| Phase | Condition |
|---|---|
| `archived` | `archivedAt != null && now >= archivedAt` |
| `draft` | `announcedAt == null \|\| now < announcedAt` |
| `ended` | `days[]` non-empty and `now` is after the last day's `endTime` |
| `in_progress` | `days[]` non-empty and `now` is between the first day's `startTime` and the last day's `endTime` |
| `registration_open` | `registration.opensAt == null` or `now >= opensAt`, **and** (`closesAt == null` or `now < closesAt`) |
| `registration_closed` | `registration.closesAt != null && now >= closesAt` |
| `announced` | fallback — announced, registration not yet open (`opensAt != null && now < opensAt`) |

Null semantics, stated so no boundary is ambiguous: `announcedAt: null` ⇒ `draft` (a fresh seed is
never public by accident). `archivedAt: null` ⇒ never archived. `opensAt: null` ⇒ registration was
never gated and is open from announcement. `closesAt: null` ⇒ registration never closes on a clock;
an organizer closes it by setting the field. Empty `days[]` ⇒ the `ended` and `in_progress` rows
cannot match, so a configured-but-undated event sits in `announced` or a registration phase, never in
`in_progress`. Every row is a pure function of config and `now`, so the whole table is table-testable
with a fixture config and a list of instants.

The strict-ISO discipline in the current `isSessionPast` — reject date-only strings so a
lexicographic compare cannot release an embargo a day early — is preserved; the comparison moves
from naive ET strings to explicit `Intl.DateTimeFormat` conversions in the configured timezone.

---

## 3. Provider interfaces

TypeScript-style for precision. Implementation is JavaScript with JSDoc.

### 3.1 EmailProvider

**The email core is deliberately minimal, and this section is the record of why.** The machinery in
this repository today — `broadcast_queue`, a per-minute scheduled processor, the chunked-resume
state machine with its resume budget and claim lease, the `lastUpdateTime` CAS claim, per-recipient
pacing and batching — exists because the outbound relay was a self-hosted SMTP forwarder with no
queue of its own. A managed transactional provider owns queuing, retry, rate shaping, and
suppression. **None of it is ported, and the v1.1 announcements feature must not reintroduce it**:
a batch send is one call to the provider's batch endpoint plus one audit row per recipient.

```ts
interface EmailAddress { email: string; name?: string }

interface EmailMessage {
  to: string | EmailAddress            // exactly one recipient per send() call
  from?: EmailAddress                  // defaults to config/event.sender
  replyTo?: string
  subject: string
  text?: string
  html?: string
  headers?: Record<string, string>
  tag?: string                         // template id, for provider-side analytics
  onceKey?: string                     // CORE-honored send-once claim; see "Send-once semantics"
  idempotencyKey?: string              // provider-honored where supported; independent of onceKey
}

interface EmailSendResult {
  providerMessageId: string | null
  status: 'sent' | 'failed'
  skipped?: boolean                    // true when an onceKey claim already existed — no send,
                                       // no duplicate sent_emails row
  providerStatus?: number              // HTTP status, when the provider is HTTP-based
  error?: string
  retries: number
}

interface SenderDomainStatus {
  domain: string
  verified: boolean
  spf: 'pass' | 'fail' | 'unknown'
  dkim: 'pass' | 'fail' | 'unknown'
  returnPath: 'pass' | 'fail' | 'unknown'
  detail?: string
}

interface DeliveryEvent {
  providerMessageId: string
  type: 'delivered' | 'bounced' | 'complained' | 'suppressed'
  recipient: string
  occurredAt: string                   // ISO 8601
  reason?: string
}

interface EmailProvider {
  readonly name: 'postmark' | 'webhook' | 'console'
  send(message: EmailMessage): Promise<EmailSendResult>
  verifySenderDomain?(domain: string): Promise<SenderDomainStatus>
  parseDeliveryEvent?(rawBody: unknown, headers: Record<string,string>): DeliveryEvent[] | null
}
```

**Core responsibilities (in `email/send.cjs`, not in adapters):**

- Resolve `from`, `replyTo`, and the legal footer from `config/event` before calling the adapter.
- Bounded retry: at most 3 attempts, backoff `[500ms, 2000ms]`, retry **only** on adapter-reported
  retryable statuses (5xx and 429 with a provider-supplied retry hint). Never retry a thrown
  exception — a thrown error is ambiguous about whether the message was accepted. This is the one
  piece of the current retry design that ports as-is, because the reasoning holds for any provider.
- Write exactly one `sent_emails` row per `send()` call, whatever the outcome. Fields:
  `{ to, from, subject, templateId, providerMessageId, status, providerStatus, error, retries,
  bodyStored: boolean, html, text, source, sentAt }`.
- **Never persist rendered content for auth mail.** The current implementation suppresses body
  storage for `sendCustomMagicLink` / `sendCustomOtpCode` because `sent_emails` is admin-readable and
  the body carries a bearer secret. Ported as a template-level flag (`storeRendered: false` on
  `auth.otp`) rather than a source-name allowlist.
- Truncate stored body/html at 100 KB with an explicit `bodyTruncated` boolean (ported as-is).

**Send-once semantics: one centralized mechanism, not per-call-site flags.** Today four helpers
(`sendWelcomeEmail`, `sendUnmatchedTicketEmail`, `sendGetTicketEmail`, `sendSpeakerAcceptanceEmail`)
each carry their own transaction-before-send claim flag on a different document, plus the
`shouldRollbackEmailClaim` heuristic that classifies provider statuses by whether SMTP was reached.
The heuristic and the scattered flags drop on port. The *requirement* does not: ticketing webhook
dedup (§3.3) covers only sends initiated from that one path, and several sends are not — Firestore
triggers are at-least-once, so a retried `onUserCreated` re-sends the welcome mail; a bulk
`ticketingSync` re-walks tickets it has already seen; `order.placed` and `order.updated` are distinct
deliveries about the same order and dedup by delivery id, not by order.

So `send()` accepts an optional `onceKey: string`. When present, core opens a transaction, `create()`s
`email_claims/{sha256(onceKey)}` with `{ onceKey, source, createdAt }`, and proceeds only if the
create succeeds; `ALREADY_EXISTS` returns
`{ status: 'sent', providerMessageId: null, skipped: true, retries: 0 }` without contacting the
provider and without a duplicate `sent_emails` row. The claim is written **before** the send and is
never rolled back — the same deliberate asymmetry as today, for the same reason: a rolled-back claim
plus repeated webhook deliveries is how a recipient gets the same message a dozen times, and the
recovery path for a genuinely lost send is an admin resend, which passes a fresh `onceKey`.

Which sends pass one, and the key shape:

| Send | `onceKey` |
|---|---|
| `account.welcome` | `welcome:{uid}` |
| `speaker.accepted` | `speaker-accepted:{speakerId}` |
| `ticket.claim_prompt` | `claim-prompt:{ticketExternalId}` |
| `ticket.get_ticket` | `get-ticket:{uid}` |
| `feedback.received` | `feedback:{feedbackId}` |
| `auth.otp` | none — every request must send a new code |
| admin-initiated resend of any of the above | `<same>:resend:{adminUid}:{isoMinute}` |

`email_claims` is server-only (`allow read, write: if false`) and swept by `maintenance/cleanup.cjs`
after 90 days.

**What the core does not do:** no queue collection, no scheduler, no claim/lease *for delivery*, no
chunking, no pacing, no batching. `onceKey` is an idempotency claim on one send, not a work queue.

**Adapters.**

- `postmark` — the reference client-facing adapter. Chosen over SES for onboarding cost, which is
  the dominant per-client factor under deploy-per-client: Postmark is transactional-first with a
  separate message stream model, returns a `MessageID` synchronously from a single REST call, exposes
  domain/sender verification state through its API (so `verifySenderDomain()` is a real
  implementation, not a stub, and the onboarding checklist can be script-verified). SES requires an
  AWS account and IAM principal per client, a
  per-account sandbox-exit support request before any real send, and routes bounces through SNS —
  three provisioning steps and one extra service per client, for a cost advantage that is
  irrelevant at transactional volume. SES remains a straightforward second adapter if a client
  requires it.
- `webhook` — generic signed POST to an operator-configured URL. Request body is the `EmailMessage`
  as JSON; auth is `Authorization: Bearer <EMAIL_WEBHOOK_SECRET>` plus an
  `X-Signature: sha256=<hmac>` over the raw body. A 2xx with `{ "id": "..." }` maps to
  `{ status: 'sent', providerMessageId: id }`. This is the only expression of the operator's private
  relay anywhere in the repo: no hostname, no service name, no token, no comment identifying it.
- `console` — writes the rendered message to `console.log` and returns
  `{ status: 'sent', providerMessageId: 'console-<uuid>' }`. Default under the emulator; refuses to
  load when `process.env.FUNCTIONS_EMULATOR !== 'true'` unless explicitly selected.

**Optional v1 delivery-event ingest.** One export, `emailDeliveryWebhook`: authenticates the request
through the adapter, calls `parseDeliveryEvent()`, and patches the matching `sent_emails` row by
`providerMessageId` with `{ deliveryStatus, deliveryUpdatedAt, bounceReason }`. It writes nothing
else and creates no collection. This closes the gap the current system cannot close — provider
acceptance is not delivery — for one endpoint's worth of code.

**Webhook authentication is per-provider, because Postmark does not sign its payloads.** Postmark
delivers delivery/bounce/complaint webhooks as unsigned JSON — there is no signature header to
verify, so the HMAC scheme used for the generic adapter cannot be implemented for it. The interface
carries the verification instead of assuming it:

```ts
interface EmailProvider {
  // ...
  verifyDeliveryWebhook?(rawBody: Buffer, headers: Record<string,string>): boolean
}
```

- **postmark** — authentication is HTTP Basic credentials embedded in the webhook URL registered
  with Postmark (`https://user:pass@<region>-<project>.cloudfunctions.net/emailDeliveryWebhook`).
  `verifyDeliveryWebhook` constant-time-compares the decoded `Authorization: Basic` header against
  `EMAIL_WEBHOOK_BASIC_AUTH` (§2.1). Optionally tightened with an allowlist of Postmark's published
  outbound IP ranges, checked against the forwarded client IP; the allowlist is defense in depth, not
  the primary control, because the ranges change. The credential is generated per deployment during
  onboarding, never shared between clients, and rotating it means re-registering the URL in Postmark.
- **webhook** (generic) — keeps `X-Signature: sha256=<hmac>` over the raw body, because the operator
  controls both ends and can sign.
- **console** — does not implement it; the endpoint refuses every request when the console adapter is
  active.

The endpoint returns 401 on a failed check and never falls back to accepting unauthenticated
deliveries. An unauthenticated ingest endpoint would let anyone mark arbitrary `sent_emails` rows as
bounced, which is a support-signal poisoning vector even though it writes no user-visible data.

**Auth-email rate limiting is retained.** 5 requests per 15 minutes per email address, keyed by
SHA-256 hash of the normalized address, in `auth_rate_limits/{emailHash}` (renamed from
`magic_link_rate_limits`). Enforced in `auth/otp.cjs`, not in the email core, because it is an
authentication control rather than a mail control.

### 3.2 OperatorNotifier

Replaces every direct `/alert`, `/alert-action`, `/cjs-error`, and `api.telegram.org` call. There are
16 such call sites in `functions/index.js` today.

```ts
interface OperatorEvent {
  kind: 'error' | 'warning' | 'info'
  title: string                        // short, deployment-prefixed by the core
  summary: string
  fields?: Record<string, string>      // flat key/value detail
  url?: string                         // deep link into the admin panel or the affected page
  dedupeKey?: string                   // suppress repeats within the dedupe window
  errorId?: string                     // system_errors doc id, when there is one
}

interface OperatorNotifier {
  readonly name: 'webhook' | 'email' | 'none'
  notify(event: OperatorEvent): Promise<{ delivered: boolean; sink: string; error?: string }>
}
```

Core (`notify/operator.cjs`) prefixes `title` with `config/event.shortName`, applies a 5-minute
dedupe window keyed by `dedupeKey` (in-memory per container, matching the existing
`errorAlertRateLimit` Map semantics), and never throws — a notifier failure is logged and swallowed,
because alerting is not the operation the caller was performing.

- `webhook` sink — signed JSON POST, same auth shape as the email webhook adapter. Payload is the
  `OperatorEvent` plus `{ deployment: EVENT_SLUG, projectId, timestamp }`.
- `email` sink — renders a plain operator-notification template and sends through the
  `EmailProvider` to `config/providers.notifier.operatorEmail`. This is the fallback when no webhook
  is configured, and it is the only sink a client-operated deployment would ever need.
- `none` — no-op, returns `{ delivered: false, sink: 'none' }`. Valid for demo instances.

Product code never learns which sink is configured.

### 3.3 TicketingProvider

Derived from what the Eventbrite integration actually does in `functions/index.js`: webhook
ingestion with a delayed order queue (`eventbrite_order_queue`, drained every 2 minutes because
Eventbrite's `orders` and `attendees` endpoints are eventually consistent), bulk sync
(`syncEventbriteAttendees`), single-ticket verification (`checkEventbriteTicket`), self-service order
claim (`verifyEventbriteOrder`, which rejects any `order.event_id` other than the hardcoded one),
matched/unmatched bifurcation into two collections with a transactional cross-collection claim
(`claimAttendeeSlot`), and an unmatched-ticket email flow that auto-matches when the ticket holder
later creates an account.

```ts
interface TicketRecord {
  externalId: string                   // provider attendee/ticket id — the dedup key
  orderId: string
  email: string                        // lowercased
  firstName: string | null
  lastName: string | null
  ticketClass: string | null
  quantity: number
  purchasedAt: string                  // ISO 8601
  status: 'valid' | 'refunded' | 'cancelled' | 'pending_info'
  raw?: Record<string, unknown>        // provider payload, stored for support forensics
}

interface WebhookVerification {
  valid: boolean
  deliveryId: string                   // stable per delivery — the dedup key
  eventType: 'order.placed' | 'order.updated' | 'attendee.updated' | 'unknown'
  resourceId: string | null            // order id, when derivable
  reason?: string                      // populated when valid === false
}

interface TicketingProvider {
  readonly name: 'eventbrite' | 'manual' | 'none'
  readonly externalEventId: string | null

  verifyWebhook(rawBody: Buffer, headers: Record<string,string>): Promise<WebhookVerification>
  fetchOrder(orderId: string): Promise<{ orderId: string; externalEventId: string;
                                         tickets: TicketRecord[]; complete: boolean }>
  listTickets(opts?: { since?: string; pageToken?: string }):
      Promise<{ tickets: TicketRecord[]; nextPageToken: string | null }>
  lookupByOrderNumber?(orderNumber: string, email: string): Promise<TicketRecord[] | null>
  registerWebhook?(opts: { callbackUrl: string; events: string[] }):
      Promise<{ webhookId: string }>

  // Registration messaging — see §3.5. The provider decides what (if anything)
  // an unticketed user is told to do next.
  getRegistrationPrompt(ctx: RegistrationPromptContext): Promise<RegistrationPrompt>
}
```

`fetchOrder().complete` is the provider's answer to "is the attendee data populated yet". The
eventbrite adapter returns `false` when attendee records come back as placeholders, which is what
drives the retry queue instead of the current all-attendees-skipped silent drop.

**Event ID.** `externalEventId` is read once from `EVENT_TICKETING_EVENT_ID` at adapter construction
and is the only value any provider-side filter compares against. The two-name duplication at
`functions/index.js:126` and `:4353` cannot recur because there is one field.

**Webhook registration** is an explicit provisioning step, and it applies **only to providers that
implement `registerWebhook`** — today that is `eventbrite` alone. `manual` has no webhook to
register and `none` has no provider at all, so gating any of this on "ticketing !== none" would make
a mandatory provisioning step permanently unsatisfiable for the CSV path. The capability, not the
enablement, is the gate: `scripts/register-ticketing-webhook.cjs` exits 0 with "provider does not
support webhooks — nothing to register" when `typeof provider.registerWebhook !== 'function'`, and
`getTicketingStatus` reports `webhookSupported: false` rather than an unregistered-webhook warning.
The same test governs the onboarding checklist item (§5.6) and the two webhook secrets (§8.2).

**Centralized dedup.** `ticketing/webhook.cjs` is the only place a ticketing webhook is processed:

1. `verifyWebhook()` → reject non-`valid` with 401 (or 200 + ignored for wrong-event deliveries, so
   the provider stops retrying a misconfiguration).
2. **One transaction** claims the delivery and enqueues the work together: `create()`
   `ticket_webhook_deliveries/{deliveryId}` and `set()` `ticket_sync_queue/{orderId}` with a
   `readyAt` timestamp, committed atomically before the 200 is returned. A `FAILED_PRECONDITION`
   from the claim create means a duplicate delivery → 200, no work. These must not be two writes:
   claiming first and enqueuing second loses the order permanently if the container dies in between,
   because every retry of that delivery then sees the claim and acknowledges without work. The queue
   row is keyed by `orderId` and the claim by `deliveryId`, so two distinct deliveries about the same
   order collapse onto one queue row — which is the intended behavior, not a collision.
3. `processTicketSyncQueue` (every 2 minutes) drains the queue, calls `fetchOrder()`, and re-enqueues
   with backoff while `complete === false`, up to 6 attempts, after which it fires an
   `OperatorEvent`. The current code has no such alert, which is how an order with placeholder
   attendee data disappears silently.
4. Per-ticket upsert into `tickets/{externalId}` (§4.2), then registration-state evaluation.

The manual/CSV provider implements `listTickets()` from an admin-uploaded CSV
(`ticketingImportCsv`), returns `{ valid: false, reason: 'no webhook' }` from `verifyWebhook`, and
supplies `lookupByOrderNumber` as an exact match against imported rows. `none` is `manual` with an
empty ticket set; every deployment therefore has a working registration path.

### 3.4 Registration state machine

Provider-neutral. Lives in `packages/shared/src/registration.cjs` so the frontend gate and the
server gate cannot diverge (today `canBookmarkSessions()` in `UserProfileContext.jsx:358` accepts
`registered | confirmed | approved` while `useRegisteredUsers.js:32` queries the same three and
`AttendeesTab` writes a fourth value, `ticket_only`).

`users/{uid}.registrationStatus` ∈ `pending | ticketed | approved | revoked`.

| From | To | Trigger |
|---|---|---|
| — | `pending` | account created (any sign-in path) |
| `pending` | `ticketed` | a `tickets` doc is claimed by this uid (webhook match, sync match, or self-service claim) |
| `ticketed` | `approved` | admin approval, **or** automatically when `config/features.autoApproveTicketHolders` is true |
| `pending` | `approved` | admin approval (the only path when ticketing provider is `none`) |
| `approved` \| `ticketed` | `revoked` | admin revocation, or **no valid claimed ticket remains** (see below) |
| `revoked` | `approved` | admin re-approval |

**Revocation recomputes entitlement over the whole set, never reacts to one ticket.** A user can
hold several claimed tickets — a group order, a replacement issued after a change, an add-on for a
workshop. "A ticket became `refunded` or `cancelled`" is not a revocation condition; it is a reason
to recompute. After any change to a ticket claimed by `uid`,
`recomputeEntitlement(uid)` evaluates both sources:

```
hasValidTicket = tickets.where('claimedByUid','==',uid).where('status','==','valid') is non-empty
hasAdminGrant  = users/{uid}.approvalSource == 'admin'
entitled       = hasValidTicket || hasAdminGrant
```

Only `entitled === false` moves a `ticketed` or `approved` user to `revoked`. **An explicit admin
approval survives every ticket refund**: an organizer who approved a scholarship attendee, a
volunteer, or a press pass made a decision the ticketing provider knows nothing about, and a refund
elsewhere in the order must not silently reverse it. `users/{uid}.approvalSource` ∈
`'admin' | 'ticket'` records which source granted access and is written at the moment of approval —
`'admin'` for `approveUser`, `'ticket'` for the `autoApproveTicketHolders` path. An admin revocation
is explicit and separate: it clears `approvalSource` and sets `revoked` directly, so it is never
undone by a later ticket sync.

`hasAttendeeAccess(profile, config)` returns true for `approved`, for `profile.speakerId != null`,
and for admins. That predicate — not a status-string list — gates bookmarking, directory listing,
materials access, and the personal schedule. Legacy `registered` / `confirmed` / `ticket_only`
values do not exist in v1; there is no migration because there is no data to migrate.

**The predicate is not an authorization boundary — the rules are.** `hasAttendeeAccess` is
JavaScript running in the browser and in Cloud Functions. It cannot gate a direct Firestore read, and
the attendee directory and profile pages query `users_public` straight from the client. Today's rule
(`firestore.rules:157-159`) grants `attendees_only` profiles to **any** authenticated user; since
every new account starts at `pending`, anyone who completes a sign-in — no ticket, no approval —
can enumerate the directory. v1 rules branch on the requester's own `users` doc:

```
function requesterIsApprovedAttendee() {
  return request.auth != null &&
    (get(/databases/$(database)/documents/users/$(request.auth.uid)).data.registrationStatus == 'approved' ||
     get(/databases/$(database)/documents/users/$(request.auth.uid)).data.speakerId != null);
}

match /users_public/{userId} {
  allow read: if resource.data.profileVisibility == 'public';
  allow read: if request.auth != null && request.auth.uid == userId;      // self
  allow read: if resource.data.profileVisibility == 'attendees_only' && requesterIsApprovedAttendee();
  allow read: if isAdmin() || isSuperAdmin();
  allow write: if false;                                                  // trigger-maintained
}
```

Two consequences to accept deliberately. First, each `attendees_only` read costs one extra document
read for the `get()` — the same cost `isAdmin()` already pays, and directory pages should batch by
querying once rather than per-card. Second, a `list` query over `users_public` succeeds only when
every returned document satisfies a rule, so the directory query must filter on
`profileVisibility` explicitly rather than relying on rules to drop rows. `tests/firestore.rules.test.js`
pins: `pending` user denied on an `attendees_only` doc; `approved` user allowed; speaker allowed;
anonymous allowed on `public` only; self-read allowed at any visibility; the list-query shape.

### 3.5 Registration messaging is provider-owned

Tokenizing the registration emails is not sufficient. Today `notifyNewUserSignup`
(`functions/index.js:9973`) unconditionally calls `sendGetTicketEmail` for every new signup, and
`buildGetTicketEmailTemplate` (`:15090`) renders a "Complete your registration" message whose entire
call to action is buying a ticket on Eventbrite. Under the manual/CSV provider that instruction is
false — there is nothing for the user to buy, and the admin is the one who adds them. Under `none`
the message should not be sent at all. A token substitution cannot express "do not send this."

So the provider owns the decision, the wording of the action, and the destination:

```ts
interface RegistrationPromptContext {
  user: { uid: string; email: string; displayName: string | null }
  registrationStatus: 'pending' | 'ticketed' | 'approved' | 'revoked'
  isSpeaker: boolean
  hasClaimedTicket: boolean
  trigger: 'account_created' | 'ticket_unclaimed' | 'admin_resend'
}

interface RegistrationPrompt {
  send: boolean                 // false suppresses the message entirely
  templateId: 'ticket.get_ticket' | 'ticket.claim_prompt' | null
  ctaLabel: string | null       // "Get your ticket" | "Claim your ticket" | "Contact the organizers"
  ctaUrl: string | null         // provider checkout URL, claim URL, or a mailto:/contact page
  action: 'purchase' | 'claim' | 'await_approval' | 'contact_organizer' | null
  bodyNote: string | null       // one provider-specific sentence rendered into {{provider_note}}
}
```

Provider behavior:

| Provider | `trigger: account_created`, no ticket | Ticket exists, unclaimed |
|---|---|---|
| `eventbrite` | `send: true`, `action: 'purchase'`, `ctaUrl` = `config/event.registration.externalUrl`, template `ticket.get_ticket` | `send: true`, `action: 'claim'`, template `ticket.claim_prompt` |
| `manual` | `send: true` only if `config/event.registration.externalUrl` is set (some clients register through their own form); otherwise `send: true`, `action: 'await_approval'`, no CTA URL, body says an organizer will confirm | `send: true`, `action: 'claim'` |
| `none` | `send: false` | n/a |

Every provider returns `send: false` when `ctx.isSpeaker` is true or `ctx.hasClaimedTicket` is true —
the two skip conditions the current implementation buries inside `sendGetTicketEmail`. Making them
part of the returned decision means the skip is testable without a mail send, and the caller
(`users/lifecycle.cjs`) contains no ticketing knowledge at all: it calls `getRegistrationPrompt`,
and if `send` is true it renders the named template with the returned CTA fields.

The templates are therefore **provider-parameterized, not merely tokenized** — see §6.2.

---

## 4. Firestore schema for v1

### 4.1 Surviving collections

| Collection | Purpose | Renamed from |
|---|---|---|
| `config/{docId}` | Runtime event config, 5 docs (§2.2) | `admin_settings` (partly) |
| `users/{uid}` | Account + attendee profile. Adds `speakerId`; loses `isSpeaker`, `sessionIds`, `customBadges` | — |
| `users/{uid}/sessionNotes/{sessionId}` | Private per-session notes | — |
| `users_public/{uid}` | Public-safe projection (trigger-maintained). `scheduleVisibility` is renamed `profileVisibility` (`public` \| `attendees_only` \| `private`) because it governs directory and profile visibility, not just the shared schedule; read rules in §3.4 | — |
| `speakers/{speakerId}` | **Canonical** speaker record (§4.3) | `cmsSpeakers` |
| `speakers_public/{speakerId}` | Public projection of `speakers` | new |
| `speaker_invites/{token}` | Invite tokens, status flow | — |
| `auth_challenges/{token}` | OTP challenge store: `{ kind:'otp', email, codeHash, attempts, expiresAt }` | `magic_links` |
| `auth_rate_limits/{emailHash}` | 5/15min bucket | `magic_link_rate_limits` |
| `cmsPages/{pageId}` | Page + section definitions as data (§5.2) | new (was `PAGE_CONFIGS` in code) |
| `cmsContent/{docId}` | Content blocks, keyed `section` + `field` | — |
| `cmsSchedule/{sessionId}` | Sessions. `dayId` replaces free-text `day`; `speakerIds: string[]` replaces the comma-separated `speakers` string | — |
| `cmsOrganizations/{docId}` | Sponsors/partners | — |
| `cmsTimeline/{docId}` | Prior-event timeline | — |
| `cmsUpdates/{docId}` | News/announcement posts | merged from `updates` + `cmsUpdates` |
| `cmsVersionHistory/{docId}` | Content version audit | — |
| `cmsPublishQueue/{docId}` | Publish requests + status | — |
| `announcements/{id}` | Site-wide banner | — |
| `key_dates/{id}` | Countdown milestones | — |
| `live_updates/{id}` | Live feed, admin-form authored | — |
| `sessionBookmarks/{sessionId}` | Aggregate bookmark counts | — |
| `sessionReactions/{sessionId}` + `/users/{uid}` | Emoji reactions + dedup | — |
| `session_materials/{id}` | Materials, **server-only reads** (§4.4) | — |
| `session_materials_public/{id}` | Approved-materials metadata projection | — |
| `tickets/{externalId}` | All tickets, claimed and unclaimed (§4.2) | `eventbrite_synced` + `eventbrite_unmatched` |
| `ticket_webhook_deliveries/{deliveryId}` | Webhook dedup claims | new |
| `ticket_sync_queue/{orderId}` | Delayed order fetch with backoff | `eventbrite_order_queue` |
| `email_templates/{templateId}` | Firestore overrides of code defaults (§6) | `speaker_email_templates` (generalized) |
| `sent_emails/{id}` | Outbound audit + delivery status | — |
| `email_signups/{id}` | Newsletter/waitlist | — |
| `media_assets/{assetId}` | Indexed Storage objects | — |
| `system_errors/{id}` | Error telemetry | — |
| `client_error_rate_limits/{ipHash}` | Telemetry rate limit | — |
| `feedback/{id}` | Bug/feedback inbox | `bug_reports` |
| `feedback_rate_limits/{ipHash}` | Feedback rate limit | `bug_report_rate_limits` |
| `edit_requests/{id}` | Public content-correction requests | — |
| `admin_logs/{id}` | Admin action audit | — |
| `activity_logs/{id}` | User activity | — |
| `background_jobs/{id}` | Scheduled-job run log | — |

**37 collections**, down from 49 with client rules plus 6 functions-only.

### 4.2 Collections not carried over

`posts`, `postReactions`, `reports`, `notifications`, `deleted_posts_audit` (social cut);
`session_qa`, `session_qa_archive` and their message subcollections (chat cut);
`broadcast_templates`, `broadcast_history`, `broadcast_queue`, `broadcast_drafts` (broadcast cut);
`invoices`, `invoiceDesignConfigs`, `sponsorPackages` (invoicing cut — sponsor tiers move into
`config/event` and `cmsOrganizations`); `renderedVideos` (video cut); `admin_requests` and its
`activity` subcollection (operator triage pipeline stays private); `session_material_urls`,
`session_material_counts` (§4.4); `magic_links` as a link store (retained only as the OTP challenge
store under a new name); `admin_settings` (split into `config/*`).

`tickets/{externalId}` replaces the matched/unmatched pair with one document and a `claimedByUid`
field. The current two-collection design forces a transactional cross-collection claim
(`claimAttendeeSlot`, which must check the *other* collection to avoid double-creation) and a
delete-from-both cleanup path. One collection with `{ claimedByUid: string | null, claimedAt }`
makes the claim a single-document transaction and removes the drift class the `check-eb-count-drift`
and `cleanup-eb-drift` scripts exist to detect.

```ts
// tickets/{externalId}
{ externalId, orderId, email, firstName, lastName, ticketClass, quantity,
  purchasedAt, status, provider,                 // 'eventbrite' | 'manual'
  claimedByUid: string | null, claimedAt: Timestamp | null,
  claimPromptSentAt: Timestamp | null,           // replaces profileEmailSent
  raw, createdAt, updatedAt }
```

### 4.3 Speaker single source of truth

**How the tri-sync actually works today** (read from code, because this is the part most worth
getting right):

- `cmsSchedule/{id}.speakers` is a **comma-separated free-text name string**.
- `cmsSpeakers/{id}` holds `firstName`/`lastName` plus a `sessionInfo` map keyed by session id,
  containing `{title, description, format}` copied from the schedule, plus manual fields
  (`coPresenters`, `notes`), plus a `_deletedSessions` archive map.
- `syncSessionInfoToSpeakers()` (`functions/index.js:7041`) runs from inside `cmsUpdateContent`: on a
  schedule write it parses the old and new name strings, builds a lowercased full-name → doc-ref map
  over the *entire* `cmsSpeakers` collection, and writes `sessionInfo` leaves.
- `reverseJoinSpeakerToSessions()` (`:7157`), fired by the `onCmsSpeakerWritten` trigger, does the
  inverse: on any speaker write it scans the *entire* `cmsSchedule` collection for name matches and
  populates `sessionInfo` inside a transaction.
- `users/{uid}` separately carries `isSpeaker` and `sessionIds`, written server-side by the invite
  flow and by `syncSessionSpeakerIds`, with a name-based fallback resolution path
  (`cmsSpeakers.uid` → `users`) for authorization.
- `detectSpeakerSoTDrift` (`:19035`) runs daily and reports four drift classes: stale `sessionIds`,
  orphaned `cmsSpeakers`, a legacy dead field, and missing bios.

The join key is a **lowercased human name in a free-text field**. Every reconciliation script, both
sync directions, and the drift detector exist to compensate for that.

**v1 design.**

- `speakers/{speakerId}` is canonical. It holds identity (`firstName`, `lastName`, `slug`),
  profile (`bio`, `headshotPath`, `organization`, `jobTitle`, `socialHandles`), pipeline state
  (`status`, `inviteToken`, `approvedAt`), and `uid: string | null` linking to an account.
- `cmsSchedule/{id}.speakerIds: string[]` holds speaker document IDs. The free-text `speakers` string
  is gone; the admin session editor picks speakers from a typeahead over `speakers`.
- `users/{uid}.speakerId: string | null` replaces `isSpeaker` and `sessionIds`. "Is this user a
  speaker" is `speakerId != null`. "Which sessions" is a query:
  `cmsSchedule.where('speakerIds', 'array-contains', speakerId)` (single-field array index, no
  composite needed).
- **Derived views, one direction only.** `onSpeakerWritten` maintains `speakers_public/{speakerId}`
  — a projection carrying only publicly-safe fields — and nothing else. There is no reverse trigger,
  no `sessionInfo` map, and no `_deletedSessions` archive: session→speaker is a foreign key and
  speaker→session is a query, so there is no copied data to fall out of step.
- Session metadata a speaker sees (title, description, format) is read live from `cmsSchedule` at
  render time. Manual per-speaker-per-session notes, if a client wants them, live in
  `speakers/{speakerId}/sessionNotes/{sessionId}` — a subcollection nobody syncs.

**Referential integrity is enforced at the write seam, because Firestore will not enforce it.** "No
drift" is a claim about *copied fields*, not about dangling references — nothing in Firestore stops
`speakerIds` from naming a deleted speaker. Three server-side rules make the seam transactional, and
all three live in Cloud Functions because every collection involved is `allow write: if false` for
clients:

1. **Session save validates its references.** `cmsUpdateContent` (and `cmsSavePage` for any page
   embedding a speaker list) reads each id in `speakerIds` and rejects the write, naming the id, if a
   `speakers/{id}` doc does not exist. Rejecting is right rather than silently dropping: a typo'd or
   stale id in an admin payload is a bug to surface, not data to discard.
2. **Speaker delete is an atomic unlink.** `deleteSpeaker` runs one transaction: query
   `cmsSchedule.where('speakerIds','array-contains',speakerId)`, remove the id from each session
   (`arrayRemove`), clear `users/{uid}.speakerId` when `speakers.uid` is set, delete
   `speakers_public/{speakerId}`, delete `speakers/{speakerId}`. Above the transaction's document
   limit the operation refuses and directs the admin to a soft delete
   (`speakers.status = 'removed'`), which hides the speaker everywhere without touching sessions.
   A speaker on 500-plus sessions is not a real case, but failing loudly beats a half-applied unlink.
3. **The `users.speakerId` ↔ `speakers.uid` pair is written only by the invite/acceptance
   transaction** and by `deleteSpeaker`. Both sides are set or cleared in the same commit, never
   independently, and the rules work in §3.4 already makes both documents server-write-only — so
   there is no client path that can set one half.

The accurate claim is therefore narrower than "nothing can drift": **no periodic reconciliation is
needed, because every write that could break a reference is transactional at the seam.** That is what
retires `detectSpeakerSoTDrift` and the eight reconciliation scripts — not an assumption that
references cannot dangle.

Deletes: `syncSessionInfoToSpeakers`, `reverseJoinSpeakerToSessions`, `onCmsSpeakerWritten`,
`syncSessionSpeakerIds`, `cleanupRevokedInviteSessionIds`, `detectSpeakerSoTDrift`, the
name-resolution fallback ladder in the authorization path, and the eight reconciliation scripts.

### 4.4 Session materials

Current shape is four collections plus an hourly reconciler: `session_materials` (auth-readable),
`session_materials_public` (anonymous-readable metadata projection), `session_material_urls`
(server-only URL vault, created because the parent doc became anonymously readable), and
`session_material_counts` (server-only per-session counter enforcing a cap transactionally,
healed hourly by `reconcileSessionMaterialCounts`).

v1 is two collections:

- `session_materials/{id}` — **`allow read, write: if false`**. Every field, including the link URL,
  lives here. All client access goes through Cloud Functions. Making the raw doc server-only removes
  the reason the URL vault exists.
- `session_materials_public/{id}` — trigger-maintained projection carrying exactly
  `{ sessionId, type, filename, reviewStatus }`. Anonymous read. This is the schedule pill's
  discovery surface.

The per-session cap moves to a `materialCount` field on `cmsSchedule/{sessionId}`, incremented and
decremented in the same transaction that creates or deletes the material — same atomicity, one fewer
collection, and no reconciler because there is no second document to fall out of step. The
projection trigger is idempotent and self-healing on any write.

Embargo logic is retained: `getSessionMaterialUrl` gates on
`speaker | admin | (reviewStatus === 'approved' && isSessionPast(config, session, now))`, with the
strict-ISO discipline from `functions/helpers.js:300` preserved and the day→date map read from
`config/event.days[]`.

**The URL-shaped-filename scrub is a required invariant, in both layers.** The projection carries
`filename`, and `filename` on a link material is user-supplied. If a speaker submits a link with a
blank label or a label that is itself the URL, an unscrubbed projection publishes the embargoed URL
as the material's display name — the embargo is defeated without the URL ever touching a URL field.
That is the load-bearing leak the PR #438 work fixed, and the fix must be carried, not re-derived:

- `looksLikeUrl(s)` (`functions/index.js:8669`) — true for `https?://`, for anything containing
  `://`, and for bare `domain.tld/…` shapes — ports verbatim into
  `packages/shared/src/urlSafety.cjs`.
- **Write path** (`addSessionMaterialLink`, `updateSessionMaterial`): a link material whose trimmed
  label is empty or `looksLikeUrl` is stored with `filename: 'External link'`. The client sends an
  empty label and trusts the server to fill it; it must never send the URL as a fallback label.
- **Projection trigger** (`projectSessionMaterialPublic`, `functions/index.js:9315`): re-applies the
  same gate. This is deliberate defense in depth, not redundancy — the trigger fires on *every*
  write, including Admin SDK writes from recovery scripts, console edits, and any data that predates
  a scrubbed write path, none of which pass through the HTTP handlers.
- File materials are **not** scrubbed: `slides.pdf` is URL-shaped under `looksLikeUrl`, and the
  bytes are signed-URL gated regardless, so the filename is a display label rather than a secret.
  The asymmetry is intentional and must survive the port.

The three pinning tests carry over into `functions/src/materials/*.test.cjs`: a URL-shaped label
renders `External link`, an empty label renders `External link`, a real label is preserved — plus a
projection-level test that a directly-written URL-shaped `filename` never reaches
`session_materials_public`.

### 4.5 Badges

Definitions move from `src/constants/badgeData.js` (which hardcodes nine prior CJS summits and a
derived-badge function producing "OG", "zoom veteran", "pandemic pioneer") into `config/badges`,
seeded per event.

- Attendees self-select from the configured set. `useBadgeManager` keeps `toggleBadge` and the
  per-category `maxPicks` cap.
- **Free-text custom badges are cut.** `addCustomBadge` / `removeCustomBadge`, the
  `users.customBadges` field, the profanity filter dependency on that path, and the admin rendering
  of custom badges all go.
- Server-side validation: the `users` update rule and `syncUserPublic` both reject any badge id not
  present in `config/badges`. Rules cannot read `config/badges` cheaply for a list membership check,
  so validation is enforced in the trigger (which rewrites `users_public.badges` to the intersection
  with the configured set) and in the profile-save Cloud Function.
- Attendance-history badges (the "which prior events did you attend" derivation) become a generic
  `config/badges.priorEvents: Array<{ id, label, year }>` with a simple count-based rule set; the
  hand-authored CJS jokes do not port.
- No admin badge-assignment UI in v1.

---

## 5. Bootstrap / init design

Starting point: the operator has manually created a Firebase project, enabled Firestore, Storage,
Auth, and Functions, and set billing. Everything after that is this section.

### 5.1 Order of operations

1. **Configure the deployment environment.** Create a GitHub Environment named for the client slug;
   set the Tier A variables and secrets from §2.1. Nothing is committed.
2. **Deploy rules and indexes first.** `firebase deploy --only firestore:rules,firestore:indexes,storage`
   from the deploy workflow's `provision` job. Rules before data, so the seed writes land under the
   final rule set.
3. **Deploy functions.** Required before seeding because `init-event.cjs` calls no functions but the
   first admin sign-in does.
4. **Run `scripts/init-event.cjs`.** Idempotent; safe to re-run. In order:
   a. Validate Tier A env; refuse to run against a project that already has a `config/event` doc
      unless `--force` is passed.
   b. Write `config/event`, `config/features`, `config/theme`, `config/badges`, `config/providers`
      from a client answers file (`--answers path/to/answers.json`) or interactive prompts.
   c. Write `config/bootstrap.adminEmails` from `--admin` flags (one or more).
   d. Seed `cmsPages` with the eight default pages (§5.3).
   e. Seed `cmsContent` with placeholder blocks for every `defaultBlocks` entry in those pages (§5.4).
   f. Seed `email_templates` overrides for the two client-visible templates whose copy is
      event-specific (`ticket.get_ticket`, `ticket.claim_prompt`); the rest run from code defaults.
   g. Upload neutral placeholder branding assets into the `branding/` Storage slots.
   h. Print the manual checklist (§5.6) and the launch-readiness summary, then **exit 0**.
5. **Build and deploy hosting.** `generate-content` against the now-seeded project, then build, then
   deploy.
6. **Complete the manual Firebase Auth steps** (§5.6), then sign in as the first admin and verify the
   admin panel loads.
7. **Verify sender domain** (`scripts/verify-sender-domain.cjs`) before any real user sign-in, since
   OTP login is the only email-dependent critical path.
8. **Register the ticketing webhook** — only when the configured provider implements
   `registerWebhook` (§3.3). For `manual` and `none` the script reports "not applicable" and exits 0;
   there is nothing to register and nothing missing.
9. **Run `init-event.cjs --check` before launch.** Separate mode, separate moment (§5.1.1).

#### 5.1.1 Launch readiness is a separate check, not an init failure

`init-event.cjs` must not exit non-zero on `config/event.legal.reviewRequired`. That flag is true on
every fresh deployment by construction (§5.5), it is set at step 4 — before hosting exists at steps
5–6 — and the only way to clear it is the admin Settings UI, which requires the hosting deploy that
the non-zero exit would have blocked. As written it would hard-fail every first-time deployment on a
condition it created itself.

Instead: init prints unmet readiness items as warnings and exits 0. Enforcement lives where it can
actually be acted on — the persistent admin-panel banner and the public-page notice on the legal
pages (§5.5), neither of which an operator can miss. Pre-launch, the operator runs
`init-event.cjs --check`, a read-only mode that exits non-zero if any of the following is unmet, and
prints exactly what to do about each:

| Check | Passes when |
|---|---|
| Legal review | `config/event.legal.reviewRequired === false` |
| Sender domain | `config/event.sender.domainVerified === true` |
| Seeded content | count of `cmsContent` docs with `seeded: true` is below a configured threshold (default 0) |
| Branding | no `branding/` slot still points at a placeholder asset |
| First admin | at least two accounts hold an admin role (§5.6 item 7) |
| Ticketing | provider is `none`/`manual`, **or** `config/providers.ticketing.webhookRegisteredAt` is set |
| Auth | Google provider enabled and the custom domain is an authorized domain (operator-attested, recorded in `config/event`) |

`--check` is the gate on going live. `init` is the gate on nothing.

### 5.2 Pages as data

`PAGE_CONFIGS` (556 of the 793 lines in `src/cms/cmsArchitecture.js`) is event-specific vocabulary
compiled into the bundle: section ids like `expect`, field ids like `when_day1_title`,
`summits_value`, `photo_video_opt_out`. Adding a page today requires a code edit plus a deploy.

`BLOCK_TYPES` is genuinely generic and **stays in code**, because each block type is a contract with
a React renderer — a block type with no renderer is a broken page, and Firestore cannot supply a
component.

`PAGE_CONFIGS` becomes `cmsPages/{pageId}`:

```ts
// cmsPages/{pageId}
{
  id: string,                  // 'home'
  label: string,               // 'Home page'
  path: string,                // '/'
  icon: string | null,
  order: number,
  visible: boolean,
  systemPage: boolean,         // true for pages with a dedicated React route (home, schedule,
                               // speakers, sponsors); false for generic content pages rendered
                               // by a single <ContentPage> route
  sections: Array<{
    id: string,
    label: string,
    description: string | null,
    allowedBlocks: string[],   // BLOCK_TYPES keys; validated on write
    maxBlocks: number,
    reorderable: boolean,
    defaultBlocks: Array<{ field: string, blockType: string, description: string }>
  }>
}
```

`cmsSavePage` / `cmsDeletePage` validate `allowedBlocks` and `defaultBlocks[].blockType` against the
code's `BLOCK_TYPES` registry and reject unknown ids. The admin CMS reads `cmsPages` at runtime;
`getPageSections`, `getAllowedBlocksForSection`, `getDefaultBlocks`, `isSectionReorderable`,
`getMaxBlocks`, and `findFieldLocation` keep their signatures and take the pages collection as input
instead of closing over the constant.

**Generic pages route at their own root-level `path`, not a `/p/:slug` prefix (issue #52).** A
non-system page's admin-set `path` (e.g. `/scholarships`) IS its URL — there is no separate slug
namespace. `apps/web/src/App.jsx` mounts every system route (`schedule`, `speakers`, `sponsors`,
`signin`) plus `index` for home explicitly, then a single catch-all (`path="*"`, registered last —
react-router matches routes top to bottom) that renders `<ContentPage>`. ContentPage reads the
current location's pathname and looks it up against visible pages by their stored `path` — one
lookup key, not a route param, and not the old dual `getPage(slug) ?? getPage('/p/' + slug)`
fallback. A pathname that matches no page (including the retired `/p/...` prefix — those links now
404 rather than redirect) renders the same `NotFound` used everywhere else on the site; ContentPage
IS the site's 404 path for anything that isn't a static route.

Because a generic page's path can be anything an admin types, two guards keep it from colliding
with the site's real structure:

- **Reserved-path registry** (`packages/shared/src/routing.cjs`, `RESERVED_PATH_SEGMENTS`): the
  first path segment of every statically mounted App.jsx route, plus `p` (reserving the old prefix
  so it can never be reclaimed by a new page) and `admin` (reserved ahead of its own route landing,
  for the authenticated admin area under construction on a parallel branch) — the list covers future
  system areas as well as routes that exist today. This is the single source of truth, imported by
  both
  `validatePageDoc` (functions) and, indirectly through the same registry, the web router's mental
  model of what it owns. `validatePageDoc` rejects a non-system page whose first path segment is
  reserved, rejects `path === '/'` (home's route) for anything but a system page, and enforces
  normalized form — lowercase, slug-safe segments (`[a-z0-9-]`, no leading/trailing hyphen), no
  trailing slash, no empty (`//`) segments. System pages are exempt from the reserved-segment and
  root checks: they ARE the routes those checks protect (e.g. the schedule page's path IS
  `/schedule`).
- **Application-level uniqueness** in `cmsSavePage`: Firestore has no unique index on `path`, so
  before writing a draft the handler queries both `cmsPages` and `cmsPages_drafts` for an exact
  `path` match belonging to any OTHER page id, and rejects the save (400, naming the colliding page)
  if one exists.

### 5.3 Default seeded pages

`home`, `schedule`, `speakers`, `sponsors`, `travel`, `faq`, `conduct`, `contact`, plus `privacy`
and `terms` as legal templates (§5.5). Ten documents. Section ids are generic: `hero`, `details`,
`highlights`, `stats`, `history`, `footer` on home; `intro` + `faq_items` on faq;
`intro` + `expectations` + `reporting` on conduct.

**The travel page needs a real schema, not just blocks.** `src/pages/Travel.jsx` (548 lines) is
already CMS-wired through `getContent()`, but every call passes a Philadelphia-specific default as
its fallback argument — the venue address, the Google Maps URL, four named hotels with rates and
shuttle flags in a fixed-length array (`Travel.jsx:34-36`), three fixed transit cards naming SEPTA
lines, the airport line, and a specific parking lot address (`:260-368`), a shuttle block with
literal pickup times (`:216-238`), and a hardcoded cross-link paragraph crediting a named reporter's
city guide (`:393`). A partially-seeded deployment would render another event's directions. So the
port strips every fallback and makes the repeating groups variable-length, with the shape seeded
explicitly:

```ts
// cmsPages/travel sections, and the cmsContent fields they seed
travel_header   : page_title, page_subtitle
travel_venue    : venue_name, venue_building, venue_address, venue_maps_url, venue_notes
travel_lodging  : lodging_title, lodging_subtitle, booking_url, booking_disclaimer
                  lodging_items[]  → { name, rate, currency, distance, note, url, shuttle }
travel_transit  : transit_title
                  transit_items[]  → { title, duration, description, links[] {label,url} }
travel_shuttle  : enabled, shuttle_title, shuttle_description,
                  shuttle_times[]  → { label, times }
travel_local    : local_title, local_description, local_links[] { label, url }
travel_help     : help_title, help_description, help_email
```

`lodging_items`, `transit_items`, `shuttle_times`, and `local_links` are ordered block lists in
`cmsContent`, not fixed-arity field sets, so a client with one hotel and five transit options is a
CMS edit rather than a code change. Every seeded value is a synthetic placeholder
(`[Replace] Nearest airport`, `[Replace] Hotel name`, `$0`) carrying `seeded: true`. Sections with
zero non-seeded items render nothing on the public page instead of rendering placeholders, and
`travel_shuttle.enabled` defaults false. The result: an incomplete travel seed produces a sparse page,
never a wrong one.

### 5.4 Placeholder content strategy

Seeded blocks carry realistic-shaped synthetic copy, never another organization's text:

- Text blocks: a one-sentence description of what belongs there, prefixed `[Replace] `.
- Dates and venue: rendered from `config/event`, so they are correct as soon as init runs.
- Stats: zeros with the configured labels.
- Images: the neutral placeholder assets from the `branding/` slots.
- Every seeded block carries `seeded: true` and `seededAt`. The admin CMS shows a "sample content"
  chip on any block still flagged, and the admin dashboard shows a count of remaining seeded blocks.
  Editing a block clears the flag. This is what makes "is this site ready to launch" answerable.

No CJS copy, no real speaker names, no real attendee data, no real sponsor logos — in seeds, in
fixtures, in tests, or in the demo instance. The demo instance is seeded by
`scripts/seed-demo-event.cjs` with a fictional event, fictional speakers, and generated placeholder
headshots.

### 5.5 Legal page templates

`src/pages/PrivacyPolicy.jsx` and `src/pages/TermsOfService.jsx` today are React components with
hardcoded prose naming Montclair State University as operator (three occurrences across the two
files), describing magic-link sign-in (`TermsOfService.jsx:58` — a mechanism v1 does not have), and
naming Eventbrite unconditionally (four occurrences) regardless of what a deployment uses.

v1: both become CMS content pages seeded from provider-aware templates.

- The seed composes the template from `config/event.legal.operatorName`,
  `config/providers.ticketing.provider`, `config/providers.email.provider`, and the configured
  auth methods, so a `manual`-ticketing deployment's privacy policy never mentions a ticketing
  vendor and no deployment ever describes magic links.
- Both pages seed with `config/event.legal.reviewRequired = true`. While that flag is set: a
  persistent admin-panel banner reads "Privacy policy and terms are unreviewed templates", and the
  public pages render a visible notice. An admin clears the flag from Settings after the client's
  counsel signs off.
- The template text is written as a starting point with `[Client legal review required]` markers on
  every clause that depends on jurisdiction, data-retention policy, or a third-party processor list.
  It never asserts another organization's terms.

### 5.6 Manual checklist (deploys cannot automate these)

Printed by `init-event.cjs` and duplicated in `docs/CLIENT_ONBOARDING.md`:

1. Firebase Console → Authentication → Sign-in method → enable **Google**; set the project support
   email and the public-facing app name (both appear in the consent dialog).
2. Firebase Console → Authentication → Settings → Authorized domains → add the client's custom
   domain and the Hosting default domain.
3. Firebase Hosting → add the custom domain, complete DNS verification, wait for certificate issuance.
4. Email provider → add the sender domain, publish SPF, DKIM, and a DMARC policy in the client's DNS,
   then confirm with `scripts/verify-sender-domain.cjs`. **OTP sign-in does not work reliably until
   this passes** — an unauthenticated sender domain is exactly the condition that gets emailed
   sign-in codes quarantined by the institutional mail filters this buyer set runs.
5. Ticketing provider → create the API token. **Webhook registration applies only to providers that
   implement `registerWebhook`** (§3.3 — `eventbrite` today): run
   `scripts/register-ticketing-webhook.cjs` and confirm the delivery in `getTicketingStatus`. For
   `manual`, the equivalent step is uploading the first attendee CSV; for `none`, there is no step.
   This item is satisfiable by every provider, which is the point — a checklist entry a CSV
   deployment can never complete is a checklist entry operators learn to ignore.
6. Google Cloud Console → confirm the Cloud Billing API is enabled for the deploying service account,
   or the functions deploy fails its pre-flight check with a 403 that reads like an unrelated error.
7. First admin signs in and confirms the admin panel loads; a second admin is granted through the UI
   so `config/bootstrap` is not a single point of failure.

---

## 6. Transactional email templates

### 6.1 Storage: code-shipped defaults with Firestore overrides

Chosen over pure-Firestore for three reasons. (1) A fresh deployment must be able to send an OTP code
before seeding completes; a pure-Firestore design has a bootstrap hole exactly where sign-in lives.
(2) A malformed override must not brick sign-in — the renderer falls back to the code default,
logs a `system_errors` row, and fires an `OperatorEvent`. (3) Template changes that matter for
correctness (a new required token) ship with the code that produces the token, so they are reviewed
and tested; client-visible copy changes still happen in the admin panel without a deploy.

```
functions/src/email/templates/
  layout.cjs             # shared HTML wrapper: banner, brand colors, footer
  auth.otp.cjs
  account.welcome.cjs
  ticket.claim_prompt.cjs
  ticket.get_ticket.cjs
  speaker.invite.cjs
  speaker.accepted.cjs
  speaker.confirmation.cjs
  feedback.received.cjs
```

Each default exports
`{ id, subject, html, text, tokens: string[], requiredTokens: string[], storeRendered: boolean }`.
`email_templates/{templateId}` may override `{ subject, html, text }` only — never `tokens`, never
`requiredTokens`, never `storeRendered`.

**Two token checks, not one.** An allowlist alone rejects only unknown tokens, which leaves the worse
failure open: an `auth.otp` override that simply omits `{{code}}` passes every check and renders a
well-formed, useless email — while consuming one of the user's five requests per fifteen minutes, so
the user is progressively locked out by a copy edit. `requiredTokens` closes it. For `auth.otp` it is
`['code']`; for `account.welcome`, `['login_url']`; for the `ticket.*` pair, `[]`, because
`getRegistrationPrompt` may legitimately return a null CTA (§3.5).

`render(templateId, tokenValues)`:

1. Loads the override (cached, 5-minute TTL), falls back to the code default.
2. **Unknown-token check**: every `{{token}}` referenced in the body must appear in `tokens`.
3. **Required-token check**: every entry in `requiredTokens` must be referenced in the body.
4. A failure of either check falls back to the code default for that render, logs a `system_errors`
   row, and fires an `OperatorEvent` — the client's mail keeps working on the shipped copy while the
   operator learns the override is broken. The same two checks run at **save time** in
   `saveEmailTemplate`, which rejects the write with a specific message, so the normal path is that a
   broken override never reaches storage at all.
5. Substitutes tokens (escaping rules below).
6. A missing *value* for a declared token renders as empty string and logs a warning; it does not
   throw, because a half-rendered mail still beats no mail.

**Auth mail gets one more gate at the send boundary.** Independent of template validation,
`auth/otp.cjs` refuses to call `send()` when the rendered `html` and `text` do not both contain the
generated code as a nonempty substring, and returns a 500 rather than a success. A user must never
spend a rate-limit slot on a mail that cannot sign them in.

**Escaping: `_html` tokens are trusted markup, everything else is escaped.** Blanket HTML-escaping
would break `{{postal_address_html}}`, `{{social_links_html}}`, and `{{next_steps_html}}`, which are
markup by definition — the postal block is `<br>`-separated by design in
`functions/helpers.js:76`. The rule is mechanical and enforced by the token name:

- A token whose name ends in `_html` is substituted **raw** into the `html` body, and stripped to
  plain text (tags removed, `<br>`/`</p>` to newlines) for the `text` body.
- Every other token is HTML-escaped in the `html` body and substituted raw into `text`.

**Invariant: no user-supplied value may ever populate an `_html` token.** `_html` values come only
from `config/*` (admin-authored, admin-rules-gated) or from code constants. A speaker's name, an
attendee's organization, a feedback body, a session title — anything a non-admin can write — is
carried by a plain token and escaped. `render()` enforces this structurally: `_html` values are
accepted only from a fixed resolver map in `email/render.cjs` that reads config, never from the
per-send `tokenValues` argument, so a call site cannot pass one even by mistake. A unit test asserts
that every `_html` token in every shipped template resolves through that map.

### 6.2 Token vocabulary

Global tokens available to every template, populated from `config/event`:

`{{event_name}}`, `{{event_short_name}}`, `{{event_tagline}}`, `{{event_dates}}`,
`{{event_timezone}}`, `{{venue_name}}`, `{{venue_address}}`, `{{venue_map_url}}`,
`{{site_url}}`, `{{login_url}}`, `{{schedule_url}}`, `{{support_email}}`,
`{{sender_name}}`, `{{sender_email}}`, `{{operator_name}}`, `{{postal_address_html}}`,
`{{brand_primary}}`, `{{brand_ink}}`, `{{logo_url}}`, `{{social_links_html}}`, `{{current_year}}`.

Per-template tokens:

| Template | Tokens | Phase |
|---|---|---|
| `auth.otp` | `{{code}}`, `{{expiry_minutes}}` | 2 |
| `account.welcome` | `{{first_name}}`, `{{profile_url}}`, `{{next_steps_html}}` | 2 |
| `ticket.claim_prompt` | `{{first_name}}`, `{{ticket_class}}`, `{{cta_label}}`, `{{cta_url}}`, `{{provider_note}}` | 4 |
| `ticket.get_ticket` | `{{first_name}}`, `{{cta_label}}`, `{{cta_url}}`, `{{provider_note}}`, `{{registration_closes}}` | 4 |
| `speaker.invite` | `{{speaker_name}}`, `{{invite_url}}`, `{{invite_type}}`, `{{admin_contact_email}}` | **3** |
| `speaker.accepted` | `{{speaker_name}}`, `{{profile_wizard_url}}`, `{{deadline}}` | **3** |
| `speaker.confirmation` | `{{speaker_name}}`, `{{session_title}}`, `{{session_time}}`, `{{session_room}}` | **3** |
| `feedback.received` | `{{first_name}}`, `{{category}}`, `{{reference_id}}` | 3 |

Two templates deserve specific notes.

`ticket.get_ticket` — the current `buildGetTicketEmailTemplate` is a single literal containing
regional transit directions and named hotels. That content is not a template token; it is CMS
content. The default renders `{{venue_name}}`, `{{venue_address}}`, `{{venue_map_url}}`, and a link
to the seeded travel page (§5.3), where a client edits the specifics.

Both `ticket.*` templates are **provider-parameterized**, not merely tokenized. `{{cta_label}}`,
`{{cta_url}}`, and `{{provider_note}}` are supplied by `TicketingProvider.getRegistrationPrompt()`
(§3.5), not by the config layer, and the template is not rendered at all when the provider returns
`send: false`. The template body must never assume a purchase action — it renders whatever CTA the
provider returns, and omits the button block entirely when `cta_url` is null (the
`action: 'await_approval'` case).

### 6.3 Seeded defaults and phasing

All eight ship as code defaults from the phase in the table. Only the `ticket.*` templates seed
Firestore overrides at init, because those two carry the most client-specific copy.

- **Phase 2** — `auth.otp` and `account.welcome`, plus `layout.cjs` and the global token set. The
  phase-2 milestone is event-neutral emailed-code sign-in, which requires the OTP template, the
  layout wrapper, and a working `EmailProvider` adapter together.
- **Phase 3** — `speaker.invite`, `speaker.accepted`, `speaker.confirmation`, and
  `feedback.received`, tokenized **with their features, not after them**. The three speaker builders
  today hardcode the event name, dates, venue and city details, sender identity, and site URLs; a
  non-CJS deployment cannot exercise the phase-3 invite pipeline at all without them, because
  testing the pipeline means sending wrong-event mail to a real inbox. Template tokenization is part
  of the speaker port's definition of done, not a phase-4 follow-up.
- **Phase 4** — `ticket.get_ticket` and `ticket.claim_prompt`, which cannot be finished before the
  provider that parameterizes them exists.

---

## 7. Theming

### 7.1 Current state

Token centralization is already most of the way there: 16 `brand-*` colors in `tailwind.config.js`
plus eight CSS custom properties in `src/index.css`. The gap is that the values are literals in two
build-time files, and there are **239 raw six-digit hex literals** across `src/**/*.{js,jsx}` (the
decision record estimates ~150; the actual count at this commit is higher — measured with
`grep -rEo "#[0-9a-fA-F]{6}" src --include=*.jsx --include=*.js | wc -l`). Some are legitimate:
`buildSchedulePdf`'s color table needs numeric RGB, and email templates need literal hex because
mail clients do not resolve CSS custom properties. Most are not.

### 7.2 The chain

```
config/theme (Firestore)
   → generate-content.cjs → apps/web/src/generated/theme.css   (build-time :root custom properties)
   → EventConfigProvider → <style id="event-theme-runtime">     (runtime override, same properties)
   → tailwind.config.js maps brand-* utilities to var(--brand-*)
```

`tailwind.config.js` stops carrying hex:

```js
colors: {
  'brand-primary':    'rgb(var(--brand-primary-rgb) / <alpha-value>)',
  'brand-primary-dark':  'rgb(var(--brand-primary-dark-rgb) / <alpha-value>)',
  'brand-accent':     'rgb(var(--brand-accent-rgb) / <alpha-value>)',
  'brand-surface':    'rgb(var(--brand-surface-rgb) / <alpha-value>)',
  'brand-surface-alt':'rgb(var(--brand-surface-alt-rgb) / <alpha-value>)',
  'brand-ink':        'rgb(var(--brand-ink-rgb) / <alpha-value>)',
  'brand-ink-muted':  'rgb(var(--brand-ink-muted-rgb) / <alpha-value>)',
  // ... plus semantic tokens: success, warning, danger, highlight, keynote
}
```

The `<alpha-value>` form is what keeps `bg-brand-primary/10` working, which the current palette
supports only because the values are literal hex. Values are stored as space-separated RGB triples
in the custom properties for that reason.

`config/theme`:

```ts
{
  colors: {
    primary: '#2A9D8F', primaryDark: '#1E7268', primaryLight: '#5FBFB3',
    accent: '#C84B31', surface: '#F5F0E6', surfaceAlt: '#EDE8DC',
    ink: '#2C3E50', inkMuted: '#5C6B7A',
    success: '#166534', warning: '#D97706', danger: '#CA3553', highlight: '#D4A017'
  },
  fonts: { heading: 'serif-editorial', body: 'sans-humanist', accent: 'script-casual' },
  texture: 'paper' | 'flat',           // controls the bg-paper / bg-parchment treatments
  radius: 'sharp' | 'soft' | 'round',
  logos: {                             // Storage paths under branding/
    primary: string, mark: string, footer: string,
    ogDefault: string, favicon: string
  }
}
```

### 7.3 Admin surface

A Branding tab in the admin panel edits `config/theme` with live preview (the runtime style element
updates on change) and uploads into the branding slots. The admin panel's own palette
(`admin-*` tokens) stays fixed — it is operator/admin tooling, not client-facing surface, and
letting a client theme it is a support liability.

### 7.4 Fonts

Font families are chosen from a **bundled allowlist** of three-to-five self-hosted sets shipped as
woff2 in `apps/web/public/fonts`, not from arbitrary remote URLs. Reasons: no third-party request on
every page load (a real objection from institutional clients), no CSP exception, and no dependency on
a font CDN's availability. `config/theme.fonts` names a set id; `theme.css` emits the matching
`@font-face` block and `--font-heading` / `--font-body` / `--font-accent` properties. Adding a font
set is a PR — a deliberate, small, reviewable one.

### 7.5 What stays build-time

The Tailwind utility class set (Tailwind 3 generates from source scanning; a color that no source
file references is not emitted, which is exactly why the palette must be custom properties rather
than dynamic class names), the bundled font files, the texture SVG/PNG assets, and the block-type
registry. Everything a client changes is a Firestore write.

### 7.6 The hex sweep

Porting a file includes converting its hex literals to tokens. Enforcement: an ESLint rule
(`no-restricted-syntax` matching `/#[0-9a-fA-F]{3,8}\b/` in JSX attribute values and string
literals) with an allowlist of exactly three paths — `functions/src/email/templates/**` (mail clients
need literal hex), `functions/src/schedule/pdf.cjs` (jsPDF needs numeric RGB, and even there the
values come from config), and `apps/web/src/generated/theme.css`. `npm run lint` runs in CI, so a
new hex literal fails a PR.

---

## 8. Deploy pipeline

### 8.1 Two workflows, cleanly split

`ci.yml` — runs on every push and pull request, including forks. **No secrets, no Firebase project.**

```
lint            → npm run lint (web + functions + tests)
unit:web        → vitest run --workspace apps/web
unit:functions  → vitest run --workspace functions
rules           → firebase emulators:exec --only firestore,storage 'vitest run --config vitest.rules.config.js'
e2e             → firebase emulators:exec --only firestore,storage,auth,functions 'playwright test'
build           → npm run build   (against the committed synthetic generated/ files)
```

The build step is credential-free specifically because `apps/web/src/generated/*` is committed with
demo content (§2.4) and `VITE_FIREBASE_*` values are non-secret client config with CI-only dummy
values. A fork PR runs every check.

**`deploy.yml` is a caller plus a reusable workflow**, because a single-job workflow cannot bind an
environment for both trigger shapes. `${{ inputs.client }}` is populated only on
`workflow_dispatch`; a push-triggered run for `AUTO_DEPLOY_ENVIRONMENTS` would evaluate it to the
empty string and bind no environment at all, silently running without the secrets it needs. The
split:

```yaml
# deploy.yml — resolves WHICH clients, then fans out
on:
  workflow_dispatch:
    inputs:
      client:      { required: true, type: string }   # one environment name
      provision:   { required: false, type: boolean, default: false }
  push:
    branches: [main]

jobs:
  resolve:                          # emits a JSON array of environment names
    runs-on: ubuntu-latest
    outputs: { clients: "${{ steps.pick.outputs.clients }}" }
    steps:
      - id: pick
        env:
          EVENT_NAME: "${{ github.event_name }}"
          DISPATCH_CLIENT: "${{ inputs.client }}"
          AUTO: "${{ vars.AUTO_DEPLOY_ENVIRONMENTS }}"   # comma-separated, may be empty
        run: |
          if [ "$EVENT_NAME" = "workflow_dispatch" ]; then
            CLIENTS=$(jq -cn --arg c "$DISPATCH_CLIENT" '[$c]')
          else
            CLIENTS=$(jq -cn --arg a "$AUTO" '$a | split(",") | map(gsub("^\\s+|\\s+$";"")) | map(select(length > 0))')
          fi
          echo "clients=$CLIENTS" >> "$GITHUB_OUTPUT"

  deploy:
    needs: resolve
    if: needs.resolve.outputs.clients != '[]'
    strategy:
      fail-fast: false               # one client's failure must not cancel the others
      max-parallel: 1                # deploys are serialized, as today's concurrency group is
      matrix: { client: "${{ fromJSON(needs.resolve.outputs.clients) }}" }
    uses: ./.github/workflows/deploy-client.yml
    with:
      client:    "${{ matrix.client }}"
      provision: "${{ github.event_name == 'workflow_dispatch' && inputs.provision }}"
    secrets: inherit
```

`deploy-client.yml` is `workflow_call`-only, and **every** job in it declares
`environment: ${{ inputs.client }}` — which resolves correctly for both trigger shapes because the
value arrives as a workflow input, not as `inputs.client` on the outer event. Jobs, in order:

```
guard        → refuse to run when the ref is from a fork
shared       → pack packages/shared into functions/ (§1.1) — prerequisite of every functions deploy
provision    → deploy firestore:rules, firestore:indexes, storage   ← indexes + storage rules are
                                                                       deployed by CI for the first time
functions    → deploy functions            (see the run condition below)
content      → generate-content.cjs --out "$RUNNER_TEMP/generated" (needs FIREBASE_SERVICE_ACCOUNT)
build        → vite build with the environment's VITE_* vars, GENERATED_DIR="$RUNNER_TEMP/generated"
smoke        → OPTIONS preflight against the required endpoint list, from
                https://${EVENT_FIREBASE_REGION}-${EVENT_FIREBASE_PROJECT_ID}.cloudfunctions.net
hosting      → deploy hosting
post         → deploy updatesMeta after hosting (self-fetches the live HTML template)
```

**The functions job runs unconditionally on dispatch, and on a paths filter only for push runs:**

```yaml
if: >-
  github.event_name == 'workflow_dispatch' ||
  needs.changes.outputs.functions == 'true'
```

A dispatch is how a client is provisioned (§5.1 step 3), and a newly created project has no
functions at all. Gating that run on "did this commit touch `functions/**`" means provisioning at any
revision where it did not — the common case, since provisioning happens at whatever `main` currently
is — deploys zero functions into an empty project, and the bootstrap then fails at first sign-in with
no obvious cause. Push runs keep the filter, which is what protects the deploy quota.

**The paths filter covers every input to the functions artifact**, not just `functions/**`:

```yaml
filters: |
  functions:
    - 'functions/**'
    - 'packages/shared/**'      # packed into functions/ at deploy time (§1.1)
    - 'package-lock.json'       # workspace resolution changes what gets installed
    - '.github/workflows/deploy-client.yml'
```

Omitting `packages/shared/**` would ship a functions bundle carrying a stale copy of the shared
config, time, and registration logic — the exact modules whose whole purpose is that both runtimes
agree.

Everything that is a hardcoded probe URL, project id, or function-name list in the current
`deploy.yml` becomes an environment variable or is derived. The smoke test's required-function list
lives in `functions/src/required-endpoints.json` so it is reviewed with the code that adds an
endpoint.

`continue-on-error` appears on no step. The current workflow carries it on the functions bundle
deploy, which is how a Cloud Billing API 403 went unnoticed for weeks.

### 8.2 Repo variables and secrets

Per §2.1. Repository-level variables: `AUTO_DEPLOY_ENVIRONMENTS` only. Everything else is
environment-scoped. Full v1 secret surface per environment:

| Secret | Required when |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | always |
| `EMAIL_PROVIDER_API_KEY` | provider = `postmark` |
| `EMAIL_WEBHOOK_BASIC_AUTH` | provider = `postmark` and delivery-event ingest enabled |
| `EMAIL_WEBHOOK_URL`, `EMAIL_WEBHOOK_SECRET` | provider = `webhook` |
| `TICKETING_API_TOKEN` | ticketing provider ≠ `none` |
| `TICKETING_WEBHOOK_SECRET` | provider implements `registerWebhook` (`eventbrite`) — **not** for `manual` |
| `OPERATOR_WEBHOOK_URL`, `OPERATOR_WEBHOOK_SECRET` | notifier = `webhook` |

The two ticketing rows are separately gated on purpose. `manual` needs no token in practice and
never a webhook secret; a checklist that demands both for "ticketing enabled" produces placeholder
secrets, and a placeholder secret in a secret store is worse than an absent one because it looks
provisioned.

Absent by design: broadcast unsubscribe HMAC, Telegram bot token and chat id, Slack's four,
Airtable key, GitHub PAT, deploy secret.

### 8.3 Indexes and storage rules

`firestore.indexes.json` and `storage.rules` are deployed by the `provision` job on every deploy.
Neither is deployed by CI today — both are undocumented manual steps, which means a new composite
index or a rules tightening reaches production only when someone remembers.

### 8.4 CMS publish redesign

Current flow: `cmsPublish` (`functions/index.js:5386`) writes a `cmsPublishQueue` doc, then POSTs
`repository_dispatch` to `api.github.com/repos/jamditis/cjs2026/dispatches` with a personal access
token stored as `GITHUB_PAT`; the workflow's success/failure/cancelled steps write status back.
Under deploy-per-client with a public repo, this is unshippable: it hardcodes one repo, it needs a
long-lived PAT with write scope on that repo, and it would let a client admin trigger workflow runs
in the shared repository.

**Replacement: publish is a Firestore revision copy, not a deploy.** The frontend reads content from
Firestore at runtime with the generated static files as the first-paint snapshot (§2.4), so publish
never needs a build. But it cannot be a boolean flip on a single doc, for a reason worth stating
plainly: a `published: true` flag on the live doc means every keystroke an editor saves to an
already-published doc is immediately visible to anonymous subscribers, and clearing the flag to hide
the edit unpublishes live content instead. Editing and publishing must touch different documents.

**Two-revision model.** Every publishable collection `C` — `cmsContent`, `cmsSchedule`,
`cmsOrganizations`, `cmsTimeline`, `cmsUpdates`, `cmsPages` — gets a draft sibling `C_drafts`:

```ts
// C/{docId} — the PUBLISHED revision. Anonymously readable. Content fields only.
{ ...contentFields, visible: boolean, revision: number,
  publishedAt: Timestamp, publishedBy: string }

// C_drafts/{docId} — the DRAFT revision. Admin-readable only. Never anonymously readable.
{ ...contentFields, visible: boolean,
  status: 'dirty' | 'clean',       // 'dirty' = differs from the published revision
  basedOnRevision: number | null,  // published revision this draft was forked from
  updatedAt: Timestamp, updatedBy: string }
```

A parallel collection rather than a `draft` map field on the live doc, because **Firestore rules
cannot project fields**: any field on an anonymously readable doc is public, which is the exact
lesson the materials embargo already taught. Parallel top-level collections rather than a
`C/{docId}/draft/current` subcollection, because the admin CMS needs a plain "list everything
unpublished" query (`C_drafts.where('status','==','dirty')`) rather than a collection-group index.

Flow:

1. **Edit.** `cmsCreateContent` / `cmsUpdateContent` / `cmsSavePage` write to `C_drafts/{docId}`
   only, setting `status: 'dirty'`. They never touch `C/{docId}`. A doc that has never been
   published has a draft row and no live row; anonymous reads simply find nothing.
2. **Preview.** The admin CMS reads `C_drafts` directly. Public pages accept `?preview=1`, which
   switches `ContentProvider`'s read source to `C_drafts`; the rules deny it for anyone who is not an
   admin, so the query parameter is a convenience, not the control.
3. **Publish.** `cmsPublish` commits, per document, one atomic batch: copy the draft's content fields
   into `C/{docId}` with `revision = published.revision + 1`, `publishedAt`, `publishedBy`; set
   `C_drafts/{docId}.status = 'clean'` and `basedOnRevision` to the new revision; append a
   `cmsVersionHistory` entry. A multi-doc publish chunks at 400 writes per batch and records each
   committed chunk on the `cmsPublishQueue` row, so a partial publish is resumable and observable
   rather than silently half-applied.
4. **Unpublish** is a separate explicit action that sets `C/{docId}.visible = false` (or deletes the
   live doc). It is never a side effect of editing. **Delete** removes both docs in one batch.

**Rules consequence.** Content collections become anonymously readable and must gate on visibility;
draft collections are never anonymously readable at all:

```
match /cmsContent/{docId} {
  allow read: if resource.data.visible == true;
  allow read: if isAdmin() || isSuperAdmin();
  allow write: if false;                       // via cmsPublish (Admin SDK)
}
match /cmsContent_drafts/{docId} {
  allow read: if isAdmin() || isSuperAdmin();
  allow write: if false;                       // via cmsUpdateContent (Admin SDK)
}
```

`tests/firestore.rules.test.js` pins, per collection: anonymous read of a `visible: false` live doc
denied; anonymous read of any draft doc denied; authenticated non-admin read of any draft doc denied;
admin read of both allowed. Because every field on a live doc is public, any field that must stay
private — reviewer notes, internal flags, unpublished scheduling — belongs on the draft doc or a
server-only doc, never on the published one.

**Snapshot refresh, phased.** The static snapshot still matters for first paint and for crawlers that
do not execute JavaScript. Per §10 Q7 the Cloud Run publisher is deferred, so:

- **Phases 2–4:** an `onSchedule` function (`maintenance/snapshotRefresh.cjs`, nightly) regenerates
  the snapshot from the **published** collections and writes it to Storage for the next deploy to
  pick up. It ships with the normal functions deploy — no container build, no extra IAM, nothing for
  `deploy.yml` to provision. Between refreshes the runtime read path keeps human visitors current;
  only crawler first-paint lags, by at most a day.
- **Phase 5 deliverable:** the `site-publisher` Cloud Run job in the client's own project, running
  `generate-content.cjs` → `vite build` → `firebase deploy --only hosting` under the project's own
  service account and invoked by `cmsPublish` through the Admin SDK. Landing it means adding a
  `publisher` job to `deploy.yml` that builds and pushes the image, creates or updates the Cloud Run
  job, and grants the functions runtime service account the `run.invoker` role on it. That
  provisioning work is named here so it is not discovered during phase 5.

`cmsPublishQueue` keeps its status field, and the `cancelled()`-state handling lesson ports as a
job-level timeout that marks stranded rows `failed` — but now the reconciler is a single
`maintenance/cleanup.cjs` sweep rather than three workflow steps.

### 8.5 Storage rules hardening (mandatory)

Two real holes in `storage.rules` today:

- `cms-images/{allPaths=**}` allows write to **any authenticated user**. The rule's own comment
  states that admin validation happens in the React layer. That is not an authorization boundary —
  any signed-in attendee can write into the CMS image namespace with a direct SDK call.
- `profile-photos/{userId}/{allPaths=**}` allows write to any authenticated user with **no
  `request.auth.uid == userId` check**, so any signed-in user can overwrite any other user's photo.
  (`speaker-photos/{userId}` does have the owner check; `profile-photos` does not.)

v1 rules:

```
match /profile-photos/{userId}/{allPaths=**} {
  allow read: if true;
  allow write: if request.auth != null && request.auth.uid == userId
               && request.resource.size < 2 * 1024 * 1024
               && request.resource.contentType.matches('image/(png|jpeg|webp)');
}
match /speaker-photos/{speakerId}/{allPaths=**} {
  allow read: if true;
  allow write: if false;              // via updateSpeakerProfile (Admin SDK)
}
match /cms-images/{allPaths=**}  { allow read: if true;  allow write, delete: if false; }
match /branding/{allPaths=**}    { allow read: if true;  allow write, delete: if false; }
match /session-materials/{sessionId}/{allPaths=**} { allow read, write: if false; }
match /exports/{allPaths=**}     { allow read: if true;  allow write: if false; }  // schedule PDF
```

Every admin-authored upload path becomes server-authorized: `mediaUpload` verifies admin (or, for
speaker headshots, ownership), then either writes through the Admin SDK or returns a short-lived
resumable upload URL scoped to one object path. The role check moves from a React conditional to a
verified ID token. `broadcast-images`, `sponsor-logos`, `video-logos`, and
`admin-request-screenshots` do not exist in v1.

### 8.6 generate-content credentials, and the hygiene gate

`generate-content.cjs` needs Admin SDK credentials, which fork PRs must not have. The `content` job
therefore lives in `deploy.yml` (environment-scoped secrets) and `ci.yml` never runs it, building
instead against the committed synthetic snapshot.

**Deploy-time generation never writes into the working tree.** `generate-content.cjs --out <dir>`
writes to an out-of-tree directory (`$RUNNER_TEMP/generated`), and `vite.config.js` resolves the
`@generated` import alias to `process.env.GENERATED_DIR` when set, falling back to
`apps/web/src/generated` otherwise. The committed files are untouched by every deploy. This matters
for more than tidiness: if the deploy job overwrote them in place, a client's real content would sit
in the tree of a public repo for the length of the run, one `git add -A` away from being committed.

**The hygiene gate runs in `ci.yml`, not `deploy.yml`.** Comparing a client's regenerated files
against the committed demo snapshot is not a drift check — they always differ on a real deploy, so
the gate would block every deploy, and it would *pass* precisely in the case it is meant to catch
(the committed files already containing that client's data). Instead, `ci.yml` runs
`generate-content.cjs` against the **synthetic demo fixture** — a checked-in Firestore export loaded
into the emulator, no credentials — and fails if the output differs from
`apps/web/src/generated/*`. That detects both a stale snapshot and a snapshot that has been
overwritten with anything other than demo data, and it runs on every PR including forks.

---

## 9. Porting map

Legend: **as-is** = copy with renames and import-path changes only. **changed** = port with the named
modifications. **rewrite** = new implementation against the same requirement. **drop** = the layer
exists only to compensate for infrastructure v1 does not have.

| v1 feature | Source in `cjs2026` | Destination | Disposition |
|---|---|---|---|
| CORS + auth helpers | `functions/index.js:38-200` | `functions/src/core/{http,auth}.cjs` | changed — origins from `EVENT_ALLOWED_ORIGINS` |
| Admin bootstrap check | `functions/helpers.js:160-174` + 3 frontend copies | `functions/src/core/auth.cjs` reading `config/bootstrap` | rewrite — server-only, single source; frontend gets admin status from its own profile doc, never from an email list in the bundle |
| Email send | `sendEmailViaNotify` (`functions/index.js:531-654`) | `functions/src/email/send.cjs` | rewrite on `EmailProvider` (§3.1); retry-on-observed-status-only and body-cap logic port as-is |
| Email claim/rollback helpers | `shouldRollbackEmailClaim` + 4 claim-flag helpers (`:487-529`, `:14994+`) | — | **drop on port** — ticketing dedup replaces it |
| Broadcast suite | 13 exports + 4 collections | — | not ported |
| Operator alerts | 16 `/alert`, `/alert-action`, `/cjs-error`, Telegram call sites | `functions/src/notify/` | rewrite (§3.2) |
| `logError` + `system_errors` | `functions/index.js:280-415` | `functions/src/telemetry/systemErrors.cjs` | changed — alert path via notifier; persist-fail inline alert retained (a trigger cannot fire for a doc that never committed) |
| `onSystemErrorCreated` | `:18426+` | `functions/src/telemetry/systemErrors.cjs` | changed — posts an `OperatorEvent`, keeps the `alertedAt` idempotency gate |
| `logClientError` + benign filter | `functions/index.js`, `src/main.jsx` | `functions/src/telemetry/`, `apps/web/src/main.jsx` | as-is — the SafeLinks and stale-bundle patterns are deployment-independent |
| OTP send/verify | `sendCustomOtpCode` (`:11944`), `verifyOtpCode`, `buildOtpEmailTemplate` (`:11869`), `generateOtpCode` | `functions/src/auth/otp.cjs` | changed — template tokenized, challenge store renamed, `kind` discriminator no longer needed (only one kind) but the field is kept for forward compatibility |
| OTP shared infra | `isRateLimited` / `recordMagicLinkRequest` (`:10079-10124`), `magic_links`, `cleanupExpiredMagicLinks` | `functions/src/auth/challenges.cjs`, `auth_challenges`, `auth_rate_limits` | as-is with renames — explicitly retained per the decision record |
| Magic links | `sendCustomMagicLink`, `verifyMagicLink`, `buildMagicLinkEmailTemplate`, `/auth/verify` route, `AuthVerify.jsx` | — | not ported |
| Login page | `src/pages/Login.jsx` | `apps/web/src/pages/Login.jsx` | changed — Google + OTP only; the magic-link branch, its inbox screen, and the `sendCustomMagicLink` fetch at `Login.jsx:236` go |
| Speaker acceptance | `src/pages/SpeakerAccept.jsx` (calls `sendCustomMagicLink` at `:168`) | `apps/web/src/pages/SpeakerAccept.jsx` | rewrite on OTP — token validation unchanged, email sign-in path swapped to request-code/enter-code |
| Speaker invite pipeline | `sendSpeakerInvite`, `validateSpeakerInvite`, `acceptSpeakerInvite`, `resendSpeakerInvite`, `cancelSpeakerInvite`, `getSpeakerInvites` | `functions/src/speakers/invites.cjs` | changed — writes `speakers/{id}` as canonical, templates tokenized |
| Speaker profile wizard | `src/pages/SpeakerProfile.jsx` (1,590 lines), `updateSpeakerProfile` | `apps/web/src/pages/SpeakerProfile.jsx`, `functions/src/speakers/profile.cjs` | changed — writes `speakers/{id}`; stipend/diversity steps become config-toggled |
| Speaker tri-sync | `syncSessionInfoToSpeakers` (`:7041`), `reverseJoinSpeakerToSessions` (`:7157`), `onCmsSpeakerWritten`, `syncSessionSpeakerIds`, `cleanupRevokedInviteSessionIds`, `detectSpeakerSoTDrift` (`:19035`), 8 scripts | — | **drop on port** — replaced by a foreign key (§4.3) |
| Speaker projection | (new) | `functions/src/speakers/projection.cjs` | rewrite — one-way `speakers` → `speakers_public` |
| Speaker delete / unlink | scattered across `cmsDeleteSpeaker` + `cleanupRevokedInviteSessionIds` + 8 reconciliation scripts | `functions/src/speakers/lifecycle.cjs` (`deleteSpeaker`) | rewrite — one transaction unlinks `speakerIds`, clears `users.speakerId`, deletes the projection and the record; soft-delete fallback above the transaction limit (§4.3) |
| `users_public` projection | `syncUserToUsersPublic` | `functions/src/users/projection.cjs` | as-is — good design, plus badge-set validation (§4.5) |
| Schedule page | `src/pages/Schedule.jsx` (1,685 lines) | `apps/web/src/pages/Schedule.jsx` | changed — day grouping from `config/event.days[]`; **Google Calendar sync removed** |
| Google Calendar sync | `handleExportMyScheduleGoogle` + `calendar.events` scope (`Schedule.jsx:764-800`), `syncSessionToGoogleCalendar`, the trust-bridge modal | — | **removed** — per-client OAuth consent-screen verification does not scale under deploy-per-client |
| ICS export + calendar links | `generateICS` / `downloadICS` (`Schedule.jsx:762`), `src/utils/calendarUtils.js` | `apps/web/src/utils/calendar.js` | changed — timezone and location from config; add Google/Outlook "add to calendar" URL builders as the replacement for direct sync |
| Session time helpers | `src/utils/calendarUtils.js` + its duplicate `functions/helpers.js:215-308` | `packages/shared/src/time.cjs` | rewrite — one implementation, config timezone, day-id keyed; the strict-ISO fail-closed gate is preserved verbatim in behavior |
| `SessionCard` | `src/components/SessionCard.jsx` | `apps/web/src/components/SessionCard.jsx` | changed — the convergence point for every cut feature; bookmark/reaction/materials pills become feature-flag conditional |
| Bookmarks | `bookmarkSession`, `sessionBookmarks`, `SessionBookmarkContext` | `functions/src/schedule/bookmarks.cjs` | changed — split out of the shared backend block it occupies with `reactToSession`; access gate via `hasAttendeeAccess` |
| Session reactions | `reactToSession`, `sessionReactions`, `sessionReactionService` | `functions/src/schedule/reactions.cjs` | changed — same split |
| Schedule PDF | `buildSchedulePdf` (`functions/index.js:13521`), `generateSchedulePDF` | `functions/src/schedule/pdf.cjs` | changed — header title/subtitle from `config/event`, colors from `config/theme`, **arbitrary day grouping** from `config/event.days[]` replacing the fixed two-bucket structure; `fitText` binary search and per-block font measurement port as-is |
| Session materials | 11 exports across 4 collections | `functions/src/materials/` | changed — 2 collections (§4.4); `session_material_urls` and `session_material_counts` drop; `reconcileSessionMaterialCounts` drops |
| Materials embargo | `getSessionMaterialUrl` gate + `isSessionPast` | `functions/src/materials/access.cjs` | as-is in behavior, config-driven in inputs |
| Media library | `cmsUploadImage`, `cmsDeleteImage`, `cmsUpdateMediaMetadata`, `scanMediaUsage`, `MediaLibrary.jsx` + 3 modals | `functions/src/media/`, `apps/web/src/components/media/` | changed — server-authorized uploads, hardened Storage rules (§8.5) |
| `backfillMediaAssets` | `functions/index.js` | — | not ported |
| CMS content CRUD | `cmsCreateContent`, `cmsUpdateContent`, `cmsDeleteContent`, `cmsGetVersionHistory` | `functions/src/cms/` | changed — chat-lifecycle hooks and Airtable sync stripped out of the create/update/delete bodies |
| CMS publish | `cmsPublish` (`:5386`) + `repository_dispatch` | `functions/src/cms/publish.cjs` | rewrite (§8.4) |
| `PAGE_CONFIGS` | `src/cms/cmsArchitecture.js:237-693` | `cmsPages` collection + `cmsSavePage`/`cmsDeletePage` | rewrite (§5.2) |
| `BLOCK_TYPES` + helpers | `src/cms/cmsArchitecture.js:23-236,694-793` | `apps/web/src/cms/blockTypes.js` | as-is — helper signatures take pages as input instead of closing over the constant |
| Content generation | `scripts/generate-from-firestore.cjs` | `scripts/generate-content.cjs` | changed — adds config + theme output; uses `lib/firebase-init.cjs` instead of its own inline `initFirebase()`; `--out <dir>` so deploy-time generation never writes into the tree (§8.6) |
| Shared-code packaging | (none — `functions/helpers.js` duplicates `src/utils/*` by hand) | `scripts/prepare-functions.cjs` + `firebase.json` predeploy | rewrite (new) — packs `packages/shared` into `functions/vendor/shared.tgz` so the workspace sibling actually reaches the Functions runtime (§1.1) |
| `firebase-init` helper | `scripts/lib/firebase-init.cjs` | same path | changed — project id and bucket from env, not constants |
| Eventbrite integration | 7 exports, `claimAttendeeSlot`, order queue, 2 collections | `functions/src/ticketing/providers/eventbrite.cjs` + shared `ticketing/` core | rewrite behind `TicketingProvider` (§3.3) |
| Manual/CSV ticketing | — | `functions/src/ticketing/providers/manual.cjs` | rewrite (new) |
| Registration gating | `canBookmarkSessions` (`UserProfileContext.jsx:358`), `useRegisteredUsers.js:32`, `AttendeesTab` status writes | `packages/shared/src/registration.cjs` | rewrite — one state machine, one predicate (§3.4) |
| New-signup registration email | `notifyNewUserSignup` (`:9973`) → `sendGetTicketEmail` (`:15395`), `buildGetTicketEmailTemplate` (`:15090`) | `functions/src/users/lifecycle.cjs` + `ticketing/providers/*` | rewrite — the unconditional "buy on Eventbrite" send becomes `TicketingProvider.getRegistrationPrompt()`, which owns the CTA label, URL, action, and the decision to suppress the message (§3.5); the speaker/already-ticketed skips move out of the mail helper into the returned decision |
| Speaker email templates | `buildSpeakerInviteEmailTemplate` (`:15525`), `buildSpeakerAcceptanceEmailTemplate` (`:15759`), `buildSpeakerConfirmationEmail` (`:16940`) | `functions/src/email/templates/speaker.*.cjs` | changed — tokenized in **phase 3, with the speaker port**, not phase 4; all three hardcode event name, dates, venue/city, sender, and site URLs today, so the invite pipeline cannot be exercised on a non-CJS deployment until they are tokenized |
| Attendee directory + profiles | `Attendees.jsx`, `AttendeeProfile.jsx`, `users_public` | `apps/web/src/pages/` | as-is |
| Badges | `useBadgeManager`, `src/constants/badgeData.js` | `apps/web/src/hooks/useBadgeManager.js`, `config/badges` | changed — `addCustomBadge`/`removeCustomBadge` and `users.customBadges` cut; definitions from config |
| Sponsors | `Sponsors.jsx`, `SponsorPage.jsx`, `cmsOrganizations` | `apps/web/src/pages/` | as-is |
| Updates + SSR OG | `Updates.jsx`, `UpdateDetail.jsx`, `updatesMeta` | `apps/web/src/pages/`, `functions/src/public/og.cjs` | changed — meta values from config; the self-fetch-template + post-hosting-deploy ordering ports as-is |
| Live updates card | `live_updates`, `useLiveUpdates`, dashboard card | `functions/src/admin/liveUpdates.cjs`, `apps/web/src/components/` | changed — admin form replaces Slack ingestion; `slackPushWebhook` and its 4 secrets not ported |
| Feedback inbox | `submitBugReport`, `bug_reports`, feedback modal | `functions/src/admin/feedback.cjs`, `feedback` collection | changed — renamed; honeypot + time-gate + IP rate limit port as-is; Telegram triage does not |
| Admin shell + tabs | `Admin.jsx` + 11 tab components | `apps/web/src/pages/Admin.jsx` + tabs | changed — `InvoicesTab` (2,352 lines), `BroadcastTab` (1,733), `SpeakerChatTab` (557) not ported; new Branding tab; `MaterialsTab` (2,441) trimmed to the 2-collection model |
| Admin roles + stats | `grantAdminRole`, `revokeAdminRole`, `getAdminUsers`, `getSystemStats`, `exportAttendees` | `functions/src/admin/` | changed — stats query the v1 collection set |
| Runtime config writes | `admin_settings` written directly from `SettingsTab.jsx` / `useAdminSettings` via the client SDK | `functions/src/admin/config.cjs` (`updateEventConfig`, `updateFeatures`, `updateTheme`, `updateBadges`) | rewrite — `config/*` is client-unwritable, so the Settings, Branding, badge, and feature-toggle tabs all post to validated endpoints that reject deploy-mirrored read-only fields (§1.3) |
| Legal pages | `PrivacyPolicy.jsx`, `TermsOfService.jsx` | `cmsContent` seeded templates | rewrite (§5.5) |
| Travel / venue page | `src/pages/Travel.jsx` (548 lines) | `apps/web/src/pages/Travel.jsx` + `cmsPages/travel` | **changed** — every hardcoded Philadelphia fallback stripped (venue address `:29`, maps URL `:30`, Temple booking URL `:31`, the 4-hotel fixed array `:34-36`, the 3 SEPTA/PHL/parking transit cards `:260-368`, literal shuttle times `:216-238`, the named city-guide cross-link `:393`); fixed-arity groups become variable-length CMS lists; sections with no client content render nothing (§5.3) |
| `Local.jsx`, `CampusMap.jsx` | ~1,900 lines | — | not ported — city-guide and campus-map content is covered by the `travel_local` section of the travel page |
| Video generator, Remotion, `imageProxy` | ~13,900 lines | — | not ported |
| Invoices | 2,352 + backend | — | not ported |
| Airtable sync | 4 exports + 6 scripts + `escapeAirtableFormula` | — | not ported |
| Social layer | `posts`, `onPostCreated`, `deletePostWithAudit`, notifications | — | not ported |
| Speaker chat / Q&A | 5 exports + lifecycle hooks | — | not ported |
| Drift detectors | `detectSyncDrift`, `detectSpeakerSoTDrift`, `reconcileStaleStateMachines`, `reconcileSessionMaterialCounts` | — | **drop on port** — each compensates for a denormalization or a queue v1 does not have |
| `cleanupStaleData` | `functions/index.js` | `functions/src/maintenance/cleanup.cjs` | changed — v1 collection set; Cloud Storage backup-before-delete ports as-is |
| Rules tests | `tests/firestore.rules.test.js`, `tests/storage.rules.test.js` | same paths | changed — new collection set, plus new tests for the two storage holes closed in §8.5 |
| Functions tests | `functions/index.test.js` (16,805 lines), `functions/helpers.test.js` | `functions/src/**/*.test.cjs` | changed — split per module; literal-string assertions rewritten against a fixture config |
| Frontend tests | ~40 colocated `*.test.jsx` | alongside their components | changed — CJS fixtures replaced with synthetic ones |
| E2E | `e2e/auth.spec.js`, `e2e/speaker-registration.spec.js` | `tests/e2e/` | changed — run against emulators in CI (they currently require a live project) |

---

## 10. Open questions — all resolved 2026-08-16

Every recommendation below was adopted as written, with three noted specifics: (Q1) runtime content
reads are adopted, and the §8.4 rules gate is a mandatory part of the change — external review then
showed that a single published flag on the live doc exposes mid-edit drafts to anonymous readers, so
§8.4 now specifies a two-revision model (separate draft collections, atomic publish copy) with the
rules gate applied to both surfaces;
(Q3) Postmark runs as one operator account with a message stream per client — sender domains still
verified per client, API key still stored per environment; (Q5) the four-value vocabulary ships with
no check-in state in v1 — day-of check-in, if a client requests it, is a later boolean field, not a
fifth status. (Q10 remains procedurally open only in the sense that the ownership conversation with
counsel has to happen; the ruling — scaffold private, first public push gates on the resolved
LICENSE copyright line — is adopted.)

1. **Runtime content reads vs. static-snapshot-only.** §2.4 and §8.4 propose that the frontend read
   CMS collections at runtime with the generated static files as the first-paint snapshot, which is
   what lets "publish" be a flag flip instead of a deploy. This is a change from the current
   build-time-only model and adds Firestore reads per visitor. **Recommendation: adopt it.** It
   removes the PAT, removes the cross-repo trust, removes the publish-queue stranding class, and
   makes CI credential-free. Read cost at event scale is negligible.

2. **Deployment configuration lives in GitHub Environments on the public repo.** The alternative is a
   private per-client deployment repo that calls a reusable workflow. **Recommendation: Environments
   on the public repo for v1** — environment secrets are unavailable to forks, and one repo means one
   code line for every client. Revisit if a client ever requires that their config not exist in the
   operator's shared repo at all.

3. **Postmark as the reference adapter.** §3.1 justifies it over SES on per-client onboarding cost.
   **Recommendation: confirm Postmark**, and confirm whether the operator will resell under one
   Postmark account with per-client message streams, or provision a Postmark account per client. The
   answer changes whether `EMAIL_PROVIDER_API_KEY` is one secret reused across environments or one
   per environment (it should be per environment either way, but the billing story differs).

4. **`speakers` as canonical, with `users.speakerId` as the link.** The alternative is making
   `users/{uid}` canonical and treating speakers as a role. **Recommendation: `speakers` canonical**,
   because a speaker frequently exists before any account does (invite-first flow) and sometimes never
   creates one, whereas the reverse is not true. This is the single largest schema divergence from the
   current model and the one most expensive to change later.

5. **Registration status vocabulary.** §3.4 proposes four values (`pending`, `ticketed`, `approved`,
   `revoked`), collapsing today's five (`pending`, `registered`, `confirmed`, `approved`,
   `ticket_only`). **Recommendation: adopt the four.** Confirm that no client workflow needs a
   distinct "checked in at the door" state in v1; if one does, it should be a separate boolean, not a
   fifth status.

6. **Delivery-event webhook in v1 or v1.1.** The decision record calls it an optional v1 nice-to-have.
   **Recommendation: ship it in phase 2**, scoped to patching `sent_emails` rows and nothing else.
   It is roughly 80 lines and it is the only thing that distinguishes "the provider accepted it" from
   "it reached the inbox" — the exact failure mode that motivated most of the machinery being cut.

7. **Cloud Run publisher job for snapshot refresh.** §8.4's secondary component adds a container
   build to every deployment. **Recommendation: defer it to phase 5** and ship phase 2–4 with a
   scheduled nightly snapshot refresh, since the runtime read path already keeps content current for
   human visitors and only crawler first-paint depends on the snapshot. *Adopted; §8.4 now specifies
   the phase 2–4 refresh as an `onSchedule` function that ships with the ordinary functions deploy,
   and names the Cloud Run image build, job creation, and `run.invoker` grant as phase-5 additions to
   `deploy-client.yml`, so nothing in phases 2–4 depends on infrastructure no job provisions.*

8. **Font allowlist size.** §7.4 bundles three-to-five self-hosted font sets and forbids arbitrary
   remote fonts. **Recommendation: three sets at launch** (editorial serif, humanist sans, and a
   casual script for accents — matching the current aesthetic's three roles), with adding a set as a
   documented PR path. Confirm this is acceptable, since it is the one theming dimension a client
   cannot self-serve.

9. **`ticket_sync_queue` is a queue, and §3.1 forbids queues.** The email prohibition is specific to
   email; the ticketing delayed-fetch queue exists because the ticketing provider's own read APIs are
   eventually consistent, which no email provider change fixes. **Recommendation: keep it**, scoped to
   `ticketing/`, with a hard attempt cap and an operator alert on exhaustion — and state in
   `CONTRIBUTING.md` that this is the only queue in the system, so it is not read as a precedent.

10. **Copyright holder on LICENSE.** LICENSE, NOTICE, and SECURITY.md must be in the first public
    commit (§1.5), and the LICENSE copyright line names the entity granting the license — so
    ownership (personal / CCM / Montclair State, under the university's IP policy) gates repository
    creation, not phase 5. **Recommendation: resolve it before phase 2 begins; scaffold the repo
    private until it does**, and treat the first public push as the gate rather than the launch.

---

## 11. Current-behavior notes that differ from existing documentation

Recorded because the porting work depends on the code, not the docs:

- `docs/ARCHITECTURE.md` (dated 2026-05-26) lists `live_updates` as Slack-authored; `slackPushWebhook`
  is still the primary writer, confirmed at `functions/index.js:3475-3576`.
- The repo-root contributor guide states Storage has "10 path rules"; `storage.rules` has 9.
- That same guide states "46 routes" in one place and "43" in another; `docs/ARCHITECTURE.md` says
  47. None were re-counted here, because the v1 route set is defined independently.
- The decision record estimates "~150 stray hex literals to sweep"; the measured count at this commit
  is 239 across `src/**/*.{js,jsx}` (§7.1). Some are legitimately literal (PDF, email templates).
- `package.json` currently declares `"license": "MIT"`. The new repo is Apache-2.0; this is a fresh
  declaration in a new package, not a relicensing of the existing one, but the discrepancy is worth
  the director's awareness given question 10.
- `functions/helpers.js:300` (`isSessionPast`) and `src/utils/calendarUtils.js` are documented in-code
  as intentional duplicates because one is CommonJS and one is ESM. `packages/shared` is the
  structural fix, and it is the clearest single argument for the workspaces decision in §1.1.
