# Audit 06 — apps/web lib, hooks, contexts, webmcp, utils, generated, app config

Scope: `apps/web/src/{lib,hooks,contexts,webmcp,utils,generated}`, `src/firebase.js`, `src/main.jsx`,
root-level `src/*.test.js`, `package.json`, `vite.config.js`, `tailwind.config.js`, `postcss.config.js`,
`generatedDir.js`, `index.html`, `public/`, `README.md`. Read-only; nothing in the repository was changed.

Findings are ordered by severity. Paths are relative to `/home/user/eventrunner/`.

---

### 1. WebMCP `mountToolSet` keeps the old tool list when the admin tier changes
- Category: broken
- Confidence: certain (mechanism reproduced); reach is limited to browsers that expose `modelContext` with `features.webmcpAdmin` on
- Where: `apps/web/src/webmcp/registration.js:43-64` (record reuse), `:70-89` (deferred cleanup); caller `apps/web/src/webmcp/AdminWebMcpRegistration.jsx:27-39`
- Evidence: when a record for `setId` already exists, `mountToolSet` only does `record.mounts += 1; record.stateRef = stateRef;` and never looks at the new `definitions`. The cleanup defers the unregister by one microtask (written for Strict Mode's immediate remount). React runs an effect's cleanup and its re-run in the same commit, so a dependency change looks exactly like the Strict Mode remount: the old record is reused with the old registrations. Reproduced with the real module:
  ```
  node --input-type=module -e "import { mountToolSet } from './src/webmcp/registration.js'; ..."
  mount(definitions: [])            -> cleanup() -> mount(definitions: [a, b])   => registered: []
  mount(definitions: [staff1, op1]) -> cleanup() -> mount(definitions: [staff1]) => registered: ['staff1','op1']
  ```
  `registration.test.js` covers only duplicate mounts with the same definitions.
- How it is reached / impact: `AdminWebMcpRegistration`'s effect depends on `[enabled, user?.uid, adminTier]` and passes `adminToolsForTier(adminTier)`. `adminTier` changes while `enabled` stays true in two real cases (`contexts/AuthContext.jsx:192-212`): (a) the tier probe failed transiently (`'unknown'`, which maps to `[]`) and a retry via `refreshAdminStatus` resolves it to `staff`/`operator`: no tool is ever registered for the session; (b) the Access page changes the operator's own standing and calls `refreshAdminStatus`: an operator demoted to staff keeps `inspect_system_errors` offered to the model (the server still refuses it), and a staff member promoted never gets it. The comment in `AdminWebMcpRegistration.jsx:31-32` ("this keeps the model from offering one") is not true after a tier change.
- Proposed fix: in `registration.js`, make the reuse conditional on the same definitions (for example compare the list of `definition.name`s, or key the record by `setId` plus the names). When they differ, unregister the old registrations and register the new list. Add a test for cleanup-then-mount with a different list.

### 2. `downloadIcs` revokes the blob URL synchronously; the other three download helpers defer it for a stated reason
- Category: inconsistent (possible broken download in some engines)
- Confidence: likely
- Where: `apps/web/src/utils/calendar.js:150-161`; compare `apps/web/src/lib/materialsSource.js:247-258`, `apps/web/src/lib/schedulePdf.js:44-53` and `:99-106`
- Evidence: `calendar.js:158-160` does `link.click(); document.body.removeChild(link); URL.revokeObjectURL(url);`. `saveBlobAs` and both PDF helpers end with `setTimeout(() => URL.revokeObjectURL(blobUrl), 0)` under the comment "Deferred: revoking immediately can race the browser's own read of the blob URL in some engines." `saveBlobAs`'s doc says it is "the one copy" of the save; `downloadIcs` and the two functions in `schedulePdf.js` are three more copies.
- How it is reached / impact: every "Add to calendar (.ics)" action: `components/session/CalendarMenu.jsx:54`, `pages/Schedule.jsx:482`, `pages/MySchedule.jsx:167`. In an engine where the race exists the .ics download fails silently.
- Proposed fix: in `utils/calendar.js` replace the body of `downloadIcs` with `saveBlobAs(new Blob([icsText], { type: 'text/calendar;charset=utf-8' }), filename)` (import from `lib/materialsSource.js`). Optionally do the same in `lib/schedulePdf.js` to remove the two inline copies.

### 3. Demo-only and orphaned files in `public/` ship in every client build
- Category: unneeded / inefficient
- Confidence: certain for the four files with zero references; likely / owner-decision for the rest
- Where: `apps/web/public/demo/**` (20 files, 2.0 MB), `apps/web/public/hero/*` (8 images, about 1.35 MB), `apps/web/public/branding/nclocal-*` (7 files, about 196 KB), `apps/web/public/branding/venue-plan-placeholder.svg`, `apps/web/public/branding/demo-venue-plan.svg`
- Evidence:
  - Zero references anywhere in the repository (`grep -rIlF` over the whole tree, `docs/demo` build output excluded): `branding/venue-plan-placeholder.svg`, `branding/nclocal-app-icon.svg`, `branding/nclocal-og.svg`, `demo/workshop-recap.webp`.
  - `public/demo/speakers/*.webp` (12) and `public/demo/sponsors/*.webp` (6): the committed snapshot no longer names any of them (`grep headshotPath src/generated/scheduleData.js` gives only `null`; the only `logoPath` is `branding/nclocal-logo.png`), and no generator, seed or fixture under `scripts/`, `functions/src`, `packages/` or `e2e/` names a `demo/speakers` or `demo/sponsors` path. The old ids survive only in `scripts/lib/superseded-demo-ids.json`. Remaining users: unit tests, and `e2e/image-sizes.spec.js:15`, which reads `demo/speakers/elena-santos.webp` from disk as an upload fixture. `demo/summit-gathering.webp` is named only in tests.
  - `hero/newsroom.webp` (217 KB): `lib/demoHero.js:5` maps `newsroom` to `nclocal-summit.jpg`; `newsroom.webp` is named only in `EventHero.test.jsx`, `mediaSource.test.js`, `e2e/hero-geometry.spec.js` and `public/hero/README.md`.
  - `hero/*` is read only by `lib/demoHero.js`, which returns `null` unless `IS_DEMO`. Nothing strips `hero/`, `demo/` or `nclocal-*` from a client `dist` (no match for these in `scripts/publish-site.cjs`, `scripts/write-site-files.cjs`, `scripts/lib/app-icons.cjs`, `vite.config.js`).
- How it is reached / impact: Vite copies `public/` into `dist/`, so every client deployment uploads and serves about 3.5 MB of demo art plus another organization's logo files that no client page can request. `lib/bundledAssets.js:1` says "Demo images ship with every build" — that was deliberate while the fictional demo used them; the snapshot has since moved to the NC Local mock-up.
- Proposed fix: delete the four unreferenced files. Owner decision for the rest: remove `public/demo/{speakers,sponsors}` and `hero/newsroom.webp` (move `elena-santos.webp` to an e2e fixture directory and update `e2e/image-sizes.spec.js:15` and the unit tests), then drop the matching dead branches: the `demo/...webp` alternative in `lib/bundledAssets.js:5`, the `demo/speakers/` branch in `components/media/ProfilePhoto.jsx:40`, and the `img[src*='/demo/sponsors/']` rule in `src/index.css:2831`. For `hero/` and `nclocal-*`, either accept the cost or have `scripts/publish-site.cjs` remove them from a client `dist`.

### 4. `apps/web/README.md` no longer matches the code in several places
- Category: inconsistent
- Confidence: certain (each line checked against the file it names)
- Where and evidence:
  - `README.md:227-229` "Three open-license variable font sets ... (`source-serif-4`, `source-sans-3`, `caveat`)". `public/fonts/` holds 27 woff2 files and `public/fonts/README.md` says "Twenty-three families live in this directory."
  - `README.md:12` "three-path allowlist". `eslint.config.*:131-138` lists four function paths (`functions/src/email/templates/**`, `functions/src/schedule/pdf.cjs`, `functions/src/pdf/kit.cjs`, `console/functions/src/emailLayout.cjs`) plus `apps/web/src/generated/theme.css`; `CONTRIBUTING.md` says four.
  - `README.md:24` says `eventConfig.js` feeds "event identity, dates, features, badges". `src/generated/eventConfig.js` exports `eventConfig`, `features`, `theme`, `launch` and no badges; `contexts/EventConfigContext.jsx:134-139` states "config/badges has no synthetic snapshot counterpart".
  - `README.md:157-158` says the demo flag is "read in exactly one place — `src/lib/demoMode.js` — and consumed at five points". The table under it has six rows; `import.meta.env.VITE_DEMO_MODE` is also read in `src/pages/specimen/specimenRoute.js` (the README's own specimen section says so) and `generatedDir.js`; `IS_DEMO` is imported by 27 non-test files (for example `lib/announcementsSource.js`, `lib/profileSource.js`, `lib/feedbackApi.js`, `lib/errorReporting.js`, `lib/launchSource.js`, `lib/speakerInvites.js`, `lib/usePitchCallOpen.js`, `webmcp/PublicWebMcpRegistration.jsx`). The row naming `src/pages/Login.jsx` is stale: that file has no demo reference (`grep -n "IS_DEMO\|demoMode" src/pages/Login.jsx` is empty).
  - `README.md:126-136` (env table) omits variables the app reads: `VITE_FIREBASE_APP_CHECK_SITE_KEY`, `VITE_APP_CHECK_DEBUG_TOKEN` (`src/firebase.js`), `VITE_ENABLE_CLIENT_ERROR_REPORTING` (`lib/errorReporting.js:106`), `VITE_CONSOLE_ORIGIN`, `VITE_BUILD_ID` (`admin/components/ReportProblemDialog.jsx:10,66`).
  - `README.md:100` starts the emulators with `--only functions,firestore,auth`, while `README.md:115` and `:134` say `VITE_USE_EMULATORS` connects Auth/Firestore/Storage. With that flag `src/firebase.js:76-78` points every media URL at `http://127.0.0.1:9199` and `lib/photoUpload.js:15` connects Storage there, so the documented dev loop has no Storage emulator behind its media URLs.
  - `README.md:272` says `ticketingCommerce.js` "restricts payment handoffs to hosted Stripe Checkout". `lib/ticketingCommerce.js:77-89` checks only https, no credentials and no port, and its comment says a merchant custom domain is allowed on purpose (the test accepts `https://checkout.events.example.org/...`).
- How it is reached / impact: a contributor following the README gets wrong font, lint, env and demo-mode information; the dev loop shows broken images.
- Proposed fix: edit `apps/web/README.md` only: point the Fonts section at `public/fonts/README.md`; say "the allowlist in eslint.config"; replace "badges" with "theme, launch"; replace the "five points" sentence with "the main ones are"; drop `Login.jsx`; add the missing env rows; add `storage` to the `--only` list (or say media needs it); reword the checkout sentence to "validates the transport of the server's Checkout URL".

### 5. Client build passes two `VITE_` variables nothing reads, and never sets one the app does read
- Category: inconsistent / unneeded
- Confidence: certain for the unread pair; likely for `VITE_BUILD_ID`
- Where: `scripts/publish-site.cjs:180,184`, `.github/workflows/deploy-client.yml:172-173,435,460,483,486`, `.env.example:94,105`; reader `apps/web/src/admin/components/ReportProblemDialog.jsx:66`
- Evidence: `grep -rn "MEASUREMENT_ID\|VITE_EVENT_PUBLIC_URL\|EVENT_PUBLIC_URL" apps/web` (node_modules and dist excluded) returns nothing; `src/firebase.js:14-21` builds `firebaseConfig` without `measurementId`. `VITE_BUILD_ID` is set only in `.github/workflows/deploy-console.yml:68` (the console build); neither client build path sets it, so `version: import.meta.env.VITE_BUILD_ID || ''` is always `''` in a problem report sent from a client site.
- How it is reached / impact: two dead inputs in a build step whose comment says the key list must mirror exactly; problem reports from client sites carry no build version.
- Proposed fix: remove `VITE_FIREBASE_MEASUREMENT_ID` and `VITE_EVENT_PUBLIC_URL` from the three places (and the matching assertions in `scripts/deploy-workflow.test.cjs` if any), or wire them. Add `VITE_BUILD_ID: ${{ github.sha }}` to the client build env in `deploy-client.yml` and `publish-site.cjs` if the version is wanted. This sits partly in the scripts/workflow auditors' area; reported here because the reader side is the web config.

### 6. WebMCP `check_public_schedule` reports a midnight-crossing session as `invalid-time`
- Category: inconsistent
- Confidence: likely
- Where: `apps/web/src/webmcp/publicTools.js:121-126`; contract in `apps/web/src/lib/eventTime.js:140-151`
- Evidence: the tool flags `session.startTime >= session.endTime`. `resolveSessionInstants` supports exactly that shape by design ("A session ending after midnight (`23:30`–`00:15`) resolves its wall clock on the next calendar day") and `eventTime.test.js` covers it.
- How it is reached / impact: a late session that the schedule page, the .ics export and calendar sync all render correctly is listed as a structural issue by the diagnostic. Diagnostic output only.
- Proposed fix: in `publicTools.js` flag only `startTime === endTime` or a non-`HH:MM` value, or resolve through `resolveSessionInstants` and flag when `start` or `end` is null.

### 7. `demoAttendees` is always empty with the current snapshot
- Category: unneeded
- Confidence: likely (owner decision whether the demo directory returns)
- Where: `apps/web/src/lib/demoCommunity.js:4-17`; consumers `apps/web/src/lib/profileSource.js:108-111,143`
- Evidence: the list is built from snapshot speakers whose `slug` starts with `demo-`. `grep -c "slug: 'demo-" src/generated/scheduleData.js` is 0, the snapshot has `attendeeDirectory: false`, and `lib/demoCommunity.test.js` now asserts the result is `[]` ("returns no historical attendee directory or profile reads").
- How it is reached / impact: dead mapping code and two demo branches that can only answer "nobody".
- Proposed fix: replace `demoAttendees` with a frozen empty array (or return `[]`/`null` directly in the two `IS_DEMO` branches of `profileSource.js`) and keep `demoUpdates`.

### 8. `ScheduleShareError` is given a `code` its constructor drops
- Category: inconsistent
- Confidence: certain
- Where: `apps/web/src/lib/scheduleShareSource.js:69-75` (constructor takes `{ message, status }`), `:113-116` (passes `code:`)
- Evidence: every sibling error class (`BookmarkRequestError`, `ReactionRequestError`, `MaterialRequestError`, `TicketClaimError`) stores `this.code`; this one does not, so the server's error code is discarded. No caller reads `.code` today (`components/schedule/ShareSchedule.jsx` has no `code` reference), so there is no user-visible effect yet. The class's JSDoc also sits on the same line as the `export` (line 69).
- Proposed fix: add `code` to the constructor and set `this.code = code`, or delete the `code:` argument.

### 9. Helpers duplicated inside the area, one of them already exported by `packages/shared`
- Category: unneeded
- Confidence: certain for the duplicates; owner-decision on merging
- Where and evidence:
  - `apps/web/src/lib/eventTime.js:20-27` `partsIn` is byte-for-byte `packages/shared/src/eventDateTime.cjs:38-45` `partsIn`, which `shared/eventDateTime` exports and `lib/eventDateTime.js:21` and `lib/timeZoneOptions.js:12` already import. Smallest fix: import it in `eventTime.js` and delete the local copy. (`zonedDateTime` overlaps `resolveEventDateTime` too, but it resolves an ambiguous fall-back time silently where the shared one reports `ambiguous`, so that is not a drop-in swap.)
  - `apps/web/src/lib/eventTime.js:239-256` `eventDateRangeLabel(eventConfig)` and `:377-399` `formatEventDateRange(days, timeZone)` produce the same strings ("October 15–17, 2026", "October 30 – November 1, 2026", cross-year form). Callers: `pages/Home.jsx:127` uses the first; `components/editorial/Nameplate.jsx:28` and `components/ComingSoon.jsx:27` use the second. Only difference: the second needs a valid timezone and returns null without one.
  - `parentOf` is written twice, identically: `apps/web/src/lib/scheduleGrid.js:92-100` and `apps/web/src/lib/scheduleView.js:127-135`.
  - `idTokenGetter(user)` is defined four times: `lib/organizationProfileApi.js:10`, `lib/registrationAnswersApi.js:9`, `lib/speakerMaterialsApi.js:12`, `lib/speakerProfileApi.js:23`.
  - `lib/speakerProfileApi.js:38-42` `getOwnSpeakerProfile` and `:50-54` `loadOwnSpeakerProfile` call the same endpoint with the same body; the first is the second's `.speaker`.
- Proposed fix: as stated per item; each is a local edit in the named file.

### 10. Exports and paths with no production reader
- Category: unneeded
- Confidence: certain (whole-repository grep: `apps`, `e2e`, `scripts`, `console`, `packages`, `functions`, `docs`, `tasks`)
- Where and evidence:
  - `apps/web/src/contexts/EventConfigContext.jsx:328` `useFeatures` — read only by `EventConfigContext.test.jsx` and by mocks in two specimen tests.
  - `apps/web/src/contexts/ContentContext.jsx:332` `usePages` — read only by `ContentContext.test.jsx`.
  - `apps/web/src/contexts/ContentContext.jsx:322-328` the `useContent(section, field)` shorthand — the only two-argument call is `ContentContext.test.jsx:40`.
  - `apps/web/src/lib/speakerProfileApi.js:21` and `apps/web/src/lib/speakerMaterialsApi.js:10` `export { AdminApiError }` — nothing imports `AdminApiError` from either module (`grep -rn AdminApiError src | grep -v "^src/admin/"` shows only these two files and their tests, which match on `name`).
  - `apps/web/src/lib/contentSource.js:32-45`: the JSDoc for `subscribeContentCollection` is stranded above the JSDoc of `subscribeSpeakersPublic` (lines 46-61); the function it documents (line 79) has none.
  - `export` keywords with no outside reader, tests included (used inside their own file only): `isKnownTemplate` (`lib/pageTemplates.js:119`), `formatEventClock` (`lib/eventDateTime.js:88`), `SCHEDULE_SORTS` (`lib/scheduleView.js:176`), `DEFAULT_AVATAR_PREFIX` (`lib/mediaSource.js:72`), `isFontAvailable` (`lib/themeRuntime.js:484`), `LIVE_UPDATE_AUDIENCES` (`lib/liveUpdatesSource.js:32`), `accountRecordId` (`lib/registrationAnswersApi.js:16`), `ReactionRequestError` (`lib/reactionsSource.js:96`).
- Proposed fix: delete `useFeatures`, `usePages`, the two re-exports; drop the two-argument branch of `useContent` or keep it as an owner decision; move the JSDoc; removing the bare `export` keywords is optional.

### 11. Tailwind theme keys no class uses
- Category: unneeded
- Confidence: owner-decision (the config comment already says the `brand-*` names are unread and "stay defined")
- Where: `apps/web/tailwind.config.js` `theme.extend.colors` and `transitionDuration`
- Evidence: scanned every non-test `.js`, `.jsx`, `.css` under `src` (generated excluded) for `<utility>-<key>`: no match for colors `brand-primary`, `brand-primary-dark`, `brand-primary-light`, `brand-accent`, `brand-surface`, `brand-surface-alt`, `brand-ink`, `brand-ink-muted`, `success`, `highlight`, `accent-soft`, `accent-secondary`, `ink-motif`, `rule-nameplate`, `admin-state-live`, `admin-focus-ring`, `admin-focus-ring-rail`, `admin-rail-ground-raised`, and durations `fast`, `base`, `signature`. A class built by string concatenation would not be seen by this scan (nor by Tailwind). Every CSS variable the config names is defined.
- Impact: none on output size (Tailwind emits only used utilities); only config noise.
- Proposed fix: none required; remove the keys if the owner wants the config to list only live utilities.

---

## Files read

- `apps/web/src/contexts/` — all 5 production files in full; tests by name and by the assertions needed for the findings.
- `apps/web/src/lib/` — all 77 production modules in full (the 68 test files were consulted where a finding depended on them: `registration`, `demoCommunity`, `scheduleShareSource`, `ticketingCommerce`, `eventTime`, `themeRuntime.parity`).
- `apps/web/src/hooks/` — all 9 hooks. `apps/web/src/webmcp/` — all 5 production files. `apps/web/src/utils/calendar.js`.
- `apps/web/src/firebase.js`, `src/main.jsx`, `src/generatedDir.test.js`, `src/optimizeDeps.test.js`, `src/presetRemapsPaths.test.js` (head).
- `apps/web/package.json`, `vite.config.js`, `tailwind.config.js`, `postcss.config.js`, `generatedDir.js`, `index.html`, `README.md`, `public/manifest.webmanifest`, `public/fonts/README.md`, `public/hero/README.md`, listing of all of `public/`.
- For cross-checks: `CONTRIBUTING.md`, parts of `firestore.rules`, `packages/shared/package.json` and `src/eventDateTime.cjs`, `scripts/publish-site.cjs`, `scripts/generate-content.cjs`, `.github/workflows/deploy-client.yml` (env lines), `functions/src/cms/pageTemplates.cjs` and `pages.cjs` (enum lines).

## Checked and found correct

- `src/generated/**` matches its generator: `node scripts/generate-content.cjs --demo --check` printed "7 file(s) match the committed snapshot" (check mode writes nothing).
- `package.json`: every dependency and devDependency is imported or configured (`firebase`, `leaflet`, `quill`, `react`, `react-dom`, `react-router`, `shared`; `@testing-library/*`, `@vitejs/plugin-react`, `autoprefixer`, `jsdom`, `postcss`, `tailwindcss`, `vite`, `vitest`); no bare import lacks a dependency.
- `vite.config.js` `optimizeDeps.include` equals the set of `shared/*` entries imported under `src` (diff empty), and every entry exists in `packages/shared/package.json` exports.
- No lib module, hook or webmcp file is unimported; `lib/demoModeFlag.js` is used by `generatedDir.js`.
- Every context value field has a production reader (`isOperator`, `adminTier`, `refreshAdminStatus`, `sources`, `contentSource`, `readSource`, `timeline`, `getPublicPage`, `needsProfileSetup`, `attendeeAccess`, `setDemoTheme`).
- `lib/liveUpdatesSource.js` `readableAudiences` matches `firestore.rules:596-601`; `sessionNotesSource.js` matches the `sessionNotes` rule (keys `['text']`, 10000); `registrationAnswersApi.readOwnAnswers` handles the rules' denial of a missing doc.
- Client limits match the server: profile and speaker photo 2 MB, media 5 MB, speaker material 9 MB, reaction kinds, page layout and template enums (pinned by `admin/pageDoc.test.js`).
- `functionsOrigin` (AuthContext) versus `resolveFunctionsOrigin` (errorReporting): a documented, deliberate pair. `FONT_SETS` in `themeRuntime.js` is pinned to shared by `themeRuntime.parity.test.js`. `DASHBOARD_SPEAKER_STATUSES` is pinned to shared by its test and kept local on purpose.
- README commands and paths that still work: `npm run test -w apps/web`, `npm run build -w apps/web`, `npm run build:demo`, `scripts/dev/login-smoke.mjs --app-url/--emulator-log`, `scripts/dev/build-app-icons.mjs`, all linked ADR/doc/e2e files, the four ticketing test files.
- `index.html` favicon and manifest targets exist; manifest icons exist.
- `lib/csv.js` (BOM, quotes, trailing rows), `lib/sanitizeHtml.js`, `lib/chunkReload.js`, `lib/retrySubscription.js`, `lib/calendarSync.js`, `hooks/useSessionNote.js`, `lib/useRegistrationLink.js`: read for logic errors, none found.
