# Operate session pitch intake

Session pitch intake is a private server workflow. A caller needs a verified Firebase sign-in. A ticket and attendee approval are not required.

The public `config/pitch_call` document contains only two fields:

- `enabled`: A Boolean.
- `closesAt`: An RFC3339 date and time.

The call is closed when the document is missing or malformed, when `enabled` is false, or when `closesAt` has passed. Operators set both fields through `updatePitchCall`. Clients cannot write the document directly.

## API

All endpoints use `POST`, the configured Functions region, the normal CORS allowlist, and `Authorization: Bearer <Firebase ID token>`. Error responses use `{ "error": { "code", "message" } }`.

### Open or close the call

`updatePitchCall` requires operator access.

```json
{
  "enabled": true,
  "closesAt": "2026-11-30T23:59:59Z"
}
```

The server stores the closing time as a canonical UTC RFC3339 value. It writes the configuration and its `admin_logs` row in one transaction. The public configuration does not store an operator uid or email.

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

`consent: true` records agreement to organizer storage, review, and contact. The stored consent includes its version and submission time. `title` and `description` are required, with limits of 160 and 5,000 characters. `organization` and `format` are optional, with limits of 200 and 120 characters. `submissionKey` must contain 8 to 128 letters, numbers, underscores, or hyphens. The server stores the uid and normalized email from the verified token. It checks token revocation, so a disabled or deleted Firebase account cannot submit with an unexpired token. It ignores identity and review fields in the request body.

Keep the same `submissionKey` while retrying one unchanged form. The server derives the stored record id from the verified uid and the key. An unchanged retry returns the original id and does not spend another rate-limit slot. Changed content with the same account and key returns `409 conflict`. A different account has its own key namespace.

The limit is five new pitches per account in 15 minutes. The pitch and its rate-limit slot commit in one transaction. A completed retry is still acknowledged after the call closes. A new pitch is refused.

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

## Data boundaries

`session_pitches` is readable only by staff and operators. Direct client writes are denied. Submitters cannot read their own stored row.

`session_pitch_rate_limits` is server-only. No client tier can read or write it.

Reviewing a pitch does not create or publish a schedule session. It does not change a user role and does not send mail. Staff explicitly create private drafts from an accepted proposal, then review the session and speaker editors before publication.

Deleting an attendee account does not delete its submitted pitches. A pitch remains an organizer record with the uid and email captured at submission. Issue [#322](https://github.com/CenterCoopMedia/eventrunner/issues/322) owns this initial retention decision. Each deployment must document its retention period before it opens a pitch call. Track a change to this policy under the [first-customer readiness epic](https://github.com/CenterCoopMedia/eventrunner/issues/337).

## Visitor form and review queue

The public `/pitch` route uses the event branding and theme. Visitors can write before signing in. Google or an emailed code verifies their email without a ticket. The form retains entries and the retry key in browser tab storage through sign-in, reloads, and request failures. It clears the stored draft after a confirmed submission. Browser storage failure leaves entries available while the page stays open.

The form requires a title, description, and organizer-review consent. Organization and format are optional. It displays the deadline in the visitor's timezone. A missing, malformed, expired, or unreadable call keeps submission unavailable. Configure the deployment's consent and retention policy before opening intake; this acknowledgement does not grant permission to publish a proposal.

Open **Session pitches** at `/admin/pitches`. Staff can search by title, email, or organization, filter by decision, and open each proposal. Save notes and the chosen decision explicitly. A concurrent edit disables saving and keeps your unsaved notes visible. Copy your notes before choosing **Load current review**, then reconcile them with the current revision. Decisions send no notifications. Notification delivery is a separate workflow.

Operators can expand **Manage the call for sessions** and save an enabled state and RFC3339 deadline. Staff cannot change these settings.

### Reviewed CSV import and private export

Expand **Import proposals from CSV**. Use a stable source name and these exact headers:

```csv
externalId,email,title,description,organization,format,consent
example-1,presenter@example.test,Reporting together,A practical workshop.,Example newsroom,Workshop,true
```

Each file contains 1–50 proposals and is smaller than 512 KB. Keep original external IDs. Each row needs consent evidenced in the original form; never infer it from a nonempty field. Review every displayed row, check the consent acknowledgement, then choose **Import reviewed proposals**. The server validates every row before storing any. A repeated source and external ID with identical content is unchanged. Changed content under the same source ID blocks the complete batch; reconcile it before retrying. Imported records are private, have no Firebase identity, and begin with a new decision. Import does not send mail.

**Export filtered queue** downloads only the current filtered proposals. It includes contact emails; keep the file private. It excludes private review notes, auth UIDs, and reviewer identities. Spreadsheet formulas are escaped. No CSV is stored on a public URL.

### Explicit draft conversion

Save an **Accepted** decision first. Expand **Create session and speaker drafts**. Confirm the proposed speaker's first and last names, configured event day, and start/end time. Verify consent and identity, then check the review acknowledgement and choose **Create reviewed drafts**. This is separate from acceptance. The server checks the accepted decision and review revision in a transaction.

`convertSessionPitch` accepts `{ id, expectedRevision, firstName, lastName, dayId, startTime, endTime }`. It atomically creates one hidden `cmsSchedule_drafts` row, one canonical `speakers` row with `status: draft`, the speaker slug reservation, and a conversion/audit record. No invite, account role, live session, or public speaker projection is created. Retry returns the existing conversion and cannot overwrite or duplicate drafts.

Use **Review session draft** and **Review speaker draft** to complete the ordinary editors. Session visibility and speaker approval remain explicit actions in those editors. Private notes and reviewer identities never enter either draft.

The conversion response includes its committed review revision. A retry returns the same conversion revision even if a later reviewer changed the pitch; the queue still shows a conflict for that later change.
