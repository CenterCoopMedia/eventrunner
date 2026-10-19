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
- **An external form** (for example, Airtable). `/pitch` shows the call status, the deadline and one **Open the pitch form** link while the call is open. The site's own form and sign-in are hidden. `submitSessionPitch` refuses new pitches, so one call never has two queues. A retry of a pitch stored before the switch is still acknowledged; it creates nothing new. The external service stores the answers under its own terms. Bring them into the queue with an [Airtable refresh](#refresh-pitches-from-airtable) or the [reviewed CSV import](#reviewed-csv-import-and-private-export).

The deadline and the enabled state apply in both modes. While the call is open, the home page lead shows a **Pitch a session** action to `/pitch`. Share `/pitch`, not the external address, so closing the call also removes the link.

### Set up an Airtable form

1. In the Airtable base, make these fields: `email` (email), `title` (single line text), `description` (long text), `organization` (single line text), `format` (single line text or single select) and `consent` (checkbox). State the review and contact purpose in the checkbox's form label.
2. For the CSV import only, add a formula field named `externalId` with the formula `RECORD_ID()`. Airtable fills it for each response. The Airtable refresh uses the record ID directly and does not need this field.
3. Make a form view from these fields. Make `email`, `title`, `description` and `consent` required. Copy the form's public share link.
4. In **Session pitches**, expand **Manage the call for sessions**. Choose **An external form, such as Airtable**, paste the share link, set the deadline, select **Accept session pitches** and save.
5. Bring the responses into the review queue. Use the [Airtable refresh](#refresh-pitches-from-airtable) when the deployment has an Airtable token. Otherwise download a CSV of a grid view (**Download CSV**) and use the [reviewed CSV import](#reviewed-csv-import-and-private-export). In a CSV, a ticked checkbox exports as `checked`, which the import reads as consent. Import 50 rows or fewer at a time, and keep the same source name for every import from this form.

Firestore stays the record for the review queue. Airtable stays the record for the form answers.

## Refresh pitches from Airtable

The refresh reads one approved Airtable table and brings its records into the private review queue. It only reads. It never writes to Airtable, never deletes a pitch, never publishes and never sends email. Confirm the field names, the refresh timing and the editing rule below with the client before the call opens.

### Set up the connection

1. **Create a token.** In Airtable, open the builder hub and create a personal access token. Give it one scope, `data.records:read`, and add only the base that holds the pitch table. Use an Airtable account that the client controls, so the token stays valid after a staff change.
2. **Store the token as a secret.** Save it in the client's Secret Manager as `AIRTABLE_API_TOKEN`. Grant the functions runtime service account `secretAccessor` on it ([DEPLOY_RUNBOOK.md](../DEPLOY_RUNBOOK.md)). Do not paste the token into the admin panel, a GitHub variable, a document or a chat.
3. **Turn the feature on for the deployment.** Set the GitHub Environment variable `EVENT_AIRTABLE_ENABLED` to `true` and deploy. Without the flag, every refresh fails with "Airtable is not turned on for this deployment". With the flag and without the secret, the deploy fails.
4. **Find the IDs.** Open the table in Airtable. The address has the form `airtable.com/<base ID>/<table ID>/<view ID>`. The base ID starts with `app`, the table ID with `tbl` and the view ID with `viw`. Each ID has 17 characters.
5. **Save the settings.** In **Session pitches**, expand **Refresh pitches from Airtable**, then **Connection settings** (operators only). Enter the base ID and the table ID. A table name also works, but a renamed table then stops the refresh. Enter a view ID or name to bring in only the records that view shows, for example a view that hides test rows. Type the name of each Airtable field. Choose the automatic refresh timing. Select **Use this Airtable connection** and save.
6. **Test it.** Choose **Refresh from Airtable**. Check the counts. Open one new pitch and compare it with its Airtable record.

The settings are stored in `session_pitch_sources/airtable`. Only operators can read them. `updateAirtablePitchSource` writes them and an `admin_logs` row.

### Field names

| Pitch field | Airtable field type | Rule |
| --- | --- | --- |
| Email (required) | Email or single line text | One valid address. Stored lowercase. |
| Title (required) | Single line text | 1–160 characters. |
| Description (required) | Long text | 1–5,000 characters. |
| Consent checkbox (required) | Checkbox | Only a ticked box is consent. A row without a ticked box is skipped. |
| Organization (optional) | Single line text | Up to 200 characters. |
| Format (optional) | Single line text, single select or multiple select | Up to 120 characters. A multiple select is joined with commas. |
| External ID (optional) | Any text field | Leave it empty to use the Airtable record ID. Do not change it after the first refresh: a new ID makes a new pitch. |

The names must match the Airtable field names exactly, including capitals and spaces. Each pitch field takes a different Airtable field. The refresh asks Airtable for the mapped fields only, so other columns stay in Airtable. A number becomes text. An attachment, a linked record or another object is refused with the reason "Required text missing or too long".

### Refresh timing

- **By hand.** Staff or an operator choose **Refresh from Airtable**. A refresh can start once a minute. A second refresh while one runs is refused.
- **Automatic.** An operator picks **Every 15 minutes** or **Every hour** in the settings. The default is off. `scheduledAirtablePitchRefresh` runs every 15 minutes. It returns at once unless a timing is set and that much time has passed since the last run. It does the same work as the button. It is not a queue: nothing waits in Firestore for a later run.

Each refresh reads up to 1,000 records (10 pages of 100). It sends at most four requests a second, below Airtable's limit of five per base. After a rate-limit answer (429) it waits 30 seconds and tries again, two times at most. A view with more than 1,000 records ends as **Completed in part**. Use a smaller view, for example one that hides declined records.

### What a refresh changes

Each record has the identity `airtable` plus its external ID. The CSV import uses the same identity for the source name `airtable`. A refresh therefore adopts rows from an earlier CSV import with that source name and does not duplicate them.

- **New record with consent:** a new pitch with the decision **New**, no notes and no Firebase identity. Its consent record says `airtable-source`.
- **Unchanged record:** nothing is written.
- **Changed record:** the email, title, description, organization and format are updated. The decision, private notes, reviewer, conversion and notices stay. The review revision goes up by one, so a review form opened on the old text reports a conflict and does not save over it. The queue shows **Updated in Airtable** until the next saved review, and the pitch names the changed fields. Session and speaker drafts made before the change do not change. Edit them in their own editors.
- **Record removed from the view or deleted in Airtable:** the pitch stays. A complete refresh marks it **Removed from Airtable**. A record that comes back loses the mark. A refresh that ends as **Completed in part** marks nothing.
- **Consent box cleared on an existing record:** the pitch stays and shows **Consent unchecked in Airtable**. Do not use it until the submitter confirms consent.
- **Rows that cannot be used:** skipped and counted, with the reason: consent box not ticked, email missing or not valid, required text missing or too long, external ID missing, or external ID used twice. The status lists the first 25 Airtable record IDs. Find them with Airtable's record ID search, correct them in Airtable and refresh again.

Editing rule: the submitter's text belongs to Airtable. Edit a proposal in Airtable, not in Event Runner. Review decisions and notes belong to Event Runner. Airtable never changes them.

### Status and audit

The **Refresh pitches from Airtable** panel shows the last run: when it ran, who ran it (or "on the schedule"), the result (**Completed**, **Completed in part** or **Failed**) and the counts. The counts are created, updated, unchanged, back in Airtable, skipped and flagged as removed. A failed run shows its error. The status is in `session_pitch_sync/airtable`. Staff and operators can read it. Only the refresh writes it. Every run, by hand or scheduled, also writes one `admin_logs` row with the action `refreshAirtablePitches`, its counts and any error code.

### Troubleshooting

| Error | Cause and fix |
| --- | --- |
| Airtable is not turned on for this deployment | Set `EVENT_AIRTABLE_ENABLED=true` and deploy. |
| The AIRTABLE_API_TOKEN secret is not set | Create the secret, grant `secretAccessor` and deploy again. |
| Airtable refused the access token | The token expired, was revoked or was typed wrong. Make a new token and add a new secret version. |
| The access token cannot read this base | Add the base to the token's access list in Airtable. |
| Airtable cannot find this base, table or view | Compare the IDs in the settings with the Airtable address. |
| Airtable refused the request (`UNKNOWN_FIELD_NAME`) | A mapped field name does not match Airtable. Check capitals, spaces and renamed fields. |
| Airtable asked Event Runner to slow down | Another tool uses the same base. Wait one minute and refresh again. |
| A refresh is already running | Wait for it to finish. A run that stops without finishing releases its lock after 10 minutes. |

The token never appears in the status, the audit log, an error message or the function logs. To rotate it, add a new secret version and deploy the refresh functions again. To stop the connection, clear **Use this Airtable connection**. Pitches already in the queue stay.

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

**Upgrade note.** Automatic receipts are on by default. A deployment that upgrades to this version sends a receipt for each new pitch from this site's form, with no further step. If you do not want automatic receipts, choose **Staff send each receipt** under **Manage pitch emails** and save before you deploy this version, or before you open the call.

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

Each attempt has its own send-once key (`pitch-notice:{id}:{receipt|accepted|rejected}:{attempt}`), so a repeated request cannot send one attempt twice. A retry is a new attempt. After a refusal it is safe. After an unknown result it can deliver a second copy. The records sit on the private pitch row in `notices`. The **Email log** keeps each sent message.

A decision is stored apart from its email. A failed email never changes the decision.

### Change the wording

Operators expand **Manage pitch emails**. Choose the receipt mode, then edit the subject and the wording of each email. The wording is plain text. A blank line starts a new paragraph. You can use `{{pitch_title}}`, `{{event_name}}`, `{{site_url}}`, `{{support_email}}` and the other global email tokens. The note to the submitter appears after the wording of a decision email. A line break in a pitch title becomes a space in the subject. Choose **Use the shipped receipt wording** (or the acceptance or decline email wording) to restore the default text. The event branding and footer wrap every email. If another operator saves first, your edits stay on the page and a notice offers **Load current settings**. Copy your edits before you load them.

In a historical demo, the site sends no pitch email and records none.

## Data boundaries

`session_pitches` is readable only by staff and operators. Direct client writes are denied. Submitters cannot read their own stored row.

`session_pitch_rate_limits` is server-only. No client tier can read or write it.

`session_pitch_settings/notices` holds the receipt mode and the edited email wording. Staff and operators can read it. Only `savePitchNoticeSettings` writes it.

`session_pitch_sources` (the Airtable connection settings) is readable only by operators. `session_pitch_sync` (the Airtable refresh status) is readable by staff and operators. Clients cannot write either one.

Reviewing a pitch does not create or publish a schedule session. It does not change a user role and does not send mail. Decision emails are a separate staff action (see [Pitch emails](#pitch-emails)). Staff explicitly create private drafts from an accepted proposal, then review the session and speaker editors before publication.

Deleting an attendee account does not delete its submitted pitches. A pitch remains an organizer record with the uid and email captured at submission. Issue [#322](https://github.com/CenterCoopMedia/eventrunner/issues/322) owns this initial retention decision. Each deployment must document its retention period before it opens a pitch call. Track a change to this policy under the [first-customer readiness epic](https://github.com/CenterCoopMedia/eventrunner/issues/337).

## Visitor form and review queue

Before deploying this version, check existing CMS pages and page drafts at `/pitch` and below it. Content generation and the site artifact build block deployment if any such page exists, including a hidden page or an unpublished draft. Rename and publish those pages through the CMS first. This check does not move or delete content.

The public `/pitch` route uses the event branding and theme. Visitors can write before signing in. Google or an emailed code verifies their email without a ticket. The form retains entries and the retry key in browser tab storage through sign-in, reloads, and request failures. It clears the stored draft after a confirmed submission. Browser storage failure leaves entries available while the page stays open.

The form requires a title, description, and organizer-review consent. Organization and format are optional. It displays the deadline in the visitor's timezone. A missing, malformed, expired, or unreadable call keeps submission unavailable. Configure the deployment's consent and retention policy before opening intake; this acknowledgement does not grant permission to publish a proposal.

Open **Session pitches** at `/admin/pitches`. Staff can search by title, email, or organization, filter by decision, and open each proposal. Save notes and the chosen decision explicitly. A concurrent edit disables saving and keeps your unsaved notes visible. Copy your notes before choosing **Load current review**, then reconcile them with the current revision. Saving a decision sends no email. Send the acceptance or decline email from the pitch after you save the decision (see [Pitch emails](#pitch-emails)).

Operators can expand **Manage the call for sessions** and save an enabled state, a deadline and where people pitch. Staff cannot change these settings.

Enter the **Deadline** as a **Date** and a **Time** on the event's clock. The time zone comes from **Event settings** and shows under the fields. The line under it states the deadline in words, with the zone and the UTC offset for the chosen date. For example, 11:59 PM on January 31 reads "Intake closes Sunday, January 31, 2027 at 11:59 PM Eastern Standard Time (UTC−05:00)." The page stores the same RFC3339 instant as before.

A deadline is required. A cleared deadline does not save. A time that the clocks skip when daylight saving time starts does not exist, so the page refuses it and asks for another time. A time that happens twice when daylight saving time ends shows two choices, one before and one after the clocks go back. Choose one before you save. A failed save keeps your entries. If another operator saves the call while you edit it, your entries stay and a notice offers **Load saved settings**.

### Reviewed CSV import and private export

Expand **Import proposals from CSV**. Use a stable source name and these headers. Other columns are ignored. A header name must not repeat:

```csv
externalId,email,title,description,organization,format,consent
example-1,presenter@example.test,Reporting together,A practical workshop.,Example newsroom,Workshop,true
```

Each file contains 1–50 proposals and is smaller than 512 KB. Keep original external IDs. Each row needs consent evidenced in the original form; never infer it from a nonempty field. `consent` must be `true` or `checked` (Airtable's export of a ticked checkbox). Review every displayed row, check the consent acknowledgement, then choose **Import reviewed proposals**. The server validates every row before storing any. A repeated source and external ID with identical content is unchanged. Changed content under the same source ID blocks the complete batch; reconcile it before retrying. The CSV import keeps this rule because a file does not show which copy is current. Use the [Airtable refresh](#refresh-pitches-from-airtable) for records that change after the first import. Imported records are private, have no Firebase identity, and begin with a new decision. Import does not send mail, and an imported pitch never gets a receipt. Staff can send an imported pitch's decision email. It goes to the address in the CSV, which nobody verified, so the preview says so (see [Pitch emails](#pitch-emails)).

**Export filtered queue** downloads only the current filtered proposals. It includes contact emails; keep the file private. It excludes private review notes, auth UIDs, and reviewer identities. Spreadsheet formulas are escaped. No CSV is stored on a public URL.

### Explicit draft conversion

Save an **Accepted** decision first. Expand **Create session and speaker drafts**. Confirm the proposed speaker's first and last names, configured event day, and start/end time. Verify consent and identity, then check the review acknowledgement and choose **Create reviewed drafts**. This is separate from acceptance. The server checks the accepted decision and review revision in a transaction.

`convertSessionPitch` accepts `{ id, expectedRevision, firstName, lastName, dayId, startTime, endTime }`. It atomically creates one hidden `cmsSchedule_drafts` row, one canonical `speakers` row with `status: draft`, the speaker slug reservation, and a conversion/audit record. The proposed format becomes the session draft’s `type`, which session cards and format filters use. The session editor keeps it on save. No invite, account role, live session, or public speaker projection is created. Retry returns the existing conversion and cannot overwrite or duplicate drafts.

Use **Review session draft** and **Review speaker draft** to complete the ordinary editors. Session visibility and speaker approval remain explicit actions in those editors. Private notes and reviewer identities never enter either draft.

The conversion response includes its committed review revision. A retry returns the same conversion revision even if a later reviewer changed the pitch; the queue still shows a conflict for that later change.

The review queue lists newest proposals first. Records without a creation time follow dated proposals. Equal creation times use the proposal ID as a stable tie-breaker; the CSV export keeps the displayed order.
