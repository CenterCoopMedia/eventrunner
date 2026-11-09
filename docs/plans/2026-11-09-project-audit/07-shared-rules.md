# Audit 07: packages/shared, Firebase rules, indexes, firebase.json, .env.example

Scope: `packages/shared/` (src, package.json, exports map), `firestore.rules`, `storage.rules`,
`firestore.indexes.json`, `firebase.json`, `vitest.rules.config.js`, `tests/`, `.env.example`.
Read-only. Findings are ordered by severity.

---

### 1. Nothing ever sets `config/event.announcedAt`, so a client site stays in the `draft` phase for good

- Category: broken
- Confidence: likely (every writer in the repo was searched; an operator could still edit Firestore by hand, but no document tells them to)
- Where:
  - `packages/shared/src/answers.cjs:425-426` (seed writes `announcedAt: null`, `archivedAt: null`)
  - `packages/shared/src/config/lifecycle.cjs:105-106` (`announcedAt === null` returns `'draft'` before any other phase is tested)
  - `functions/src/admin/config.cjs:116-117` (the two keys are accepted by `updateEventConfig`, but nothing sends them)
  - Readers: `functions/src/ticketing/ticketAnswers.cjs:37,147`, `apps/web/src/components/EventCountdown.jsx:110-145`,
    `apps/web/src/components/speaker/SpeakerStatusHeader.jsx:14-18`, `functions/src/reminders/scheduleCore.cjs:118`,
    `apps/web/src/lib/backIssue.js:54`
- Evidence: `rg -n "announcedAt|archivedAt"` over the whole repo (not docs, not tests) finds one writer of a non-null
  value: `scripts/lib/demo-event.cjs:146` (the demo fixture). `apps/web/src/admin/**` has no hit at all, so
  `AdminEventSettings.jsx` `toPayload` never sends either key. `scripts/init-event.cjs`, `scripts/provision-client.cjs`,
  `docs/DEPLOY_RUNBOOK.md` and `docs/operator/` have no hit. `scripts/lib/idempotency.cjs:154-155` only preserves the fields.
- How it is reached / impact: on every site made by `init-event` or the console, `getEventPhase` returns `'draft'` always. So:
  - `ticketAnswers.cjs` `CLOSED_PHASES` (`registration_closed`, `in_progress`, `ended`, `archived`) is never reached:
    attendees can change registration answers after registration closes and after the event.
  - The home countdown never draws (`draft` is excluded from its phases).
  - `SpeakerStatusHeader` never reaches its finished state; reminders never see `archived`; the back-issue view never shows.
- Proposed fix: owner decision between (a) add "Announce" and "Archive" controls to admin Event settings that send
  `announcedAt` / `archivedAt` through `updateEventConfig`, or (b) have the seed set `announcedAt` (for example at launch
  or at init) and document `archivedAt` in the runbook. Either way add the two fields to `validateEventConfig` (finding 6).

### 2. Signed-in routes `/dashboard`, `/registration`, `/tickets/mine`, `/tickets/status` are missing from the `firebase.json` private block

- Category: inconsistent, inefficient
- Confidence: certain (config), likely (that it is unintended)
- Where: `firebase.json:27-36` (rewrites) and the matching `headers` entries; `apps/web/src/App.jsx:148-153,163`;
  `docs/DEPLOY_RUNBOOK.md:579-585`; `scripts/lib/site-manifest.cjs:108-130`
- Evidence: the runbook says "Adding an authenticated one means adding it to that middle block, above the catch-all, and
  to the `headers` block", because "spending a function invocation to say so is waste". The block lists `/signin`,
  `/profile`, `/attendees`, `/schedule/mine`, `/speaker/**`, `/ticket/**`, `/admin`. App.jsx also mounts `dashboard`,
  `registration`, `registration/:stepSlug`, `tickets/mine`, `tickets/status`. `site-manifest.cjs` already lists
  `/dashboard` as `access: 'authenticated'`.
- How it is reached / impact: each load of those routes falls to the `**` rewrite and runs `routeMeta`
  (`functions/src/public/og.cjs` `resolveRouteSubject`): one function invocation, a config read and a
  `cmsPages.where('path','==',…)` query, to return a `noindex` shell. `/dashboard` is the signed-in home, so this is the
  most-loaded private page. These routes also do not get the `X-Robots-Tag: noindex` header the listed ones get.
- Proposed fix: add `/dashboard`, `/registration`, `/registration/**`, `/tickets/mine`, `/tickets/status` to
  `hosting.rewrites` (above `**`) and to `hosting.headers` in `firebase.json`; update the list in `DEPLOY_RUNBOOK.md` and
  the assertions in `scripts/deploy-workflow.test.cjs` / `scripts/hosting-security.test.cjs`.
- Note for the functions/scripts owners (outside my area, not verified in depth): `og.cjs` has no case for the public
  routes `/pitch` and `/tickets` (`rg "pitch|tickets" functions/src/public/og.cjs` has no hit), so they get the same
  `noindex` shell, and `site-manifest.cjs` does not list them.

### 3. `storage.rules` keeps a world-readable `exports/` namespace that nothing writes or reads

- Category: unneeded
- Confidence: certain (no writer or reader), owner-decision (removal)
- Where: `storage.rules:103-109`; `tests/storage.rules.test.js:47,277,282`
- Evidence: the comment names `generateSchedulePdf`, which does not exist (`rg -w generateSchedulePdf functions/src`
  has no hit outside the ADR). The PDF is streamed: `functions/src/schedule/pdf.cjs:461-463,533-535`
  (`res.send(artifact.bytes)`), with no bucket call. `rg "exports/" functions/src scripts apps/web/src` finds one line,
  a comment: `functions/src/users/export.cjs:30` says the data export is not stored because "storage.rules makes
  `exports/` world-readable".
- How it is reached / impact: no current effect. It is a standing public-read grant on a path a later feature could
  write to by mistake (the exact hazard `users/export.cjs` avoided).
- Proposed fix: delete the `match /exports/{allPaths=**}` block and the three `exports/schedule.pdf` assertions in
  `tests/storage.rules.test.js` (the catch-all then denies it); or fix the comment if the namespace is kept on purpose.

### 4. Five `.mjs` shims export fewer names than their `.cjs` modules; the root barrel has no importer

- Category: inconsistent, unneeded
- Confidence: certain
- Where and evidence (a `node` script that loads each `.cjs` with `require` and each `.mjs` with `import()` and compares keys):
  - `src/index.mjs`: 59 of 97. Missing: `DEFAULT_CUSTOM_BADGE_BLOCK_LIST, LEGAL_KEYS, MAX_CUSTOM_BADGES,
    MAX_CUSTOM_BADGE_LENGTH, MAX_MILESTONES, MAX_MILESTONE_LABEL_LENGTH, MAX_PHOTO_PATH_LENGTH, MAX_REGISTRATION_GOAL,
    MAX_SOCIAL_HANDLES, MAX_SOCIAL_KEY_LENGTH, MAX_SOCIAL_LABEL_LENGTH, MAX_SOCIAL_VALUE_LENGTH,
    MAX_SPEAKER_RESOURCE_LABEL_LENGTH, MAX_TOTAL_BADGES, MILESTONE_KEYS, PAGE_PATH_SEGMENT_RE, PROFILE_TEXT_LIMITS,
    SITE_PUBLISHER_JOB_NAME, SOCIAL_HANDLE_KEYS, SOCIAL_KEYS, SPEAKER_RESOURCE_KEYS, SPEAKER_RESOURCE_LINK_KEYS,
    SPEAKER_TRANSITIONS, SYSTEM_PAGE_ROUTES, TRACK_LETTER_RE, canMoveSpeaker, firstPathSegment, httpsUrlHref, internals,
    isBareEmailAddress, isCanonicalPagePath, isHttpsUrl, isPublishablePhotoPath, listSocialAccounts,
    resolveRegistrationAction, systemPageIdForPath, validateCustomBadges, validateProfileBounds`
  - `src/config/index.mjs` (24 of 28): `MAX_SPEAKER_RESOURCE_LABEL_LENGTH, SITE_PUBLISHER_JOB_NAME, SPEAKER_RESOURCE_KEYS,
    SPEAKER_RESOURCE_LINK_KEYS`
  - `src/config/schema.mjs` (16 of 19): `MAX_SPEAKER_RESOURCE_LABEL_LENGTH, SPEAKER_RESOURCE_KEYS, SPEAKER_RESOURCE_LINK_KEYS`
  - `src/config/deploy.mjs` (6 of 7): `SITE_PUBLISHER_JOB_NAME`
  - `src/profile.mjs` (10 of 14): `MAX_PHOTO_PATH_LENGTH, MAX_SOCIAL_HANDLES, MAX_SOCIAL_KEY_LENGTH, MAX_SOCIAL_VALUE_LENGTH`
  - `src/speaker.mjs` (13 of 14): `internals`
  - The other 29 shims match exactly. No shim exports a name its module lacks. `presetCatalog.cjs` has no shim and is not
    in the exports map; it is only required by `theme.cjs:663`, so that is fine.
  - Root barrel: `rg "['\"]shared['\"]"` over all code finds no `require('shared')` or `import … from 'shared'`. The one
    use is `functions/src/vendor.test.cjs:15`, which only calls `require.resolve('shared')`.
- How it is reached / impact: nothing breaks today, because no ESM consumer imports a missing name. The next web import of,
  say, `MAX_SOCIAL_HANDLES` from `shared/profile` fails the Vite build. Only three modules have a shim parity test
  (`ticketCommerce.test.cjs:165`, `invoice.test.cjs`, `richText.test.cjs`).
- Proposed fix: add the missing names to the five shims, and add one test in `packages/shared/src` that walks every
  `.cjs`/`.mjs` pair and compares the keys (the check I ran is about 15 lines). For the root barrel: either delete
  `index.cjs`/`index.mjs` and point `"."` at a tiny file, or keep it under the same parity test. Owner decision.

### 5. Status vocabulary added by the shared-status plan that no production code reads

- Category: unneeded, inconsistent (with `tasks/todo.md` "No status literal is typed twice")
- Confidence: certain (usage), owner-decision (what to do)
- Where and evidence (`rg -w <name>` over the repo, excluding `functions/vendor` and `docs/docs`):
  - `consoleRequest.cjs:45-65` `CONSOLE_REQUEST_TRANSITIONS`, `canMoveConsoleRequest`, `inConsoleRequestGroup`: used only
    in `consoleRequest.test.cjs`. No console function or script checks a move against the table; writers still type the
    target (`console/functions/src/reviewDecisions.cjs:166`, `applicationStatus.cjs:136`, `applications.cjs:149`).
    Compare `canMoveSpeaker`, which `functions/src/speakers/profile.cjs:351` and `apps/web/src/admin/speakerRecord.js:36` do call.
  - `delivery.cjs:17` `NOTICE_STATES`: test only (`deliveryStateOf` is used).
  - `ticketCommerce.cjs:260` `INVENTORY_STATES`: test only; `'held' | 'sold' | 'released'` are typed as literals in
    `functions/src/ticketing/stripeCommerce.cjs`, `stripeReconcile.cjs`, `commerceAdmin.cjs`, `stripeCheckout.cjs`, `entitlement.cjs`.
- How it is reached / impact: the transition table for console requests documents the moves but does not guard them, so
  it can drift from the writers without a failing check (the test compares it with a list typed in the test).
- Proposed fix: either call `canMoveConsoleRequest` in the console writers (S1 in `tasks/todo.md` is still unchecked), or
  note in the module that the table is documentation. Small note: the plan says the modules live in
  `packages/shared/src/status/` (`tasks/todo.md:19`); they are flat files in `src/`.

### 6. `validateEventConfig` accepts impossible clock values and does not check `announcedAt` / `archivedAt`

- Category: broken (validator gap)
- Confidence: certain (behaviour), likely (that it matters: reached only through the API or an answers file, not the admin form)
- Where: `packages/shared/src/config/schema.cjs:60-61` (`HHMM_RE`, `NAIVE_ISO_RE`), `:296-297`, `:606-611`; no code for
  `announcedAt`/`archivedAt` anywhere in the file
- Evidence (ran with `node -e`):
  - `days:[{id:'d1',date:'2027-01-01',startTime:'25:00',endTime:'99:99'}]` returns `{ ok: true }`
  - `registration:{opensAt:'2027-13-45T29:61'}` returns `{ ok: true }`
  - `announcedAt:'tomorrow', archivedAt:5, seo:7` returns `{ ok: true }`
  - The stricter patterns exist in the same package: `time.cjs:27-28` (`ISO_DATETIME_RE` with field ranges) and
    `eventDateTime.cjs` `TIME_RE`.
- How it is reached / impact: `updateEventConfig` (`functions/src/admin/config.cjs`) and `buildConfigDocs` both rely on
  this validator. A day ending `99:99` is never "past" on that date (`time.cjs isDayPast`, `lifecycle.cjs`), and a
  malformed `announcedAt` reads as null, which puts the site in `draft` (finding 1).
- Proposed fix: in `schema.cjs`, range-check `HHMM_RE` (`([01]\d|2[0-3]):[0-5]\d`), reuse `ISO_DATETIME_RE` from
  `time.cjs` for `registration.opensAt/closesAt`, and add "null or naive ISO datetime" checks for `announcedAt` and `archivedAt`.

### 7. `VITE_EVENT_PUBLIC_URL` is a required deploy key that no bundle code reads

- Category: unneeded
- Confidence: certain
- Where: `packages/shared/src/config/deploy.cjs:43` (`REQUIRED_ALWAYS`), `.env.example:94`, `scripts/publish-site.cjs:184`,
  `scripts/provision-client.cjs:909`, `.github/workflows/deploy-client.yml` (asserted by `scripts/deploy-workflow.test.cjs:220`)
- Evidence: `rg VITE_EVENT_PUBLIC_URL` over the repo finds only the validator, the scripts and workflow that pass it, tests,
  the ADR and `.env.example`. There is no `import.meta.env.VITE_EVENT_PUBLIC_URL` in `apps/web`, and
  `apps/web/vite.config.*` / `index.html` do not read it.
- How it is reached / impact: a deploy fails as "missing required key" for a value nothing uses.
- Proposed fix: drop it from `REQUIRED_ALWAYS`, `.env.example`, `publish-site.cjs`, `provision-client.cjs`, the workflow
  step and the test fixtures; or, if the bundle should use it, name the reader.

### 8. `.env.example` small gaps

- Category: inconsistent
- Confidence: certain
- Where / evidence:
  - `.env.example:1` still says "Run of Show" (the old working name). It is the only place outside `docs/plans/` that
    uses it as the product name.
  - `.env.example:4` says "This file documents the full set". Not listed: `EVENT_TICKETING_ORGANIZATION_ID` (read by
    `functions/src/ticketing/providers/eventbrite.cjs:567` when `scripts/register-ticketing-webhook.cjs` runs; set by
    `scripts/provision-client.cjs:1107`; also absent from that script's own help text at lines 100-106),
    `VITE_DEMO_MODE` and `VITE_USE_EMULATORS` (documented in `apps/web/README.md:134-136` only), `VITE_BUILD_ID`
    (read by `apps/web/src/admin/components/ReportProblemDialog.jsx:66`; set only in `deploy-console.yml:68`, so the event
    site's problem reports always send an empty version).
  - `.env.example:106-107` says `VITE_FIREBASE_REGION` is "read by apps/web/src/contexts/AuthContext.jsx"; it is also
    read by `apps/web/src/lib/errorReporting.js:93`.
- Proposed fix: rename the header; add the three optional keys with one line each; for `VITE_BUILD_ID`, set it in the
  client build step or remove the read (web owner's call).

### 9. Duplicated helpers inside `packages/shared`

- Category: unneeded (duplicate logic)
- Confidence: certain (duplication), owner-decision (some copies may be kept to keep first-paint modules small, as
  `schema.cjs:84-90` says for one constant)
- Where:
  - IANA zone probe, same code twice: `config/schema.cjs:188-196` `isValidTimezone` and `eventDateTime.cjs` `isKnownTimeZone`.
  - "Real calendar date" round trip, four copies: `config/schema.cjs:171-180`, `pitch.cjs:7-12`, `invoice.cjs:246-252`,
    `eventDateTime.cjs` `readWall`.
  - Wall clock in a zone, twice: `time.cjs:39-52` `nowInZone` and `eventDateTime.cjs` `wallParts` (same Intl parts, same
    "24" midnight fix).
  - Email shape: `ticketCommerce.cjs:148` uses the older pattern `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` that `email.cjs:8-14`
    says was replaced because it backtracks. Not exploitable here (a 254-character cap is tested first), but it is a
    second definition of "an email address"; `isEmailAddress` is one require away.
  - `registrationForm.cjs:28-32` `DIRECTORY_CHOICES` re-types the three ids of `profile.cjs:68` `PROFILE_VISIBILITIES`.
- Proposed fix: have `schema.cjs` use `isKnownTimeZone`, export one `isCalendarDate` from `eventDateTime.cjs` and use it
  in the other three, build `nowInZone` on `wallParts`, and use `isEmailAddress` in `ticketCommerce.cjs`.

### 10. Server-only collections that the rules' "named explicitly" list omits

- Category: inconsistent
- Confidence: certain
- Where: `firestore.rules:737-797` ("Server-only collections, named explicitly so a future edit cannot open them by accident")
- Evidence: used by code, not named in the rules (the catch-all at `:865` denies them, so access is correct today):
  `admin_mail_limits` (`functions/src/admin/accessMail.cjs:23`), `ticketLookupBudgets`
  (`functions/src/ticketing/lookupBudget.cjs:14`), `speaker_photo_upload_budgets` (`functions/src/media/upload.cjs:591`),
  `cmsUpdates_deleted` (`functions/src/cms/updates.cjs:45`), `security_migrations` (`scripts/migrate-security-data.cjs:16`).
- Proposed fix: add five `match /<name>/{id} { allow read, write: if false; }` lines, or drop the claim from the comment.

### 11. Two client read grants in `firestore.rules` that no client uses

- Category: unneeded
- Confidence: certain (no reader), owner-decision (both are tested, so they may be kept on purpose)
- Where:
  - `firestore.rules:174-177` `cmsVersionHistory` `allow read: if isAdmin()` ("admin-readable for the CMS UI"). The web
    never opens the collection: `rg cmsVersionHistory apps/web/src` finds one comment (`admin/versionHistory.js:4`); the
    pages read versions through the callable in `functions/src/cms/versions.cjs`.
  - `firestore.rules:158-159` public `get` on `announcements/{id}` inside its window. Visitors read
    `announcements_public/current` (`apps/web/src/lib/announcementsSource.js:13`); only the admin page lists `announcements`.
- Proposed fix: set `cmsVersionHistory` to `allow read, write: if false`, and drop the public `get` branch on
  `announcements`, with their tests (`tests/firestore.rules.test.js:1901-1907` for the second).

### 12. Stale comments in shared (trivial)

- Category: inconsistent
- Confidence: certain
- Where: `packages/shared/src/badges.cjs:7` says "Free-text custom badges do not exist in v1"; the same file implements
  them from line 30. `packages/shared/src/answers.cjs:4` says "the five Tier B config documents", `:489` says "all six".
  `answers.cjs:262-267` says an unknown feature key "surfaces as a validation error"; `buildFeatures` returns a warning.
- Proposed fix: correct the three comments.

---

## Files read

- `packages/shared/package.json` and all 37 non-test `.cjs` modules under `packages/shared/src` (including `config/`),
  read in full, except the two generated data files `presetCatalog.cjs` and `presetRemaps.cjs` (checked by loading
  them, not read line by line). All 36 `.mjs` shims were compared by script; six were read.
- `firestore.rules` (869 lines), `storage.rules`, `firestore.indexes.json`, `firebase.json`, `vitest.rules.config.js`,
  `.env.example`: read in full.
- `tests/` (13 files, 6,498 lines): not read line by line. I grepped them for covered collections, legacy status
  literals and imports. Shared `*.test.cjs` files: grepped, not read in full.
- For cross-checks: every `.where(` / `.orderBy(` chain in `functions/src`, `scripts`, `apps/web/src`; every client
  Firestore call site in `apps/web/src`; `tasks/todo.md`; parts of `functions/src/public/og.cjs`, `functions/src/admin/config.cjs`,
  `scripts/lib/site-manifest.cjs`, `docs/DEPLOY_RUNBOOK.md`.

## Checked and found correct

- Exports map: all 34 entries point at files that exist; every subpath has an importer; no module is missing from the map
  except the internal `presetCatalog.cjs` and the four `config/*` parts reached through `shared/config`.
- Rules vs shared constants (agree today): self-editable field list (`SELF_EDITABLE_PROFILE_FIELDS`), text limits
  160/80/2000/200/200, photo path 512, social handles 10/64/512, badges 40, custom badges 3, the three profile
  visibilities, the six default avatars, `isOwnProfilePhoto` vs `isPublishablePhotoPath`. Only the badges cap has a
  parity test (`badges.test.cjs:48`).
- No status list literal remains outside the shared modules in `functions/src`, `apps/web/src`, `console`, `scripts`
  (searched for the opening pair of each list).
- Rules helpers: every function in `firestore.rules` and `storage.rules` is called. Every collection in the rules is
  referenced by code and appears in a rules test.
- Client reads vs rules: each `apps/web/src` listener and query matches a rule that allows it, including the
  `ticket_answers` get on a missing document (handled as "not answered" in `registrationAnswersApi.js`).
- Indexes: all 24 composite indexes have a matching query, and every query that needs a composite index has one.
  Queries with two equality filters and no index of their own (`csvImport.cjs:361-363` email + status) are served by
  index merging. No change proposed.
- `firebase.json`: `updatesMeta`, `emailUnsubscribe` and `routeMeta` exist (`functions/src/public/og.cjs:1028,1034`,
  `functions/src/announcements/suppression.cjs:367`). The hard-coded `us-central1` is rewritten by the deploy for other regions.
- Every function and file named in the `firestore.rules` and `storage.rules` comments exists, except
  `generateSchedulePdf` (finding 3).
- `.env.example`: every other listed key is read by code or the deploy workflow.
- Read with no defect found: `time`, `eventDateTime`, `reminderSchedule`, `lifecycle` (logic), `registration`, `speaker`,
  `speakerReadiness`, `readiness`, `pitch`, `pitchForm`, `registrationForm`, `invoice`, `promoCodes`, `ticketCommerce`,
  `venue`, `imageSizes`, `richText`, `urlSafety`, `page`, `routing`, `seed`, `announcement`, `update`, `theme`.
