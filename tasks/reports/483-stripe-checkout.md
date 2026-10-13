# Epic 483: catalog and Checkout

## Scope

This branch implements the catalog schema, server pricing, purchase reservation, hosted Checkout creation, purchaser recovery, and free or comp order path for epic 483. The director owns integration, deployment wrappers, security rules, operator controls, email delivery, documentation, and final CI. Separate branches own Stripe reconciliation and the web interface.

This branch alone does not meet the full epic. It does not claim browser, emulator, connector-review, or live Stripe evidence.

## Changes

- `packages/shared/src/ticketCommerce.cjs` and its ES module shim define catalog fields, supported currencies, integer amounts, sales windows, quantities, and attendee assignments. A checkout request cannot supply prices or user IDs.
- `functions/src/ticketing/stripeCommerce.cjs` owns order IDs, frozen price lines, individual ticket IDs, and inventory transitions. All ticket types share the event capacity. Paid sales retain their capacity after refund or cancellation under the director’s MVP policy.
- `functions/src/ticketing/stripeCheckout.cjs` exposes catalog, checkout, order-status, comp, and recovery helpers. A verified purchaser receives only their own order. Free and comp orders write their tickets in the same transaction as the order and inventory.
- A paid reservation commits the exact Stripe request and idempotency key before calling Stripe. A lost response keeps the inventory held. Recovery sends the same request only within 23 hours. Later ambiguity requires operator review.
- The existing `ticket_sync_queue` receives the order in the reservation transaction. Its scheduled reconciliation can recover an abandoned creation attempt. This branch adds no queue.
- `ticket_inventory/purchaser_<hash>` holds the current order pointer and purchase window. It permits one active hold and five new orders per purchaser per hour. Retrying a saved order uses no quota. Operator comps are exempt and audited.
- Public checkout reads `users/{uid}` in the reservation transaction. Account deletion makes the transaction retry and refuse the reservation. A first sign-in waits for profile creation. Operator comps are exempt from this purchaser profile requirement.
- The tests cover request validation, scope and verified identity, integer prices, concurrent last-seat purchases, duplicate requests, uncertain responses, stale idempotency, free group claims, comps, rate limits, account deletion, recovery on another device, and inventory transitions.

## API contracts

`ticketingCheckout` accepts `{ requestId, lines: [{ ticketTypeId, quantity, attendees: [{ firstName, lastName, email }] }] }`. A purchaser can resume the saved order with `{ requestId, resume: true }` or `{ orderId, resume: true }`. A resume request must use one ID and no cart. Order IDs are checked for ownership before any provider work. A missing order and another purchaser’s order both return the same HTTP 404 response.

An existing hold returns HTTP 409 with `error.code: purchase-in-progress` and the purchaser’s `error.existingOrderId`. The interface can use that ID to recover the same order on another device. A missing purchaser profile returns HTTP 503 with `error.code: account-not-ready`. Retrying after profile creation is safe.

`ticketingOrderStatus` accepts `orderId` or the same purchaser’s `requestId`. An order redirect does not mark the order paid. Completed purchases use `status: paid` or `status: free` with `paymentStatus: succeeded`.

`createCompOrder` accepts the director’s operator-gated actor UID, type ID, attendee list, request ID, reason, and standard dependencies. It returns `orderId`, status fields, ticket IDs, and the stored order. The HTTP caller owns the operator authorization.

Rate exhaustion returns HTTP 429 with `error.code: rate-limited`, `error.retryAfterSeconds`, and the `Retry-After` header. It creates no order or charge. The quota window is one hour from the first new order in that window.

## Decisions

- Supported currencies are USD, CAD, EUR, GBP, AUD, and NZD. Each uses two minor-unit digits. Adding other exponents needs a separate implementation and display test.
- Hosted card Checkout uses the Stripe 23 API fields `ui_mode: hosted_page` and `allowed_payment_method_types: [card]`. Currency conversion, automatic tax, and promotion codes are disabled. The server stores tax treatment and commercial terms with each order.
- Every attendee needs a name and email before purchase. The existing claim path binds each ticket to a verified email. Buying group tickets does not grant the purchaser another attendee’s ticket.
- The one-hour hold is released only after an authoritative unpaid expiry. Refunds and cancellation do not restock paid tickets.

## Verification

The final focused run passed 40 tests. The shared and ticketing unit run passed 511 tests. Targeted ESLint and `git diff --check` passed. The account-deletion and device-recovery regressions failed before the fixes. These tests use Node 22 and repository Firestore fakes. No production credentials or payment calls were used.

The director must run the complete integrated checks after packing the shared package and regenerating required output. The initial implementation commit used the runtime git identity before the repository’s identity instruction was found. The director corrected that unpublished commit to the required Joe Amditis GitHub noreply identity during integration. Later commits use the configured repository identity and a DCO sign-off.

## Integration review

The review found that the purchaser confirmation URL used `order` while the status page expects `orderId`. The director took that fix. The review also reproduced a historical-demo policy race in check-in when the demo flag changes during the transaction. The director owns adding transaction-local policy reads to operator mutations.
