# Eventbrite adapter verification

Verifies the six numbered judgment calls documented in
[`functions/src/ticketing/providers/eventbrite.cjs`](../functions/src/ticketing/providers/eventbrite.cjs)'s
module doc (and itemized in
[`functions/src/ticketing/providers/__fixtures__/README.md`](../functions/src/ticketing/providers/__fixtures__/README.md))
against a real Eventbrite sandbox event, and tells you how to diff what you capture against the
committed synthetic fixtures. See issue #79 for the tracked scope this runbook covers.

**Prerequisite:** an Eventbrite account with a test/sandbox event, its numeric event id
(`EVENT_TICKETING_EVENT_ID`), and an API token (`TICKETING_API_TOKEN`) from the account's API keys
page. A dev/staging Event Runner deployment with `EVENT_TICKETING_PROVIDER=eventbrite` configured.

## Setup: register the webhook

```sh
EVENT_TICKETING_PROVIDER=eventbrite EVENT_TICKETING_EVENT_ID=<sandbox event id> \
TICKETING_API_TOKEN=<from Eventbrite account> \
TICKETING_WEBHOOK_SECRET=<generate one: `openssl rand -hex 32`, store like EMAIL_WEBHOOK_BASIC_AUTH> \
EVENT_FIREBASE_PROJECT_ID=<dev project id> \
  node scripts/register-ticketing-webhook.cjs
```

Confirm success via `getTicketingStatus` (admin Settings) or the Cloud Functions log for the
registration call.

The script registers every action the adapter handles: `order.placed`, `order.updated`,
`order.refunded`, and `attendee.updated` (#357). In the Eventbrite dashboard, confirm that the
webhook lists all four. If the script names an older webhook at the same endpoint, delete that
webhook in Eventbrite.

Then exercise all three flows against the sandbox event's real checkout (or Eventbrite's test-order
tooling, if offered): place an order, refund one, cancel one.

## Per-assumption capture and diff plan

For each of the six numbered assumptions, capture the specific real artifact named below, sanitize
it (strip every real identifier — attendee/organizer names, emails, the sandbox account's org name
and id, real order/ticket numeric ids, phone numbers, and free-text fields. Replace them with clearly
synthetic placeholders in the same shape. Every delivery body echoes `config.endpoint_url`, and that
URL carries `TICKETING_WEBHOOK_SECRET`: replace the token value in `config.endpoint_url` with
`fixture-placeholder` (`?token=fixture-placeholder`) before the body is saved anywhere. Do not use `[REDACTED]` blocks because preserving field shape is the
whole point), and diff it against the named fixture file.

### 1. Webhook authentication (URL secret, #356)

Eventbrite does not sign webhook deliveries, and its webhook API takes no signing secret. The
adapter does not check an HMAC. `register-ticketing-webhook.cjs` registers the callback URL with
`?token=<TICKETING_WEBHOOK_SECRET>` added. `ticketingWebhook` compares that query parameter with the
secret in constant time and answers 401 when it is missing or wrong. The body is not trusted for
ticket data: the function reads only an order id from an `api_url` on `www.eventbriteapi.com`, and
the sync drain fetches that order from the Eventbrite API with this deployment's token. A delivery
with the right secret that the adapter cannot read gets 200 and is ignored, so Eventbrite does not
retry it. A secret shorter than 32 characters, or none, refuses every delivery and stops the
registration script; other ticketing functions keep working.

This is proven offline only, with faked fetch (`eventbrite.test.cjs`,
`eventbriteEndToEnd.test.cjs`). It is not yet confirmed against Eventbrite. Confirm it in the
sandbox:

- **Check the registration:** in the Eventbrite dashboard, the webhook URL ends in
  `?token=…`. Do not copy the value into notes, issues, or screenshots.
- **Check a delivery:** place a sandbox order. `getTicketingStatus` shows the delivery, and the
  order reaches `ticket_sync_queue`. If Eventbrite drops or rewrites the query string, every
  delivery gets a 401. Record that as a corrected verdict; do not weaken the check.
- **Check a refusal:** send one POST to the bare callback URL, without `token`. It must get a 401.
- **Capture:** the request headers of one delivery, to record whether Eventbrite sends any
  signature header at all. If it does, record its name and scheme as a corrected verdict.
- **Know the log exposure:** Cloud Run request logs record the full request URL, query string
  included. Event Runner code never logs the secret, but anyone who can read the project's request
  logs can read it. Keep log access to operators. If the secret leaks, generate a new one, update
  the secret, deploy, and run the registration script again; then delete the old webhook it names.
- **Verdict:** confirmed, or corrected with what Eventbrite really sends.

### 2. Delivery id

- **Capture:** trigger the exact same order-update notification twice if possible (or watch for
  Eventbrite's own retry behavior on a slow-responding endpoint) and compare the two raw request
  bodies byte for byte.
- **Sanitize:** this is about body *identity*, not content, so you can hash both bodies
  (`sha256sum`) locally without sanitizing them for this specific check.
- **Diff against:** `webhook-order-updated.json` and `webhook-order-updated-2.json` model "two
  distinct deliveries, different bytes, same `orderId`" — confirm real retries of the *same*
  notification are byte-identical (so `sha256(rawBody)` dedup works as intended), and that two
  genuinely different notifications about the same order differ in bytes, as those two fixtures
  assume.

### 3. `api_url` shape

- **Capture:** the full webhook payload body for one delivery of each action (`order.placed`,
  `order.updated`, `order.refunded`, `attendee.updated`), specifically its `api_url` field.
- **Sanitize:** replace any real event/order/attendee numeric ids in the URL path with a
  renumbered fake sequence, keeping the path *shape* identical. Replace the token in
  `config.endpoint_url` as the general rule above says.
- **Diff against:** the adapter accepts three shapes, none yet confirmed against Eventbrite:
  `/v3/events/{eventId}/orders/{orderId}/` (`webhook-attendee-updated.json` and the other first
  fixtures), `/v3/orders/{orderId}/` (`webhook-order-placed-order-path.json`, the shape
  Eventbrite's documentation shows for `order.*`), and `/v3/events/{eventId}/attendees/{attendeeId}/`
  (`webhook-attendee-updated-attendee-path.json`, the documented `attendee.*` shape, mapped to its
  order through `GET /events/{id}/attendees/{id}/`). An authenticated delivery in any other shape
  gets 200 and is ignored, so a shape the adapter does not know loses the update without an
  error. Record which shape each action really uses. This is the single most load-bearing
  assumption — verify it carefully.

### 4. `order.refunded` folding

- **Capture:** the webhook delivery body produced when you refund an order, specifically its
  `config.action` field.
- **Sanitize:** strip real order/attendee ids and any customer-identifying fields; keep `api_url`
  and `config.action` shape intact.
- **Diff against:** `webhook-order-refunded.json`, which models `config.action: "order.refunded"`
  on the wire. The registration sends `order.refunded` (#357), so a refund must produce a
  delivery. Confirm the real refund delivery's `config.action` string matches what the fixture
  assumes, and confirm the adapter's fold into `eventType: 'order.updated'` still makes sense (a
  subsequent `GET /orders/{id}/` should pick up the refunded ticket status).

### 5. Order completeness ("complete" signal)

- **Capture:** the `GET /orders/{id}/?expand=attendees` response body immediately after
  `order.placed` fires (before Eventbrite's data has necessarily propagated) and again a few
  seconds or minutes later — specifically whether the `attendees` key is present, absent, or
  populated at each point.
- **Sanitize:** replace attendee names and emails with fake placeholders in the same shape; keep
  the `attendees` array's presence, absence, and length.
- **Diff against:** `order-processing.json` (no `attendees` key) and `order-complete.json`
  (populated `attendees`). Confirm the real API actually omits the key entirely when not yet
  hydrated, rather than returning an empty array, which would need different handling — this is
  the assumption's whole premise.

### 6. `registerWebhook` org discovery

- **Capture:** the response body of `GET /users/me/organizations/` for the sandbox account —
  specifically, does it return exactly one organization, and does the adapter's "use the first
  result" logic pick the right one? If the sandbox account has more than one org, this is the
  multi-org case the assumption explicitly flags as unverified.
- **Sanitize:** replace the real organization name and numeric id with fake placeholders, keeping
  the response shape (array of org objects with whatever fields are present).
- **Diff against:** `organizations.json`. Note whether the sandbox account only has one org (the
  assumption trivially holds) or more than one (the assumption needs a real decision — e.g.
  "prompt the operator to choose" or "match by name" — recorded as a corrected verdict, not
  silently patched).

## Filing the results

1. **Name every sanitized fixture with a `-sanitized` suffix** (e.g.
   `webhook-order-placed-sanitized.json`) — never overwrite or reuse an existing synthetic
   filename.
2. **Add a one-line provenance note** to each new file (a header comment, or a new column in
   `__fixtures__/README.md`) stating it was "captured from a real Eventbrite sandbox delivery on
   `<date>`, values sanitized" — so it's never mistaken for the documentation-derived synthetic
   originals.
3. **Update `__fixtures__/README.md`'s opening paragraph** — its current wording ("None of it was
   captured from a real Eventbrite account") stops being true the moment one sanitized-real fixture
   is added.
4. **Write an explicit verdict for each of the six assumptions** — confirmed, or corrected, with
   what changed. This is what "done" actually requires; the fixture files are supporting evidence,
   not the deliverable itself.
5. **Any adapter code or fixture change goes through a normal PR** on its own branch — never a
   direct push — updating `eventbrite.cjs`'s module doc comments, the fixtures, and their tests
   together.
6. Never commit an unsanitized payload, even temporarily — sanitize before the first `git add`, and
   never paste an unsanitized payload into an issue, PR description, or this runbook's results.
