# g2-announce: announcement email to attendees

Branch `joe/wave3-g2-announce`, cut from `25c60e8`. Worktree
`/home/user/eventrunner/.claude/worktrees/wf_e62b5d98-1d3-2`.

Promise delivered: "Confirmation emails, speaker reminders and event announcements will use
an agreed email provider and workflow." Staff can now email an announcement from the
Announcements page through the central sender, on its own broadcast stream, with a preview,
a test send, a confirmation of the count, send-once keys, one-click unsubscribe, a send
history, and `admin_logs` rows.

## Commits

1. `Add batch send to the email core and providers` (#201)
2. `Send announcement email with a stream, unsubscribe and history` (#202, #203, #490)
3. `Add the announcement email composer to the Announcements page` (#202, #203)
4. `Accept a Postmark resubscribe record on the delivery webhook` (#490)
5. `Document announcement email for staff, operators and clients`
6. This report.

No generated output is committed (director override). `packages/shared` is not changed, so
no `.mjs` shim and no lockfile change.

## What changed, per issue

### #201 Batch send

- `functions/src/email/send.cjs`: `sendBatch(messages)` on the email core. Message
  resolution (sender, reply-to, stream, legal footer) is shared with `send()` through
  `resolveMessage`. `EmailBatchError` for refusals before any write.
- `functions/src/email/providers/postmark.cjs`: `sendBatch` (one `POST /email/batch`, results
  by position, ErrorCode 0 accepted, nonzero final, whole-request failure mapped to every
  entry, short or invalid 2xx answer uncertain), `checkBatch` (500 messages, 50 MB on the
  final serialized payload), `getMessageStream` (for #490).
- `functions/src/email/providers/console.cjs`: `sendBatch`; the captured line now carries
  `headers` and `messageStream`.
- Webhook relay: no `sendBatch`, so the core refuses with `batch-unsupported` before claims.
- Tests: `functions/src/email/sendBatch.test.cjs` (18 cases, faked fetch, the contract table
  from the issue comment).

Done when: "one batch call writes one `sent_emails` row per recipient" (test `two fresh
recipients: one batch request, two ordered results and two audit rows`); "a partial
provider failure marks only the failed recipients" (`one accepted and one rejected inside
HTTP 200…`); "a repeat of the same batch sends nothing twice" (`a repeat of the same batch
sends nothing twice…`, `concurrent calls with the same keys…`). **Met in full.**

### #490 Announcement stream and unsubscribe contract

- `config/providers.email.announcementStream` (set by the init answers file,
  `scripts/lib/answers.cjs`). The transactional `messageStream` is unchanged.
- `functions/src/announcements/compose.cjs` `resolveChannel`: Postmark reads
  `/message-streams/{id}` with the server token before preview, test, start, and every chunk.
  Missing, not found, archived, transactional, equal to the transactional stream, `None`
  handling, or a failed read: refused before any claim. Console: application-managed.
  Webhook relay: refused (`unsupported-provider`) before claims or HTTP.
- Postmark `UnsubscribeHandlingType: Postmark` → provider mode: no application link, Postmark
  adds its footer; the preview says so. **Decision:** `Custom` handling is also accepted, as
  application mode (signed link plus `List-Unsubscribe` and `List-Unsubscribe-Post`). #490
  named only `Postmark`; the dispatch asked for a signed link and the headers, and `Custom` is
  how Postmark expects a sender to supply its own. The owner may want `Custom` refused.
- Signed link: HMAC-SHA256 over `sendId.addressHash` with a random per-send key stored on the
  server-only send record. **Decision:** this keeps the ADR's "no new deployment secret" rule
  and still makes a link unforgeable for another address or send.
- `functions/src/announcements/suppression.cjs`: public `emailUnsubscribe` (GET shows a button
  and records nothing, so link scanners cannot opt a reader out; POST and RFC 8058 one-click
  record `email_suppressions/{sha256(address)}`; no address is stored; 20 requests per
  15 minutes per client IP; `admin_logs` row without the address; demo guard). Staff removal
  path `removeEmailSuppression`. Hosting rewrite `/unsubscribe` → `emailUnsubscribe`
  (`firebase.json`, noindex and no-store headers).
- `emailDeliveryWebhook` mirrors a Postmark `SubscriptionChange` suppression on an
  announcement row into the same record. A resubscribe record now answers 200 instead of 400
  (commit 4), so the broadcast stream's webhook can carry SubscriptionChange.
- The template validator is unchanged and still rejects `pm:unsubscribe`; no editable
  template carries it. The announcement wrapper (`email/templates/announcement.email.cjs`) is
  not in the override registry.

Acceptance checks: 1. config fixtures for the valid stream and each invalid case with no send
or claim (`postmark: … is refused before any claim or send`, six cases); 2. mapper gets the
explicit stream, OTP keeps its prior stream (`two fresh recipients…`, `single send still uses
its prior stream…`, `postmark with Postmark unsubscribe handling…`); 3. existing template
checks unchanged (render tests untouched and passing; `the shipped wrapper passes the
template token checks and is not editable`); preview does not claim a real link (`the preview
counts each audience…`: inert `?test=1` link); 4. console output synthetic for preview and
test; webhook relay fails before provider contact (`the webhook relay is refused…`);
5. real-provider smoke is **not done** here (no credentials); it is a checklist item in
`docs/POSTMARK_PROVISIONING.md`. **Met except check 5, which needs an operator.**

### #202 Composer

- Endpoints in `functions/src/announcements/sends.cjs` (staff tier): `listAnnouncementSends`,
  `previewAnnouncementEmail`, `sendAnnouncementTest`, `sendAnnouncementEmail`.
- Audience (`audience.cjs`) from `users/{uid}` on the server: `registered` (approved or
  ticketed), `approved`, `speakers` (speakerId set). Revoked never; pending never; lowercased
  dedupe; unusable addresses counted; suppressed addresses left out and counted; at most 5,000.
- Receipt: SHA-256 over audience, every address, rendered subject and bodies, sender, stream,
  mode. A mismatch at send is `409 preview-stale` before any record or claim.
- Send: freezes recipients on `announcement_sends/{sendId}`, sends 200 per call as one
  provider batch, per-recipient key `announcement:{sendId}:{addressHash}`, lease so two calls
  never take the same chunk, suppression re-checked per chunk, stream re-checked per chunk.
  The composer calls until `sent`. No background worker reads the record, so it is not a queue.
- UI: `apps/web/src/admin/components/AnnouncementEmailComposer.jsx` on the Announcements page:
  audience, subject, email message, optional button; preview in the sandboxed frame with the
  plain text; test send; confirmation that repeats the count; progress status line; result
  notice; focus moves to the preview heading, the confirmation heading, the error summary, and
  the result; Go back returns focus to the send button. Any edit drops the preview.
- Email log names the sources `announcement` and `announcement-test`.

Done when: "a test send reaches the console adapter as one batch" (`a confirmed send reaches
the console adapter as one batch, with an audit row per recipient`, which asserts one
`sendBatch` call); "every recipient has an audit row" (same test, two `sent_emails` rows with
source `announcement`); "the send appears in the email log" (browser test
`e2e/announcement-email.spec.js` finds a recipient's row under source Announcement on
`/admin/email-log`). **Met in full.**

The #202 comment's matrix: preview/edit/cancel write nothing (`the preview counts each
audience… writes nothing`; UI `drops the preview on any edit`); change after preview refused
(`a change after the preview is refused…`); same confirmed send twice (`submitting the same
confirmed send again, even at once…`); no recipients (`no-recipients` 409, empty state in the
preview); large audience: **deviation**, chunks of 200 across calls up to 5,000 instead of a
refusal over one batch, as the dispatch asked; missing unsubscribe support or wrong stream
refused; partial or uncertain results counted apart; keyboard path (UI tests above).

### #203 Saved templates and send history

- Send history: shipped (the 20 most recent sends, counts, failed addresses with reasons,
  Continue sending). "A completed send appears in the history": `a confirmed send reaches the
  console adapter…` (history assertions) and the browser test.
- "A saved template can be loaded into a new message": **partly.** **Use this message** loads
  any past send into the form (`loads a past send into the form with Use this message`). Named,
  reusable templates that are not sends are **not built**; not needed for a safe send. #203
  stays open; ROADMAP left unticked with a note.

## Tier decision

Staff tier for all five admin endpoints. Staff already run the banner on the same page and
attendee communication day to day; requiring an operator would block the client's own staff.
The safety is in the flow: server-chosen audience, receipt, explicit count confirmation,
send-once keys, unsubscribe, and `admin_logs` (`startAnnouncementEmail`,
`completeAnnouncementEmail`, `sendAnnouncementTest`, `removeEmailSuppression`,
`emailUnsubscribe`). Recorded in `functions/README.md`.

## Tests added

- `functions/src/email/sendBatch.test.cjs`: 18.
- `functions/src/announcements/sends.test.cjs`: 23 scenarios; run on an in-memory Firestore
  under `npm test`, and against the Firestore emulator when `FIRESTORE_EMULATOR_HOST` is set
  (`npx firebase emulators:exec --only firestore --project demo-announce "node --test
  functions/src/announcements/sends.test.cjs"`: 46 of 46 passed). Covers tiers, audience,
  send, dedupe, chunked resume after lost progress, stale preview, test send, unsubscribe
  honored (and during a send), forged links, rate limit, historical demo, webhook refusal,
  Postmark stream cases, provider and Custom modes, the webhook mirror.
- `functions/src/announcements/compose.test.cjs`: 6.
- `functions/src/email/providers/postmark.test.cjs`: resubscribe expectation updated.
- `scripts/lib/answers.test.cjs`: 1. `scripts/deploy-workflow.test.cjs`: rewrite list updated.
- `tests/firestore.rules.test.js`: `announcement_sends`, `email_suppressions`,
  `unsubscribe_rate_limits` deny-all, admin included.
- `apps/web/src/admin/components/AnnouncementEmailComposer.test.jsx`: 10.
  `AdminAnnouncements.test.jsx`: composer mocked, one placement test.
- `e2e/announcement-email.spec.js`: compose → preview → test → confirm → send → history →
  one-click unsubscribe → next preview leaves the address out → email log. Run with
  `e2e/email-log.spec.js`: 5 of 5 passed.

## Final checks

Run last, after the docs commit, with generated output regenerated in place
(`generate-content --demo`, `build-demo`, `build-pages`), then the generated changes were
discarded:

- `npm run lint`: exit 0.
- `npm test`: 3147 tests, 3147 pass, 0 fail.
- `npm run test -w apps/web` (vitest run, under the lock): 292 files, 3445 tests passed.
- `npm run test:rules` (under the lock): 3 files, 375 tests passed.
- `npm run build -w apps/web` (vite build, under the lock): built.
- `node scripts/generate-content.cjs --demo --check`: 7 files match.
- `node scripts/build-demo.cjs --check` (under the lock): 210 files match.
- `node scripts/build-pages.cjs --check`: 30 files match.
- `npm run check:copy`: 533 files, no blocked patterns.

On the committed branch without the regenerated output, `npm test` has one expected failure:
`the committed site matches a fresh render` (docs/docs stale for six edited pages). The
director regenerates on the stack tip.

## Not done, and why

- Named saved templates (#203). Not needed for a safe send; Use this message covers reuse.
- Real Postmark smoke test of link replacement and stream-scoped suppression (#490 check 5).
  Needs credentials and an authorized synthetic recipient; a checklist item now.
- Webhook relay batch and unsubscribe contract (#201, #490). The relay is refused for
  announcements until a contract exists.
- Scheduling a send for later. Out of scope (no queue, no scheduler).
- A list of unsubscribed addresses. The record holds only a hash, by design; staff restore by
  address.
- Per-recipient personalization (first name). Not requested.

## Review round

The adversarial review had one must-fix and seven optional findings. Each one is below, with
the commit that fixed it or the reason it was not changed.

### Must fix: unsubscribe rate limit blocked real one-click opt-outs

Fixed in `Never rate limit a correctly signed unsubscribe`. The handler took a per-IP slot for
every request before it checked the signature. It now checks the signature first. A correctly
signed request (GET or POST) never takes a slot. Only a request whose signature fails takes a
slot, with the same limit (20 per 15 minutes per client address). A GET still shows a button
and records nothing; the button POSTs. `recordSuppression` is idempotent, so a repeat of a
signed POST writes nothing new.

Tests, written first and seen to fail (`sends.test.cjs`):

- "signed one-click unsubscribes from one shared address are never rate limited": 50
  recipients, one client address, a GET and a one-click POST each. All 50 are recorded, and
  no rate-limit document is written.
- "requests with a bad signature are rate limited per client address, and a signed one still
  passes": 20 forged POSTs answer 400, the 21st answers 429, another address still gets 400,
  and a signed one-click POST from the limited address is recorded.

### Optional findings

1. **Claims are never released, so a provider outage loses a chunk.** Real. Fixed in
   `Retry an announcement's failed addresses, and show cut-short lists`. A recipient the
   provider refused with a transient status (5xx or 429, after the core's own retries) goes on
   `retryRecipients` (addresses only, to keep the record under the Firestore size limit). The
   history offers "Retry N failed addresses". It loads the message, and the preview and send
   take `retryOf`. That is a new send with its own identity, receipt and send-once keys,
   limited to that list less any address that unsubscribed since. The earlier record gets
   `retriedBy` in the same transaction, so each send is retried once. A refusal for good (for
   example 406 inactive) and an uncertain result are not retried. The receipt binds the retry,
   so a retry preview cannot start a send to the whole audience. Tests first:
   "postmark: a provider outage leaves the failed addresses for one retry send that reaches
   only them", "postmark: a recipient the provider refuses for good is not offered for a
   retry", and composer tests "retries the failed addresses of a send as a new previewed send,
   once" and "drops a retry when staff pick another audience or cancel it".
   Not fixed: a recipient claimed by a call that died before the provider request counts as
   "already handled" and is not resent. The site cannot tell that case from a delivered one.
   The ADMIN_GUIDE now says so.
2. **Postmark-mode restore leaves Postmark's own suppression.** Real. Fixed with copy and docs,
   not an API call (`Retry an announcement's failed addresses, …` for the composer, `Document
   announcement retry and Postmark-managed unsubscribe` for the guides). With Postmark
   handling, the restore hint and message say to reactivate the address on the broadcast
   stream in Postmark too. ADMIN_GUIDE describes both modes. POSTMARK_PROVISIONING section 2a
   has the same step. I did not call Postmark's suppression delete API: Postmark may refuse to
   reactivate a recipient-originated opt-out, and this sandbox cannot check that against the
   real API. Test first: "says a restore also needs Postmark when Postmark handles
   unsubscribes". The resubscribe record is still not mirrored back, and that is intended: a
   resubscribe through Postmark does not remove the site's record without staff action.
3. **"Failed addresses (50)" hides that the list is cut short.** Real. Fixed in the retry
   commit. The label is "Failed addresses (first 50 of N)" when failed plus uncertain is more
   than the stored list, and a line points to the Email log filtered by the source
   Announcement. Test first: "says when the failed address list is cut short, and where the
   rest are".
4. **The receipt goes stale on a busy registration day.** Not changed. The reviewer calls the
   behaviour acceptable for safety. A refused send already focuses an error that says to
   preview again, which is one click. An automatic re-preview would put a new count in front
   of staff without a new decision, and it would weaken the rule that staff confirm only the
   count they saw.
5. **Custom unsubscribe handling is accepted, but #490 names Postmark handling only.** Not
   changed. This is an owner decision, and the brief forbids GitHub comments from a builder.
   The director should ask the owner: either refuse Custom on Postmark, or record the change
   on #490. The key on the send record is server-only (deny-all rules). Anyone who could read
   it could already read the recipient list beside it.
6. **The delivery webhook comment says it writes nothing else.** Real. Fixed in `Keep the live
   unsubscribe link out of the email log`: the comment now names `email_suppressions`.
7. **The Email log stores each recipient's live signed link.** Real. Fixed in `Keep the live
   unsubscribe link out of the email log`. The email core takes `auditRedact`, a list of
   `{ find, replace }` pairs that change only the bodies the audit row stores. An announcement
   swaps the live link for the inert test link there, in its HTML and plain text forms. The
   mail sent is unchanged. Test first: "the email log stores each copy with the inert link,
   never the recipient's live signed link".

### Review round commits

1. `Never rate limit a correctly signed unsubscribe` (must fix)
2. `Keep the live unsubscribe link out of the email log` (optional 6 and 7)
3. `Retry an announcement's failed addresses, and show cut-short lists` (optional 1, 2, 3)
4. `Document announcement retry and Postmark-managed unsubscribe` (optional 1, 2, 3; docs)
5. `Add the review round to the g2-announce report` (this section)

### Review round checks

Run after the last code and docs commit; lint, npm test and check:copy again after this report.

- `npm run lint`: exit 0.
- `npm test`: 3150 of 3151 pass. The one failure is the expected "the committed site matches
  a fresh render": docs/docs is stale for the edited Markdown pages. A local
  `node scripts/build-pages.cjs` made it pass (`build-pages.test.cjs` 63/63, `--check` 30
  files match). The regenerated files were then discarded and are not committed.
- `npm run test -w apps/web` (under the lock): 292 files, 3449 tests pass.
- `npm run test:rules` (under the lock): 3 files, 375 tests pass.
- `npm run build -w apps/web` (under the lock): built.
- `npm run check:copy`: 533 files, no blocked patterns.
- `sends.test.cjs` on the Firestore emulator as well as in memory (under the lock): 54/54
  (27 scenarios on each backend). This proves the retry transaction on real Firestore.
- E2E, `e2e/announcement-email.spec.js` with `e2e/email-log.spec.js`, through a temporary
  no-sandbox Playwright config (under the lock): 5 passed. The temporary config and runner
  were deleted.
