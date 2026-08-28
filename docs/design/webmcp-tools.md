# Read-only WebMCP tools

Event Runner can expose named browser tools through `document.modelContext` when a supported top-level browser provides the API. The implementation also accepts `navigator.modelContext` for compatibility with earlier browser previews. The normal site remains the source of truth and the complete fallback.

Reference: https://learn.chatgpt.com/docs/webmcp

## Registration boundary

- Register tools from JavaScript in the top-level event page or authenticated admin app.
- Do not depend on declarative markup or an iframe.
- Check that `document.modelContext?.registerTool` is a function, then check the earlier `navigator.modelContext` preview surface. Unsupported browsers perform no registration and keep the same interface and network behavior.
- Register only when the event’s experimental flag permits the relevant tool set.
- Use stable allowlisted names, explicit descriptions, narrow JSON schemas, `additionalProperties: false`, and `readOnlyHint: true` for every tool in the first two phases.
- Do not build a generic wrapper around function names, Firebase paths, URLs, queries, or document ids.

## Public tools

The public event site can expose bounded facts that the same visitor can already read:

- `get_event_context`: event name, configured dates and timezone, current route type, public feature state, and public theme identity.
- `inspect_public_page`: current public page type, route, and the public content source that resolved it.
- `check_public_schedule`: bounded consistency results over the published schedule only.
- `get_public_release_context`: public build and generated-content version information.

The public set is on for the static demo. A client deployment must set the validated `webmcpPublic` feature flag. The flag defaults off when it is absent.

A public result never includes a draft, user profile, attendee record, ticket, invitation, email, provider state, storage path, internal error, secret, token, or non-public identifier. Lists have explicit maximum lengths and include a truncation count.

## Authenticated diagnostics

Admin tools register only after the existing admin gate succeeds. They call existing authenticated server boundaries with the current Firebase ID token. The browser registration is not an authorization boundary.

Candidate read-only diagnostics are event readiness, current draft validation, publish-queue status, redacted system errors, media usage, and ticketing health. Each result must be bounded and must omit attendee, ticket, payment, invitation, and email details.

The authenticated set uses the separate validated `webmcpAdmin` feature flag. The flag defaults off. It registers only inside the successful admin gate and calls six fixed admin endpoints with the current Firebase ID token. A model cannot select an endpoint, collection, path, URL, query, event, or document id. The current-page validator receives only the page id owned by the open admin route.

## Write decision

No tool in the first two phases publishes, deploys, deletes, sends email, exports data, changes provider setup, or saves a draft. A write tool requires a separate security and product review after the read-only tools have passed supported-browser acceptance testing. The review must name the exact side effect, schema, authorization path, validation path, audit record, confirmation behavior, and rollback.

## Verification

- Test unsupported-browser behavior.
- Test registration scope and cleanup.
- Test each input schema and output bound.
- Test that public pages cannot discover admin tools.
- Test unauthenticated and unauthorized admin calls.
- Test redaction with synthetic sensitive fields.
- Compare results with the existing application validators.
- Invoke each tool in a real supported top-level browser before the experimental flag is enabled outside the demo.
