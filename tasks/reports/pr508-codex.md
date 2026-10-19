# PR #508: Codex review findings

Branch `joe/blissful-einstein-9qvtd1-20-launch-and-promises`, from 550ec5d.

## Findings

1. **Bind reminder sends to the full preview (P1).** Real. The send checked
   only the count and the wording version, then rendered again from the live
   stores. Preview now returns `receipt`: a SHA-256 over each recipient's id,
   address, items, subject and bodies, the same idea as the announcement
   receipt. Send refuses a different receipt with `stale-preview`, before any
   reservation. The page sends the receipt. Commit 92f71b5. Test:
   `tests/speaker-reminders.rules.test.js` "refuses a send when an address, a
   readiness item or a session title changed after the preview".
2. **Retryable announcement failures lost with the progress write (P2).**
   Real. `sendBatch` now records a failure on the recipient's claim. A replay
   reports it again, marked `skipped`, so the tally counts it as failed and a
   transient one goes on `retryRecipients`. Commit 08a59c1. Tests:
   `functions/src/announcements/sends.test.cjs` "postmark: an outage whose
   progress write fails still leaves the failed addresses for a retry", and
   `functions/src/email/sendBatch.test.cjs` "a repeat of the batch reports the
   failure an earlier call recorded on the claim".
3. **Template target emptiness check (P2).** Real. The likely path: a
   half-applied project gets a schedule in the admin, and the resume merges
   into it. The check now covers every collection in `EXCLUDED_REASONS` and
   every collection that `listCollections()` reports. `cmsMeta` joins the
   apply's own writes. Commits 9c3615d and 1c06528 (guide). Tests:
   `scripts/export-event-template.test.cjs` "a target that holds speakers,
   ..." (now with cmsSchedule, cmsOrganizations, cmsTimeline, cmsUpdates and an
   unlisted collection) and "a half-applied project that has gained other
   data is not resumed" (schedule case).
4. **Duplicate Airtable IDs (P2).** Real. Every record that shares an ID is
   now skipped. The ID still counts as present, so its pitch is not flagged
   as removed. Commit 1042593. Test: `functions/src/sessions/airtableSync.test.cjs`
   "a cleared consent box flags the existing pitch, and every record sharing
   an id is skipped".
5. **Import confirmation and database state (P2).** Not real. The commit
   plans each row again inside its own transaction, against the live record
   and import key. So an edit made after the preview is a conflict at commit
   time and stays, and a deleted record is not made again. A test proves this
   on the code as it was. Commit 49accd1 (test, guide sentence, module
   comment; no behaviour change). Test: `functions/src/imports/speakerImport.test.cjs`
   "a staff edit or a delete between the preview and the commit survives the
   commit".
6. **Ambiguous reminder outcome (P2).** Real. A provider throw after the
   request left now records `lastStatus: 'uncertain'` with `lastSentAt`, so the
   24-hour window applies. A replay of the batch reports it as uncertain. The
   response has an `uncertain` list, and the page says that the provider did
   not confirm the reminder. Commit 92f71b5 (with finding 1: same file, test
   harness and page). Test: `tests/speaker-reminders.rules.test.js` "a reminder
   the provider may have accepted counts as sent for the 24-hour window".
7. **Template block validation (P2).** Real. `parseTemplateFile` now runs each
   block through the editor's rich-text sanitizer and `checkBlockContract`
   (required fields, sponsor package limit). The apply stores the cleaned
   block. Commit 42d77c6. Test: `scripts/export-event-template.test.cjs` "a
   hand-edited template meets the content editor's block rules before
   anything is seeded".
8. **Webhooks that beat the audit write (P1).** Real. The row is written after
   the provider answers, and in `sendBatch` after every retry round. An event
   for an unknown message now gets 503 with `Retry-After: 60` while the event
   is less than 15 minutes old. Matched events in the request are applied
   first, and applying them again changes nothing. Postmark's documentation
   says it retries 5xx, 408 and 429 after 1, 5, 10, 10, 10 and 15 minutes, and
   drops other 4xx. The 15-minute window allows about three retries, and an
   older event (or one dated far ahead) gets 200. Commit 4653e58. Tests:
   `functions/src/email/send.test.cjs` "delivery webhook asks for a retry when
   a recent event beats the audit row, and applies it on the retry" and
   "... acknowledges an unknown message once its event is old ...".

Also: a278cfa sets the phone admin nav count in `e2e/theme-responsive.spec.js`
to 28. The spec cannot import `DOCKET` (its module imports CSS and JSX), so the
number is pinned with a pointer, as `AdminLayout.test.jsx` does. No other spec
or test pins 26 or 27 links.

## Decisions the owner may want to change

- Reminder receipt and wording version are both checked. The wording check
  stays first for its clearer message.
- A replay of a reminder batch after a speaker's readiness changed is now
  refused as stale instead of reporting the first outcome.
- An uncertain reminder adds one to `sentCount`.
- Postmark pauses an event type whose endpoint fails persistently. Mail that
  another application sends through the same Server would get 503 for 15
  minutes per event. The provisioning guide says to give such an application
  its own Server.
- A past event whose template holds a legacy `{ value, label }` stat block is
  now refused at apply, naming the block, because the editor refuses that
  shape too.

## Checks (last run, on the final tree)

- `npm run lint`: clean.
- `npm test`: 3389 pass, 0 fail.
- `apps/web` vitest: 306 files, 3603 tests pass.
- `npm run build -w apps/web`: built.
- `npm run test:rules`: 7 files, 435 tests pass.
- `generate-content --demo --check`, `build-demo --check`, `build-pages --check`,
  `check:copy`, `audit-policy`: pass.
- E2E (no-sandbox runner, deleted after): speaker-reminders 1, announcement-email
  1, email-log 4, record-import 3, session-pitch-airtable 1: 10 passed.
- E2E `theme-responsive.spec.js`: 4 of 5 pass. The phone admin test now passes
  the 28-link count and the drawer checks. It then fails in its loop over all
  28 pages: `page.goto` returns `net::ERR_INSUFFICIENT_RESOURCES`, at a
  different page each run (timeline, media, feedback). This is the
  container's Chromium after many full Vite dev reloads, not a page error.
  CI must confirm it.
- CodeQL 2.27.2, javascript-code-scanning suite, on the changed directories
  (email, announcements, speakers, sessions, imports, scripts/lib,
  init-event.cjs, apps/web/src/admin; 202 files): 0 results.
