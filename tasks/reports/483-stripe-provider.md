# Stripe provider and reconciliation report

Branch: `codex/483-stripe-reconciliation`.

Related issues: [#483](https://github.com/CenterCoopMedia/eventrunner/issues/483),
[#325](https://github.com/CenterCoopMedia/eventrunner/issues/325), and the deferred
class-access work in [#326](https://github.com/CenterCoopMedia/eventrunner/issues/326).

This report covers the provider, financial reconciliation, existing queue and
claim integration, deployment wiring, and onboarding. It does not mark the epic
or #325 accepted in full. The integrating branch owns checkout, organizer
operations, emails, UI, rules, the ADR, and the final CI and review evidence.

## Changes

### Stripe adapter and authoritative financial state

`functions/src/ticketing/providers/stripe.cjs` implements the existing provider
contract. It also exposes Checkout creation, Session retrieval and expiration,
financial-state reads, and `reconcileOrder(orderId)`.

The adapter uses the official Stripe SDK. It validates the organizer account
with the authenticated account endpoint. Each order also carries the internal
event ID, account ID, test/live mode, and payment-attempt ID. Webhook verification
uses the exact raw bytes and the endpoint signing secret. A separately retrieved
Stripe event binds accepted notifications to the configured account.

The adapter maps Session, PaymentIntent, refund, and dispute notifications to
the saved internal order. It never stores the raw webhook body. A signed Session
event can recover an exact payment attempt when the create response was lost.
Delivery IDs include account, mode, event, and Stripe event scope before hashing.

`stripeReconcile.cjs` retrieves the current Session, all line items, PaymentIntent,
refunds, and disputes. It checks line identity, quantity, currency, amounts,
metadata, mode, payment method, and payment status against the immutable order.
Order, inventory, and stable per-seat tickets commit in one transaction. A
per-order lease prevents an expired worker from replacing a newer result.

Each successful paid seat has its own ticket. Purchaser email does not replace
the attendee assignment. Reconciliation keeps claim fields, corrected attendee
details, check-in data, cancellation, and prior refund invalidation.

Successful full refunds invalidate all seats. A partial refund needs an explicit
ticket allocation. An organizer may instead record that a monetary adjustment
preserves admission. Pending, requires-action, succeeded, failed, and canceled
refund records remain distinct. A later failed refund does not revive a ticket.
Disputes create an organizer exception and leave admission unchanged.

### Queue and registration integration

The existing `ticket_sync_queue` remains the only queue. A transactional lease
and generation counter prevent concurrent drains and preserve a webhook that
arrives while an older provider read is in progress. A provider that owns ticket
persistence bypasses the generic upsert, including on a self-service claim.

Payment waiting has a separate bounded counter from the six provider-read
attempts. Exhausted work remains visible. Financial mismatches also persist on
the order and use the existing operator notifier.

`registration.cjs` now checks for a current valid claimed ticket in the same
transaction that updates the user's registration state. Tests reproduce a
refund after claim and a refund during the account update. Neither can grant
admission. The query uses the existing `claimedByUid + status` index.

Runtime notification dependencies are lazy. Status and claim handlers do not
read an unrelated email credential. Sync binds the selected notifier's send
secrets. Registration prompts bind send-only email secrets and preserve the
Eventbrite constructor's existing credential requirements.

### Deployment and onboarding

`packages/shared/src/config/deploy.cjs` accepts Stripe and requires an explicit
event ID, organizer account, and test/live mode. Live mode is rejected in demo
and emulator configuration. `.env.example` documents the settings and managed
secrets. The deploy workflow passes account and mode through validation, both
Functions environment writers, and the publisher's JSON environment.

`getTierA()` and the init answers builder mirror the non-secret Stripe scope.
An answers file cannot override the selected account or mode. The Stripe
checklist describes the Dashboard snapshot webhook endpoint, generated signing
secret, test mode, catalog setup, and sandbox verification.

The Stripe privacy template states which attendee data this site collects and
which payment data Stripe handles. The terms identify the organizer as the
ticket seller and the party handling admission, support, and refund decisions.
Both keep the existing legal-review marker. A fresh-init test checks the actual
seeded CMS content and confirms that init does not create a catalog or invent
commercial terms. Eventbrite, manual, and none retain their existing templates.

## Decisions and bounds

These are the implementation defaults coordinated with the integrating agent.
The organizer must configure the deployment and commercial terms before sales.

| Item | Current behavior |
| --- | --- |
| Account | One organizer-owned Stripe account per event deployment; no Connect routing |
| Checkout | Hosted Checkout with card-only payment; one currency per event |
| Current SDK contract | Stripe 23.0.0 uses create parameters `ui_mode: hosted_page` and `allowed_payment_method_types`; the returned Session still has `payment_method_types` |
| Inventory | Only held capacity can be released; sold capacity stays reserved after cancellation or refund |
| Expiration | Release requires an expired unpaid Session and no unresolved or received payment |
| Unknown creation | Retry the saved request under the same attempt key; preserve capacity when the outcome is uncertain |
| Safe retry age | Checkout helper stops automatic key reuse at 23 hours |
| Checkout hold | Checkout helper sets 60 minutes |
| Order and queue leases | 5 minutes, with ownership checks on commit |
| Stripe API request | 10-second SDK timeout; one SDK network retry |
| Stripe list bounds | At most 10 pages of 100 objects for each list; pagination failures do not silently omit refunds |
| Full sync | 25 saved orders per provider page; existing generic maximum of 50 pages |
| Unreadable provider state | Six attempts; backoff starts at 2 minutes and caps at 60 minutes |
| Payment waiting | 48 checks; open Sessions check at expiry, processing states after 15 minutes |
| Refund execution | Organizer uses Stripe Dashboard; Eventrunner reconciles each refund |
| Admission allocation | Successful partial refund requires selected seats or a recorded preserve-admission decision |
| Ticket classes | Full-event access only; #326 remains separate server/rules work |

## Evidence

Tests use synthetic identities, orders, and provider objects. The signature tests
use the installed official SDK's test-header generator and verification code.
They do not contact a Stripe account.

| Behavior | Evidence |
| --- | --- |
| Exact raw bytes, scope isolation, signed lost-response recovery, hosted card-only creation, webhook setup, bounded pagination | `providers/stripe.test.cjs` |
| Paid multi-seat order, preserved assignments and claims, replay, atomic inventory, financial validation | `stripeReconcile.test.cjs` |
| Full and partial refunds, explicit preserve-admission decision, later refund failure, disputes, cancellation race | `stripeReconcile.test.cjs` |
| Expiry once, processing hold, late payment after release, expired Session with unresolved payment | `stripeReconcile.test.cjs` |
| Concurrent workers, incoming webhook during a read, bounded payment waiting, stale generic-upsert prevention | `sync.test.cjs` |
| Valid-ticket requirement and both claim/refund timing windows | `registration.test.cjs` |
| Actual deployed secret bindings and lazy email dependency | `sync.test.cjs`, `index.test.cjs`, `registrationPrompt.test.cjs` |
| Scope preserved through validation, both Functions env files, and publisher JSON | `scripts/deploy-workflow.test.cjs` |
| Scope mirroring, override refusal, provider-aware legal clauses, actual fresh-init CMS and checklist | `core/config.test.cjs`, `scripts/lib/answers.test.cjs`, `scripts/lib/legal.test.cjs`, `scripts/init-event.test.cjs` |

The four onboarding tests were run before their implementation and failed on
missing scope fields or missing Stripe legal content. They passed after the fix.

Final verification used Node 22 after this report was written:

| Check | Result |
| --- | --- |
| All `functions/src/ticketing/**/*.test.cjs`, core config, init answers/legal/init-event, deploy validation/workflow, and webhook registration tests | 372 passed; 0 failed, skipped, or canceled |
| ESLint over the worktree | Exit 0; 0 errors; one existing `AccountMenu.jsx` effect-cleanup warning outside this slice |
| Copy check | 508 files; no blocked patterns |
| `git diff --check` | Clean |

The integrating agent must run the combined branch gates after cherry-picking
and regenerating its artifacts. Earlier focused runs passed 153 provider/ticketing
tests, 64 deployment tests, and 72 onboarding tests; those groups overlap and are
not additional to the 372-test final run. The existing lint warning was reported
to the integrating agent for the final clean check.

## Remaining acceptance work

- A real merchant sandbox rehearsal has not run. No Stripe credentials were
  available to this agent. Authentication/3DS, actual declines, hosted checkout,
  webhook retry, refund processing, and recovery against Stripe remain a
  separate authorized rehearsal before production cutover.
- This slice did not run the UI, browser, Firebase rules, full build, generated
  content, or required GitHub CI gates. The integrating branch owns those checks
  and the final review threads. This report does not substitute unit tests for
  that evidence.
- Embedded Checkout from #325 is deferred under the hosted MVP decision. #326's
  limited-pass enforcement is not implemented here. These issue clauses must
  not be marked accepted from this report.
- No merchant account, webhook endpoint, charge, or refund was created in
  Stripe. No production cutover or merge occurred in this branch.

## Primary references checked

Checked on October 13, 2026, together with the installed SDK's type definitions.

- [Checkout creation](https://docs.stripe.com/api/checkout/sessions/create)
  and [Session object](https://docs.stripe.com/api/checkout/sessions/object).
- [Hosted fulfillment](https://docs.stripe.com/checkout/fulfillment?payment-ui=stripe-hosted),
  [inventory expiry](https://docs.stripe.com/payments/checkout/managing-limited-inventory?payment-ui=stripe-hosted),
  and [Session expiration](https://docs.stripe.com/api/checkout/sessions/expire).
- [Webhook behavior](https://docs.stripe.com/webhooks) and
  [idempotent requests](https://docs.stripe.com/api/idempotent_requests).
- [Refunds](https://docs.stripe.com/refunds),
  [refund states](https://docs.stripe.com/api/refunds/object), and
  [PaymentIntent-filtered disputes](https://docs.stripe.com/api/disputes/list).
- [Authenticated account retrieval](https://docs.stripe.com/api/accounts/retrieve)
  and [Connect charge models](https://docs.stripe.com/connect/charges).
- [Stripe privacy policy](https://stripe.com/privacy), updated April 28, 2026,
  and [integration security](https://docs.stripe.com/security/guide). The seeded
  wording describes the implemented data flow and makes no compliance claim.
