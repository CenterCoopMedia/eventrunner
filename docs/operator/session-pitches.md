# Operate session pitch intake

Session pitch intake is a private server workflow. A caller needs a verified Firebase sign-in. A ticket and attendee approval are not required.

The public `config/pitch_call` document contains only three fields:

- `enabled`: A Boolean.
- `closesAt`: An RFC3339 date and time.
- `externalFormUrl`: An https address of an external form, or `null`. Older documents without this field use this site's form.

The call is closed when the document is missing or malformed, when `enabled` is false, or when `closesAt` has passed. Operators set all three fields through `updatePitchCall`. Clients cannot write the document directly.

## Choose where people pitch

A call uses one intake at a time:

- **This site's pitch form** (`externalFormUrl: null`). Proposals go directly into the private queue.
- **An external form** (for example, Airtable). `/pitch` shows the call status, the deadline and one **Open the pitch form** link while the call is open. The site's own form and sign-in are hidden. `submitSessionPitch` refuses new pitches, so one call never has two queues. A retry of a pitch stored before the switch is still acknowledged; it creates nothing new. The external service stores the answers under its own terms. Bring them into the queue with the [reviewed CSV import](#reviewed-csv-import-and-private-export).

The deadline and the enabled state apply in both modes. While the call is open, the home page lead shows a **Pitch a session** action to `/pitch`. Share `/pitch`, not the external address, so closing the call also removes the link.

### Set up an Airtable form

1. In the Airtable base, make these fields: `email` (email), `title` (single line text), `description` (long text), `organization` (single line text), `format` (single line text or single select) and `consent` (checkbox). State the review and contact purpose in the checkbox's form label.
2. Add a formula field named `externalId` with the formula `RECORD_ID()`. Airtable fills it for each response.
3. Make a form view from these fields. Make `email`, `title`, `description` and `consent` required. Copy the form's public share link.
4. In **Session pitches**, expand **Manage the call for sessions**. Choose **An external form, such as Airtable**, paste the share link, set the deadline, select **Accept session pitches** and save.
5. To review responses here, download a CSV of a grid view (**Download CSV**). Other columns in the view are ignored. A ticked checkbox exports as `checked`, which the import reads as consent. Import 50 rows or fewer at a time, and keep the same source name for every import from this form.

No Airtable key or sync is used. Firestore stays the record for the review queue.

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

The server stores the closing time as a canonical UTC RFC3339 value. `externalFormUrl` must be empty, `null` or an https address of 2,048 characters or fewer. An empty string or `null` saves `null` and selects this site's form. A request without the field keeps the stored form, so a deadline-only update cannot reopen native intake. The response returns all three stored fields. It writes the configuration and its `admin_logs` row in one transaction. The public configuration does not store an operator uid or email.

### Submit a pitch

`submitSessionPitch` accepts any verified Firebase sign-in.

```json
{
  "title": "Building durable local reporting partnerships",
  "description": "A practical discussion of shared reporting and distribution workflows.",
  "organization": "Example newsroom",
  "format": "Panel",
  "submissionKey": "one-client-generated-key-per-form",
  "consent": true
}
```

`consent: true` records agreement to organizer storage, review, and contact. The stored consent includes its version and submission time. `title` and `description` are required, with limits of 160 and 5,000 characters. `organization` and `format` are optional, with limits of 200 and 120 characters. `submissionKey` must contain 8 to 128 letters, numbers, underscores, or hyphens. The submission payload limit is 40 KB, which covers all valid fields at their character limits, including Unicode and JSON escapes. The server stores the uid and normalized email from the verified token. It checks token revocation, so a disabled or deleted Firebase account cannot submit with an unexpired token. It ignores identity and review fields in the request body.

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
  "preview": true
}
```

`kind` is `receipt` or `decision`. A decision email needs the saved status `accepted` or `rejected`. `feedback` is an optional note to the submitter of 2,000 characters or fewer. A receipt takes no note. With `preview: true`, the server returns `{ preview: { to, templateId, subject, text } }` and writes nothing. Without it, the server sends the email and returns `{ state: "sent", templateId, attempt }`.

The server compares `expectedStatus` and `expectedRevision` with the stored pitch, so staff send the email for the decision they see. It refuses:

- A stale status or revision: `409 status-conflict`.
- An email that was already sent for this pitch and decision: `409 already-sent`.
- An email that another request is sending now: `409 in-progress`. A send that stops before it records a result can be retried after 10 minutes.
- A receipt for an imported pitch: `400`.
- Any send in a historical demo: `403 read-only-demo`.

A failed delivery returns `502 delivery-failed`. The decision stays saved, and the email can be retried.

### Change the pitch emails

`savePitchNoticeSettings` requires operator access.

```json
{
  "receiptMode": "automatic",
  "templates": {
    "pitch.receipt": { "subject": "We received your pitch", "wording": "Hello,\n\nWe received “{{pitch_title}}”." }
  }
}
```

`receiptMode` is `automatic` or `manual`. `templates` can hold `pitch.receipt`, `pitch.accepted` and `pitch.declined`. A missing or `null` email uses the shipped wording. A subject is one line of 200 characters or fewer. The wording is 5,000 characters or fewer. The server checks every `{{token}}` before it saves and refuses an unknown or malformed one. It writes the settings and an `admin_logs` row together and returns the effective settings.

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

### Send a decision email

1. Save an **Accepted** or **Declined** decision.
2. Under **Emails to the submitter**, expand **Prepare the acceptance email** or **Prepare the decline email**.
3. Optionally, write a **Note to the submitter**. Private review notes are never sent.
4. Choose **Preview the acceptance email** (or the decline email). Read the address, the subject and the text.
5. Select **I reviewed this email** and choose **Send the acceptance email** (or the decline email).

Each email is sent once for each pitch and decision. If staff decline a pitch, then accept it again, the acceptance email that was already sent does not go again. A changed note clears the preview, so you confirm the email that is sent.

### Delivery records

Each pitch shows the state of its emails: **Sending**, **Sent** or **Not sent**, with the time, who sent it and the attempt number. A record that is **Not sent** shows the reason. Choose **Retry the receipt** or prepare the decision email again to retry. Each attempt has its own send-once key (`pitch-notice:{id}:{receipt|accepted|rejected}:{attempt}`), so a repeated request cannot send one attempt twice. The records sit on the private pitch row in `notices`. The **Email log** keeps each sent message.

A decision is stored apart from its email. A failed email never changes the decision.

### Change the wording

Operators expand **Manage pitch emails**. Choose the receipt mode, then edit the subject and the wording of each email. The wording is plain text. A blank line starts a new paragraph. You can use `{{pitch_title}}`, `{{event_name}}`, `{{site_url}}`, `{{support_email}}` and the other global email tokens. The note to the submitter appears after the wording of a decision email. Choose **Use the shipped receipt wording** (or the acceptance or decline email wording) to restore the default text. The event branding and footer wrap every email.

In a historical demo, the site sends no pitch email and records none.

## Data boundaries

`session_pitches` is readable only by staff and operators. Direct client writes are denied. Submitters cannot read their own stored row.

`session_pitch_rate_limits` is server-only. No client tier can read or write it.

`session_pitch_settings/notices` holds the receipt mode and the edited email wording. Staff and operators can read it. Only `savePitchNoticeSettings` writes it.

Reviewing a pitch does not create or publish a schedule session. It does not change a user role and does not send mail. Decision emails are a separate staff action (see [Pitch emails](#pitch-emails)). Staff explicitly create private drafts from an accepted proposal, then review the session and speaker editors before publication.

Deleting an attendee account does not delete its submitted pitches. A pitch remains an organizer record with the uid and email captured at submission. Issue [#322](https://github.com/CenterCoopMedia/eventrunner/issues/322) owns this initial retention decision. Each deployment must document its retention period before it opens a pitch call. Track a change to this policy under the [first-customer readiness epic](https://github.com/CenterCoopMedia/eventrunner/issues/337).

## Visitor form and review queue

Before deploying this version, check existing CMS pages and page drafts at `/pitch` and below it. Content generation and the site artifact build block deployment if any such page exists, including a hidden page or an unpublished draft. Rename and publish those pages through the CMS first. This check does not move or delete content.

The public `/pitch` route uses the event branding and theme. Visitors can write before signing in. Google or an emailed code verifies their email without a ticket. The form retains entries and the retry key in browser tab storage through sign-in, reloads, and request failures. It clears the stored draft after a confirmed submission. Browser storage failure leaves entries available while the page stays open.

The form requires a title, description, and organizer-review consent. Organization and format are optional. It displays the deadline in the visitor's timezone. A missing, malformed, expired, or unreadable call keeps submission unavailable. Configure the deployment's consent and retention policy before opening intake; this acknowledgement does not grant permission to publish a proposal.

Open **Session pitches** at `/admin/pitches`. Staff can search by title, email, or organization, filter by decision, and open each proposal. Save notes and the chosen decision explicitly. A concurrent edit disables saving and keeps your unsaved notes visible. Copy your notes before choosing **Load current review**, then reconcile them with the current revision. Saving a decision sends no email. Send the acceptance or decline email from the pitch after you save the decision (see [Pitch emails](#pitch-emails)).

Operators can expand **Manage the call for sessions** and save an enabled state, an RFC3339 deadline and where people pitch. Staff cannot change these settings.

### Reviewed CSV import and private export

Expand **Import proposals from CSV**. Use a stable source name and these headers. Other columns are ignored. A header name must not repeat:

```csv
externalId,email,title,description,organization,format,consent
example-1,presenter@example.test,Reporting together,A practical workshop.,Example newsroom,Workshop,true
```

Each file contains 1–50 proposals and is smaller than 512 KB. Keep original external IDs. Each row needs consent evidenced in the original form; never infer it from a nonempty field. `consent` must be `true` or `checked` (Airtable's export of a ticked checkbox). Review every displayed row, check the consent acknowledgement, then choose **Import reviewed proposals**. The server validates every row before storing any. A repeated source and external ID with identical content is unchanged. Changed content under the same source ID blocks the complete batch; reconcile it before retrying. Imported records are private, have no Firebase identity, and begin with a new decision. Import does not send mail, and an imported pitch never gets a receipt.

**Export filtered queue** downloads only the current filtered proposals. It includes contact emails; keep the file private. It excludes private review notes, auth UIDs, and reviewer identities. Spreadsheet formulas are escaped. No CSV is stored on a public URL.

### Explicit draft conversion

Save an **Accepted** decision first. Expand **Create session and speaker drafts**. Confirm the proposed speaker's first and last names, configured event day, and start/end time. Verify consent and identity, then check the review acknowledgement and choose **Create reviewed drafts**. This is separate from acceptance. The server checks the accepted decision and review revision in a transaction.

`convertSessionPitch` accepts `{ id, expectedRevision, firstName, lastName, dayId, startTime, endTime }`. It atomically creates one hidden `cmsSchedule_drafts` row, one canonical `speakers` row with `status: draft`, the speaker slug reservation, and a conversion/audit record. The proposed format becomes the session draft’s `type`, which session cards and format filters use. The session editor keeps it on save. No invite, account role, live session, or public speaker projection is created. Retry returns the existing conversion and cannot overwrite or duplicate drafts.

Use **Review session draft** and **Review speaker draft** to complete the ordinary editors. Session visibility and speaker approval remain explicit actions in those editors. Private notes and reviewer identities never enter either draft.

The conversion response includes its committed review revision. A retry returns the same conversion revision even if a later reviewer changed the pitch; the queue still shows a conflict for that later change.

The review queue lists newest proposals first. Records without a creation time follow dated proposals. Equal creation times use the proposal ID as a stable tie-breaker; the CSV export keeps the displayed order.
