# Builder g1-airtable report: Airtable connection for session pitches

Branch `joe/wave3-g1-airtable`, worktree `/home/user/eventrunner/.claude/worktrees/wf_e62b5d98-1d3-1`,
cut from `25c60e8` (#491). Commits: the feature, the docs, this report. No `Regenerate generated
output` commit, as the dispatch asked: `docs/docs` and `docs/demo` were regenerated locally for the
checks and then discarded.

## What changed

**Server (new files).**

- `functions/src/sessions/airtableClient.cjs`: a read-only Airtable REST client. It calls only
  `https://api.airtable.com`. Only the Functions emulator can use a loopback origin, through
  `EVENT_AIRTABLE_API_ORIGIN` (the browser test needs this). Base, table and view ids are checked
  by pattern; a table or view name is limited to 100 characters with no control characters. It
  pages with `offset`, reads at most 10 pages of 100 per run, keeps 250 ms between requests (four
  per second, under Airtable's five per base), waits 30 s after a 429 and 2 s after a 5xx or
  network error (three attempts in all), and asks only for the mapped fields (`fields[]`). Errors
  become safe codes and messages (`token-rejected`, `forbidden`, `not-found`, `invalid-request`
  with Airtable's error type, `rate-limited`, `unavailable`, `network`, `bad-response`,
  `no-token`). `redact` removes the token, any `pat…` or `key…` token shape, and bearer headers.
- `functions/src/sessions/airtableSync.cjs`: `updateAirtablePitchSource` (operator),
  `refreshAirtablePitches` (staff), `scheduledAirtablePitchRefresh` (every 15 minutes; it returns
  at once unless an operator chose 15 or 60). `runAirtableSync` does the work:
  - Identity is the CSV import's hash `import\0airtable\0<externalId>`. The external id is the
    mapped field, or the Airtable record id when none is mapped. A row from an earlier CSV import
    under the source name `airtable` is adopted (its `airtable` metadata is added).
  - New record with consent: creates a pitch (`source: 'airtable'`, `status: 'new'`,
    `reviewRevision: 0`, `uid: null`, `consent.version: 'airtable-source'`).
  - Unchanged: no write.
  - Changed: updates only email, title, description, organization and format; keeps status,
    private notes, reviewer, conversion and notices; sets `sourceUpdatedAt` and
    `sourceChangedFields`; raises `reviewRevision` by one (see decision 2).
  - Not seen in a complete read: `sourceRemovedAt` is set once; a returning record clears it. A
    partial read (page limit reached) flags nothing. Only pitches from the same base and table are
    considered.
  - Consent box not `true`: skipped and counted; an existing pitch gets `sourceConsentMissingAt`.
  - Other skips: `invalid-email`, `invalid-field` (uses the native `readSubmission` limits),
    `missing-id`, `duplicate-id`. The status keeps the first 25 skipped record ids with reasons.
  - A lease on `session_pitch_sync/airtable` (`running.startedAt`, 10 minutes) stops overlapping
    runs; a manual run is refused for 60 s after the last start (429 with `Retry-After`); a
    scheduled run waits for its timing (2 minutes of slack).
  - Every run, failed or not, writes `session_pitch_sync/airtable` (`lastRun`: trigger, start,
    finish, outcome `completed`/`partial`/`failed`, counts, skip reasons, skipped ids, redacted
    error, who) and one `admin_logs` row `refreshAirtablePitches`. A run never sends mail,
    publishes or converts.
  - Deploy wiring: the token is the managed secret `AIRTABLE_API_TOKEN`, bound with
    `defineSecret` only when `EVENT_AIRTABLE_ENABLED=true` and never in the emulator. The refresh
    and scheduled functions have `timeoutSeconds: 300`. The scheduled function is always exported,
    so turning the flag off never deletes a function in a non-interactive deploy.

**Server (edits).** `functions/index.js` (one barrel line), `.github/smoke-endpoints.json` (two
HTTP names), `firestore.rules` (`session_pitch_sources` operator-read, `session_pitch_sync`
admin-read, both client-write-denied), `packages/shared/src/config/deploy.cjs` (the
`EVENT_AIRTABLE_ENABLED` default `false` and a true/false check; an edit to an existing module, so
no new `.mjs` shim), `.github/workflows/deploy-client.yml` (the variable in validation and in both
functions env writers), `.env.example`, `scripts/dev/run-e2e.sh` (emulator-only exports for the
fake Airtable).

**Web.** New `apps/web/src/admin/pages/AirtablePitchSync.jsx`: a **Refresh pitches from
Airtable** disclosure on the Session pitches page with the last-run status (badge word, time in
the event zone, who, counts, skip reasons and ids, last error), the **Refresh from Airtable**
button (keyboard path, `aria-busy`, a second press ignored, result in a status line, a refusal in
a focused alert), and, for operators only, **Connection settings** (enabled, base id, table, view,
seven field names, automatic refresh). New `PitchSourceMarkers.jsx`: **Updated in Airtable**
(until a review is saved after the change), **Removed from Airtable**, **Consent unchecked in
Airtable**, each a word in a badge; the review panel adds a sentence that names the changed
fields. `AdminSessionPitches.jsx` gains 5 lines only (two imports, the panel, two marker lines).

**Docs.** `docs/operator/session-pitches.md` (new "Refresh pitches from Airtable" section: token
with `data.records:read`, secret, flag, ids, field names table, timing, what a refresh changes,
editing rule, status and audit, troubleshooting; the Airtable form steps and data boundaries
updated), `docs/ADMIN_GUIDE.md`, `docs/handbook/for-event-staff.md`, `docs/DEPLOY_RUNBOOK.md`
(variable and secret rows), `functions/README.md` (tier table, "Airtable pitch refresh" section
with the secret), `README.md:48`, `CHANGELOG.md`, new `docs/adr/0005-airtable-pitch-intake.md`,
and a pointer in the ADR 0001 porting-map row.

## Tests added

- `functions/src/sessions/airtableClient.test.cjs` (8, fake fetch): settings validation; the
  emulator-only origin; offset pagination with the token only in the header, mapped fields and
  view; table-name encoding and the page limit as an incomplete read; 429 wait-and-retry; every
  refusal code with no token in the message; no request without a token; `redact`.
- `functions/src/sessions/airtableSync.test.cjs` (13, fake Airtable plus the Firestore fake):
  mapping and each skip reason; first refresh (create, skip, status, audit, only three
  collections written, token absent); unchanged no-op; changed record keeps status, notes,
  conversion, notices and reviewer and bumps the revision; removed flag set once and cleared on
  return; partial read flags nothing; cleared consent and duplicate ids; CSV-row adoption; lease,
  one-minute gap, schedule off by default, flag off, 60-minute timing; Airtable 401 and a
  Firestore crash recorded and redacted with the token never logged; not-enabled,
  not-configured, turned-off, no-token; secret binding; operator-only settings handler; staff and
  operator refresh, 401/403/429/502/409.
- `tests/session-pitch-airtable.rules.test.js` (5, Firestore emulator): rules for both new
  collections by tier; the handlers' real transactions (create, review through the real
  `reviewSessionPitch`, change, removal, a stale review then conflicts, no `sent_emails` or
  drafts); a refused token stored nowhere. `tests/firestore.rules.test.js`: both collections
  join `ADMIN_READABLE` (operator and admin tiers).
- `apps/web/src/admin/pages/AirtablePitchSync.test.jsx` (8): staff status and skip reasons
  without settings; failed and partial words; no run yet; one refresh per press and its result;
  focus moves to a refusal; operator save with default names (and the form stays open when the
  live listener delivers the saved document, a regression the browser run found); saved settings
  and an in-place base id refusal; queue and review markers.
- `packages/shared/src/config/deploy.test.cjs` (+1), `scripts/deploy-workflow.test.cjs` (+1).
- `e2e/session-pitch-airtable.spec.js` (1): an operator saves the connection, refreshes by
  keyboard against a loopback fake Airtable (two pages), sees counts and the new pitches, then the
  record changes and another leaves the view, and the queue shows **Updated in Airtable** and
  **Removed from Airtable**; no horizontal scroll.

## The promise, clause by clause

- "bring pitch records from an approved Airtable table into the private Event Runner review
  queue": met. `airtableSync.test.cjs` "a first refresh creates private new pitches…";
  `session-pitch-airtable.rules.test.js` (staff can read, visitor cannot); E2E spec.
- "refresh them without duplicates": met. "an unchanged refresh writes no pitch…" (two pitches
  after three runs), "adopts a row from an earlier CSV import", emulator test `pitches.size` 2.
- "preserve review decisions": met. "a changed record keeps every review decision" (fake) and the
  emulator test after a real `reviewSessionPitch`.
- "keep publication under staff control": met. Runs write only `session_pitches`,
  `session_pitch_sync` and `admin_logs` (fake test), and the emulator test checks no
  `cmsSchedule_drafts` or `sent_emails`.
- "configure and test a connection … confirm the fields, refresh timing and editing rules": met
  in product and docs (operator settings form, schedule select, the operator guide's field table,
  timing and editing rule). The real Airtable base has not been called; see "Not done".
- Dispatch items: token as a managed secret, validated and documented (deploy flag check,
  workflow test, `.env.example`, runbook, functions README); only `api.airtable.com`
  ("only the Functions emulator may use a loopback origin"); staff refresh plus optional
  schedule, off by default ("runs never overlap … schedules respect their timing"); pagination,
  bound and 429 handling (client tests); content change preserves status, revision semantics,
  notes, conversion and notices and is marked (sync, emulator and UI tests); removed records
  flagged, never deleted; consent skipped and reported; no automatic email; visible sync status
  with counts and redacted error (UI test, E2E); every run audited.

## Decisions the owner may want to change

1. **Staff may refresh.** The operator approves the base, table, view and mapping. A refresh only
   brings private proposals into a queue that staff already review, publishes nothing and sends
   no mail. Settings stay operator-only, and their document is operator-read only.
2. **A content change raises `reviewRevision`.** The review form already treats a revision change
   as a conflict, so a reviewer looking at the old text cannot save a decision over the new text.
   Status, notes, reviewer, conversion and notices are untouched. If "preserve reviewRevision"
   was meant literally, drop the `+ 1` in `applyChunk`; the marker still shows.
3. **The CSV path keeps its 409 on a changed row.** Making it update in place is not simple and
   safe: a file does not show which copy is newer, and its rows carry no `airtable` metadata. The
   operator guide and ADR 0005 say so.
4. **A deploy flag, `EVENT_AIRTABLE_ENABLED`, gates the secret.** Binding the secret in every
   deployment would make deploys fail for clients without Airtable. This touches
   `packages/shared/src/config/deploy.cjs` (existing module, no shim needed), so the director must
   refresh the lockfile hashes.
5. **Default field names** in the settings form are the lowercase names the existing Airtable
   form steps already use (`email`, `title`, …, `consent`), and the external id defaults to the
   Airtable record id, which equals the old `RECORD_ID()` formula field.
6. **Limits:** 1,000 records per run, one manual run per minute, a 10-minute lease, 25 listed
   skipped ids. A rich-text description arrives as Airtable's Markdown text.
7. **Not touched for conflict reasons:** the call-settings hint in `AdminSessionPitches.jsx` still
   says an external form's pitches arrive "only through CSV import". It sits next to the deadline
   field another builder is changing. Change "only through CSV import" to "through an Airtable
   refresh or CSV import" on the stack tip.
8. The new ADR is not added to `scripts/lib/pages-manifest.cjs`, as ADR 0004 is not either.

## Checks (final run, with `docs/docs` and `docs/demo` regenerated locally)

- `npm run lint`: exit 0.
- `npm test`: 3,122 tests, 3,122 pass, 0 fail.
- `npm run test -w apps/web`: 292 files, 3,442 tests passed.
- `npm run test:rules`: 4 files, 385 tests passed.
- `npm run build -w apps/web`: built.
- `node scripts/generate-content.cjs --demo --check`: exit 0.
- `node scripts/build-demo.cjs --check`: "docs/demo/ matches a fresh build (210 file(s))".
- `node scripts/build-pages.cjs --check`: exit 0.
- `npm run check:copy`: 531 files, no blocked patterns.
- E2E (no-sandbox local runner): `e2e/session-pitch-airtable.spec.js` 1 passed (after the last
  code change); `e2e/session-pitch-ui.spec.js` 5 passed (run before the settings-form fix, which
  that spec does not reach).

The regenerated `docs/docs` (six pages) and `docs/demo` were then discarded. On the committed
branch, `npm test` fails one test, "the committed site matches a fresh render", until the director
regenerates on the stack tip.

## Not done

- No call to a real Airtable base. The proposal's "configure and test a connection" for the
  client's own table needs the client's token and base; the operator guide's "Test it" step is
  that check.
- The pitch email builder's receipt and decision emails are on another branch. Imported rows
  carry `source: 'airtable'` and `uid: null`; that work must not send a receipt for them
  (ADR 0005 says so).
