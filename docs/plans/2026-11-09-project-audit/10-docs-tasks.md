# Audit 10: root Markdown, docs/, tasks/, video/, design/

Read-only. Nothing in the repository was changed. `node scripts/check-docs.cjs` was run once (passes), plus grep and `node -e` one-liners.

Findings are ordered by severity. Items 12 to 17 are inventories for an owner decision: they give facts, not a verdict.

---

### 1. Admin guide and Stripe operator guide name controls the admin no longer has

- Category: inconsistent (docs vs code)
- Confidence: certain for the rows below (each label was searched in `apps/web/src`, tests included, and the component was read)
- Where and evidence:

| Doc says | Where in docs | What the code has now |
|---|---|---|
| **Save image draft** / **Save and publish image** | `docs/ADMIN_GUIDE.md:103` | `Save draft` / `Publish` (`apps/web/src/admin/components/HomeHeroImageEditor.jsx:111,114`) |
| **This session needs no slides or other materials** (tick) | `docs/ADMIN_GUIDE.md:197` | switch `Request speaker materials` (`AdminSessionEditor.jsx:477`): the sense is inverted too |
| **Show this session when it is published** | `docs/ADMIN_GUIDE.md:719` | `Show on the schedule` (`AdminSessionEditor.jsx:486`) |
| **Show this organization when it is published** | `docs/ADMIN_GUIDE.md:205,719` | `Show on the sponsors page` (`AdminOrganizationEditor.jsx:400`) |
| **Save attendee settings** | `docs/ADMIN_GUIDE.md:458` | `Save` (`AttendeeReminderSchedule.jsx:389`) |
| **Configure ticket catalog** | `docs/ADMIN_GUIDE.md:552`, `docs/operator/stripe-ticketing.md:107` | panel `Ticket catalog` (`StripeCatalogPanel.jsx:138,140`); no control has the doc's name |
| **Pause new sales** checkbox, **Publish the catalog**, **Save catalog** | `docs/ADMIN_GUIDE.md:554`, `stripe-ticketing.md:111,123` | switches `Publish tickets` and `Ticket sales`, button `Save` (`StripeCatalogPanel.jsx:155,156,183`) |
| **Review reopening sales** / **Review pausing sales** | `docs/ADMIN_GUIDE.md:554`, `stripe-ticketing.md:123,179` | `Reopen sales` / `Pause sales` (`StripeTicketingWorkspace.jsx:64`) |
| **Resync this order** | `docs/ADMIN_GUIDE.md:560`, `stripe-ticketing.md:141,149` | `Refresh order` (`StripeOrderDetail.jsx:185`) |
| **Search orders** | `stripe-ticketing.md:135` | `Search` (`StripeTicketList.jsx:66`) |
| **Review check-in correction** | `docs/ADMIN_GUIDE.md:568`, `stripe-ticketing.md:153` | dialog `Undo this check-in?` (`StripeCheckInPanel.jsx:54`) |
| **Make a card payment link** | `docs/ADMIN_GUIDE.md:650`, `stripe-ticketing.md:169` | `Create payment link` (`InvoiceCardPayment.jsx:190`) |
| **Download the speaker template** | `docs/ADMIN_GUIDE.md:759` | `Download speaker template` (`AdminRecordImport.jsx:302`) |
| **Save as a new message** | `docs/ADMIN_GUIDE.md:814` | `Save new message` (`AnnouncementSavedMessages.jsx:253`) |
| **Search by name or id** | `docs/ADMIN_GUIDE.md:932` | `Search by name` (`AdminVersionRecords.jsx:229`) |
| **+ Add track** | `docs/ADMIN_GUIDE.md:975` | `Add track` (`EventTracksEditor.jsx:138`) |
| **Manage pitch emails** | `docs/ADMIN_GUIDE.md:5`, `docs/operator/session-pitches.md:263` | panel `Pitch emails` on `/admin/pitches/settings` (`PitchEmails.jsx:89`) |
| **Export the shown pitches** | `docs/operator/session-pitches.md:44` | `Download pitches` (`AdminSessionPitches.jsx:71`) |

- How it is reached: the admin labels were reworded on 2026-11-05 (`0f6582b` "Admin registration, program and people: plain words and icon utilities"). The guides were not updated. Both guides are published pages (`admin-guide/`, `stripe-ticketing/`), so staff look for buttons that do not exist.
- Not verified (likely the same class): "Email an announcement" (`ADMIN_GUIDE.md:797`), "Use this Airtable connection" (`session-pitches.md:43`), "Hidden — staff-issued only" (`stripe-ticketing.md:109`). No string match in `apps/web/src`.
- Proposed fix: update the labels in `docs/ADMIN_GUIDE.md`, `docs/operator/stripe-ticketing.md`, `docs/operator/session-pitches.md`, then `node scripts/build-pages.cjs`.

### 2. Docs say "six site styles"; the catalog and the admin picker have seven

- Category: inconsistent
- Confidence: certain
- Where: `README.md:42,91`; `docs/ADMIN_GUIDE.md:67` ("Six site styles are available"); `docs/design-reference.md:6,27,31,350`; `docs/interface-guidelines.md:238` ("the six preset ids"); `design/tokens/presets/*.json` `$first-class-note` ("All six styles…", in all seven files, `nclocal.json:5` included), copied into `design/tokens/presets/README.md` seven times.
- Evidence: `scripts/build-preset-catalog.cjs:92-94` `PRESET_ORDER = ['civic','newsroom','broadsheet','atlas','field-guide','zine','nclocal']`; `Object.keys(require('./packages/shared/src/presetCatalog.cjs').PRESETS)` prints seven ids; `design/tokens/presets/` holds seven JSON files. Only the demo filters `nclocal` out (`apps/web/src/components/demoStyleIds.js:4`), so "compare all six" is still true for the demo (`README.md:19`, `docs/project/index.html:124`).
- Impact: `docs/design-reference.md` ("Every site style… in full") has no NC Local section (grep `nclocal|NC Local` returns nothing there or in `ADMIN_GUIDE.md`).
- Proposed fix: say seven (or "six plus the NC Local pilot style") in the files above, and add the NC Local entry to `docs/design-reference.md`. Leave the demo sentences.

### 3. Handbook pages describe a product without invoices or Stripe tickets

- Category: inconsistent (describes a removed limit)
- Confidence: certain
- Where:
  - `docs/handbook/faq.md:5`: "Summit-only tools (video generator, invoices) stay there."
  - `docs/handbook/for-clients.md`: "What v1 does not include…: video generation, invoicing, social feeds, speaker chat"; "Eventbrite or spreadsheet tickets"; "Whether tickets are Eventbrite, a spreadsheet, or neither".
  - `docs/handbook/for-event-staff.md` (Tickets): "Your operator chose Eventbrite, a spreadsheet import, or no ticketing."
  - `docs/project/index.html` (Ticketing card and Milestone 4): "Eventbrite and manual CSV adapters" only.
- Evidence: `README.md` lists "Sponsor invoices with a PDF, email, and an optional card payment link" and "Stripe Checkout on the organizer's own Stripe account"; `docs/ROADMAP.md:247-249` ticks #208, #209, #519; code in `apps/web/src/admin/pages/AdminInvoiceEditor.jsx`, `functions/src/ticketing/stripeCheckout*.cjs`.
- Proposed fix: edit those four files; regenerate `docs/docs/`.

### 4. Two support addresses are in use for the same purpose

- Category: inconsistent
- Confidence: certain (which one is right is the owner's call)
- Where: `info@eventrunner.org` in `README.md`, `CONTRIBUTING.md:5` ("Code of Conduct… Reports go to info@eventrunner.org"), `SUPPORT.md`, `SECURITY.md`. `info@collaborativejournalism.org` in `GOVERNANCE.md:18-19`, `CODE_OF_CONDUCT.md:63`, `docs/handbook/faq.md:31`, `for-attendees.md:52`, `for-clients.md:43`, `for-event-staff.md:69`, `getting-help.md:14,30`.
- Evidence: `SECURITY.md` comment: "info@eventrunner.org is the operational address (Postmark Server "Event Runner", verified per issue #98)". `CONTRIBUTING.md:5` and `CODE_OF_CONDUCT.md:63` name different addresses for the same conduct report.
- Proposed fix: replace the older address in the seven files (if the owner confirms), then regenerate.

### 5. NOTICE is out of date: old product name and a partial font list

- Category: inconsistent
- Confidence: certain
- Where: `NOTICE:1` "Run of Show"; `NOTICE:10-18`.
- Evidence: `NOTICE` says the product bundles woff2 fonts "each licensed under the SIL Open Font License 1.1" and lists five families. `apps/web/public/fonts/` holds 24 families (its README table). `console/functions/fonts/` bundles `DejaVuSans*.ttf` (its own `LICENSE-DejaVuSans.txt`, not OFL) and `NotoSans*.ttf`; NOTICE does not mention that directory. Bricolage Grotesque is only in `docs/fonts/`.
- Other "Run of Show" leftovers in text people read: `docs/ROADMAP.md:5` ("Run of Show v1 project"), `docs/DEPLOY_RUNBOOK.md:17` (`your-org/run-of-show`), `.github/DISCUSSION_TEMPLATE/show-and-tell.yml:6`, `.env.example:1`. (`demo-run-of-show` as an emulator project id is in use and is not a finding.)
- Proposed fix: rename in `NOTICE`; either list every bundled family or drop the list and point to the three font READMEs, with the DejaVu licence named.

### 6. README "Develop" omits the step CONTRIBUTING calls required

- Category: inconsistent
- Confidence: likely (not run: a fresh install is outside the audit rules)
- Where: `README.md` Develop block starts at `npm install`; `CONTRIBUTING.md` Dev setup: "`npm run prepare:functions` # packs packages/shared into functions/vendor/ — required before install".
- Evidence: `functions/package.json` has `"shared": "file:./vendor/shared.tgz"`; `.gitignore` has `**/vendor/*.tgz`, so a fresh clone has no tarball.
- Smaller, same block: `npm test` is described as "shared package, Cloud Functions, and scripts" (`README.md`, `CONTRIBUTING.md` test table), but the script also runs `console/functions/src/**/*.test.cjs` (`package.json`).
- Proposed fix: add `npm run prepare:functions` before `npm install` in `README.md`; add "console functions" to the two descriptions.

### 7. ROADMAP M14 (client console) is all unticked while the console is live

- Category: inconsistent
- Confidence: likely (issue state on GitHub was not read)
- Where: `docs/ROADMAP.md:119-130`: "Console foundation", "Guided setup and the status page", "Operator review", "Provisioner", "Custom web address" are `[ ]`.
- Evidence: `README.md` Status: "The client console is live at console.eventrunner.org: a client opens one signup link… the site builder makes their site". `CHANGELOG.md` [Unreleased] has "The guided setup in the client console (ADR 0007 §3, P5)" and "Settings → Web address (ADR 0007 §8, P9a)". Code: `console/web`, `console/functions`, `scripts/provision-client.cjs`, `.github/workflows/provision-client.yml`.
- Also: `docs/ROADMAP.md:3` "v1 is five phases" beside M6, M13, M14 and M7 to M12; M13 says "built, in review" and README says "are built".
- Proposed fix: tick what shipped in `docs/ROADMAP.md`; regenerate.

### 8. video/README says publishing the preview page is a separate decision, but Pages already publishes it

- Category: inconsistent / inefficient
- Confidence: certain on the mechanism; owner-decision on what to do
- Where: `video/README.md:46-47` ("Publishing that page is a separate repository deployment decision"); `docs/video-production.md` last paragraph; `.github/workflows/pages.yml:116-118` (`upload-pages-artifact` with `path: docs`).
- Evidence: the artifact is the whole `docs/` tree. `docs/videos/` (eight MP4s, 88 MB with posters) is served at `/videos/` after every push to `main`. `scripts/build-pages.cjs:62-69` already treats `videos/index.html` as a landing page. No page links to `/videos/` (grep of `docs/index.html`, `docs/project`, `docs/support`).
- Same mechanism: `docs/plans/` (28 MB) and `docs/pr-evidence/` (25 MB) are uploaded and served too. `scripts/lib/pages-manifest.cjs:8-10` says plans "are not public navigation": true for navigation, but the files are public at their paths. About 141 MB of the 143 MB committed `docs/` tree is not part of the site.
- Proposed fix (owner): either correct the two sentences, or stage only the site files for upload in `pages.yml`.

### 9. CHANGELOG `[Unreleased]` repeats its category headings and nothing has been released

- Category: inconsistent
- Confidence: certain
- Where: `CHANGELOG.md:10,43,1244` (`### Added` three times), `829,1205,1340` (`### Fixed` three times), `16,1351` (`### Security` twice), all under the single `## [Unreleased]` at line 8; the file has 1,374 lines and no version section.
- Evidence: `RELEASING.md` "CHANGELOG hygiene": an entry goes "in the category it belongs to… creating the category heading if this PR is the first entry in it". `tasks/director/union.py` joins conflict blocks "ours then theirs", which is how headings repeat.
- Proposed fix: merge the repeated headings in `CHANGELOG.md`; regenerate.

### 10. Small stale statements (each verified)

- Category: inconsistent
- Confidence: certain unless noted
- `docs/performance/public-bundle-report.md:141`: "CI checks the normal build and the committed demo build." `docs/demo/` is not committed (`.gitignore`, `docs/performance/public-bundle-budget.md`: "CI needs no committed `docs/demo/`").
- `docs/adr/0008-registration-and-pitch-steppers.md:71-72`: CSV columns "`presenter_1_name` … `presenter_5_email`". Code: `packages/shared/src/pitchForm.cjs:348-351` accepts `presenter_[1-4]_(name|email|organization|role)`; the last column is `presenter_4_role`. `docs/operator/session-pitches.md:348` has it right.
- `docs/adr/0005-airtable-pitch-intake.md:4` "Proposed for review with the implementation on this branch"; `0004:4` and `0006:4` "Proposed for review…". All three are merged and README cites them as shipped. (ADR 0003 "Proposed" agrees with `docs/ROADMAP.md` #177 unticked; not a finding.)
- `RELEASING.md:77`: "whatever provisioning mechanism reads a `source_revision`". No `source_revision` exists in the repository or in the runbook.
- `scripts/check-docs.cjs:9-11` (comment, outside my area): "Local task ledgers and agent state are not versioned". `tasks/` is tracked (86 files), so its Markdown is committed but never link-checked. A manual check of `tasks/**/*.md` found 0 broken relative links today.
- `docs/adr/0001-event-platform-v1.md:1895`: the smoke list "lives in `functions/src/required-endpoints.json`". The file does not exist (the ADR is the original contract; likely superseded; low value).
- `apps/web/public/fonts/README.md` (outside my area, likely): "Twenty-three families… The other twenty" above a table with 24 family rows.

### 11. tasks/director scripts: machine paths and one drifted claim

- Category: inconsistent (low)
- Confidence: certain
- Where: `tasks/director/checks.sh:3` and `regen.sh:5` default to `/home/user/eventrunner`; `capture.sh:14,50` defaults output to `/home/user/evidence/out` (does not exist; `mkdir -p` creates it); example paths `/home/user/wt-ev`, `/home/user/evidence/plans/pr1.json` do not exist. `tasks/todo.md` and `tasks/lessons.md` name about 25 `/home/user/wt-*` worktrees and `/home/user/specs/<id>.md`.
- `capture.sh:73` says "Same fixed, credential-free values scripts/dev/run-e2e.sh uses", but `run-e2e.sh:48-50` now also exports `EVENT_AIRTABLE_ENABLED`, `EVENT_AIRTABLE_API_ORIGIN`, `AIRTABLE_API_TOKEN`. A capture plan that opens an Airtable pitch screen runs with different settings than the e2e suite.
- Checked and still correct: `capture.spec.mjs` imports (`ADMIN_EMAIL`, `adminDb`, `mailFileSize`, `waitForOtpCode`) exist in `e2e/helpers.mjs`; every command in `checks.sh` and `regen.sh` exists; `run-e2e.sh` still takes no test-file argument.
- References: only `tasks/todo.md:605,639-645` and `tasks/lessons.md:70,103` mention these scripts. Nothing in `package.json`, CI or `scripts/` runs them.
- Proposed fix: none needed for function; add the three Airtable exports to `capture.sh` if it stays.

---

## Inventories for an owner decision (facts only)

### 12. docs/plans: 201 files, 28 MB

- Category: unneeded? | Confidence: owner-decision
- 11 dated Markdown plans (about 380 KB), `2026-11-08-state-machine-map/` (6 files, 165 KB), `evidence/` (184 files, 26.7 MB).
- Referenced from outside `docs/plans/`:
  - `2026-08-16-event-platform-v1-triage.md`: README, GOVERNANCE, ROADMAP, ADR 0001, handbook/for-clients, `.github/ISSUE_TEMPLATE/feature.yml`, docs/project.
  - `2026-08-26-operator-handoff.md`: POSTMARK_PROVISIONING.
  - `2026-08-27-admin-identity-story.md`, `2026-09-10-admin-editorial-desk.md`: code comments in `apps/web/src/admin/*`, `index.css`, interface-guidelines, CHANGELOG.
  - `2026-08-27-design-system-overhaul.md`, `2026-08-27-preset-visual-stories.md`: `design/tokens/presets/*`, `scripts/build-preset-catalog.cjs`.
  - `2026-09-09-cjs-parity-gap.md`: ROADMAP, `functions/src/users/export.cjs`, tasks/*.
  - `2026-09-10-design-vocabulary-expansion.md`: CHANGELOG, ROADMAP, tasks.
  - `2026-11-08-state-machine-map/`: `packages/shared/src/consoleRequest.cjs`, `tasks/todo.md`.
- No reference from outside `docs/plans/`: `2026-08-26-trademark-screen.md` (one link from another plan), `2026-11-05-action-feedback.md`, `2026-11-06-interface-experience.md` (no reference at all).
- `evidence/` by folder: `specimen/` (34 files, 16.9 MB) is referenced by `scripts/dev/capture-specimen.mjs`, `scripts/README.md` and one plan (it is that script's output folder). `admin-editorial-desk/` (29 files, 2.5 MB) is referenced by its plan. The other 12 folders (121 files, 7.4 MB) have no reference anywhere: `issue-316-mobile` 2.3 MB, `theme-heroes` 1.3 MB, `pr122` 0.9 MB, `pr119` 0.7 MB, `pr693`, `pr690`, `pr694`, `m8-repair`, `admin-day-headings-and-photo-focus`, `pr-262`, `pr692`, `issue-316-section-label`.

### 13. docs/pr-evidence: 144 files, 25 MB

- Category: unneeded? | Confidence: owner-decision
- Ten folders. One reference in the repository: `event-time-fields/` from `tasks/reports/l3.md`. The other nine (`nclocal` 19.4 MB with 65 files, `launch-rehearsal-links` 1.8 MB, `333-image-sizes` 1.3 MB, `npm-claim-policy`, `session-pitches`, `pitch-external-form`, `340-role-switcher`, `r6b-promo`, `badger-brand`) are named by no file.
- No doc (CONTRIBUTING, AGENTS, builder-brief, lessons) defines this folder or says when to add to it.
- Caveat: pull request descriptions on GitHub may embed these images by URL. That was not checked; deleting a file breaks such an image.

### 14. tasks/reports (67 files, 720 KB) and tasks/specs (13 files, 416 KB)

- Category: unneeded? | Confidence: owner-decision
- Reports referenced (14): `a3, a4, b1-b6, c1-c5, c7`, each from its spec, four also from `tasks/todo.md`.
- Reports nothing references (53, 333 KB): `22-deploy-exit, 27-hero-spacing, 35-tz-controls, 37-invoice-issue, 39-invoice-email, 40-composer-saved`, the 20 `483-*`, three `486-*`, `a1, a2, b7, deploy-new-retry, g1-g5, l1-l3, pr508-codex, r1-r3, s1, u1-u3, w1, w2, w4, w5`.
- Specs referenced (8): `b3-b6, c1-c3, c7`. Not referenced (5): `b1, b2, c4, c5, c6`.
- Nothing outside `tasks/` references any report or spec. `tasks/builder-brief.md` tells builders to write `tasks/reports/<id>.md`. Last change to both folders: 2026-11-04.
- `tasks/todo.md` (680 lines) is the live ledger: its top section is dated 2026-11-08; sections from line 416 down are handoff state from 2026-09-23/24.

### 15. video/: 285 files, 120 MB, outside CI

- Category: unneeded? / inefficient | Confidence: owner-decision
- `video/assets/audio/*.wav`: 8 files, 95 MB. Each is named only in `video/review/audio-quality.json`; `render.mjs:51` builds the path from piece and format. They are output of `npm --prefix video run score` (`make-score.mjs`), which the README describes as fully synthesized from oscillators and seeded noise, and `score-provenance.mjs` checks their hash. They are regenerable inputs to `render`.
- `docs/videos/*.mp4` (8 files, 82 MB) and posters (8 PNG, 7.5 MB): all referenced by `docs/videos/index.html`, `docs/video-*.md` and `video/review/*.json`. `docs/videos/*-transcript.md` are byte-identical copies of `video/<piece>/transcript.md`, written by `video/preview-page.mjs:21` (generated, by design).
- Nothing runs the kit automatically: `video` is not an npm workspace; no workflow, root script or `scripts/ci/classify-changes.cjs` rule names it. `npm --prefix video run check` (7 test files plus `tsc`) is manual only.
- Superseded study code, still present: `video/README.md` says the trailer "supersedes… the 20-second Boardwalk-inspired study". `video/trailer/prepare-study.mjs` and `video/trailer/make-study-score.mjs` are in no package script and no doc; `trailer/study-timeline.ts`, `trailer/geometry.ts`, `trailer/stage.ts` remain imported by `bootstrap.ts:6` and `tests/direction.test.mjs`, so the study path is still compiled and tested.
- Review files nothing references: `video/review/current-ending.jpg`, `preview-1440.jpg`, `preview-390.jpg` (575 KB together), `assembly-ending-{landscape,vertical}-flash.json`, `assembly-motion-landscape-flash.json`, `render-readback-check.json`, `publish-page-{landscape,vertical}-partial-flash.json`, `preview-review.json`.
- Captures no script or timeline uses: `video/assets/captures/vertical/operator-schedule-menu.png`, `operator-speakers-menu.png`, `speakers-menu.png` (329 KB). `capture/run.mjs:64-65` writes them; no `script.json` or `timeline.ts` names them.
- All eight `package.json` scripts point at files that exist; every README command and flag exists.

### 16. design/brand/concepts: 9 PNGs, 9.4 MB

- Category: unneeded? | Confidence: owner-decision
- `design/brand/README.md` names `00-badger-reference.png`, `logo-d.png`, `og-a.png` and says of the folder: "All original concept references, kept with the final artwork" (deliberate).
- Named by no file: `illustration-a.png`, `logo-a.png`, `logo-b.png`, `logo-c.png`, `og-b.png`, `og-c.png` (7.1 MB).
- `design/brand/*.svg` and `design/tokens/*` are all referenced.

### 17. Pages manifest vs docs/ source

- Category: inconsistent? | Confidence: owner-decision
- All 30 `source` entries in `scripts/lib/pages-manifest.cjs` exist. No missing source, no duplicate.
- Maintained docs under `docs/` that are not in the manifest (GitHub only): `docs/operator/session-pitches.md` (364 lines) and `docs/operator/problem-reports.md` (the other four operator guides are published; published `handbook/for-event-staff.md` links to session-pitches, so that link leaves the site); ADRs 0002, 0004, 0005, 0006, 0007, 0008 (only 0001 and 0003 are published; README links 0004 to 0008 as the record for shipped features); `docs/COPY_STYLE.md`; `docs/nclocal-demo.md`; `docs/design/*` (4); `docs/testing/*` (2); `docs/performance/*` (2); `docs/video-*.md` (5).
- The manifest comment says only `docs/plans/**` is left out on purpose; it gives no reason for the others.

---

## Files read

- Root: `README.md`, `CONTRIBUTING.md`, `RELEASING.md`, `SECURITY.md`, `SUPPORT.md`, `GOVERNANCE.md`, `AGENTS.md`, `NOTICE` in full; `CHANGELOG.md` lines 1-60 and its heading structure; `CODE_OF_CONDUCT.md` by grep.
- `docs/`: in full: `handbook/*` (7), `operator/admin-sessions.md`, `problem-reports.md`, `webmcp-diagnostics.md`, `design/*` (4), `testing/*` (2), `performance/*` (2), `docs/fonts/README.md`, `docs/project/index.html` (text). By section plus automated passes: `ADMIN_GUIDE.md`, `DEPLOY_RUNBOOK.md`, `CLIENT_ONBOARDING.md`, `POSTMARK_PROVISIONING.md`, `EVENTBRITE_VERIFICATION.md`, `NPM_NAME_CLAIM.md`, `ROADMAP.md`, `design-reference.md`, `interface-guidelines.md`, `operator/session-pitches.md`, `operator/stripe-ticketing.md`, `operator/archive-handoff.md`, ADRs 0001-0008 (headers and flagged lines), `video-*.md`. Not read line by line: `docs/plans/**`, `docs/pr-evidence/**` (inventory only), `docs/docs/**` (generated).
- `tasks/`: `builder-brief.md`, `director/*` (5) in full; `todo.md` lines 1-60 plus headings; `lessons.md` by grep; `reports/`, `specs/` inventory only.
- `video/`: `README.md`, `package.json`, `local-env.sh`, `.gitignore`, `review/verification-summary.md`, `trailer/direction-study.md`; import graph of every `.mjs`/`.ts`; asset reference check for all 285 files.
- `design/`: `brand/README.md`, `tokens/presets/README.md` (headings and notes), file reference check.
- Code read to verify: `scripts/lib/pages-manifest.cjs`, `scripts/check-docs.cjs` (head), `scripts/build-pages.cjs` (head), `scripts/build-preset-catalog.cjs`, `.github/workflows/pages.yml`, `ci.yml` (job names, shards), `package.json` files, `scripts/dev/run-e2e.sh`, `e2e/helpers.mjs` exports, and the admin components named in finding 1.

## Checked and found correct

- `node scripts/check-docs.cjs` passes: no broken relative Markdown or HTML link outside `tasks/`. `tasks/**/*.md`: 0 broken relative links (manual pass).
- Every backticked repository path in root docs, `docs/*.md`, handbook, operator, design, testing, performance and video docs exists (misses were `docs/demo/` build output, `.codex/config.toml` stated as absent on purpose, `console/functions/.env` local file, and ADR 0001's upstream-repo paths).
- All 79 environment and variable keys named in docs (`EVENT_*`, `VITE_*`, `CONSOLE_*`, `PAGES_*`, `E2E_*`, `LOCAL_CI_ACTOR_ID`, `AUTO_DEPLOY_ENVIRONMENTS`, …) exist in code, workflows or `.env.example`.
- Every `node scripts/…` and `video/…` command in docs names an existing script, and every `--flag` shown exists in that script. Every `npm run <name>` exists. Every `gh workflow run … -f key=` uses a real `workflow_dispatch` input (`deploy.yml`: client, provision, bootstrap; `provision-client.yml`: application_id, test_mode).
- All workflow file names in docs exist (`preview.yml`, `bug_report.yml`, `feature_request.yml` appear only in ADR 0001's original tree sketch).
- All `DEPLOY_RUNBOOK.md §N` cross references (§0 to §12.6) point at sections that exist; AGENTS.md "runbook §12.6" is right.
- CONTRIBUTING: hex-ban exception list matches `eslint.config.mjs`; three e2e shards and two web shards match `ci.yml`; `firebase-tools ~15.22.4` matches `package.json`; Node range matches `engines`; job names "Documentation checks", "Shared package tests", "CI gate" exist.
- AGENTS.md: `.claude/settings.json` has the attribution settings and the `jq` hook as described; `.github/workflows/no-ai-attribution.yml` exists.
- `docs/performance/public-bundle-budget.md` limits equal `scripts/ci/bundle-budget.json`; the report records each limit change.
- Handbook numbers: custom badges 3 (`MAX_CUSTOM_BADGES`), four co-presenters (`MAX_CO_PRESENTERS`), WebMCP tool names, `CONSOLE_REPORT_*` settings and the "Reports are not switched on yet" message all match code.
- Root site assets (`docs/*.png`, `favicon.svg`, `tokens.css`, `styles.css`, `docs.css`, `scroll-regions.js`, `docs/fonts/*`, `docs/examples/demo-answers.json`) are all referenced.
