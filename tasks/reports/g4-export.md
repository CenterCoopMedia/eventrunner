# g4-export: full event data export and archive handoff

Branch `joe/wave3-g4-export`. Issue #329 ("Export a portable event data package for customer handoff"). One product commit, then this report.

## What changed

**Server (functions/src/admin/, all new files):**

- `exportRecords.cjs`: one record function per collection. Private collections (speakers, users, session_pitches, session_materials, ticket_orders, tickets, media_assets) copy named fields only. Public-by-design documents (live CMS documents, public config) copy the stored document without publish bookkeeping. Every record then passes `scrub`, which removes any key that names a credential or a raw payload at any depth (`token` but not `tokens`, `secret`, `password`, `apiKey`, `privateKey`, `credential`, `signature`, `raw`, `payload`, `stripeRequest`, `idempotencyKey`, `checkoutUrl`). `readPages` reads a collection in document-id order, 300 at a time, under a document cap.
- `dataExport.cjs`: `exportEventData`, POST `{ dataset }`, answers `{ filename, csv, rowCount }` like `exportAttendees`. `sessions`, `speakers`, `organizations` are staff tier. `orders`, `admissions` are operator tier; the gate admits both tiers and then refuses staff by name. Explicit columns, `escapeCell` from users/export.cjs, BOM and CRLF, admin_logs row written before the file (fail closed), 413 past 20,000 documents or 10 MB.
- `eventPackage.cjs`: `downloadEventPackage`, operator tier, POST `{ sections, includeStaffNotes }`. Builds a deflated zip (yazl) in memory: JSON per record type, CSV for the main lists, `manifest.json` (format `eventrunner-event-data-package`, schema version 1, export time, per-file records/bytes/SHA-256, relationships, exclusions), `README.md` (files, formats, relationships, exclusions, personal data and retention). Never reads `config/bootstrap`, `config/providers`, drafts, version history, admin_logs, auth, rate-limit, mail, invite, webhook, sync-queue, payment-attempt or inventory collections. 413 past 50,000 documents or 9 MB, naming the script. admin_logs row before the first byte; no row, no package. Response only, never Storage.
- `eventPackageReader.cjs`: reads a package zip and verifies manifest, checksums, counts, unexpected files, and every relationship (dangling references are counted, not treated as damage).
- `exportFixture.cjs`: synthetic event for the tests. Every forbidden value starts with SECRET or PRIVATE.
- `functions/index.js`, `.github/smoke-endpoints.json`: the two endpoints.
- `functions/src/cms/firestoreFake.cjs`: `orderBy('__name__')` orders by document id (additive).

**Script:** `scripts/export-event-package.cjs` builds the same package with no cap (firebase-init credentials), writes an admin_logs row with `details.via: 'script'`, writes the file 0600, refuses to overwrite without `--force`; `--verify <zip>` runs the reader.

**Web:** `apps/web/src/admin/pages/AdminDataExport.jsx` (route `data-export`, docket item "Data export" in the System group, staff tier), `apps/web/src/admin/eventPackage.js` (zip fetch, server words on refusal, nothing saved on a cut body). Staff see three spreadsheet rows and a sentence that an operator exports orders, admissions and the package. Operators also see the two operator rows and the package panel: a fieldset of eight parts (all chosen), a staff-notes checkbox (off), and the download button. No control is disabled; busy controls carry aria-busy and aria-disabled; an empty choice states why. Results stay in place.

**Docs:** new `docs/operator/archive-handoff.md` (three kinds of access, spreadsheets, package, script and `--verify`, managed Firestore export, Storage copy, read-only past site with archive date and `historicalDemo`, retention and deletion, handoff record); added to `scripts/lib/pages-manifest.cjs` (Operate group). `docs/ADMIN_GUIDE.md` (tier table, new "Data export" section), `docs/CLIENT_ONBOARDING.md` (handoff subsection "After the event: data export and archive"), `functions/README.md`, `CHANGELOG.md`.

## Tests added

- `functions/src/admin/dataExport.test.cjs` (14): request validation, tiers per dataset, 401/403/405 gate, staff refused orders and admissions with no audit row, each CSV's content and formula escaping (`'=HYPERLINK`, `'+SUM`, `'@Ledger`, `'=Cy`), no SECRET/PRIVATE value or account id in any file, audit row shape, fail-closed audit, 413 on cap, 650 documents read across pages in id order.
- `functions/src/admin/eventPackage.test.cjs` (12): request validation, operator-only gate, headers, manifest and README for every file, reader verification with zero dangling references, tamper and dangling detection, no secret in any file, design tokens kept, published-only JSON vs current-revision CSV, joins, staff-note opt-in, audit row and fail-closed, 413 on both caps, `scrub`.
- `scripts/export-event-package.test.cjs` (5): argument contract, `--verify` end to end on a saved zip, damaged file, overwrite refusal.
- `apps/web/src/admin/pages/AdminDataExport.test.jsx` (8): page held to the server's datasets, tiers and sections; staff and operator views; export flow, busy state, refusal, package choices, empty choice.
- `apps/web/src/admin/eventPackage.test.js` (5).
- `tests/firestore.rules.test.js`: "event data export: sources and audit rows (issue 329)" (4).
- `e2e/data-export.spec.js` (2): staff signs in, exports sessions through the page, file read from disk (escaped title, speaker name, no SECRET), admin_logs row; staff ID token refused by both operator endpoints (403). Operator downloads the package through the page; the saved zip passes `verifyEventPackage`, keeps the seeded session → speaker and order → ticket joins, carries no SECRET and no bootstrap.
- Updated docket lists in `AdminApp.test.jsx`, `AdminLayout.test.jsx`, `AdminTour.test.jsx`.

## Issue #329 "Acceptance criteria", clause by clause

1. "Define a versioned manifest and documented formats for exported records, IDs, relationships and media/material files or references." Met. `manifest.json` (format, `schemaVersion: 1`, per-file records and SHA-256, `relationships`, `excluded`) and `README.md` in every package. Proof: eventPackage.test.cjs "an operator gets a private zip with a versioned manifest and a README for every file"; media and materials are references (`content/media.json`, `materials/materials.json`), documented in the README and the runbook.
2. "Include required event content and private operational data with explicit permission and exclusion controls; never include secrets or credentials." Met. Operator-only package, per-part choice, staff notes opt-in, explicit exclusion list. Proof: "no file holds a secret, a credential, a private note, a staff address or an excluded collection", "staff notes go only when the operator includes them", AdminDataExport.test.jsx package tests, E2E operator test.
3. "Gate and audit export; use private delivery and bounded/paginated processing rather than public object paths." Met. Proof: gate tests in both test files, the rules test block, the E2E 403 calls; audit and fail-closed tests; "a page larger than one read page is read in id order"; 413 cap tests; the zip is only in the response body (no Storage write anywhere in the module).
4. "Document retention/deletion and the difference between cloud project access, data ownership terms and portable export." Met in `docs/operator/archive-handoff.md` ("Three kinds of access", "Retention and deletion") and the package README ("Personal data and retention").
5. "Validate an export against synthetic data and demonstrate relationship preservation and recovery/import or a documented consumer path." Met. `verifyEventPackage` and `--verify`; "the reader verifies the package: checksums, counts, and every relationship resolves"; the E2E test reads the browser-saved zip. The consumer path is documented (unzip, read manifest, join on `id`). Recovery of the whole project is the managed Firestore export and import, documented; there is no importer that writes a package back into Firestore.
6. "Preserve the existing filtered attendee CSV contract and formula-injection protections." Met. `functions/src/users/export.cjs` is unchanged; its tests and `e2e/attendee-admin.spec.js` pass. The package's `attendees.csv` uses the same `buildCsv`.

## Decisions the owner may want to change

- Spreadsheets show the current revision (draft if any) with its state word, matching the admin lists. The package's JSON holds published records only; its CSV files are the same spreadsheets. The README says so.
- Account ids are in the package (attendee `id`, `purchaserAccountId`, `claimedByAccountId`, `submitterAccountId`) so records join. They are not in any spreadsheet.
- The package includes announcements, live updates, the media index and the ticket catalog, and leaves out feedback, change requests and system errors (listed as "request separately").
- The endpoint cap is 9 MB of zip, the same reasoning as the materials archive (10 MB response cap). Larger events use the script.
- The client cannot read `Content-Disposition` cross-origin, so the browser names the file `event-data-package-<client date>.zip`.
- `docs/ROADMAP.md` has no line for #329, so nothing was ticked.
- The repeat-event template (#328, `scripts/lib/event-template.cjs`) is not on this base, so there was nothing to read; no overlap.

## Generated output

Not committed, per the dispatch. `docs/docs` must be regenerated on the stack tip (new manifest page, ADMIN_GUIDE and CLIENT_ONBOARDING edits). `packages/shared` is unchanged; no lockfile change.

## Final checks

Last run, after every edit, with generated output regenerated locally first and then discarded:

- `npm run lint`: pass.
- `npm test`: 3130 tests, 3130 pass, 0 fail.
- `npm run test -w apps/web`: 293 files, 3447 tests passed, no unhandled errors.
- `npm run test:rules`: 3 files, 376 tests passed.
- `npm run build -w apps/web`: pass.
- `node scripts/generate-content.cjs --demo --check`: pass.
- `node scripts/build-demo.cjs --check`: pass.
- `node scripts/build-pages.cjs --check`: pass.
- `npm run check:copy`: 534 files, no blocked patterns.
- E2E (no-sandbox local runner): `e2e/data-export.spec.js`, `e2e/attendee-admin.spec.js`, `e2e/materials-archive.spec.js`: 7 passed. The spec has not changed since that run.

Without regeneration, `npm test` fails the two docs/docs freshness tests ("the committed site matches a fresh render", "every manifest page has a committed output file"), because this branch adds a manifest page and edits rendered Markdown. The director's regeneration on the stack tip clears them.

## Not done

- No importer writes a package back into Firestore. Full recovery is the managed Firestore export and import, documented in the runbook; the package's consumer path is the reader and the README.
- The archive runbook's commands (`gcloud firestore export`, `gcloud storage cp`, `firebase hosting:disable`) were not run against a real project; this sandbox has no credentials.
