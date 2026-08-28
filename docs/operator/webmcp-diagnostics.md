# Use read-only browser diagnostics

Event Runner can register read-only diagnostic tools in a supported browser when the event’s experimental setting is on. The tools supplement the visible admin. They do not replace it.

## Access

Public tools contain public event information only. Admin diagnostics appear only after the normal admin access check succeeds. Each admin tool calls the existing authenticated server boundary with the current Firebase ID token. Signing out removes the admin tool set.

A tool registration does not grant access. The server still decides whether the caller can read the result. Turn on `webmcpPublic` for a client public site and `webmcpAdmin` for its admin diagnostics. Both validated feature flags default off. The static demo enables the public set without changing a client default.

## Admin diagnostics

The admin set contains these tools:

- `check_event_readiness`
- `validate_current_page_draft`
- `inspect_publish_queue`
- `inspect_system_errors`
- `check_media_usage`
- `check_ticketing_health`

Each tool calls one fixed server endpoint. The current-page validator uses only the page id from the open admin editor route. It is unavailable on other admin routes.

Results do not contain attendee records, ticket details, payments, invitations, email content, provider credentials, storage administration, secrets, tokens, or unrestricted internal logs. Publish and system-error lists report their total and truncated count. Media checks report the total, checked, and truncated asset counts without object paths.

## Limits

The tools cannot save, publish, deploy, delete, send email, export data, change provider setup, or run an arbitrary function. Use the visible admin controls for all changes.

Before either experimental setting is enabled outside the demo, invoke every tool in a real supported top-level browser and compare the result with the related screen. Confirm that public routes list no admin tool name. Sign out and confirm that the six admin names disappear. Record any mismatch as an issue.
