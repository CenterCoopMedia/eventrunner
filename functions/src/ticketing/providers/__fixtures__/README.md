# Eventbrite fixtures — synthetic

Every file in this directory is **hand-authored synthetic JSON**, written to match Eventbrite's
*documented* webhook and REST (v3) API response shapes as closely as this project could confirm
without account access to a live Eventbrite sandbox. None of it was captured from a real
Eventbrite account, and none of it contains real attendee, order, or organization data — every
name, email, and numeric id below is invented for this repository.

**Operator verification against a real sandbox is tracked separately in issue #79.** These
fixtures exist so the ticketing core, the webhook dedup/queue pipeline, and the eventbrite
adapter's own mapping logic can be tested end-to-end (`functions/src/ticketing/providers/eventbrite.test.cjs`,
`functions/src/ticketing/webhook.test.cjs`, `functions/src/ticketing/sync.test.cjs`) without a
network dependency — not as a substitute for that verification.

## Where interpretation was required

`functions/src/ticketing/providers/eventbrite.cjs`'s module doc numbers six judgment calls in
detail; the short version, because it drives what these fixtures look like:

1. **Webhook signing.** Eventbrite's classic webhook delivery is not documented as carrying a
   payload signature. This adapter was specified to implement HMAC-SHA256 over the raw body with
   `TICKETING_WEBHOOK_SECRET`, delivered as `X-Eventbrite-Signature: <hex>`. The fixture webhook
   bodies below are **unsigned** — signatures are computed in tests, over these exact bytes, using
   `internals.signBody` from the adapter itself, so the fixture stays valid if the wire format
   ever changes. #79 must confirm whether a real Eventbrite delivery carries this header at all;
   if not, the fallback is the same shared-secret-in-callback-URL trick the ADR (§3.1) already
   uses for Postmark's unsigned delivery webhooks.
2. **Delivery id.** Eventbrite's webhook payload carries no per-delivery identifier, so the
   adapter derives one as `sha256(rawBody)`. `webhook-order-updated.json` and
   `webhook-order-updated-2.json` are deliberately two DIFFERENT bodies about the same order, to
   exercise "two distinct deliveries collapse onto one queue row, not onto one delivery claim"
   (spec §3.3).
3. **Resource URL shape.** `api_url` is modeled as always resolving the ORDER resource path
   (`/v3/events/{eventId}/orders/{orderId}/`), even for `attendee.updated` deliveries, because the
   sync queue is keyed by order id and an attendee resource's own URI does not carry one. This is
   the single most load-bearing assumption in this directory.
4. **`order.refunded` folding.** The ADR's `WebhookVerification.eventType` enum has no
   `order.refunded` slot. `webhook-order-refunded.json` carries `config.action: "order.refunded"`
   on the wire (matching Eventbrite's documented action name) and the adapter maps it to
   `eventType: 'order.updated'` — the refund is picked up when the order is re-fetched, not
   through a distinct code path.
5. **"Complete" signal.** `order-complete.json` has an `attendees` array (populated);
   `order-processing.json` omits the `attendees` key entirely, modeling "Eventbrite has not
   hydrated the expansion yet". `order-refunded.json` has an `attendees` array whose entries carry
   `"refunded": true` — a refunded order is still *complete* data, just with refunded tickets.
6. **Webhook registration scope.** `organizations.json` and `webhooks-list-empty.json` /
   `webhooks-list-existing.json` model the two-call discovery
   (`GET /users/me/organizations/` → `GET /organizations/{id}/webhooks/`) `registerWebhook` uses.

## Files

| File | Models |
|---|---|
| `webhook-order-placed.json` | `order.placed` delivery body |
| `webhook-order-updated.json` | `order.updated` delivery body (order `ord-2001`) |
| `webhook-order-updated-2.json` | A second, distinct `order.updated` delivery about the same order — different bytes, same `orderId` (judgment call 2) |
| `webhook-order-refunded.json` | `order.refunded` delivery body (judgment call 4) |
| `webhook-attendee-updated.json` | `attendee.updated` delivery body |
| `webhook-wrong-event.json` | A correctly-shaped delivery for an event id other than the configured one |
| `order-complete.json` | `GET /orders/{id}/?expand=attendees` — fully hydrated, two valid attendees |
| `order-processing.json` | Same order id, `attendees` key absent — the eventual-consistency case |
| `order-refunded.json` | Same order, attendees present with one `refunded: true` |
| `order-not-found.json` | Documents the 404 shape; the adapter never parses this — a 404 short-circuits before the body is read |
| `orders-page-1.json` | `GET /events/{id}/orders/?expand=attendees` — first page, `pagination.has_more_items: true` |
| `orders-page-2.json` | Second (final) page, `pagination.has_more_items: false` |
| `organizations.json` | `GET /users/me/organizations/` |
| `webhooks-list-empty.json` | `GET /organizations/{id}/webhooks/` — no existing subscription |
| `webhooks-list-existing.json` | Same call — one subscription already registered at the callback URL under test |
| `webhook-create-response.json` | `POST /organizations/{id}/webhooks/` response |
