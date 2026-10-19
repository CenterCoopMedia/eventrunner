# g5-import: Initial record imports for speakers, sessions and sponsors

Branch `joe/wave3-g5-import`, worktree `/home/user/eventrunner/.claude/worktrees/wf_e62b5d98-1d3-5`.
Base `0591e06`. One feature commit, then this report. No regenerate commit (the director
regenerates `docs/docs` and `docs/demo` on the stack tip). `packages/shared` is not changed,
so no lockfile hashes move.

## What changed

Staff open **Import records** (Operations group on the rail, `/admin/import`), choose
Speakers, Sessions or Organizations, choose a CSV, map columns, preview, and confirm.

Server: `functions/src/imports/`

- `recordImport.cjs`: the `importRecordsCsv` endpoint (staff tier, POST, CORS, 300 s
  timeout), request validation, one pipeline for the dry run and the commit, the digest a
  commit must send back (409 `preview-mismatch` otherwise), the three-way reconcile, one
  transaction per row, one `admin_logs` row (`records-import`, with counts) per commit.
- `speakerImport.cjs`: shared `validateSpeaker`; create mirrors `createSpeaker` (server
  minted id, `speaker_slugs` reservation, `status: 'draft'`, `uid`/`inviteToken`/`approvedAt`
  null). Update merges mapped fields only; never moves status; never re-derives the slug from
  a name; keeps the email of a speaker with an open invitation (note).
- `sessionImport.cjs`: resolves day (id, date, label), track (letter, name), place (id,
  name), 12/24-hour times, speakers (speaker external ID, then slug). Validates with
  `validateSpeakerReferences` and `validateSessionStructure` in the row transaction. Writes
  `cmsSchedule_drafts` through `store.writeDraft`, `visible: false` on create.
- `organizationImport.cjs`: `organizationSlugError`, `validateOrganizationFields`; writes
  `cmsOrganizations_drafts` through `writeDraft`, `visible: false` on create.
- `seedFlag.cjs`: drops `seeded`/`seededAt` on an import update, like an editor save.
- `firestore.rules`: explicit deny for the new server-only `record_imports` collection.
- `functions/index.js`, `.github/smoke-endpoints.json`: the new export.

Web: `apps/web/src/admin/recordImport.js` (vocabulary, auto-mapping, templates, only the
mapped columns leave the browser), `pages/AdminRecordImport.jsx` (lazy route), docket item
in `AdminLayout.jsx`, route in `AdminApp.jsx`.

Docs: `docs/ADMIN_GUIDE.md` "Import records" (steps, drafts, external ID rules, template
header rows per type, column rules), staff tier table; `functions/README.md`; `CHANGELOG.md`.

## Promise clauses and the tests that prove them

| Clause | Proof |
|---|---|
| "staff CSV imports … for speakers, sessions and organizations/sponsors" | `recordImport.test.cjs` "staff and operators both reach it"; the three importer test files; `e2e/record-import.spec.js` |
| "column mapping" | `speakerImport.test.cjs` mapRow; `sessionImport.test.cjs` mapRow (day/track/place); `recordImport.test.js` guessMapping and template round trip; `AdminRecordImport.test.jsx` "maps the template headers…" |
| "a dry-run preview listing creates/updates/unchanged/errors per row" | `recordImport.test.cjs` "a preview lists each row and writes nothing"; `AdminRecordImport.test.jsx` preview table; E2E test 1 asserts no draft exists after the preview |
| "explicit confirmation" | `recordImport.test.cjs` "a commit without the preview digest, or with another file's, writes nothing"; `AdminRecordImport.test.jsx` "imports only on confirmation, sending the preview digest" and "drops the preview when the mapping changes" |
| "idempotent upsert keyed by a stable external id (re-importing the same file changes nothing)" | "importing the same file again changes nothing and writes nothing" in all three importer tests (only `admin_logs` written); E2E test 2 ("No change" on every row, nothing to import) |
| "a changed row updates only mapped fields and never overwrites staff edits to unmapped fields" | `speakerImport.test.cjs` "a changed row updates only the mapped field…" (headshot and status survive); `sessionImport.test.cjs` "an update after publish…" (recording link survives); `organizationImport.test.cjs` "a logo staff chose survives" |
| "everything written as DRAFTS (hidden session drafts, speaker status draft, organizations unpublished)" | `speakerImport.test.cjs` "a new speaker is a draft record with no public projection"; `sessionImport.test.cjs` "a new session is a hidden draft; no live document is written"; `organizationImport.test.cjs` "a new organization is a hidden draft"; E2E test 1 reads Firestore: `visible: false`, `status: 'dirty'`, no live doc |
| "validation through the same shared validators the editors use" | speaker "a field the shared validator refuses…"; session "the shared session validator refuses a bad row…"; organization "the organization validator refuses a bad row…" (messages are the validators' own) |
| "links between sessions and speakers resolved by external id or slug with clear errors" | `sessionImport.test.cjs` "speakers link by speaker external ID or by slug; an unknown one is a row error" |
| "size limits" | `recordImport.test.cjs` validateImportRequest (500 rows, 60 columns), cell cap, external ID cap; `AdminRecordImport.test.jsx` "refuses a file over the row limit before sending it" |
| "admin_logs audit" | `recordImport.test.cjs` "a commit writes one admin_logs row with the counts…"; E2E test 1 reads the row |
| "Must not send any email or invite" | `recordImport.test.cjs` and each importer test assert no write to `sent_emails`, `email_claims`, `speaker_invites`, `speakers_public`, live `cmsSchedule`/`cmsOrganizations`, `users`; E2E test 1 asserts the captured mail file did not grow during the import |
| "emulator handler tests (auth, idempotency, drafts only, no email)" | Handler tests use the in-memory Firestore fake, per the house rule ("no emulator", CONTRIBUTING, functions/README). The emulator path is covered by the E2E spec, which calls the deployed function in the functions emulator against the Firestore emulator. `tests/firestore.rules.test.js` pins `record_imports` deny-all against the emulator. |
| "admin UI tests" | `AdminRecordImport.test.jsx` (10), `recordImport.test.js` (7), docket tests updated |
| "a browser test of upload → preview → import for one record type" | `e2e/record-import.spec.js` (organizations), 2 passed |
| Docs: ADMIN_GUIDE "Import records" with CSV templates/headers, CHANGELOG | `docs/ADMIN_GUIDE.md` section and template table; `CHANGELOG.md` [Unreleased] Added |

Met in full, with the emulator note above.

## Decisions the owner may want to change

- **Staff tier**, not operator. The import writes only drafts, through the editors'
  validators, so it grants nothing the staff editors do not.
- **Three-way merge.** The key document keeps the last imported values. A file value that
  has not changed never writes, even over a staff edit. A changed file value over a staff
  edit keeps the staff value and reports a conflict note once. A field mapped for the first
  time fills only a blank field. This is how "never overwrites staff edits" and "re-import
  changes nothing" hold together.
- **A record staff deleted is not recreated** (reported as No change with a note). A new
  external ID makes it again.
- **One transaction per row**, not one for the file: 500 rows do not fit one transaction,
  and a re-run finishes a commit that stopped part way.
- **Not importable**: session parent (publish-order rules), speaker headshot, organization
  logo (media library objects), speaker status, visibility. Staff set these in the editors.
- **Session ids** take a free `-2`, `-3` suffix like the session editor; **speaker and
  organization slugs** that are taken are row errors, like their editors.
- **Docket**: "Import records" sits under Operations. The rail link count tests went from
  26 to 27 (`AdminLayout.test.jsx`, `e2e/theme-responsive.spec.js`).
- No ROADMAP item names this work, so nothing was ticked.

## Final check results (last run, after the last code and docs edit)

Generated output was regenerated locally for the checks and then discarded.

- `npm run lint`: exit 0.
- `npm test`: 3193 tests, 3193 pass, 0 fail.
- `npm run test -w apps/web` (lock): 293 files, 3451 tests passed.
- `npm run test:rules` (lock): 3 files, 373 tests passed.
- `npm run build -w apps/web` (lock): exit 0; `scripts/ci/bundle-budget.cjs`: 1 initial
  chunk, 280713 gzip bytes, no failure.
- `node scripts/generate-content.cjs --demo --check`: exit 0.
- `node scripts/build-demo.cjs --check` (lock): matches a fresh build (211 files).
- `node scripts/build-pages.cjs --check`: exit 0.
- `npm run check:copy`: 535 files, no blocked patterns.
- E2E (no-sandbox local runner, lock): `e2e/record-import.spec.js` 2 passed;
  `e2e/theme-responsive.spec.js -g phone` 4 passed.

Without regeneration, `npm test` fails one test ("the committed site matches a fresh
render") because `docs/ADMIN_GUIDE.md` and `CHANGELOG.md` changed. The director's
regenerate on the stack tip clears it.

## Left undone

- Nothing in scope. Parent sessions, logos and headshots stay editor-only (above).

## Review round

The adversarial review (three must-fix, six optional findings) is answered in commit
`fe87b3e` ("Keep record imports off published speakers and out of personal data"). The
findings touch the same planRow functions, so they are one commit.

### Must fix

1. **A re-import published changes to an approved speaker at once.** Fixed (`fe87b3e`).
   Design: a change to a speaker that `isPubliclyVisibleSpeaker` says is public goes into
   `pendingEdits`, the existing queue that `applySpeakerPendingEdits` and
   `discardSpeakerPendingEdits` serve and that the Speakers list shows as "Changes pending
   review". The live fields do not move, so `onSpeakerWritten` writes nothing. The merge
   reads a queued value as the current one, so a change the speaker queued is kept (as a
   conflict) and not replaced. An approved speaker's slug is not changed (applying the queue
   does not move `speaker_slugs`); the row says to change it in the editor. A not-yet-public
   speaker (draft, invited, accepted) is still written in place. Proof:
   - `speakerImport.test.cjs` "a re-import never changes what a published speaker shows"
     runs the projection core (`createSyncSpeakerPublic`) after each write: `speakers_public`
     is unchanged after the import and changes only after `applyApplySpeakerPendingEdits`.
     It failed before the fix (no pending-review note, live field written).
   - `speakerImport.test.cjs` "keeps the slug of a published speaker, and a pending edit by
     the speaker".
   - `e2e/record-import.spec.js` "the change waits as pending edits, and speakers_public
     moves only when staff apply it": the deployed function and the real trigger in the
     emulator.
   - Copy: the guide's draft rules, the page's preview and result notes (per type), the
     CHANGELOG and `functions/README.md` now say a speaker change waits for review.
2. **`record_imports` kept raw personal data.** Fixed (`fe87b3e`). A key keeps
   `values` as a 32-hex sha256 digest per field, and no `externalId` field (the id is only
   hashed into the key's document id). `reconcileFields` compares digests. The guide's "keeps
   no copy" sentence now says what is kept. Test: `recordImport.test.cjs` "an import key
   keeps no personal data". A digest of a known address can still be checked by someone who
   guesses the address; the key's existence after a delete is still needed so a deleted
   record is not made again.
3. **No reconciliation with records made before the import.** Fixed (`fe87b3e`). A row
   with no key whose slug (speaker), address (organization) or session ID belongs to a
   record no import key points at is matched to it: verdict `update`, `matched: true`, a
   note naming the record, and the commit writes the key with no "last" values, so the merge
   fills only empty fields and keeps every stored value (with a note per difference). The
   page shows "Matches existing". Guards: a record linked to another external ID is a row
   error; a speaker with a different email address is a row error (another person); a
   session matches by title only on the same day (so "Lunch" on day 2 does not match day
   1), otherwise it gets a suffix and a note that names the other session and how to match
   it. Duplicates inside one file get their own error. Tests: the "matched" tests in all
   three importer files, and the web test "names a matched record".

### Optional

1. **Over-long cell cut silently.** Real; fixed. A mapped cell over 5000 characters is a
   row error naming the field and column, before any importer reads it. Test:
   `recordImport.test.cjs` "a mapped cell over the limit is a row error".
2. **A reverted staff edit is not re-applied.** Real; documented (the smallest correct
   answer). Keeping the previous last value until resolution would make the conflict note
   repeat on every run. The guide's external ID list and the module doc now say it.
3. **A removed speaker can be linked to a session.** Real; fixed. Row error by external ID
   or slug. Test: `sessionImport.test.cjs` "a removed speaker is a row error".
4. **"Publish them from the Speakers page."** Real; fixed. Per-type copy in
   `apps/web/src/admin/recordImport.js` (`previewNote`, `doneNote`); speakers say "Invite or
   approve them on the Speakers page".
5. **Audit row after the writes.** Real; fixed. The commit writes the `admin_logs` row,
   awaited, before the first record write, and a failure returns 500 with nothing imported
   (the exportAttendees rule). The counts are merged into that row at the end
   (`finished: true`). Tests: `recordImport.test.cjs` audit tests, including "a commit whose
   audit row cannot be written imports nothing".
6. **No file-size check before reading.** Real; fixed. Files over 5 MB are refused before
   `file.text()`. Test: `AdminRecordImport.test.jsx` "refuses a file over the size limit
   without reading it".

### Review round checks (last run, after the last code and docs edit)

Run on commit `fe87b3e`; only this report changed after it.

- `npm run lint`: exit 0.
- `npm test`: 3203 tests, 3202 pass, 1 fail: "the committed site matches a fresh render",
  because `docs/ADMIN_GUIDE.md` and `CHANGELOG.md` changed. After a local
  `node scripts/build-pages.cjs` that test file passed (63 of 63); the regenerated
  `docs/docs` was then discarded, as instructed.
- `npm run test -w apps/web` (lock): 293 files, 3453 tests passed.
- `npm run test:rules` (lock): 3 files, 373 tests passed.
- `npm run build -w apps/web` (lock): exit 0.
- `npm run check:copy`: 535 files, no blocked patterns.
- E2E (untracked no-sandbox Playwright config, deleted after; lock):
  `e2e/record-import.spec.js` 3 passed (the two organization tests and the new published
  speaker test).
- Import server tests alone: recordImport 24, speakerImport 15, sessionImport 15,
  organizationImport 9, all pass.
- Not run: `build-demo --check` and `generate-content --demo --check`. The web page changed,
  so `docs/demo` needs the director's regeneration on the stack tip, as before.
