# functions

Cloud Functions, one domain module per directory under `src/`. `index.js` is an export barrel only — no logic, no handler bodies (spec §1.3).

Landed so far (M2 backend foundation):

- `src/core/` — config loader/cache (`getEventConfig`, Tier A env accessors), CORS, error responses, lazy firebase-admin init
- `src/email/` — the one send path (bounded retry, `onceKey` send-once claims, `sent_emails` audit; `sendBatch` sends many single-recipient messages in one provider batch call, needs a send-once key on every entry, refuses a malformed or oversized batch and a provider without batch support before any claim, retries only retryable entries, and marks a throw or a missing result uncertain with no replay), template renderer with the `_html` escaping rules, phase-2 templates (`auth.otp`, `account.welcome`), Postmark/webhook/console adapters, delivery-event ingest (`emailDeliveryWebhook`; an event for a message with no `sent_emails` row yet answers 503 with `Retry-After` for 15 minutes after the event, so the provider retries it, and is acknowledged after that), and the staff-tier email log readers (`log.cjs`: `listSentEmails` lists rows without bodies and searches a bounded window of 500; `getSentEmail` returns one row's bodies and records the read in `admin_logs`)
- `src/auth/` — emailed-code sign-in: challenge store, rate bucket, attempt lockout, send-boundary code gate, custom-token issuance
- `src/notify/` — operator notifier with webhook/email/none sinks
- `src/cms/` — the two-revision publish model (spec §8.4): block-type registry, draft-only content/page/update editors (`cmsSaveUpdate` takes `title`, `body`, `publishAt`, `pinned`, `category`, `featured`, `featuredImage`, and `content`, and refuses any other key by name), version history reads with a what-changed list per version, and the chunked resumable publish pipeline over the six publishable collections and their `_drafts` siblings; `organizations.cjs` checks each organization field's type and length at the content save (the website stored canonical, the logo a Storage object path), and a create's document id, which is the organization's page address (`/sponsors/:slug`): it must be slug-shaped, and one already in use answers 409 at the save; `timeline.cjs` checks each timeline entry at the same save (the year a whole number from 1900 to 2100, the title required text on one line up to 120 characters, the description optional text up to 600 characters), refuses a key the request sends outside those fields by name, and drops a stray key only the stored entry carries
- `src/admin/` — validated writers for `config/{event,features,theme,badges}` (`updateEventConfig`, `updateFeatures`, `updateTheme`, `updateBadges`); rejects deploy-mirrored read-only fields and everything outside that four-document allowlist (spec §1.3). `access.cjs` holds the operator-only `listAdminAccess` and `setAdminAccess`, the only path that reads or changes `config/bootstrap` from the browser; it lowercases on write, refuses the change that would leave no operator, and records every change in `admin_logs` with the address and the tiers it moved between. `eventStats.cjs` holds the staff-tier `getEventStats`, the admin overview's figures: thirty Firestore `count()` aggregates over `users`, `tickets`, `speakers`, the publishable collections and their drafts, and `system_errors`, answered as integers with no document body read and no `admin_logs` row, plus the registration funnel summed from them. `changeRequests.cjs` holds the change request endpoints: `submitChangeRequest` (any signed-in account with a verified email, only while `features.changeRequests` is on, read live; 5 per 15 minutes per account; the sender comes from the ID token, verified with the revocation check so a deleted account's open session is refused, and the store reads `users/{uid}` in its transaction so an account delete that lands during the call wins; a retry that changes the text under a used `submissionKey` is 409), and the staff-tier `updateChangeRequestStatus` and `deleteChangeRequest`. Each write commits in one transaction with its `admin_logs` row, which never holds the request's text.
- `src/sessions/` — private session pitch intake and review. `submitSessionPitch` requires a verified Firebase sign-in but no ticket, derives identity from the token, reads the default-closed `config/pitch_call` document inside the storage transaction, and atomically stores each new pitch with its per-user rate slot. Account-namespaced retry keys replay unchanged payloads and conflict on changed payloads. Operators control the call through `updatePitchCall`. Staff review with `reviewSessionPitch`, which checks the expected status and review revision before it commits the new status, private notes, and audit row. `pitchNotices.cjs` sends the pitch receipt after a native pitch commits (automatic mode) and the staff-sent decision emails (`sendSessionPitchNotice`, preview first). Each email has a private delivery record on the pitch and a send-once key per attempt. Operators set the receipt mode and the wording with `savePitchNoticeSettings`. `airtableSync.cjs` refreshes the queue from one approved Airtable table (below). See [`docs/operator/session-pitches.md`](../docs/operator/session-pitches.md).
- `src/users/` — account lifecycle triggers, the `users_public` projection, and the staff-tier attendee endpoints: `approveUser` and `revokeUser`, and `exportAttendees`, which returns the rows on the attendees page as a CSV file with the nine approved columns only, escapes a formula-shaped cell with a leading apostrophe, and refuses the file when its `admin_logs` row cannot be written. The file is never stored. `records.cjs` holds `updateAttendee`, the only writer of the organizer-owned `pastAttendance` (the rules deny it to every client), and `deleteAttendee`, a guarded delete: one transaction re-checks the guards (not the caller, not an admin address, not speaker-linked), removes the account, `users_public` and `schedule_shares`, releases ticket claims, and commits the audit row; an inline sweep then deletes the sign-in, saved sessions (lowering their counts), notes, profile photos, and the account's change requests with their rate-limit window, and releases any ticket claim made after the commit (a deleted sign-in's token stays valid for up to an hour). `PER_ACCOUNT_STORES` is the one list of what a delete clears. A part-way delete answers `delete-incomplete`, and the admin's retry resumes it; there is no queue.
 `src/announcements/` — announcement email (issues #201–#203, #490, #496, #497). `sends.cjs` holds five staff-tier endpoints: `listAnnouncementSends` (one page of sends, 20 by default and at most 50, newest first with a `{ createdAt, id }` cursor; each row has the counts, the audience, the sender and `auditGaps`, and no recipient address or message; plus the audiences and whether this deployment can send), `getAnnouncementSend` (one send's frozen draft, its rendered bodies with the inert test unsubscribe link, and its failed addresses; each read writes a `view-announcement-send` `admin_logs` row with the actor and the path only), `previewAnnouncementEmail` (resolves the audience from `users/{uid}` on the server, renders the email, and returns the count, a send identity, and a receipt; it writes nothing), `sendAnnouncementTest` (one copy to the caller's own address with an inert unsubscribe link), and `sendAnnouncementEmail` (starts a send from a matching receipt, then sends the next 200 recipients per call as one provider batch through `sendBatch`, with the send-once key `announcement:{sendId}:{address hash}`). A send freezes at most 5,000 recipients on `announcement_sends/{sendId}`; a lease on the record keeps two calls off the same chunk, and a lost call's chunk is retried with every reached recipient skipped by its claim. The core records a failure on its claim, so a skipped recipient whose first attempt failed is counted as failed again and, when the failure was transient, still goes on `retryRecipients`. The composer calls again until the record is `sent`. Nothing reads the record in the background, so it is not a queue. A recipient the provider refused with a transient status (5xx or 429, after the core's retries) goes on the record's `retryRecipients`; a preview and send with `retryOf` start one new send limited to them, and the earlier record gets `retriedBy` in the same transaction, so each send is retried once. Each recipient's `sent_emails` row stores the body with the inert test link in place of the live signed one (the core's `auditRedact`). Each row also holds the `sendId`, and `listSentEmails` takes a `sendId` filter. When the core cannot write a row, `sendBatch` marks that result `auditFailed`; the send record counts it in `auditGaps`, and the provider's answer still decides the counts. Maintenance (`cleanupStrandedPublishRows`) replaces a send record older than 90 days with one that holds only its unsubscribe key and `status: 'expired'`, so old unsubscribe links still work. `messages.cjs` holds the staff-tier `announcementMessages` (`list`, `load`, `save`, `rename`, `remove`) over the server-only `announcement_messages` store: a name of at most 80 characters and the composer's draft fields, checked by `compose.cjs` `validateDraft`, at most 100 messages, kept until staff remove them. A historical demo refuses `save`, `rename` and `remove`, and each change writes an `admin_logs` row without the name or the content. `compose.cjs` renders the staff text into `email/templates/announcement.email.cjs` (not in the override registry) and decides the channel: Postmark needs an active Broadcasts stream named by `config/providers.email.announcementStream`, read live before every chunk; its unsubscribe handling picks provider-managed (`Postmark`) or application-managed (`Custom`) links; console is application-managed; the webhook relay is refused. `suppression.cjs` holds the public `emailUnsubscribe` (GET shows a button and records nothing; POST and RFC 8058 one-click record `email_suppressions/{sha256 of the address}`; HMAC-signed links under a random per-send key on the server-only send record, so no new deployment secret; a correctly signed request is never rate limited, and a request whose signature fails is limited to 20 per 15 minutes per client address; an `admin_logs` row without the address) and the staff-tier `removeEmailSuppression`. `emailDeliveryWebhook` mirrors a Postmark opt-out on an announcement row into the same record. The site's `/unsubscribe` path rewrites to `emailUnsubscribe` (`firebase.json`).
- `src/admin/dataExport.cjs`, `eventPackage.cjs`, `eventPackageReader.cjs` and `exportRecords.cjs` — the event data exports (issue #329). `exportEventData` answers one CSV file (`{ filename, csv, rowCount }`) for `sessions`, `speakers` or `organizations` (staff) or `orders` or `admissions` (operator). `downloadEventPackage` (operator) answers one zip: a JSON file per record type, the main CSV files, `manifest.json` (format, schema version, export time, per-file record counts and SHA-256 checksums, relationships, exclusions) and `README.md`. `exportRecords.cjs` names every field a private record copies and then strips any key that names a credential at any depth; `config/bootstrap`, `config/providers`, audit, sign-in, mail, invite, webhook, queue and payment-attempt collections are never read. The staff sessions and organizations spreadsheets read drafts, as the admin lists do; every package file, its CSV files included, reads the live documents only and marks a hidden one. Both endpoints read collections a page at a time with a document cap (a package reads each collection once, so each document counts once), write their `admin_logs` row before the first byte and refuse the file when it cannot be written, and keep no copy. A package past 50,000 documents or 9 MB answers 413 and names `scripts/export-event-package.cjs`, which builds the same package with no cap and checks a saved one with `--verify` (`eventPackageReader.cjs`).
- `src/materials/` — session materials: The canonical store, review, the embargo gate, the public projection, and the per-file `downloadSessionMaterial`. A file must be no larger than 9 MiB because the function streams it through a 10 MB response boundary. Registration checks the authoritative Storage size, and download checks again for older records. `bulk.cjs` holds the staff-tier `listAllSessionMaterials` (every material, at most 2,000, without `createdBy`) and `downloadSessionMaterialsArchive`, which streams one stored zip of up to 50 selected files and 9 MiB through the function with `yazl`. There is no signed URL: Signing needs `signBlob` (`roles/iam.serviceAccountTokenCreator`), which a fresh client project does not grant, so the bytes go through the function, as `downloadSessionMaterial` already does. Every check runs before the first byte, one `admin_logs` row per file is committed first and the archive is refused without them, and a failure after the first byte destroys the response so the browser saves nothing.
- `src/imports/` — the staff-tier `importRecordsCsv`: a CSV import of speakers, sessions and organizations that follows `ticketingImportCsv` (column mapping, one pipeline for the dry run and the commit, a commit that must send back the dry run's digest). Every new record is a draft: a speaker in `draft` status, a session or organization through `store.writeDraft` with `visible: false`. A speaker has no draft revision, so a change to an approved speaker goes into `pendingEdits` (the queue `applySpeakerPendingEdits` and `discardSpeakerPendingEdits` serve), never onto the fields `onSpeakerWritten` projects, and its slug is not changed. Rows go through the editors' validators (`shared/speaker` `validateSpeaker`, `validateSessionStructure` and `validateSpeakerReferences`, `validateOrganizationFields`). The server-only `record_imports/{type}__{sha256(externalId)}` maps each external ID to its document and keeps a digest of each value the last import wrote (no raw values, no external ID), for a three-way merge per mapped field: an unchanged file value never writes, a changed one writes only a field staff have not edited, and an unmapped field is never written. A row with no key whose slug or session ID belongs to a record no key points at is linked to that record instead of making a second one. One transaction per row; 500 rows and 5000 characters per mapped cell at most; one `admin_logs` row per commit, written before the first record write. No mail, no invitation, no live write.

## Admin tiers

Admin identity is the server-only `config/bootstrap` document, which carries two lists (issue #186):

| List | Tier | Runs |
|---|---|---|
| `adminEmails` | operator | Branding, feature flags, admin access, deployment settings, system errors. The list's name predates the split and is kept so every existing deployment keeps full access with no migration. |
| `staffEmails` | staff | Content, schedule, speakers, attendees, media, materials, feedback, live updates, ticketing operations, the email log. |

An address on either list is an admin. An address on both is an operator. Both lists are stored lowercase, because `firestore.rules` matches them against the lowercased token email.

**One gate, one option.** Every admin endpoint calls `requireAdmin(deps, req, { tier })` from `src/core/auth.cjs` and states its tier at that call, nowhere else:

```js
const gate = await requireAdmin({ auth, db, getConfig }, req, { tier: 'staff' });
if (!gate.ok) return sendError(res, gate.status, gate.code, gate.message);
// gate.tier is 'operator' or 'staff', for a handler that holds one field back.
```

`tier: 'staff'` admits both tiers. `tier: 'operator'` admits operators only. The option defaults to `'operator'`, so an endpoint that does not say refuses staff rather than admitting them. Pass `db` in the deps: with it the gate reads `config/bootstrap` live (`loadBootstrap`), so a grant or a revocation made on the Access page takes effect on the next request on every server. That path fails closed: a read that throws answers 500 (`BOOTSTRAP_UNAVAILABLE`) and admits nobody, and an absent document means no admins; the cached copy is never consulted. Only a caller that passes no `db` reads the five-minute config cache (`requireAttendeeAccess`, on purpose). A handler that needs the predicate without the HTTP verdict (an owner-or-admin check) calls `resolveAdminTier(await loadBootstrap({ db, getConfig }), email)`, which answers `'operator'`, `'staff'` or `null`; do not scan `adminEmails` by hand.

`firestore.rules` carries the same split as `isOperator()`, `isStaff()` and `isAdmin()`. Every admin-readable collection reads on `isAdmin()` except `admin_logs`, which is the operator's audit trail and the read the browser probes to learn its tier (`apps/web/src/contexts/AuthContext.jsx`).

**Classification.** Each endpoint's tier is the one its call site states:

| Tier | Endpoints |
|---|---|
| operator | `updateFeatures`, `updateTheme`, `updatePitchCall`, `savePitchNoticeSettings`, `updateAirtablePitchSource`, `listAdminAccess`, `setAdminAccess`, `listSystemErrors`, `resolveSystemErrors`, `webMcpInspectSystemErrors`, `downloadEventPackage`, `exportEventData` for `orders` and `admissions`, and `invoiceAdmin` for `saveSettings`, `void` and `reopen` |
| staff | `updateEventConfig` (a change to the `sender` block or to `seo.defaultOgImagePath` needs an operator; unchanged values go through and the stored bytes are kept), `updateBadges`, every `cms*` endpoint, `mediaUpload`, `mediaDelete`, `mediaUpdateMetadata` (each refuses staff for anything that is branding: an upload into `branding/`, a branding asset, or an asset a `config/theme` slot or `config/event.seo.defaultOgImagePath` references; delete and relabel also refuse staff when the usage scan fails), `scanMediaUsage`, `createSpeaker`, `updateSpeaker`, `deleteSpeaker`, `applySpeakerPendingEdits`, `discardSpeakerPendingEdits`, `sendSpeakerInvite`, `resendSpeakerInvite`, `cancelSpeakerInvite`, `listSpeakerInvites`, `speakerReminders`, `speakerMailTemplates`, `reminderSchedules`, `approveUser`, `revokeUser`, `exportAttendees`, `exportEventData` (for `sessions`, `speakers`, `organizations` and `invoices`; it refuses staff the two operator datasets by name), `updateAttendee`, `deleteAttendee`, `removeUserCustomBadge`, `getEventStats`, `saveLiveUpdate`, `deleteLiveUpdate`, `updateFeedbackStatus`, `updateChangeRequestStatus`, `deleteChangeRequest`, `reviewSessionPitch`, `sendSessionPitchNotice`, `importSessionPitches`, `convertSessionPitch`, `refreshAirtablePitches`, the materials endpoints, `getTicketingStatus`, `ticketingSync`, `ticketingImportCsv`, `ticketingListTickets`, `createUserFromTicket`, `importRecordsCsv`, `listSentEmails`, `getSentEmail`, `listAnnouncementSends`, `getAnnouncementSend`, `announcementMessages`, `previewAnnouncementEmail`, `sendAnnouncementTest`, `sendAnnouncementEmail`, `removeEmailSuppression`, `invoiceAdmin` (every action but `saveSettings`, `void` and `reopen`), `invoicePdf`, and the other five `webMcp*` diagnostics |

Announcement email admits staff because staff run attendee communication day to day, the same tier as the site banner on that page. The safety is in the flow, not the tier: the server picks the audience, the send must match the preview's receipt, the page confirms the count, every recipient has a send-once key, every address can unsubscribe, and every send writes `admin_logs`.

Event settings admit staff because dates, venue, places, tracks, the register link and social handles are content an organizer runs day to day; the server compares a sent `sender` (email, name, replyTo — any other sender key is a change) and `seo.defaultOgImagePath` with the stored values inside the write transaction and refuses a staff CHANGE by name; an unchanged value is dropped from the merge so the stored bytes are kept. The form does not send the sender block for staff at all. Branding is the operator's wherever it is reached: the media endpoints gate at staff and then ask for the operator tier for an upload into `branding/`, a delete or relabel of a branding asset or of any asset `config/theme` or `seo.defaultOgImagePath` references (force or not, and a failed scan refuses too), and the speaker endpoints accept a `headshotPath` only under the speaker's own `speaker-photos/{speakerId}/` prefix and only ever delete an object there. Ticketing provider setup (provider choice, API token, webhook registration) lives in Tier A env and operator scripts, so no admin endpoint carries it; the ticketing page is attendee operations.

**Adding an endpoint.** State the tier at the `requireAdmin` call, add a test beside the module that a staff caller is admitted or refused as intended, and, if the page reads a new collection directly, add it to `ADMIN_READABLE` in `tests/firestore.rules.test.js`. On the web side, the page's docket entry in `apps/web/src/admin/AdminLayout.jsx` declares the same tier.

The shared package is packed into `vendor/shared.tgz` by `npm run prepare:functions` (also the `firebase.json` predeploy hook), because Firebase uploads only this directory — a workspace symlink does not survive the upload. The tarball is gitignored; `package-lock.json` pins its integrity hash, so a stale tarball is a loud lockfile mismatch. See spec §1.1.

Tests live beside each module (`*.test.cjs`, `node --test`) and run with fakes — no emulator, no network. Modules take injected dependencies (`db`, `fetchImpl`, clocks); only `src/core/firestore.cjs` imports firebase-admin.

## Eventbrite webhooks

`ticketingWebhook` serves Eventbrite and Stripe through one handler and one queue
(`ticket_sync_queue`). Eventbrite does not sign its deliveries, so the adapter does not
check an HMAC (#356). `TICKETING_WEBHOOK_SECRET` is a random value of at least 32
characters that the operator generates. The length is checked where the secret is
used: a short or missing secret refuses every delivery and stops registration, but
claim, verify, sync, and status keep working. `scripts/register-ticketing-webhook.cjs`
registers the callback URL with `?token=<secret>` added. The handler passes the parsed
query to `verifyWebhook`, which compares `token` with the secret in constant time
(SHA-256 digests and `timingSafeEqual`). A missing or wrong secret gets a 401 before
the body is read.

The body is not trusted for ticket data. The adapter reads only the action and an order
id from an `api_url` that is https on `www.eventbriteapi.com`, with no port or
credentials. It accepts `/v3/events/{e}/orders/{o}/`, `/v3/orders/{o}/`, and
`/v3/events/{e}/attendees/{a}/`; the attendee form is mapped to its order by reading
the attendee from the API base. If that read finds no attendee or no order yet, the
handler answers 500 and Eventbrite retries. An authenticated delivery for an action the
adapter does not handle, or in any other shape, gets 200 and is ignored, so Eventbrite
does not retry it. Nothing fetches the delivered URL. The sync drain fetches the order from
the fixed API base with this deployment's token and drops an order for another event.

Registration sends every action the adapter handles (`webhookEventTypes`), so
`order.refunded` arrives (#357). The script reads every page of the webhook list. It
reuses a subscription at the same endpoint (origin, path, and every query parameter
but the secret) that carries the current secret, every action, and the same event scope
as the deployment. An org-wide subscription is not reused by a deployment scoped to an
event. Otherwise it creates one. It names every other
subscription at the endpoint for the operator to delete.

The secret never appears in Event Runner logs, error messages, or script output.
Cloud Run request logs record the request URL, query string included, so log access
must stay with operators. Confirmation against a real Eventbrite sandbox is tracked in
#79 and described in [`docs/EVENTBRITE_VERIFICATION.md`](../docs/EVENTBRITE_VERIFICATION.md).

## Airtable pitch refresh

`src/sessions/airtableClient.cjs` is a read-only Airtable REST client. It calls only
`https://api.airtable.com` (the emulator alone may use a loopback origin from
`EVENT_AIRTABLE_API_ORIGIN`), pages with `offset`, reads at most 10 pages of 100 per run,
sends at most four requests a second, and waits 30 seconds after a 429, twice at most.
`src/sessions/airtableSync.cjs` holds three exports:

- `updateAirtablePitchSource` (operator): validates and stores the base ID, table ID or
  name, optional view, field mapping and refresh timing in `session_pitch_sources/airtable`,
  with an `admin_logs` row.
- `refreshAirtablePitches` (staff): one run, at most once a minute, never two at once.
- `scheduledAirtablePitchRefresh`: every 15 minutes; returns at once unless an operator
  chose a 15- or 60-minute timing. Always deployed, so turning Airtable off never deletes a
  function in a non-interactive deploy.

A run upserts by the CSV import's identity (`import\0airtable\0<externalId>`), keeps
status, notes, conversion and notices, bumps `reviewRevision` on a content change, flags
removed records after a complete read, skips rows without a ticked consent box, writes
`session_pitch_sync/airtable` and one `admin_logs` row, and sends no mail.

Secret: `AIRTABLE_API_TOKEN`, an Airtable personal access token with `data.records:read`
on the pitch base only. It is bound through `defineSecret` only when the deployment sets
`EVENT_AIRTABLE_ENABLED=true` (validated by `scripts/validate-deploy-env.cjs` and written to
the functions env file by `deploy-client.yml`), and never in the emulator. It is redacted
from every stored, returned or logged message.

## Scheduled reminders

ADR 0006 and issue #518. `src/reminders/` holds two exports. The rules every schedule shares
(on, off or paused, the run lease, the pause, one run from the checks to the admin log) are in
`src/reminders/scheduleCore.cjs`.

- `reminderSchedules` (staff): one POST endpoint with an `action` and a `schedule` (`speakers`
  or `attendees`; the attendee actions are in `src/reminders/attendeeActions.cjs`). `get` returns the settings, the state (on, off or paused), the next run
  and the last run. `save` checks and stores the offsets (1 to 6 whole days from 1 to 365), the
  send time (`HH:MM` on the event clock), the due date (RFC3339) and the items. `preview`
  renders one sample per offset and returns the wording version and a settings version.
  `approve` needs both, and refuses when either changed since the preview. `disable` turns the
  schedule off. Every write checks the historical-demo policy first and writes an
  `admin_logs` row. A settings change while the schedule is on pauses it.
- `runScheduledReminders`: `onSchedule` every 60 minutes, no retry. It reads
  `reminder_schedules/speakers`, works out the due window with `shared/reminderSchedule`, and
  sends through `src/speakers/reminderCore.cjs`, the staff send path. The batch id is fixed per
  window (`sched-{due date}-{N}d`). `reminder_ledger/speakers__{window}__{speakerId}` is
  created in the same transaction as the `speaker_reminders` reservation, so a speaker gets at
  most one reminder per window, and a failed or uncertain send is not sent again. The run
  holds a 15-minute lease on `reminder_schedule_runs/speakers`, and stores its last run
  there. It does nothing while off or paused, on a historical demo, or after the last event
  day. Before each speaker it stops when quiet hours begin or the window closes, and each
  reservation transaction reads the schedule again (`reserve({ guard })`), so turning it off,
  pausing it or changing it stops the run before the next speaker. Speakers not tried get no
  ledger row. A fault part way keeps the sends already made in `lastRun` and the admin log. Wording that is not the approved version pauses the schedule, writes an `admin_logs`
  row and tells the operator. A run that emails anyone writes one `admin_logs` row.
- The attendee branch (`src/reminders/attendeeSchedule.cjs`) reads
  `reminder_schedules/attendees`: offsets (default 7 and 1 days), a send time, and a plain text
  draft whose only placeholder is `{{days_until}}`. The anchor is the start of the first event
  day. The server adds the facts: the start, the venue, and the ticket link (`/tickets/mine`
  when `EVENT_TICKETING_PROVIDER=stripe`, `/dashboard` otherwise). Approval binds a wording
  version (the draft, or `shipped:` and the shipped draft, with the announcement layout), a
  settings version, and a facts version. The audience is `resolveAudience({ audience:
  'registered' })`. It sends through `src/announcements/sendRunner.cjs`, the staff
  announcement path: the announcement stream checked before any record and before each chunk,
  both unsubscribe modes, the suppression check per chunk, and the send history. The send id is
  fixed per window (`reminder-attendees-{window}`), and `reminder_ledger/attendees__{window}`
  is created in the same transaction as `announcement_sends/{sendId}`, so the email core's
  claim `announcement:{sendId}:{address hash}` sends each address once per window. Before each
  chunk the run stops for quiet hours or a closed window, and the lease transaction reads the
  schedule again (`takeLease({ guard })`); a stop there marks the record `stopped`. A record
  left by quiet hours or the deadline is continued in the same window. A record whose window
  closed, that an earlier approval started (its wording, facts or settings version differs), or
  whose stream changed part way (`channel-changed`, which also tells the operator) is marked
  `stopped` and never continued; `sendAnnouncementEmail` refuses to continue a record with
  `reminder` set. Changed wording or facts pause the schedule and tell the operator; a channel
  that cannot send fails the run and tells the operator. The admin log row holds counts, never
  addresses.
- The two branches run side by side with one deadline (`RUN_BUDGET_MS`, 480 seconds inside the
  540-second timeout). Each stops before its next speaker or chunk at the deadline
  (`time-limit`), so a long speaker run cannot starve the attendee run, and the next hourly run
  sends the rest.

Saving or resetting the speaker reminder wording (`speakerReminders`) pauses a schedule that
is on when the new wording version differs from the approved one. Secrets: the mail
provider's, and the operator webhook's when `EVENT_OPERATOR_NOTIFIER=webhook`.
`reminderSchedules` also binds the mail provider's secrets: the attendee schedule reads the
Postmark announcement stream before a preview or an approval.

## Stripe commerce

`ticketingCatalog` is a public, redacted GET. `ticketingCheckout` accepts POST from
a verified purchaser and computes prices/capacity on the server.
`ticketingOrderStatus` accepts GET/POST for the owning verified purchaser only.
Each is a domain factory in `src/ticketing/stripeCheckout.cjs`, with deploy wiring
in `commerceHttp.cjs`. The SDK is pinned to Stripe 23.0.0; changing it requires
checking the Checkout request and response contract again.

Stripe uses the existing webhook and sync queue. Exact raw bytes, account/mode/event
scope, persistent request keys, authoritative payment snapshots, refund records,
and atomic inventory/ticket updates are required before admission. `eventbrite`,
`manual`, and `none` remain supported. Provider construction does not eagerly load
unrelated email secrets on purchaser reads; only send-capable handlers bind them.

The private stores and launch decisions are documented in
[ADR 0004](../docs/adr/0004-stripe-ticket-commerce.md). There is no catalog seed, new
queue, Connect routing, or automatic migration. A missing/unpublished catalog keeps
sales closed. Merchant setup, retention terms, a real Stripe test rehearsal, and
live cutover remain operator responsibilities.

### Organizer operations and confirmations

`ticketingCommerceAdmin` is a POST action API. Staff can list scoped orders/tickets,
read their audit trail, correct an attendee, cancel selected admission, reconcile an
order, and resend transactional confirmations. Operators alone can save the
revisioned catalog, pause/resume sales, issue a confirmed comp, and allocate a
succeeded partial refund. A claimed or checked-in ticket cannot change its email.
An operator must cancel an already used ticket. All admission changes retain the
historical paid amount and sold capacity. There is no API that sends a money refund.

`ticketingCheckIn` admits staff for atomic online check-in. Undo requires an operator,
confirmation, and reason. Invalid/refunded/cancelled tickets and explicit account
revocations fail closed; duplicate scans make only one audit entry.
`ticketingMyTickets` lists only the verified caller's claimed tickets, with a cursor,
for Stripe, Eventbrite, and manual deployments. It exposes no purchaser finances.

The `onTicketOrderConfirmation` order-written trigger rereads current settled order
and admission state, then uses the existing email adapter with per-recipient,
per-template send-once keys. It sends the purchaser's order receipt separately from
each attendee's claim invitation. These messages are Event Runner confirmations;
the merchant's Stripe payment receipt is separate. Neither rendered body is retained
in the email log. Duplicate triggers do not duplicate sends. Failed or uncertain
delivery creates a redacted attention audit; staff inspect the email log and choose
an explicit resend with a new request key. Resends include the actor in the audit.

Transactional mutations include `config/event` in their read set, so enabling
`historicalDemo` during a request prevents the commit. Managed email secrets are
bound only to the organizer endpoint that can resend and the confirmation trigger;
the native attendee read/checkout handlers do not need them.

## Invoices

`invoiceAdmin` (`src/admin/invoices.cjs`, issues #208 and #209) is a POST action API
in the shape of `ticketingCommerceAdmin`: `list`, `get`, `settings`, `saveDraft`,
`deleteDraft`, `saveSettings`, `issue`, `markPaid`, `void`, `reopen` and `duplicate`.
Staff run every action but `saveSettings`, `void` and `reopen`, which need an
operator: `invoice_settings/current` holds the issuer's tax ID and bank details, a
void is final, and a reopen undoes a recorded payment. Every answer that carries an
invoice also carries `canVoid` and `canReopen`, so the page offers those controls only
to an operator. Send (email) and the Stripe pay link come in later parts.

The three collections (`invoices`, `invoice_counters`, `invoice_settings`) deny every
client read and write. `saveDraft` takes the client-minted `invoiceId` and the
`expectedRevision` the form read; revision 0 creates the draft. The body is checked
by `shared/invoice` `validateInvoiceDraft`, which keeps only the fields a draft may
set and computes the totals again in minor units. A request's own totals, status or
number are dropped. A draft's currency is fixed when it is created: the ticket
catalog currency, then the settings currency, then USD. A draft has no number; the
number is assigned only at issue, so `deleteDraft` leaves no gap.

Every write refuses on a read-only demo, refuses a stale revision with 409, and
writes its `admin_logs` row (`invoices.*`) in the same transaction. The settings row
names the fields that changed and never their values. `list` reads newest first on
`listKey` and examines at most 250 records per page, like the ticketing lists. Text
is cleaned with `sanitizeInvoiceText` on write and again on read. Responses carry
`Cache-Control: private, no-store`.

**Issue and numbering.** `issue` takes `{ invoiceId, expectedRevision }`. In one
transaction it reads the draft, the settings, `invoice_counters/current` and
`config/event` (for the write policy and the time zone), checks the stored draft again
with `validateInvoiceDraft` and `issueProblems` (a line, a due date not before the
issue date, an issuer name), and writes the invoice and `lastNumber + 1` together. The
number is `formatInvoiceNumber(prefix, sequence)`, so `INV-0001`. Either all of it
commits or none of it does, so a refused or repeated issue uses no number, and two
issues at once serialize on the counter. A counter that is not a whole number is
refused, never guessed, and a `sequence` another invoice already holds is refused (a
query in the same transaction), so a counter set back by hand cannot reuse a number.
Issue freezes the recomputed totals, the issue date on the event clock, and a copy of
the issuer block; only a draft saves or deletes.

`markPaid` takes `{ invoiceId, expectedRevision, payment: { paidOn, method, note } }`
on an issued invoice; `validatePayment` refuses a date after today on the event clock.
`void` takes `{ invoiceId, expectedRevision, reason }` on an issued or paid invoice and
keeps the number and any payment. `reopen` takes `{ invoiceId, expectedRevision,
reason }` on a paid invoice (a void one is refused), sets it back to issued, and moves
the payment to `paymentHistory` with the reason, the time and the operator; nothing is
deleted. `duplicate` takes `{ invoiceId, newInvoiceId }`: the
client mints the new id once, and a retry with the same pair answers the same draft.
The copy has the source's bill-to, lines, adjustments, reference, notes and currency,
no number, no issuer and no due date, and `duplicatedFrom`.

**The PDF.** `invoicePdf` (`src/admin/invoicePdf.cjs`) is a staff POST that answers
`application/pdf` as an attachment named for the number. It refuses a draft with 409.
It is built on each request from `publicInvoice`, so stored text is cleaned again, and
each line goes through `sanitizeForFont` and `wrapText` from `src/pdf/kit.cjs`. pdf-lib
writes drawn text as hex strings, so a parenthesis or a PDF keyword in a name stays
text. Reading a PDF writes nothing, so a read-only demo serves it.

**Export.** `exportEventData` has an `invoices` dataset (staff), and the event data
package a `billing` part with `billing/invoices.json` and `billing/invoices.csv`
(`exportRecords.cjs` `invoiceRecord`: no account ids). `invoice_settings` and
`invoice_counters` are in the package's EXCLUDED list, and the repeat-event template
leaves all three collections behind.
