# 11: documentation fixes

Only Markdown was edited (plus the regenerated `docs/docs/**`). No code, test, workflow or config changed. No git state changed. Line numbers are of the edited files.

Checks after the edits, run from the repo root: `node scripts/build-pages.cjs` (regenerated 5 pages: admin-guide, contributing, interface-guidelines, overview, stripe-ticketing), `node scripts/build-pages.cjs --check` pass, `node scripts/check-docs.cjs` pass, `npm run check:copy` pass (805 files), `npm run lint` pass (0 errors; 1 existing warning), `node --test scripts/check-docs.test.cjs scripts/build-pages.test.cjs functions/src/users/records.test.cjs` 119/119 pass. Also run because they read docs: `scripts/ci/classify-changes.test.cjs` + `scripts/lib/tokens.test.cjs` 51/51 pass, `apps/web` vitest `src/admin/updatesCopy.test.js` 3/3 pass. No edit had to be reverted.

## Edits

### docs/ADMIN_GUIDE.md (UI strings from `apps/web/src`)

| Line | Old | New | Evidence |
|---|---|---|---|
| 5 | under **Manage pitch emails** | under **Pitch emails** | `admin/components/PitchEmails.jsx:89` Panel title "Pitch emails" |
| 67 | Six site styles are available. | Seven site styles are available. | `admin/pages/AdminBranding.jsx:696` maps all `PRESET_IDS`; `packages/shared/src/presetCatalog.cjs` PRESETS has 7 ids; `scripts/build-preset-catalog.cjs:92` |
| 103 | **Save image draft** … **Save and publish image** | **Save draft** … **Publish** | `admin/components/HomeHeroImageEditor.jsx:111,114` |
| 197 | Tick **This session needs no slides or other materials** in the **Speaker materials** panel | Turn off **Request speaker materials** in the **Speaker materials** panel | `admin/pages/AdminSessionEditor.jsx:477-480` (switch, checked = !materialsNotNeeded) |
| 197 | The box is clear on a new session. | The switch is on for a new session. | `AdminSessionEditor.jsx:55` default `materialsNotNeeded: false` |
| 205 | Clear **Show this organization when it is published** | Turn off **Show on the sponsors page** | `admin/pages/AdminOrganizationEditor.jsx:400` |
| 458 | Select **Save attendee settings** | Select **Save** | `admin/components/AttendeeReminderSchedule.jsx:389` |
| 552 | opens **Configure ticket catalog** | opens **Ticket settings** | `admin/components/StripeTicketingWorkspace.jsx:69` (summary "Ticket settings") |
| 554 | Keep **Pause new sales** checked while configuring. | Keep **Ticket sales** off while configuring. | `StripeCatalogPanel.jsx:156` switch "Ticket sales" (checked = !salesPaused) |
| 554 | Use **Publish the catalog** and **Save catalog** … **Review reopening sales** and **Review pausing sales** show | Turn on **Publish tickets** and select **Save** … **Reopen sales** and **Pause sales** show | `StripeCatalogPanel.jsx:155,183`; `StripeTicketingWorkspace.jsx:64,76-79` (dialog with required reason) |
| 560 | **Resync this order** | **Refresh order** | `StripeOrderDetail.jsx:185` |
| 568 | **Review check-in correction → Undo recorded check-in** | **Undo check-in → Undo recorded check-in** | `StripeCheckInPanel.jsx:51,54` |
| 650 | **Make a card payment link** | **Create payment link** | `admin/pages/InvoiceCardPayment.jsx:190` |
| 719 | **Show this session when it is published** and **Show this organization when it is published** are cleared. | **Show on the schedule** and **Show on the sponsors page** are off. | `AdminSessionEditor.jsx:486`; `AdminOrganizationEditor.jsx:400` |
| 759 | **Download the speaker template** | **Download speaker template** | `admin/pages/AdminRecordImport.jsx:302` + `admin/recordImport.js:16` (noun "speaker") |
| 797 | Under **Email an announcement** | Under **Write your email** | `admin/components/AnnouncementEmailComposer.jsx:614-639` (Audience field is in Panel "Write your email") |
| 814 | **Save as a new message** | **Save new message** | `admin/components/AnnouncementSavedMessages.jsx:253` |
| 932 | **Collection** picks | **Content type** picks | `admin/pages/AdminVersionRecords.jsx:221` |
| 932 | **Search by name or id** | **Search by name** | `AdminVersionRecords.jsx:229`; filter matches name only (`:101-104`) |
| 975 | **+ Add track** | **Add track** | `admin/components/EventTracksEditor.jsx:138` |

### docs/operator/stripe-ticketing.md

| Line | Old | New | Evidence |
|---|---|---|---|
| 107 | **Ticketing → Configure ticket catalog** | **Ticketing → Ticket settings** | `StripeTicketingWorkspace.jsx:69` |
| 109 | A **Hidden — staff-issued only** type | A **Staff only** type | `StripeCatalogPanel.jsx` Availability option `{ value: 'hidden', label: 'Staff only' }` |
| 111 | Keep **Pause new sales** checked while setting up. | Keep **Ticket sales** off while setting up. | `StripeCatalogPanel.jsx:156` |
| 111 | Use **Save catalog**. | Select **Save**. | `StripeCatalogPanel.jsx:183` |
| 123 | check **Publish the catalog**, … **Review reopening sales → Reopen new sales** | turn on **Publish tickets**, … **Reopen sales → Reopen new sales** | `StripeCatalogPanel.jsx:155`; `StripeTicketingWorkspace.jsx:64,76` (confirm label "Reopen new sales") |
| 135 | **Search orders** | **Search** | `StripeTicketList.jsx:66` |
| 141, 144, 149 | **Resync this order** | **Refresh order** | `StripeOrderDetail.jsx:185` |
| 153 | **Review check-in correction → Undo recorded check-in** | **Undo check-in → Undo recorded check-in** | `StripeCheckInPanel.jsx:51,54` |
| 169 | **Make a card payment link** | **Create payment link** | `InvoiceCardPayment.jsx:190` |
| 179 | **Review pausing sales → Pause new sales** | **Pause sales → Pause new sales** | `StripeTicketingWorkspace.jsx:64,76` |

### docs/operator/session-pitches.md

| Line | Old | New | Evidence |
|---|---|---|---|
| 43 | Select **Use this Airtable connection** and save. | Turn on **Import from Airtable** and save. | `admin/pages/AirtablePitchSync.jsx:189` |
| 44, 323, 352 | **Export the shown pitches** (downloads) | **Download pitches** (saves) | `admin/pages/AdminSessionPitches.jsx:71` (`saveTextFile` of `shown`) |
| 111 | clear **Use this Airtable connection** | turn off **Import from Airtable** | `AirtablePitchSync.jsx:189` hint "Turn off to stop imports. Existing pitches stay." |
| 263 | under **Manage pitch emails** | under **Pitch emails** | `PitchEmails.jsx:89` |
| 297 | Operators expand **Manage pitch emails**. | Operators open **Pitch emails** in **Call settings**. | `PitchEmails.jsx:89` (a Panel, not a disclosure); `admin/pages/AdminPitchSettings.jsx:46`; link "Call settings" `AdminSessionPitches.jsx:69` |

### README.md

| Line | Old | New | Evidence |
|---|---|---|---|
| 42 | Per-event theming: six site styles | seven site styles | 7 PRESETS; admin picker `AdminBranding.jsx:696`. Line 19 (demo, "all six") left: `apps/web/src/components/demoStyleIds.js:4` filters out `nclocal` |
| 91 | the six site styles | the seven site styles | `design/tokens/presets/` holds 7 JSON files |
| 101 | (Develop block started at `npm install`) | `npm run prepare:functions` added before `npm install` | `functions/package.json:16` and `console/functions/package.json:16` `"shared": "file:./vendor/shared.tgz"`; `.gitignore:5` `**/vendor/*.tgz`; both are root workspaces (`package.json:7-13`); CONTRIBUTING.md:49; CI runs it before install (`ci.yml:174`…) |
| 103 | shared package, Cloud Functions, and scripts | shared package, Cloud Functions, console functions, and scripts | `package.json:20` includes `console/functions/src/**/*.test.cjs` |
| 104 | the web app (Vitest) | the web app and the console web app (Vitest) | `package.json:21-22` `test:web` runs `test -w apps/web && test:console` |

### CONTRIBUTING.md

| Line | Old | New | Evidence |
|---|---|---|---|
| 108 | `packages/shared`, `functions` and `scripts` unit tests | `packages/shared`, `functions`, `console/functions` and `scripts` unit tests | `package.json:20` |
| 215 | hex exceptions: templates, schedule/pdf, pdf/kit, theme.css | adds `console/functions/src/emailLayout.cjs` | `eslint.config.mjs` allowlist block (`console/functions/src/emailLayout.cjs`) |
| 194 | Markdown row: Documentation checks … | adds: `README.md`, `console/README.md`, `docs/index.html`, `docs/handbook/**` and five guides in `docs/` also select lint, because `npm run check:copy` reads them | `scripts/ci/classify-changes.cjs:37-46,96-98,190`; `scripts/check-copy-style.cjs:16-34` |
| 195, 196, 197, 198, 199, 200, 203 | tier lists without the audit job | each adds "the dependency audit policy" | `classify-changes.cjs:194` (`audit: demoGenerator \|\| docsGenerator \|\| app \|\| backend \|\| shared \|\| … \|\| full`; pages-site paths match `isDocsGeneratorPath` regex `:82` and `isDemoGeneratorPath` `:74`); job name `ci.yml:183` "Dependency audit policy" |
| 202 (new row) | (none: `tests/*.rules.test.js` fell under "unrecognized path → full matrix") | `tests/*.rules.test.js` → Lint and rules emulators | `classify-changes.cjs:141-143,190,199,231` (`rulesTests` is recognized; selects lint and rules only) |

### docs/interface-guidelines.md

| Line | Old | New | Evidence |
|---|---|---|---|
| 238 | its values are the six preset ids | its values are the seven preset ids | `packages/shared/src/theme.cjs:666` `THEME_PRESET_IDS = Object.keys(PRESETS)` (7); `apps/web/src/contexts/EventConfigContext.jsx:298`; `apps/web/src/index.css:27` `[data-theme='nclocal']` |

### scripts/README.md

| Line | Old | New | Evidence |
|---|---|---|---|
| 12-13 | a service-account key file (what CI has, from `FIREBASE_SERVICE_ACCOUNT`). | a credentials file. In CI it is the Workload Identity Federation file that `google-github-actions/auth` writes; there is no `FIREBASE_SERVICE_ACCOUNT` key. | `.env.example:123-124`; `docs/DEPLOY_RUNBOOK.md:271`; every auth step uses `workload_identity_provider` (`deploy-client.yml:197-199`, `provision-client.yml:104`, `decommission-client.yml:87`, `deploy-console.yml:92-94`); no workflow names `FIREBASE_SERVICE_ACCOUNT` |
| 475 | Planned: `grant-admin`, `register-ticketing-webhook`, `export-attendees`, `generate-favicons` | `register-ticketing-webhook` removed from Planned | `scripts/register-ticketing-webhook.cjs` and its `.test.cjs` exist |

### functions/README.md

| Line | Old | New | Evidence |
|---|---|---|---|
| 15 | ` `src/announcements/` …` (no list marker) | `- `src/announcements/` …` | rendered as part of the `src/users/` item |
| 16 | `exportEventData` … for `sessions`, `speakers` or `organizations` (staff) | … for `sessions`, `speakers`, `speakerLogistics`, `organizations` or `invoices` (staff) | `functions/src/admin/dataExport.cjs:134,175,210-211,233-234,302-303` |
| 51 | operator row | adds `updateRegistrationForm`, `webAddress` for `status` and `check` | `ticketing/registrationForm.cjs:24` (operator); `admin/webAddress.cjs:143-148` (operator unless add/remove, which is then refused for all); both exported by `functions/index.js` |
| 52 | `updateEventConfig` (a change to the `sender` block … needs an operator; | adds: and no admin can change `sender.email` or `legal.postalAddressHtml` here; | `admin/config.cjs:513-520` refuses those changes before the tier check |
| 52 | `exportEventData` (for `sessions`, `speakers`, `organizations` and `invoices`; | adds `speakerLogistics` | `dataExport.cjs:210-211` tier staff |
| 52 | staff row | adds `saveAnnouncement`, `deleteAnnouncement` | `admin/announcements.cjs:157-159,204-206` (staff); exported by `functions/index.js` |
| 62 | only `src/core/firestore.cjs` imports firebase-admin. | Each module requires firebase-admin inside a function only, so loading a module does not load it. | 61 production files under `functions/src` require firebase-admin, all indented; loading all 61 left 0 firebase-admin modules in `require.cache` (checked with `node -e`) |

### apps/web/README.md

| Line | Old | New | Evidence |
|---|---|---|---|
| 12 | three-path allowlist | five-path allowlist | `eslint.config.mjs` four JS paths with the rule off, plus `apps/web/src/generated/theme.css` recorded in `ignores` as an allowlist path (`:49-51`) |
| 24 | `eventConfig.js` feeds event identity, dates, features, badges | … features, theme, launch | `src/generated/eventConfig.js:10,109,132,187` exports; `contexts/EventConfigContext.jsx:134-139` (no badges snapshot) |
| 100 | `--only functions,firestore,auth` | `--only functions,firestore,auth,storage` | `src/firebase.js:76-78` (media at `127.0.0.1:9199` under `VITE_USE_EMULATORS`); `lib/photoUpload.js:15`; `firebase.json` emulators include `storage` |
| 136-140 (new rows) | env table without these | rows for `VITE_FIREBASE_APP_CHECK_SITE_KEY`, `VITE_APP_CHECK_DEBUG_TOKEN`, `VITE_ENABLE_CLIENT_ERROR_REPORTING`, `VITE_CONSOLE_ORIGIN`, `VITE_BUILD_ID` | `src/firebase.js:94-106`; `lib/errorReporting.js:102-110`; `admin/components/ReportProblemDialog.jsx:10,29,66` |
| 162-164 | read in exactly one place — `src/lib/demoMode.js` — and consumed at five points: | read in `src/lib/demoMode.js` (and also in `src/pages/specimen/specimenRoute.js` and `generatedDir.js`). The main points that use it: | `specimenRoute.js:34-35`; `generatedDir.js:10`; the table has six rows; `IS_DEMO` is imported by 28 non-test files |
| 172 | row named `src/pages/Login.jsx` | removed from the row | `grep IS_DEMO\|demoMode src/pages/Login.jsx` is empty |
| 233-234 | Three open-license variable font sets … (three files — all SIL OFL 1.1) | Open-license font sets are self-hosted under `public/fonts/`. The families and their licences are listed in `public/fonts/README.md`. | `public/fonts/` has 27 woff2 files, 24 families |
| 277 | restricts payment handoffs to hosted Stripe Checkout, | accepts a payment handoff only as an `https` URL with no credentials and no port, | `src/lib/ticketingCommerce.js:77-89` `safeCheckoutUrl` |

### apps/web/public/fonts/README.md

| Line | Old | New | Evidence |
|---|---|---|---|
| 12 | Twenty-three families | Twenty-four families | the table under it has 24 family rows; 27 woff2 files |
| 16 | The other twenty families are never | The other families are never | a site loads two to four of 24, so the remainder is not fixed at twenty |

### docs/performance/public-bundle-report.md

| Line | Old | New | Evidence |
|---|---|---|---|
| 141 | CI checks the normal build and the committed demo build. | CI checks the normal build and a fresh demo build. | `.gitignore:8` `docs/demo/`; `docs/performance/public-bundle-budget.md:22` |

### console/README.md (finding 7)

| Line | Old | New | Evidence |
|---|---|---|---|
| 13 | two indexes named: "my organizations" and the review queue (descending) | adds the retention index (`status`, `updatedAt` ascending) | `console/firestore.indexes.json`; `functions/src/cleanup.cjs:138-139` |
| 34 | `review` … on a decline | on a decline, a close or a launch | `functions/src/reviewDecisions.cjs:71` (`transition`, used by decline and launch via `decide`), `:171` (close) |
| 34 | `agreementAcceptance` `{ id, version, sha256, name, email, at }` | adds `legalName`, `title` | `agreementAcceptance.cjs:144` |
| 34 | Written by … `closeApplication`, `deleteSpamApplication` …; Only `declineApplication` and `closeApplication` write `review`. | adds `launchApplication` to both | `reviewDecisions.cjs:137-139`; `handlers.cjs:88` |
| 43 | `agreement_acceptances` fields | adds `legalName`, `title` | `agreementAcceptance.cjs:138` |
| 46 | `by` (a uid, `retention`, `console` or `build`); writers list | adds `build-watch` and "the build watch" | `buildRetry.cjs:115`; `handlers.cjs:105` `runBuildWatch` |
| 101 | needs … a typed name. | a typed name, legal name and job title. | `agreementAcceptance.cjs:112-113` |
| 114 (new row) | no `launchApplication` row | `launchApplication` / Operators / `ready` to `launched` (**Mark as launched**) … Emails the Owners. | `handlers.cjs:88` (`mail: true`); `reviewDecisions.cjs:137-141`; `console/firebase.json:31`; `web/src/pages/review/ReviewActions.jsx:69,78` |
| 156-157 (new list entries) | operator review list had Decline, Retry, Delete | adds **Close request** and **Mark as launched** | `ReviewActions.jsx:78,81,84` |
| 220-224 (new rows) | settings table without these | `VITE_CONSOLE_SIGN_IN_PROVIDERS`, `CONSOLE_REPORT_INTAKE_URL`, `CONSOLE_REPORT_PROJECTS`, `CONSOLE_REPORT_INTAKE_SECRET`, `CONSOLE_REPORT_ACCESS_ID`/`_SECRET` | `web/src/pages/SignIn.jsx:10` (default `google,microsoft`); `deploy-console.yml:65,83-89`; `functions/src/handlers.cjs:24-28,202,240-242` |

## Skipped (with reason)

- `docs/design-reference.md:6,27,31,42,343,350` ("six site styles"): the section lists six styles and has no NC Local entry. Saying seven needs a new NC Local section and new counts for "five of the six", "four of the six"; that is content work, not a correction.
- `design/tokens/presets/*.json` `$first-class-note` and `design/tokens/presets/README.md` ("All six styles"): the README is generated from the JSON, which is config/source data. Out of scope.
- `README.md:19` "Compare all six site styles": correct for the demo (`demoStyleIds.js:4`).
- `docs/operator/session-pitches.md:43` rest of step 5 ("Enter the base ID and the table ID. A table name also works…"): the form now asks for **Airtable base link**, **Table name**, **View (optional)** and **Match Airtable columns** (`AirtablePitchSync.jsx:184-222`). The step needs a rewrite by someone who knows what the base-link field accepts; only the switch label was fixed.
- `docs/ADMIN_GUIDE.md:197` rest of paragraph still says "the mark" / "marked session": still understandable; rewording is style, not a defect.
- `docs/ADMIN_GUIDE.md:454-456` placeholder `{{days_until}}` vs the UI hint "[Days until event]" (`AttendeeReminderSchedule.jsx:384`): not verified which form the server accepts; not in the assigned list.
- `functions/README.md:5` "Landed so far (M2 backend foundation)" and no list entries for `src/public/`, `src/telemetry/`, `src/maintenance/`, `src/pdf/`, `src/schedule/`, `src/speakers/`: adding six module descriptions is new content.
- `functions/README.md` `account.welcome` template (audit 02 finding with no sender): code decision (wire or remove).
- `scripts/lib/firebase-init.cjs:12-13` header comment says `FIREBASE_SERVICE_ACCOUNT`: code comment, not Markdown.
- `console/functions/src/handlers.cjs` header omits `CONSOLE_HELP_NAME`: code comment.
- `console/README.md` pages table omits `/signin`, `/signin/finish`, `/organizations/:orgId/team`, `…/accepted-agreement`, `/invite/:inviteId`, `/review`, `/review/:appId`, `/review/settings` (`web/src/App.jsx:146-161`): eight new rows need a page description each; left for the owner. Also the `listApplicationsForReview`…`chooseEventbriteEvent` rows (console/README.md about line 110-127) sit below prose, apart from their table header at line 86, so they do not render as a table. Formatting; not changed.
- `scripts/README.md` "Planned" `grant-admin`, `export-attendees`, `generate-favicons`: whether they are still planned is an owner call. No headings were added for the ~25 undocumented scripts (per instruction).
- `apps/web/README.md`: none left from audit 06 finding 4.
- Support addresses (`info@eventrunner.org` vs `info@collaborativejournalism.org`), `NOTICE` (name and font list), `docs/handbook/*` (invoices, Stripe), `docs/project/index.html`, `docs/ROADMAP.md` (M14 ticks, "five phases"), `CHANGELOG.md` headings, ADR status lines (0004, 0005, 0006), ADR 0008 `presenter_5_email`, ADR 0001 `required-endpoints.json`, `RELEASING.md:77` `source_revision`, `video/README.md:46-47` and `docs/video-production.md` (Pages publishes `docs/videos/`), `docs/plans/**`, `docs/pr-evidence/**`, `tasks/**`, "Run of Show" leftovers in `docs/ROADMAP.md:5` / `docs/DEPLOY_RUNBOOK.md:17`: owner decisions or excluded areas per the brief.
- `CONTRIBUTING.md` console row: the tier table has no console row, but line 209 states the console selection in prose and is correct. Not changed.
