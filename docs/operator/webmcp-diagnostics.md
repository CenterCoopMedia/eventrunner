# Use read-only browser diagnostics

Event Runner can register read-only diagnostic tools in a supported browser when the event’s experimental setting is on. The tools supplement the visible admin. They do not replace it.

## Access

Public tools contain public event information only. Admin diagnostics appear only after the normal admin access check succeeds. Each admin tool calls the existing authenticated server boundary with the current Firebase ID token. Signing out removes the admin tool set.

A tool registration does not grant access. The server still decides whether the caller can read the result.

## Admin diagnostics

The initial admin set can check event readiness, validate the current page draft, inspect bounded publish status, inspect redacted system errors, check media usage, and check ticketing integration health.

Results do not contain attendee records, ticket details, payments, invitations, email content, provider credentials, storage administration, secrets, tokens, or unrestricted internal logs. A bounded result states when more items exist.

## Limits

The tools cannot save, publish, deploy, delete, send email, export data, change provider setup, or run an arbitrary function. Use the visible admin controls for all changes.

Before the experimental setting is enabled outside the demo, invoke every tool in a real supported top-level browser and compare the result with the related admin screen. Record any mismatch as an issue.
