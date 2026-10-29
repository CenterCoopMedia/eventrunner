# ADR 0004: organizer-owned Stripe ticket commerce

**Date:** 2026-10-13  
**Status:** Proposed for review with the implementation of [epic #483](https://github.com/CenterCoopMedia/eventrunner/issues/483). Merge accepts this extension; merchant setup and live sales require a separate launch decision.  
**Extends:** [ADR 0001](0001-event-platform-v1.md), ticketing sections only.  
**Amended:** 2026-10-20, for a card pay link on an issued sponsor invoice ([#519](https://github.com/CenterCoopMedia/eventrunner/issues/519)). See [the amendment](#amendment-2026-10-20-invoice-pay-links).

## Decision and boundaries

One event deployment uses one organizer-owned Stripe account, one explicit test/live
mode, and one presentment currency. The organizer owns the account, payment receipts,
refund decisions, disputes, payout destination, account access, and customer payment
support. The deployment operator owns configuration, secrets, availability, and
reconciliation support. Event Runner does not receive platform fees, route funds,
or use Connect headers, destination charges, subscriptions, or Stripe Invoices. The
one use of the same account outside ticket orders is the invoice pay link in the
amendment below: a Checkout Session, not a Stripe Invoice.

The first implementation uses Stripe-hosted Checkout after ticket selection on the
event site. The original embedded requirement in [#325](https://github.com/CenterCoopMedia/eventrunner/issues/325)
remains follow-on work. No card fields or card data enter Event Runner. This design
is not a compliance certification. Limited day/session/material passes remain with
[#326](https://github.com/CenterCoopMedia/eventrunner/issues/326); every MVP ticket class
grants the existing full-event entitlement and must be described accordingly.

Existing Eventbrite, manual, none, and external registration deployments keep their
behavior. Selecting Stripe is an explicit deployment change, not a migration of
historical Eventbrite sales. Stop intake and resolve existing provider obligations
before changing an event's provider. A fresh event/project is the supported way to
change the merchant, currency, or event identity after selling tickets.

## Commercial configuration

The catalog is private and server-owned. An operator publishes it only after checking
the organizer's refund terms, deadlines, prices, tax treatment, and fee allocation.
`commercialTermsConfirmed` records that step; a published catalog also requires
refund-policy text. Sales start closed when the catalog is missing or unpublished.
`salesPaused` stops new orders without stopping existing payment reconciliation.

MVP currencies are USD, CAD, EUR, GBP, AUD, and NZD, each using two decimal places and
integer minor units. Currency cannot change through a catalog edit. Only immediate
card payments are enabled. Adaptive pricing, promotion codes, automatic tax, and
extra platform fees are disabled. The selected `taxTreatment` is `inclusive` or
`not_collected`; the organizer must establish which is appropriate. No exemption is
inferred. The displayed ticket amount is the payable amount. Any tax computation
or separately added charge needs its own reviewed implementation.

Early-bird prices are separate ticket types with server-enforced sale windows and
shared event capacity. Public and hidden types, per-type capacity, descriptions,
minimum/maximum quantity, and event/order limits are validated. Hidden types are
available for authorized comps, not through guessed browser IDs. A stale catalog,
client amount, client Stripe Price ID, discount, or entitlement is never accepted as
pricing authority. Completed orders retain their captured descriptions and amounts.

## Private records and invariants

| Record | Purpose and authority |
| --- | --- |
| `ticket_catalog/current` | Validated, revisioned offer and commercial terms; operator writes only. |
| `ticket_inventory/current` | Atomic event/type held and sold counters scoped to the event. |
| `ticket_inventory/purchaser_<hash>` | Purchaser's active order and bounded new-order rate window; not queued work. |
| `ticket_inventory/free_budget_<hash>` | Cumulative public free-seat allocation per event and verified purchaser email. |
| `ticket_inventory/free_recipient_<hash>` | Durable public free-seat uniqueness guard per event and attendee email. |
| `ticket_orders/{orderId}` | Immutable purchase snapshot, attendee assignments, merchant/mode, payment/refund facts, and stable ticket IDs. |
| `ticket_payment_attempts/{attemptId}` | Frozen Checkout request, order-linked idempotency key, creation outcome, and recovery lease. |
| `tickets/{externalId}` | One stable admission per seat; claim, validity, and check-in remain distinct from financial state. |
| `ticket_webhook_deliveries/{deliveryId}` | Existing deduplication record, scoped by merchant, mode, event, and provider delivery ID. |
| `ticket_sync_queue/{orderId}` | The existing and only work queue: durable wake-ups and bounded reconciliation. |
| `admin_logs/{id}` | Actor, timestamp, affected IDs, reason, and action; no raw provider body. |

The new catalog, inventory, order, and payment-attempt collections deny every direct
browser read and write, including admin clients. Existing operator reads of
`admin_logs` remain available. APIs enforce verified purchaser ownership or live staff/operator roles and
scope every order to provider, account, test/live mode, and event. Public catalog
responses contain eligible offers and availability, never buyer data or secrets.
Financial data never enters the public attendee projection.

A purchase requires a verified signed-in account. The purchaser may assign each seat
to a different attendee. Possessing an order ID, Session ID, or printed ticket code
does not claim account access. Existing verified-email ticket claims are reused;
approval is recomputed from all current valid claimed tickets inside the user
transaction. Explicit admin grants and revocations keep their existing precedence.

## Reservation, checkout, and recovery

1. A transaction reads the live event policy, catalog, inventory, purchaser guard,
   and prior order. It reserves capacity and writes the order, attempt, and existing
   queue wake-up together. One unresolved hold per purchaser and five new orders per
   hour prevent repeated reservations; retries of an existing request consume no
   additional quota. Comps require an operator and bypass only the public sale window
   and purchaser quota, never inventory.
2. Prices, attendee assignments, return URLs, card-only options, metadata, expiry,
   and the idempotency key are frozen before contacting Stripe. Concurrent calls
   share the same order/attempt. A successful free or comp order creates its valid
   seats in the same transaction and never calls Stripe.
3. Paid orders hold seats for the Session's 60-minute lifetime. An API timeout or
   unknown response retains the hold. Recovery sends the identical saved request
   and key, only within 23 hours of the first attempt. After that safe boundary,
   operator review is required. The durable order uniqueness guard never expires.
   The first queue wake-up follows the short creation lease, so a process crash
   before the Stripe request can recover while the frozen expiry remains valid.
   Once a Session exists, the next payment check can follow its expiry. The
   23-hour idempotency boundary does not extend Stripe's Session-creation window;
   an outage that makes the saved request unusable needs operator review.
4. A signed webhook can attach a missing Session ID through verified server metadata
   after a lost create response. A redirect, browser cancellation, declined card,
   local clock, or expired creation lease cannot release inventory or grant access.
5. Reconciliation validates the authoritative Session, line-item products/amounts,
   totals, currency, merchant/mode, and PaymentIntent. Paid fulfillment requires
   `payment_status=paid`. A zero-payment provider snapshot is accepted only for a
   separately validated zero-payment order. Unpaid orders never create an access
   hold through the legacy `pending_info` path.
6. A provider-confirmed expired Session releases held capacity once, provided its
   payment state cannot still complete. Processing, captured funds, or conflicting
   payment evidence produces an exception and retains capacity. A payment after
   released capacity also requires review; it cannot silently oversell the event.

Orders, attempts, tickets, and inventory are durable business records, not additional
queues. The existing queue gains delayed readiness, leases, and generation fencing.
Only the lease owner may finish work; a newer webhook generation cannot be erased by
an older worker. The existing six-attempt bound applies to unreadable provider data.
Unconfirmed payments have a separate 48-check bound, using Session expiry or a
15-minute recheck. An exhausted or inconsistent order produces an operator-visible
exception and a deduplicated notification. There is no broader retry platform.

Webhook verification uses the pinned official Stripe SDK and exact raw request bytes.
Missing bytes fail closed. The endpoint checks supported event types, retrieves the
event through the configured account, verifies mode and order associations, then
atomically records accepted delivery plus queue work before returning success.
Session, PaymentIntent, refund, charge-refund, and dispute events converge through
fresh authoritative reads. Provider-owned persistence prevents a generic ticket
upsert from reviving a locally cancelled or refunded ticket.

## Refunds, admission, and organizer authority

| Action | Authority | Result |
| --- | --- | --- |
| Read orders/tickets; correct unclaimed attendee; resend; resync | Staff | Scoped records and audited mutations. Claimed/used tickets permit name correction, not email transfer. |
| Publish/edit catalog; pause/resume; issue comp | Operator | Validated transaction; comp requires explicit confirmation and reason. |
| Cancel selected admission | Staff; operator for used tickets | Explicit confirmation and reason. Money is unchanged; seats remain sold. |
| Send money back | Authorized organizer in Stripe Dashboard | Event Runner reads the resulting refund records. No in-app refund API. |
| Allocate a succeeded partial refund | Operator | Select affected tickets or explicitly preserve all admission for a price adjustment; decision is audited. |
| Check in | Staff | Online atomic transition using an opaque seat ID; repeat scan reports already used. |
| Undo check-in | Operator | Explicit confirmation, reason, timestamp, and audit. |

Refund records retain individual IDs, amount/currency, and pending, requires-action,
succeeded, failed, or canceled status. Succeeded amounts determine full/partial money
refund state. A full refund invalidates all admission. A partial amount without
ticket allocation produces an exception; no attendee is guessed. Failed/pending
refunds do not remove valid admission. Locally removed admission is never silently
restored by a later provider event. Cancelled and refunded sales do not restock
capacity in the MVP. The organizer may issue an explicitly audited comp within
remaining capacity when a correction is appropriate.

Disputes create a redacted exception and notify the operator. They do not silently
cancel admission or reverse payouts in the application. The merchant handles the
case in Stripe and decides any admission action under its event policy.

## Email and retention

Event Runner's ticket confirmations and claim invitations use the existing managed
email adapter and send-once keys. Stripe's payment receipt remains Stripe's separate
merchant-owned receipt. Purchaser messages may contain totals; attendee invitations
contain only that recipient's assigned-seat information. Bodies are not retained in
the email log. An order-written trigger is only a wake-up and rereads settled state;
it is not a new email queue. An uncertain send is recorded for staff review before
an explicit resend receives a fresh idempotency key.

Retention is a launch decision with separate categories:

- Order financial facts and minimal provider IDs remain business records after
  account deletion. No automatic purge is added; the merchant must approve a retention
  schedule and legal holds before launch. Do not purge records with unresolved
  payments, refunds, disputes, or required accounting history.
- Attendee names/emails and order assignments are private operational data. The
  existing account-delete flow releases claims but does not erase business records.
  A request to erase those records needs the operator's reviewed, scoped procedure
  after checking business obligations; deleting an account is not represented as
  erasing the purchase.
- Attempt parameters may contain attendee data and a Checkout URL. Retain unresolved
  attempts for safe recovery. After resolution and the merchant-approved recovery
  interval, minimize expired URLs/parameters through a reviewed maintenance action;
  keep the order uniqueness guard and provider IDs needed for replay safety.
- Existing webhook-dedup and email/audit retention mechanisms continue. Dedup expiry
  does not erase order uniqueness or ticket IDs, so replay must remain safe even after
  a dedup row has gone. Do not store raw webhook/provider payloads in any new record.

The implementation supplies no generic retention automation. The runbook requires
written durations and ownership for each category before live sales.

## Configuration, rollout, and rollback

Use `EVENT_TICKETING_PROVIDER=stripe`, a stable `EVENT_TICKETING_EVENT_ID`,
`EVENT_STRIPE_ACCOUNT_ID`, and explicit `EVENT_STRIPE_MODE=test|live` in the event's
deployment environment. `EVENT_PUBLIC_URL` is the canonical HTTPS origin. Store the
matching API key in managed `TICKETING_API_TOKEN` and the endpoint signing secret in
managed `TICKETING_WEBHOOK_SECRET`. Neither enters public config. Use the documented
provider-specific webhook validation command after creating the endpoint in Stripe.

Keep the catalog unpublished until rules, indexes, functions, webhook, email, and
reconciliation are verified. An isolated test deployment uses synthetic identities
and Stripe test keys; live mode is rejected in emulators and the public demo.
There is no automatic migration or seed of paid offers. No secrets or merchant
configuration are provided by these changes.

Rollback starts with pausing sales. Keep the Stripe provider, webhook, existing
queue drain, order records, and compatible reconciliation deployed until every
accepted payment and hold is resolved. Reverting to a build without the adapter or
switching provider while orders are outstanding is not a safe payment rollback.
Historical-demo mode freezes ticketing writes, including signed webhook intake
and reconciliation. Enable it only after accepted payment, refund, dispute, and
support obligations are settled. It is not a substitute for the sales-pause switch.

Credential-free tests cover tampering, oversell, replay, refunds, roles, claims,
demo policy, and worker races. A separately authorized Stripe sandbox rehearsal must
cover authentication/3DS, declines, timeouts, webhook replay, expiry, refund states,
and merchant receipt/email delivery before any live-sales decision. The PR evidence
must distinguish those unrun external checks from local and hosted CI results.

## Amendment 2026-10-20: invoice pay links

**Status:** Accepted by the owner on 2026-10-20 ("Stripe pay link in v1", the approved
invoicing spec on [#208](https://github.com/CenterCoopMedia/eventrunner/issues/208)).
Implemented by [#519](https://github.com/CenterCoopMedia/eventrunner/issues/519).

**Scope.** A deployment whose ticketing provider is Stripe may take one more kind of
payment through the same organizer-owned account, mode and key: a fixed-amount card
payment against one issued sponsor invoice. It is a Stripe-hosted Checkout Session in
`payment` mode, card only, with one line of quantity one. Its amount is the invoice's
frozen total, its currency is the invoice currency, and its name is the invoice number.
The server builds it from the stored invoice; a request carries only the invoice id.
Adaptive pricing, automatic tax, promotion codes, transfers, `on_behalf_of` and
application fees are off, as for tickets. It is not a Stripe Invoice, a Payment Link, a
subscription, or a ticket order. It reserves no inventory and grants no admission. A
deployment on another provider has no pay links and changes nothing.

**Records.** The links live on the invoice (`invoices/{id}.payLinks`), a server-only
collection. Each link keeps its status (`creating`, `open`, `paid`, `expired`,
`cancelled`, `failed`), the Session id, the amount, the currency, the mode, who made it,
and when it ends and why it closed. The frozen request and its idempotency key are kept
only while the link is `creating`, for a safe retry. The URL is shown only while the link
is open. Card payments that were not applied go to `invoices/{id}.paymentReviews`. No
raw provider payload is stored. The event data package carries the links and reviews
without Stripe ids or URLs, like orders.

**Lifetime.** A Checkout Session ends within 24 hours. A link is made for 23 hours, and
staff make a new one after it ends. One link is open at a time. A press in the last 15
minutes of a link replaces it: the old link is cancelled and its Session expired, and a
payment that completed on it first still counts. A link is not replaced while an email of
the invoice is being sent, since that email states the link. A payment applied through one link
closes and expires any other open link. A lost create answer is
retried with the same request and key for 22 hours, inside Stripe's idempotency window and
while the frozen end time is still valid. A Stripe 4xx closes the attempt.

**Reconciliation.** Payments use the existing verified webhook and its delivery
deduplication. The Stripe adapter verifies the signature on the exact bytes, retrieves
the event with the account's key, and checks mode, account and event id. A Checkout
Session event whose metadata names an invoice of this event goes to the invoice step,
never the ticket queue. The step retrieves the Session again and trusts only that copy.
In one transaction with the delivery claim, it matches the Session to a link stored on
the invoice (by Session id, or by the link id in its metadata when the create answer was
lost), and checks `status=complete`, `payment_status=paid`, the amount against the link
and the invoice total, and the currency. When all match and the invoice is issued, it
marks the invoice paid (method `card`, via Stripe, with the Session and PaymentIntent
ids), raises the revision, and writes the `admin_logs` row. The paid date is the day of
Stripe's event on the event clock, so a late or retried delivery keeps the real day; the
time the site recorded it is kept apart. A replayed or second event
about a recorded Session changes nothing. PaymentIntent, charge, refund and dispute events
that carry invoice metadata are acknowledged without work.

**Payments that do not fit.** A paid Session for a void or already paid invoice,
through a cancelled link, for another amount or currency, or with no stored link, is
recorded on the invoice for review, written to `admin_logs`, and raised to the operator
through a `system_errors` row, in the same transaction. The invoice status does not
change. A payment through a Session the invoice has no record of also cancels every open
link and expires it at Stripe. While any review is open, no new link is made. An operator
closes the review with a note after acting in the Stripe Dashboard; that closes its
`system_errors` alert in the same transaction.
Event Runner never refunds.

**Void, paid by hand, reopen.** Void and a payment recorded by hand set an open link to
`cancelled` in their own transaction, then ask Stripe to expire the Session. When Stripe
cannot be reached, the record says the link may still work until it ends; a payment
through it is flagged as above. A paid invoice has no open link, so reopen needs no step;
reopening a card payment does not move money, and staff may make a new link.

**Risks.** (1) A payer on the hosted page while an invoice is voided can still complete
the payment; it is flagged, and the merchant refunds it. (2) A link printed on a PDF or
sent by email stops working after 23 hours; the PDF and email show the end time, and a
fresh PDF or email carries a fresh link. (3) Refunds and disputes on an invoice payment
are handled in the Stripe Dashboard and do not change the invoice; an operator reopens
it if the money goes back. (4) The restricted key needs Checkout Session write and read
for this use too; no new webhook event type is needed. (5) The invoice currency must be
one of the MVP currencies above, and the total must be within Stripe's card minimum and
the `MAX_AMOUNT` ceiling. (6) Historical-demo mode refuses new links and ignores payment
events, as for tickets.

**Tests.** Credential-free tests cover a test-mode Session built from the frozen invoice,
a lost create answer, webhook replay, duplicate events, a payment after void, currency
and amount mismatches, an unknown Session, signature and account spoofing, and the
read-only demo. The separately authorized Stripe sandbox rehearsal must add a real
invoice payment, a payment after void, and an expired link before live use.

## Provider references

- [Checkout fulfillment](https://docs.stripe.com/checkout/fulfillment?payment-ui=stripe-hosted)
- [Webhook signatures, retries, and event ordering](https://docs.stripe.com/webhooks)
- [Idempotent requests](https://docs.stripe.com/api/idempotent_requests)
- [Limited inventory and Session expiry](https://docs.stripe.com/payments/checkout/managing-limited-inventory?payment-ui=stripe-hosted)
- [Refunds](https://docs.stripe.com/refunds)
- [Connect charge models](https://docs.stripe.com/connect/charges)
