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
TICKETING_WEBHOOK_SECRET=<generate one, e.g. `openssl rand -hex 20`, store like EMAIL_WEBHOOK_BASIC_AUTH> \
EVENT_FIREBASE_PROJECT_ID=<dev project id> \
  node scripts/register-ticketing-webhook.cjs
```

Confirm success via `getTicketingStatus` (admin Settings) or the Cloud Functions log for the
registration call.

Then exercise all three flows against the sandbox event's real checkout (or Eventbrite's test-order
tooling, if offered): place an order, refund one, cancel one.

## Per-assumption capture and diff plan

For each of the six numbered assumptions, capture the specific real artifact named below, sanitize
it (strip every real identifier — attendee/organizer names, emails, the sandbox account's org name
and id, real order/ticket numeric ids, phone numbers, free-text fields — and replace with obviously
fake placeholders in the same shape, never `[REDACTED]` blocks, since preserving field shape is the
whole point), and diff it against the named fixture file.

### 1. Webhook signing

- **Capture:** the full set of HTTP headers on an actual incoming webhook delivery to your
  registered callback URL — specifically, is there an `X-Eventbrite-Signature` header at all, and
  if so what does its value look like (hex length, any prefix)? Capture from Cloud Functions logs
  (the raw request headers `ticketingWebhook` received) or a temporary logging proxy in front of
  the function during the test.
- **Sanitize:** header names and value *shape* (e.g. "64 hex chars, no prefix") are not sensitive —
  the actual signature value is derived from your webhook secret plus the body, so it's safe to
  keep or drop; there's no PII here.
- **Diff against:** there's no fixture file for headers today — the fixtures README's item 1
  documents the *assumed* scheme (HMAC-SHA256 over raw body via `X-Eventbrite-Signature`, hex
  digest). Write the observed reality as a one-line verdict: confirmed, or corrected (name the real
  header and scheme).

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

- **Capture:** the full webhook payload body for at least one `attendee.updated` delivery,
  specifically its `api_url` field.
- **Sanitize:** replace any real event/order/attendee numeric ids in the URL path with a
  renumbered fake sequence, keeping the path *shape* identical.
- **Diff against:** `webhook-attendee-updated.json`. The adapter assumes `api_url` always resolves
  `/v3/events/{eventId}/orders/{orderId}/` (the order resource), even for `attendee.updated`. Check
  whether the real `api_url` for an `attendee.updated` delivery is actually an order path or an
  attendee path (e.g. `/v3/events/{eventId}/attendees/{attendeeId}/`). This is the single most
  load-bearing assumption — verify it carefully.

### 4. `order.refunded` folding

- **Capture:** the webhook delivery body produced when you refund an order, specifically its
  `config.action` field.
- **Sanitize:** strip real order/attendee ids and any customer-identifying fields; keep `api_url`
  and `config.action` shape intact.
- **Diff against:** `webhook-order-refunded.json`, which models `config.action: "order.refunded"`
  on the wire. Confirm the real refund delivery's `config.action` string matches what the fixture
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
