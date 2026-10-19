# g3-remind: Speaker reminder emails

Branch `joe/wave3-g3-remind`. Worktree `/home/user/eventrunner/.claude/worktrees/wf_e62b5d98-1d3-3`.
Base: `25c60e8`.

## What changed

Staff can email accepted speakers a reminder of what they still owe:
biography, headshot, session description, and materials. They choose one
speaker or a group, preview each message, confirm the count, and send.

### Server

- `packages/shared/src/speakerReadiness.cjs` (+ `.mjs` shim, + export in
  `packages/shared/package.json`): the one readiness rule. The speaker's own
  "Your next steps" list (`apps/web/src/lib/speakerCompletion.js`) now uses
  its predicates, so a reminder never asks for an item that list shows as
  done. **The shared package changed: the director must refresh the
  lockfile hashes** (`npm run prepare:functions && rm -rf
  functions/node_modules/shared && npm install`). The hash changes are not
  committed.
- `functions/src/email/templates/speaker.reminder.cjs`: new template. The
  values are flags (`needs_bio`, `needs_headshot`) and plain lists of
  session titles (`description_sessions`, `materials_sessions`); every
  sentence is in the template, so staff can rewrite all of it. Required
  token: `dashboard_url`. Body stored in `sent_emails`.
- `functions/src/email/templates.cjs`: registers the template;
  `loadTemplate({ fresh: true })` skips the 5-minute cache, so a preview
  shows wording saved a moment ago and the send uses the wording the
  preview showed.
- `functions/src/email/send.cjs`: the legal-footer append moved into an
  exported `withLegalFooter`, so the preview shows the bodies the provider
  gets. Behaviour unchanged (send tests pass).
- `functions/src/speakers/reminders.cjs`: one staff endpoint,
  `speakerReminders`, actions `list`, `preview`, `send`, `export`,
  `template`, `saveTemplate`, `resetTemplate`.
  - Send needs `confirmCount` equal to the recipient count and a `batchId`
    (one per preview). `speaker_reminders/{speakerId}` records the batch in
    a transaction before the mail goes; the same batch again sends nothing.
    The email core claim `speaker-reminder:{speakerId}:{batchId}` is the
    second barrier.
  - At most one reminder per speaker per 24 hours.
  - `admin_logs`: `sendSpeakerReminders` (one row per send),
    `saveEmailTemplate`, `resetEmailTemplate`, `exportSpeakerReadiness`
    (written before the file leaves; no row, no file).
  - Historical demo: `send`, `saveTemplate`, `resetTemplate` call
    `checkDemoWrites` before any write.
- `firestore.rules`: `speaker_reminders` deny-all. `functions/index.js`,
  `.github/smoke-endpoints.json`, and the speaker export guard in
  `projection.test.cjs` name the new export.

### Admin UI

- `apps/web/src/admin/pages/AdminSpeakerReminders.jsx` at
  `/admin/speakers/reminders/send` (two segments, so no speaker id can
  shadow it; lazy loaded). List with **Show** groups (in the page address),
  selection, **Items to include**, **Preview reminders** (server-rendered
  message per recipient in the sandboxed email frame plus plain text, and
  who gets none and why), **Send N reminders** dialog naming the count and
  the speakers, "Last reminded … about …" per row, **Reminder wording**
  editor, **Export this list as CSV**.
- `AdminSpeakersList.jsx`: **Send reminders** in the header, **Remind** on
  each accepted or approved speaker.
- `TicketingConfirmation.jsx`: optional `busyLabel` (default unchanged).
- `apps/web/vite.config.js`: `shared/speakerReadiness` added to
  `optimizeDeps.include`. Without it, the dev server re-optimized on first
  use and the lazy admin chunk failed to load in the browser run.

### Docs

`docs/ADMIN_GUIDE.md` (Speakers → Speaker reminders), `CHANGELOG.md`,
`functions/README.md` (staff endpoint list).

## Each requirement and its proof

| Requirement | Proof |
|---|---|
| Staff action for one speaker or a selected group | `AdminSpeakerReminders.test.jsx` (select, group filter, `?speaker=` preselect); `AdminSpeakers.test.jsx` "offers reminders to accepted and approved speakers only"; `e2e/speaker-reminders.spec.js` |
| Only accepted speakers; what is missing uses the app's own rule | `speakerReadiness.test.cjs`; `tests/speaker-reminders.rules.test.js` "lists accepted speakers with what each still owes" and "previews … says why the rest get none" (invited, no email, unknown id refused) |
| New `speaker.reminder` template, staff can edit wording, validated tokens | `tests/speaker-reminders.rules.test.js` "refuses an unknown token at save, and the next preview and send use saved wording"; `reminders.test.cjs` "saved wording is used, and wording with an unknown token or no dashboard link is refused"; UI test "shows the server refusal of an unknown token and saves valid wording" |
| Escaped output | `reminders.test.cjs` "the shipped reminder escapes names and session titles in html" (rendered from the shipped template); rules test preview asserts `Panel &lt;one&gt;` in html |
| Preview shows exactly what each recipient gets | rules test "sends what the preview showed": provider subject, html and text equal the preview's; E2E: captured mail text equals the preview text on the page |
| Explicit confirmation with the recipient count | UI test "previews each message, confirms with the count, and sends the previewed batch"; rules test "needs the confirmed recipient count and a batch id" |
| Send-once per speaker per reminder; double click or retry does not duplicate | rules test "a retry or a double click with the same batch sends nothing more" (two concurrent requests, then a replay: one mail); UI test "a second press while sending sends nothing more"; E2E: one mail in the inbox |
| Visible "last reminded" date per speaker | UI test "shows each accepted speaker with the missing items and the last reminder in words"; E2E asserts "Last reminded … about Biography, Headshot" after the send |
| admin_logs audit | rules tests for send, save, reset, export |
| Historical-demo guard | rules test "a historical demo refuses the send before anything is stored" (no mail, no claim, no reminder record, no log, no template write) |
| Browser test of select → preview → send with captured console mail | `e2e/speaker-reminders.spec.js`, passed |
| #332 readiness CSV export | rules test "returns one row per speaker for the group and records the export first"; `reminders.test.cjs` formula-cell escaping; UI export test |

### Related issues

- **#204** ("edited wording is used by the next invite and an unknown token is
  refused at save"): **Not met in full.** The editor and the save-time check
  exist for `speaker.reminder` only. `speaker.invite` and `speaker.accepted`
  are not editable yet. The endpoint's template actions are fixed to
  `speaker.reminder`; widening them is a small follow-up. ROADMAP not ticked.
- **#332**: **Partly met.** Met: filtered groups, a staff-only CSV with
  formula-safe cells, one row per speaker (co-speakers and several sessions
  do not duplicate), counts and the group in the file name, an audited
  export, groups recalculated on every read, rejected uploads do not count.
  Not met: the "session needs no deck" exception (no such session field
  exists), and the CSV does not split pending from approved uploads (both
  count as sent, the same rule as the Materials coverage panel).

## Decisions the owner may want to change

1. **Recipients** are speakers with status `accepted` or `approved`. Draft
   and invited speakers get the invitation instead.
2. **Sessions that count** are published and visible sessions naming the
   speaker, the same set the speaker's dashboard shows. The Materials
   coverage panel also counts hidden sessions, so its "speakers with no
   materials" can differ for a hidden session.
3. **24-hour limit per speaker.** A control on the speaker's inbox, like the
   invite send budget. A failed send does not start the window.
4. **Session description** is a reminder item although a speaker cannot edit
   the session. The shipped line asks the speaker to send a description; the
   reply goes to the staff member who sent the reminder
   (`admin_contact_email` is the sender's address, falling back to the
   support address, as the invite does).
5. **One endpoint with actions** (`speakerReminders`), like
   `commerceAdmin`, rather than seven deployed functions. Staff tier for all
   actions, the wording editor included.
6. **Wording preview** uses saved wording. Staff save, then preview. There is
   no preview of unsaved wording.

## Final check results (last run, after docs; generated output regenerated locally, then discarded)

- `npm run lint`: pass.
- `npm test`: 3113 tests, 3113 pass, 0 fail.
- `npm run test -w apps/web`: 293 files, 3449 tests, all pass.
- `npm run test:rules`: 4 files, 384 tests, all pass (speaker-reminders 11).
- `npm run build -w apps/web`: built. `scripts/ci/bundle-budget.cjs`: within budget.
- `node scripts/generate-content.cjs --demo --check`: pass.
- `node scripts/build-demo.cjs --check`: pass.
- `node scripts/build-pages.cjs --check`: pass.
- `npm run check:copy`: no blocked patterns.
- E2E (no-sandbox local config): `speaker-reminders.spec.js` passed;
  `speaker-invite`, `speaker-materials`, `email-log` passed (6 of 6).

Without the regenerate step, this branch tip fails `scripts/build-pages.test.cjs`
(docs/docs is stale for the admin guide and the changelog), and `npm ci`
fails on the shared tarball hash. Both are cleared by the director's
regenerate commit, as the dispatch asked.

## Left undone

- #204 for `speaker.invite` and `speaker.accepted` (see above).
- #332 "no deck needed" exception: needs a session field first.
- No scheduled or automatic reminders: every reminder is a staff action.
