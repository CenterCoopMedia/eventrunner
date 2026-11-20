# Operate session pitch intake

Session pitch intake is a private server workflow. A caller needs a verified Firebase sign-in. A ticket and attendee approval are not required.

The public `config/pitch_call` document contains only four fields:

- `enabled`: A Boolean.
- `closesAt`: An RFC3339 date and time, or `null` for a call with no deadline.
- `externalFormUrl`: An https address of an external form, or `null`. Older documents without this field use this site's form.
- `formOptions`: The choices the pitch form offers (`formats`, `lengths` in minutes, `tracks`) and `maxCoPresenters`. A missing field means no lists and up to four co-presenters. Only `updatePitchFormOptions` writes it, and `updatePitchCall` keeps it.

The call is closed when the document is missing or malformed, when `enabled` is false, or when `closesAt` has passed. A call with `closesAt: null` has no deadline: it stays open until an operator saves `enabled: false`. A document with no `closesAt` field at all is malformed, so it reads as closed. Operators set all three fields through `updatePitchCall`. Clients cannot write the document directly.

## Choose where people pitch

A call uses one intake at a time:

- **This site's pitch form** (`externalFormUrl: null`). Proposals go directly into the private queue.
- **An external form** (for example, Airtable). `/pitch` shows the call status, the deadline and one **Open the pitch form** link while the call is open. The site's own form and sign-in are hidden. `submitSessionPitch` refuses new pitches, so one call never has two queues. A retry of a pitch stored before the switch is still acknowledged; it creates nothing new. The external service stores the answers under its own terms. Bring them into the queue with the [reviewed CSV import](#reviewed-csv-import-and-private-export).

The deadline (or no deadline) and the enabled state apply in both modes. While the call is open, the home page lead shows a **Pitch a session** action to `/pitch`. Share `/pitch`, not the external address, so closing the call also removes the link.

### Set up an Airtable form

1. In the Airtable base, make these fields: `email` (email), `title` (single line text), `description` (long text), `organization` (single line text), `format` (single line text or single select) and `consent` (checkbox). State the review and contact purpose in the checkbox's form label.
2. Add a formula field named `externalId` with the formula `RECORD_ID()`. Airtable fills it for each response. Include this field in the grid view you export.
3. Make a form view from these fields. Make `email`, `title`, `description` and `consent` required. Copy the form's public share link.
4. In **Session pitches**, select **Call settings**. Choose **An external form, such as Airtable**, paste the share link, set the deadline or choose **Open until I close it**, select **Accept session pitches** and save.
5. Choose **Download CSV** in the Airtable grid view, then upload it under [Import pitches](#reviewed-csv-import-and-private-export). Import up to 50 rows at a time. Reuse the source name and record IDs of the pitches already in the queue. **Download pitches** shows both values in the `source` and `externalId` columns.

Firestore stays the record for the review queue. Airtable stays the record for the form answers.

## API

All endpoints use `POST`, the configured Functions region, the normal CORS allowlist, and `Authorization: Bearer <Firebase ID token>`. Error responses use `{ "error": { "code", "message" } }`.

### Open or close the call

`updatePitchCall` requires operator access.

```json
{
  "enabled": true,
  "closesAt": "2026-11-30T23:59:59Z",
  "externalFormUrl": "https://airtable.com/appExample/shrExample"
}
```

The server stores the closing time as a canonical UTC RFC3339 value. `"closesAt": null` saves a call with no deadline. A missing, blank or malformed `closesAt` is refused with `400`; only an explicit `null` means no deadline. `externalFormUrl` must be empty, `null` or an https address of 2,048 characters or fewer. An empty string or `null` saves `null` and selects this site's form. A request without the field keeps the stored form, so a deadline-only update cannot reopen native intake. The response returns all three stored fields. It writes the configuration and its `admin_logs` row in one transaction. The public configuration does not store an operator uid or email.

### Set the pitch form options

`updatePitchFormOptions` requires operator access.

```json
{
  "formOptions": {
    "formats": ["Panel", "Workshop"],
    "lengths": [30, 60],
    "tracks": ["Revenue", "Audience"],
    "maxCoPresenters": 3
  }
}
```

Each list holds at most 20 choices. A format or track has a name of 1 to 80 characters, and no name is listed twice (case does not matter). A length is a whole number of minutes from 5 to 480. `maxCoPresenters` is 0 to 4. A wrong value is refused by name with `400`; nothing is cut or dropped. The server merges `formOptions` into `config/pitch_call` and writes an `admin_logs` row in the same transaction. An empty list hides its question on the public form.

### Submit a pitch

`submitSessionPitch` accepts any verified Firebase sign-in.

```json
{
  "title": "Building durable local reporting partnerships",
  "summary": "Shared reporting that outlasts one news cycle.",
  "description": "A practical discussion of shared reporting and distribution workflows.",
  "organization": "Example newsroom",
  "format": "Panel",
  "lengthMinutes": 60,
  "track": "Audience",
  "audienceLevel": "beginner",
  "leadName": "Pat Example",
  "leadRole": "Editor",
  "presenters": [{ "name": "Sam Example", "email": "sam@example.org", "organization": null, "role": "Reporter" }],
  "accessNeeds": null,
  "notes": null,
  "submissionKey": "one-client-generated-key-per-form",
  "consent": true
}
```

The check is `shared/pitchForm` `checkPitch`, the same rule each step of the public form runs. `consent: true` records agreement to organizer storage, review, and contact. The stored consent includes its version and submission time. `title`, `description` and `leadName` (the person who pitches) are required, with limits of 160, 5,000 and 120 characters. Everything else is optional: `summary` (300), `organization` (200), `leadRole` (120), `accessNeeds` and `notes` (2,000 each). `format`, `lengthMinutes` and `track` must name one of the call's choices when the call lists them; with no format list, `format` is free text of up to 120 characters. `audienceLevel` is `everyone`, `beginner`, `intermediate` or `advanced`. `presenters` lists up to `maxCoPresenters` co-presenters, each with a name and a valid email that is not the submitter's or another co-presenter's. The server stores `presenters` with the lead first (`lead: true`, the verified email). Co-presenters get no email. `submissionKey` must contain 8 to 128 letters, numbers, underscores, or hyphens. The submission payload limit is 96 KB, which covers all valid fields at their character limits, including Unicode and JSON escapes.

If an operator removes a choice while a pitch is on its way, the server reads the new list in the same transaction and refuses the pitch with `409 form-changed`. The page asks the visitor to reload and check the choice. A pitch stored before these fields existed has no `presenters`; readers treat its submitter as the one lead presenter, and a retry of it replays on its original four fields. The server stores the uid and normalized email from the verified token. It checks token revocation, so a disabled or deleted Firebase account cannot submit with an unexpired token. It ignores identity and review fields in the request body.

Keep the same `submissionKey` while retrying one unchanged form. The server derives the stored record id from the verified uid and the key. An unchanged retry returns the original id and does not spend another rate-limit slot. A retry of a legacy proposal without consent stores the newly supplied consent and its time before returning success; it keeps the original proposal time and review revision. Changed content with the same account and key returns `409 conflict`. A different account has its own key namespace.

The limit is five new pitches per account in 15 minutes. The pitch and its rate-limit slot commit in one transaction. A completed retry is still acknowledged after the call closes. A new pitch is refused.

### Send a pitch email

`sendSessionPitchNotice` requires staff or operator access. It sends one receipt or one decision email for a saved pitch.

```json
{
  "id": "derived-pitch-record-id",
  "kind": "decision",
  "expectedStatus": "accepted",
  "expectedRevision": 2,
  "feedback": "Plan for a 45-minute session.",
  "expectedSettingsRevision": 3
}
```

`kind` is `receipt` or `decision`. A decision email needs the saved status `accepted` or `rejected`. `feedback` is an optional note to the submitter of 2,000 characters or fewer. A receipt takes no note.

With `preview: true`, the server writes nothing. It returns `{ preview: { to, addressVerified, templateId, subject, text, settingsRevision, mayHaveBeenSent, otherDecisionSent } }`:

- `addressVerified` is false for an imported pitch. Its address came from the CSV, and nobody verified it.
- `settingsRevision` is the revision of the email settings that the preview used.
- `mayHaveBeenSent` is true when an earlier attempt may have reached the provider.
- `otherDecisionSent` is `accepted` or `rejected` when the other decision email was already sent to this person, or `null`.

Without `preview`, the request must carry `expectedSettingsRevision` from the preview. The server sends the email and returns `{ state: "sent", templateId, attempt }`. A retry of an email that may have been sent must also carry `confirmUnknown: true`.

The server compares `expectedStatus` and `expectedRevision` with the stored pitch, so staff send the email for the decision they see. It refuses:

- A stale status or revision: `409 status-conflict`.
- An email that was already sent for this pitch and decision: `409 already-sent`.
- An email that another request is sending now: `409 in-progress`.
- An email that may have been sent, without `confirmUnknown: true`: `409 delivery-unknown`. This covers an attempt where the email service did not answer, and a send that stopped more than 10 minutes ago before it recorded a result.
- A send whose `expectedSettingsRevision` is not the current one, because an operator changed the wording after the preview: `409 settings-changed`. Preview the email again.
- A receipt for an imported pitch: `400`.
- Any send in a historical demo: `403 read-only-demo`.

The decision stays saved whatever happens to the email. When the provider refuses the email, the server returns `502 delivery-failed`, and the email can be retried. When the email service does not answer, the server returns `502 delivery-unknown`: the provider may have accepted the email. A retry uses a new send-once key and can deliver a second copy. Check the **Email log** before you retry.

### Change the pitch emails

`savePitchNoticeSettings` requires operator access.

```json
{
  "expectedRevision": 3,
  "receiptMode": "automatic",
  "templates": {
    "pitch.receipt": { "subject": "We received your pitch", "wording": "Hello,\n\nWe received “{{pitch_title}}”." }
  }
}
```

`receiptMode` is `automatic` or `manual`. `templates` can hold `pitch.receipt`, `pitch.accepted` and `pitch.declined`. A missing or `null` email uses the shipped wording. A subject is one line of 200 characters or fewer. The wording is 5,000 characters or fewer. The server checks every `{{token}}` before it saves and refuses an unknown or malformed one. `expectedRevision` is the `revision` of the settings that the operator edited (0 before the first save). When another operator saved first, the server refuses with `409 settings-conflict` and saves nothing. It writes the settings, the next revision and an `admin_logs` row together, and returns the effective settings with the new `revision`.

### Review a pitch

`reviewSessionPitch` requires staff or operator access.

```json
{
  "id": "derived-pitch-record-id",
  "status": "in_review",
  "expectedStatus": "new",
  "expectedRevision": 0,
  "privateNotes": "Confirm the final presenter list."
}
```

Statuses are `new`, `in_review`, `accepted`, and `rejected`. `privateNotes` is optional and holds at most 5,000 characters. Omit it to keep the stored notes. Send `null` or blank text to clear them.

The server compares both expected values inside the write transaction. A stale status or revision returns `409 status-conflict`, so two reviewers cannot silently replace each other's status or notes. Each accepted review increments `reviewRevision` and commits the pitch change with its `admin_logs` row.

## Pitch emails

The site sends three pitch emails through the central email sender:

- **Receipt** (`pitch.receipt`). It goes to a person who pitches through this site's form. An imported pitch and a pitch sent to an external form never get one.
- **Acceptance email** (`pitch.accepted`) and **decline email** (`pitch.declined`). Staff send them from the pitch after they save the decision.

### Receipts

With **Send automatically** (the default), the server queues the receipt in the transaction that stores the pitch. It sends the receipt after the pitch is stored. A retried submission does not send a second receipt. A failed receipt does not fail the submission. With **Staff send each receipt**, no receipt goes until staff send it from the pitch.

**Upgrade note.** Automatic receipts are on by default. A deployment that upgrades to this version sends a receipt for each new pitch from this site's form, with no further step. If you do not want automatic receipts, choose **Staff send each receipt** under **Pitch emails** and save before you deploy this version, or before you open the call.

### Send a decision email

1. Save an **Accepted** or **Declined** decision.
2. Under **Emails to the submitter**, expand **Prepare the acceptance email** or **Prepare the decline email**.
3. Optionally, write a **Note to the submitter**. Private review notes are never sent.
4. Choose **Preview the acceptance email** (or the decline email). Read the address, the subject and the text.
5. Select **I reviewed this email** and choose **Send the acceptance email** (or the decline email).

The preview warns you in two cases:

- **This address came from an imported CSV. Nobody verified it.** An imported pitch's decision email goes to the address in the CSV. Nobody signed in with it. Check it against the source form before you send.
- **An acceptance (or a decline) was already sent to this person.** Staff changed the decision after one decision email went. Send the second email only if you mean to correct the first.

If an operator changes the wording after your preview, the send is refused. Preview the email again.

Each email is sent once for each pitch and decision. If staff decline a pitch, then accept it again, the acceptance email that was already sent does not go again. A changed note clears the preview, so you confirm the email that is sent.

### Delivery records

Each pitch shows the state of its emails, with the time, who sent it and the attempt number:

- **Sending**: a send is in progress. No retry is offered.
- **Sent**: the provider accepted the email. It is never sent again.
- **Not sent**: the provider refused the email. The reason shows. Choose **Retry the receipt** or prepare the decision email again to retry.
- **May have been sent**: the email service did not answer, or a send stopped before it recorded a result. The provider may have delivered the email. Check the **Email log** before you retry. The retry asks you to confirm **I checked the Email log. The earlier email was not delivered.**

Each attempt has its own send-once key (`pitch-notice:{id}:{receipt|accepted|declined}:{attempt}`; records from before November 2026 used `rejected`), so a repeated request cannot send one attempt twice. A retry is a new attempt. After a refusal it is safe. After an uncertain result it can deliver a second copy. The records sit on the private pitch row in `notices`, with the state `queued`, `sent`, `failed` or `uncertain`. Older records say `unknown` for `uncertain`, and the page reads both. The **Email log** keeps each sent message.

A decision is stored apart from its email. A failed email never changes the decision.

### Change the wording

Operators open **Pitch emails** in **Call settings**. Choose the receipt mode, then edit the subject and the wording of each email. The wording is plain text. A blank line starts a new paragraph. You can use `{{pitch_title}}`, `{{event_name}}`, `{{site_url}}`, `{{support_email}}` and the other global email tokens. The note to the submitter appears after the wording of a decision email. A line break in a pitch title becomes a space in the subject. Choose **Use the shipped receipt wording** (or the acceptance or decline email wording) to restore the default text. The event branding and footer wrap every email. If another operator saves first, your edits stay on the page and a notice offers **Load current settings**. Copy your edits before you load them.

In a historical demo, the site sends no pitch email and records none.

## Data boundaries

`session_pitches` is readable only by staff and operators. Direct client writes are denied. Submitters cannot read their own stored row.

`session_pitch_rate_limits` is server-only. No client tier can read or write it.

`session_pitch_settings/notices` holds the receipt mode and the edited email wording. Staff and operators can read it. Only `savePitchNoticeSettings` writes it.

Reviewing a pitch does not create or publish a schedule session. It does not change a user role and does not send mail. Decision emails are a separate staff action (see [Pitch emails](#pitch-emails)). Staff explicitly create private drafts from an accepted proposal, then review the session and speaker editors before publication.

Deleting an attendee account does not delete its submitted pitches. A pitch remains an organizer record with the uid and email captured at submission. Issue [#322](https://github.com/CenterCoopMedia/eventrunner/issues/322) owns this initial retention decision. Each deployment must document its retention period before it opens a pitch call. Track a change to this policy under the [first-customer readiness epic](https://github.com/CenterCoopMedia/eventrunner/issues/337).

## Visitor form and review queue

Before deploying this version, check existing CMS pages and page drafts at `/pitch` and below it. Content generation and the site artifact build block deployment if any such page exists, including a hidden page or an unpublished draft. Rename and publish those pages through the CMS first. This check does not move or delete content.

The public `/pitch` route uses the event branding and theme. It is a stepper (ADR 0008): **Your session**, **Format**, **Presenters**, **Access and notes**, then **Review and submit**, each at its own address (`/pitch/session` … `/pitch/review`). **Next** checks only the open step and keeps the visitor on it until it passes. A later step does not open before the steps above it pass; an address that names one opens the first step that needs work. The Review step lists every answer with an **Edit** link to its step, the consent box, and sign-in. Visitors write before signing in. Google or an emailed code verifies their email without a ticket. The form keeps entries, the current step and the retry key in browser tab storage through sign-in, reloads, and request failures. It clears the stored draft after a confirmed submission. A draft from the one-page form is carried into the stepper once. Browser storage failure leaves entries available while the page stays open.

The form requires a title, description, the lead presenter's name, and organizer-review consent. The other fields are optional. The Format step shows a choice list for each list the call sets, and a free-text format when it sets none. It displays the deadline in the visitor's timezone. A call with no deadline shows no date and no countdown. It says there is no set deadline. A missing, malformed, expired, or unreadable call keeps submission unavailable. Configure the deployment's consent and retention policy before opening intake; this acknowledgement does not grant permission to publish a proposal.

Open **Session pitches** at `/admin/pitches`. The queue lists every pitch, newest first, with its decision and a line of detail. Filter by decision, search by title, email, organization or presenter, and select **Review** to open a pitch at `/admin/pitches/<id>`. **Call settings** opens `/admin/pitches/settings` for operators. **Import pitches** opens `/admin/pitches/import` for CSV uploads. **Download pitches** saves the filtered rows.

On a pitch, **Accept**, **Decline** and **Mark in review** each save the decision at once. Choose another to change it. Under **Private notes**, **Add note** saves a note with your email and the time. Anyone on staff can add notes; only the person who wrote a note can edit it (`saveSessionPitchNote`, staff). A note does not change the pitch's revision, so it never blocks a decision. A note saved by the older single notes box shows as **Earlier note**. **Edit pitch** corrects the proposal (`editSessionPitch`, staff): the edit is checked like a new pitch, the first edit keeps the submitted copy on the pitch (`submitted`), each edit writes an `admin_logs` row with the changed fields, and the lead presenter's email cannot change. A choice the pitch already holds stays allowed after staff take it off the call's list. When someone else changes the pitch while it is open, every control stops and **Load the current version** appears; unsaved notes stay on the page. Deciding or editing sends no email. Send the acceptance or decline email from the pitch after you save the decision (see [Pitch emails](#pitch-emails)).

The review panel shows every answer: the summary, format, length, track, audience, the presenters with the lead first, access needs and notes. A field the visitor left empty reads **Not given**.

On **Call settings**, operators use **Pitch form options** to set the choices the form offers: formats, lengths in minutes and tracks, one per line, and how many co-presenters one pitch may name. An empty list hides its question. The page checks the lists with the server's rule before it saves.

On **Call settings**, operators save an enabled state, a deadline and where people pitch.

Under **When intake closes**, choose **At a set date and time** or **Open until I close it**. With **Open until I close it**, the call has no deadline. To close it, clear **Accept session pitches** and save. The public page shows no deadline. If you go back to **At a set date and time** before you save, the earlier date and time come back. Staff cannot change these settings.

Enter the **Deadline** as a **Date** and a **Time** on the event's clock. The time zone comes from **Event settings** and shows under the fields. The line under it states the deadline in words, with the zone and the UTC offset for the chosen date. For example, 11:59 PM on January 31 reads "Intake closes Sunday, January 31, 2027 at 11:59 PM Eastern Standard Time (UTC−05:00)." The page stores the same RFC3339 instant as before.

With **At a set date and time**, a deadline is required. A cleared deadline does not save. A time that the clocks skip when daylight saving time starts does not exist, so the page refuses it and asks for another time. A time that happens twice when daylight saving time ends shows two choices, one before and one after the clocks go back. Choose one before you save. A failed save keeps your entries. If another operator saves the call while you edit it, your entries stay and a notice offers **Load saved settings**.

### Reviewed CSV import and private export

Open **Import pitches**. Using Airtable? Download your grid view as CSV and upload it here. Enter a stable **Source name**, then choose the CSV. Reuse that name for updates from the same form. A different name creates a separate source. The file summary shows its name and proposal count.

Under **Match columns**, choose the source column for **Source ID**, **Email**, **Proposal title**, **Description** and **Consent**. Those five matches are required. Organization and format are optional. Open **Other proposal answers** to match the other fields below. Known headers are selected for you; check every match. A file column can be used once. Unmatched columns are ignored. Every header must have a unique, nonempty name. This example is selected automatically:

```csv
externalId,email,title,description,organization,format,consent
example-1,presenter@example.test,Reporting together,A practical workshop.,Example newsroom,Workshop,true
```

A file may also contain the pitch form's other answers: `summary`, `lengthMinutes`, `track`, `audienceLevel`, `leadName`, `leadRole`, `accessNeeds`, `notes`, and up to four co-presenters as `presenter_1_name`, `presenter_1_email`, `presenter_1_organization`, `presenter_1_role` through `presenter_4_role`. Match them under **Other proposal answers**. An outside form's lengths and tracks need not match the call's lists. A co-presenter needs a name and a valid email. When you update co-presenters, match the columns for the full list. Clear all matched co-presenter cells for a pitch to remove its co-presenters. You can match Airtable selections, attachment names with URLs, and dates to text fields. Airtable's export links expire after a few hours. [Airtable grid CSV exports](https://support.airtable.com/articles/5189551686-getting-started-with-airtable-views)

Each file contains 1–50 proposals and is smaller than 512 KB. Keep original external IDs. Each row needs consent evidenced in the original form. `consent` must be `true` or `checked` (Airtable's export of a ticked checkbox). Choose **Review proposals** to see matched answers and any rows that need correction. Fix invalid rows in the file or adjust the column matches, then review again. Malformed CSV quotes prevent the file from opening. Check the consent acknowledgement and choose **Import reviewed proposals**. Changing the file, source name or a column match clears that review and acknowledgement. The server validates the complete batch before committing it.

The summary counts pitches added, updated and unchanged. An update matches the same source name and ID. It applies fields changed in the latest export and keeps staff corrections to fields the source did not change. Decisions, review notes and existing drafts stay with the pitch. The queue shows **Updated from source** until the next saved review, and the pitch names the changed fields. Use the newest export when you upload an update.

A pitch previously pulled from Airtable can still show **Removed from Airtable** or **Consent unchecked in Airtable**. Once the record is back in the grid and the checkbox is ticked, upload a fresh export with its original source name and record ID. The import clears those warnings and counts the pitch as updated, even if its answers are the same.

Imported records are private, have no Firebase identity, and begin with a new decision. Import does not send mail, and an imported pitch never gets a receipt. Staff can send an imported pitch's decision email. It goes to the address in the CSV, which nobody verified, so the preview says so (see [Pitch emails](#pitch-emails)).

**Download pitches** saves only the current filtered proposals, with the same optional columns as the import (the lead presenter as `leadName` and `leadRole`), so an export can be imported again. It includes contact emails; keep the file private. It excludes private review notes, auth UIDs, and reviewer identities. Spreadsheet formulas are escaped. No CSV is stored on a public URL.

### Explicit draft conversion

Save an **Accepted** decision first. Expand **Create session and speaker drafts**. The dialog lists each presenter, lead first. For a new presenter, check the first and last name; the dialog fills them in from the pitch. A presenter whose email is already on a speaker shows **Already a speaker** and needs no name: the session links to that speaker, and that record is not changed. Choose the event day and the start and end time. **Invite the presenters now** is on by default. It sends the ordinary speaker invite to each new speaker in the same action. Clear it to invite them later from the Speakers page. Verify consent and identity, then check the review acknowledgement and choose **Create reviewed drafts**. The page then says who was invited. An invite that could not be emailed is still recorded; resend it from the speaker's page. This is separate from acceptance. The server checks the accepted decision and review revision in a transaction.

`convertSessionPitch` accepts `{ id, expectedRevision, speakers, dayId, startTime, endTime, invite }`. `speakers` has one entry per presenter in the stored order (`speakerCandidates` in `shared/pitchForm`: lead first, a repeated email kept once): `{ email, firstName, lastName }` for a new speaker, or `{ email }` for a presenter who is already a speaker. The email must match the presenter in that position, so a name confirmed for one person is never given to another after a staff edit. A body with `firstName` and `lastName` alone names the lead of a one-presenter pitch, as before. A count or an email that does not match the presenters is refused with `409 presenters-changed`. In one transaction it creates one hidden `cmsSchedule_drafts` row that lists every presenter's speaker, one `speakers` row with `status: draft` per new presenter (the lead is `pitch-{id}`, co-presenters `pitch-{id}-{position}`), their slug reservations, and a conversion and audit record: `{ sessionId, speakerId, speakerIds, createdSpeakerIds, revision }`, where `speakerId` is the first speaker. A presenter's role becomes the speaker's job title. The proposed format becomes the session draft's `type`, which session cards and format filters use. With `invite: true`, each new speaker then gets `speaker.invite` through the same code as **Send invite** on the Speakers page, and the response's `invites` lists `{ speakerId, email, sent: true }` or `{ speakerId, sent: false, message }`. No account role, live session or public speaker projection is created. Retry returns the existing conversion with `replayed: true`, sends no invite, and cannot overwrite or duplicate drafts.

Use **Review session draft** and **Review speaker draft** to complete the ordinary editors. Session visibility and speaker approval remain explicit actions in those editors. Private notes and reviewer identities never enter either draft.

The conversion response includes its committed review revision. A retry returns the same conversion revision even if a later reviewer changed the pitch; the queue still shows a conflict for that later change.

The review queue lists newest proposals first. Records without a creation time follow dated proposals. Equal creation times use the proposal ID as a stable tie-breaker; the CSV export keeps the displayed order.
