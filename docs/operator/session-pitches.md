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
  "submissionKey": "one-client-generated-key-per-form"
}
```

`title` and `description` are required, with limits of 160 and 5,000 characters. `organization` and `format` are optional, with limits of 200 and 120 characters. `submissionKey` must contain 8 to 128 letters, numbers, underscores, or hyphens. The server stores the uid and normalized email from the verified token. It checks token revocation, so a disabled or deleted Firebase account cannot submit with an unexpired token. It ignores identity and review fields in the request body.

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

Reviewing a pitch does not create or publish a schedule session. It does not change a user role and does not send mail. Staff must use the existing session editor for any later schedule work.

Deleting an attendee account does not delete its submitted pitches. A pitch remains an organizer record with the uid and email captured at submission. Issue [#322](https://github.com/CenterCoopMedia/eventrunner/issues/322) owns this initial retention decision. Each deployment must document its retention period before it opens a pitch call. Track a change to this policy under the [first-customer readiness epic](https://github.com/CenterCoopMedia/eventrunner/issues/337).
