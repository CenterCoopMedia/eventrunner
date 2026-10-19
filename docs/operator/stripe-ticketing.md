# Stripe ticketing: launch and support

Use this runbook for an event that explicitly selects the organizer-owned Stripe provider. [ADR 0004](../adr/0004-stripe-ticket-commerce.md) defines the payment, admission, and recovery boundaries for [epic #483](https://github.com/CenterCoopMedia/eventrunner/issues/483). The [deploy runbook](../DEPLOY_RUNBOOK.md) remains the source for Firebase provisioning, runtime identity, Workload Identity Federation, and client deployment commands.

Merging the implementation does not authorize a Stripe account connection, a payment rehearsal, or live sales. Record the organizer's launch decision and complete the readiness evidence below before opening the catalog. The public demo and credential-free CI do not take real payments.

## 1. Name the owners and approve the offer

One deployment serves one event, one organizer-owned Stripe account, one explicit test/live mode, and one currency. There are no Connect transfers, platform fees, subscriptions, or invoice payments in this ticket flow. The purchaser pays through Stripe-hosted Checkout; Event Runner never collects card details.

| Responsibility | Owner and access |
| --- | --- |
| Merchant account, receipts, payout destination, refunds, disputes, and payment support | The organizer's authorized Stripe account administrator and finance contact. Record named primary and backup contacts. |
| Event deployment, Stripe credentials, webhook health, and reconciliation | The deployment operator with approved access to the client project and secret-management system. |
| Catalog publication, sales pause/reopen, complimentary admission, partial-refund admission allocation, and check-in correction | An Event Runner operator. A staff account cannot perform these actions. |
| Order/ticket support, attendee correction, confirmation resend, resync, ordinary cancellation, and check-in | Event Runner staff or operators. Cancelling already checked-in tickets requires an operator. |
| Retention, account-deletion requests, and event policy | The organizer's designated data/records owner, with the operator carrying out the approved procedure. |

Before configuration, record the event's refund policy and deadline, support contact, currency, every advertised price, total capacity, per-type limits, sale windows, tax treatment, fee allocation, and who can approve complimentary admission. MVP currencies are USD, CAD, EUR, GBP, AUD, and NZD. Prices use two decimal places; the displayed total includes everything the attendee pays. The organizer absorbs processing fees. Choose **Tax included in ticket prices** or **No tax collected for this event** only after the organizer establishes the correct treatment; the application does not infer an exemption.

All ticket types grant the existing full-event entitlement. Describe early-bird and complimentary types accordingly. Embedded payment collection remains follow-on work in [#325](https://github.com/CenterCoopMedia/eventrunner/issues/325); day/session/material-specific access remains in [#326](https://github.com/CenterCoopMedia/eventrunner/issues/326).

## 2. Provision an isolated test deployment

Use a separate Firebase event/project and the organizer's Stripe sandbox for the authorized rehearsal. Keep its identities and data synthetic. Provision the final live event separately; copying test orders, inventory, attempts, or tickets into a live project is unsupported. After accepting orders, changing the merchant, event identity, currency, or provider requires a separately reviewed migration; a fresh event/project is the supported starting point.

Set the following non-secret values in the correct client GitHub Environment and operator process configuration. The deployment workflow passes the server values to functions. The catalog and private commerce records are never generated into the public site snapshot.

| Variable | Required value |
| --- | --- |
| `EVENT_TICKETING_PROVIDER` | `stripe` |
| `EVENT_TICKETING_EVENT_ID` | A stable identifier for this event, using letters, digits, underscores, or hyphens. Keep it unchanged after orders exist. |
| `EVENT_STRIPE_ACCOUNT_ID` | The organizer account's `acct_…` identifier. The provider verifies it against the account owning the configured key. |
| `EVENT_STRIPE_MODE` | Explicitly `test` for rehearsal or `live` for the separately approved final deployment. Live mode is refused in emulators and demo deployments. |
| `EVENT_PUBLIC_URL` | The canonical HTTPS event origin used to build Checkout return links. |
| `EVENT_ALLOWED_ORIGINS` | The approved site origins for CORS. |
| `EVENT_FIREBASE_PROJECT_ID`, `EVENT_FIREBASE_REGION` | The intended event project and functions region; the region defaults to `us-central1`. |
| Email and operator-notifier settings | A working managed email provider and an operator notification destination, configured through the existing deploy runbook. |

Verify that Google or emailed-code sign-in produces a verified account, that the public origin is authorized in Firebase Auth, and that sender-domain verification passes. Public purchasing requires an existing verified account. A newly created account whose profile has not finished initializing can retry the same saved attempt.

## 3. Generate, store, and grant access to secrets

Only the organizer's authorized Stripe administrator creates account credentials. In the intended sandbox/account, create a named restricted API key for this event integration. Start with no permissions and grant the capabilities below; use Stripe's request logs during the separately authorized rehearsal to confirm that each operation succeeds. The permission table is derived from [the provider's SDK calls](../../functions/src/ticketing/providers/stripe.cjs), not a claim that an untested restricted key is ready for launch. Stripe documents resource-level **None**, **Read**, and **Write** permissions in its [restricted-key guide](https://docs.stripe.com/keys/restricted-api-keys).

| Stripe capability | Why the integration needs it |
| --- | --- |
| Read the owning account | `accounts.retrieve()` proves that the key belongs to `EVENT_STRIPE_ACCOUNT_ID`. |
| Write Checkout Sessions; read Sessions and line items | Creates/recovers hosted Checkout, can expire a Session, and verifies the saved purchase against provider state. |
| Read Prices and Products as required for expanded line items | Reconciliation compares the provider's line-item products and amounts with the immutable order snapshot. Confirm the permission requirements of inline `price_data` during rehearsal. |
| Read PaymentIntents and Charges | Verifies payment state and links relevant webhook events to the saved order. |
| Read Refunds and Disputes | Records individual refund/dispute outcomes and their admission implications. |
| Read Events | Retrieves the signed event through the configured merchant account before accepting its association. |
| Read Webhook Endpoints for the operator verification command | Confirms an enabled snapshot endpoint with the expected URL, account/mode, and event selection. |

The runtime has no reason to receive permissions for money refunds, payouts, account changes, or Connect transfers. Creating a webhook endpoint is a separate organizer Dashboard action. If a restricted key fails, inspect the denied operation and adjust only the reviewed scope. Do not quietly replace it with an unrestricted live key. The implementation accepts mode-matching `rk_…` or `sk_…` keys; any use of an unrestricted key needs the organizer's explicit access decision.

Store the API key as **`TICKETING_API_TOKEN`** in managed Secret Manager. Create the webhook endpoint described below and store its Stripe-generated signing secret as **`TICKETING_WEBHOOK_SECRET`**. A signing secret is distinct from an API key and belongs to that endpoint and mode; do not generate an arbitrary replacement string. No publishable Stripe key is needed in this hosted flow. See Stripe's [key types](https://docs.stripe.com/keys) and [key-handling guidance](https://docs.stripe.com/keys-best-practices).

Use the approved secret-management interface or an approved secure input file to create/add a version. Do not put a secret value in a shell command, committed environment file, screenshot, issue, browser setting, or support message. The deploy workflow does not serialize Stripe secrets into public build variables or its functions environment file. Secret names and non-secret account identifiers may appear in the deployment record; values may not.

The secret writer needs permission to create/add the intended secret versions. Grant `roles/secretmanager.secretAccessor` on each payment secret to the **function runtime service account**, and retain the deploy identity's separate reference/access permissions from the deploy runbook. The repository uses the default compute runtime identity unless explicitly overridden. A successful deployment does not prove that runtime secret access works. Verify cold-start execution after the grant. Event Runner operator access alone does not grant Stripe or Google Cloud credential administration.

## 4. Create and verify the snapshot webhook

In the correct Stripe account and mode, create an enabled **snapshot** webhook endpoint for:

```text
https://<region>-<project>.cloudfunctions.net/ticketingWebhook
```

Use the actual deployed URL if the event has an approved alternative front door. Preserve the exact raw request body and `Stripe-Signature` header. Do not substitute a thin-event destination or a proxy that parses and reserializes the body. Record the endpoint's API version with the release; change it only with a compatible SDK/code review and rehearsal.

Enable the provider's current [required event list](../../functions/src/ticketing/providers/stripe.cjs):

```text
checkout.session.completed
checkout.session.expired
checkout.session.async_payment_succeeded
checkout.session.async_payment_failed
payment_intent.succeeded
payment_intent.payment_failed
payment_intent.canceled
refund.created
refund.updated
refund.failed
charge.refunded
charge.dispute.created
charge.dispute.updated
charge.dispute.closed
charge.dispute.funds_withdrawn
charge.dispute.funds_reinstated
```

Bind the generated signing secret, deploy the compatible functions, and run the existing operator command with the event's non-secret environment and secrets supplied by the approved secret manager:

```sh
node scripts/register-ticketing-webhook.cjs
```

`--callback-url` accepts an explicit HTTPS callback; `--no-write` performs verification without stamping Firestore. For Stripe, this command **verifies an existing endpoint**. It does not create the endpoint or reveal, generate, or rotate its signing secret. Success records `config/providers.ticketing.webhookRegisteredAt` and `webhookId`. It verifies configuration and the presence of a secret, not that the secret matches a delivered signature.

During the authorized rehearsal, create a test order through Event Runner and observe its actual signed delivery, accepted queue work, and final ticket state. A generic CLI fixture has no scoped Event Runner order metadata and cannot prove fulfillment. Use Stripe's resend facility on a matching test order to check replay. Confirm **Provider status**, recent delivery, pending work, and exhausted work in **Ticketing**. Registration timestamps and a green HTTP smoke check are insufficient by themselves. Stripe's [webhook documentation](https://docs.stripe.com/webhooks) explains signatures, duplicate delivery, and ordering; Event Runner reconciles authoritative state instead of trusting delivery order.

## 5. Configure and open the catalog

Open **Ticketing → Configure ticket catalog** as an operator. Set **Currency**, **Event capacity**, **Maximum tickets per order**, **Tax treatment**, event sale windows, and **Refund policy**. Currency becomes fixed when the first catalog is saved. Enter each sale window as a **Date** and a **Time** on the event's clock. The time zone comes from **Event settings**. The line under each window states it in words, with the zone and the UTC offset for that date. To end an early-bird price at 11:59 PM on January 15, enter January 15 and 11:59 PM. Select **Clear** to remove a window. A time that the clocks skip is refused, and a time that happens twice asks which one you mean. The catalog does not save until each window is complete. The stored values are UTC instants, as before.

For each ticket type, set **Ticket name**, **Price**, **Ticket-type capacity**, **Availability**, quantity bounds, and any narrower sale window. Use a separate ticket type for an early-bird price; all types still share the event capacity. A **Hidden — staff-issued only** type stays out of public purchase selection and may be used for authorized comps. Retire a saved type by clearing **Ticket type is active**; historical orders keep its identity and price.

Keep **Pause new sales** checked while setting up. Confirm the written commercial decision before checking **Commercial terms are approved for this event**. Use **Save catalog**. If another operator changed the catalog, or the save response could not be confirmed, preserve or record your intended edits, then use **Discard unsaved edits and reload catalog** before submitting against the current revision. The reload reads the saved version; a failed reload preserves the draft.

New purchases are tied to the catalog version the attendee reviewed. If prices or terms change before reservation, the page reloads the offer and requires the attendee to accept the updated refund policy before submitting again. Existing saved orders keep their original prices and terms when resumed.

Before live sales, the launch record must contain:

- The named owners, approved offer, refund policy, tax/fee decision, and completed retention schedule in section 8.
- Passing CI at the exact release commit, deployed rules/indexes/functions, runtime secret access, sender delivery, and a functioning operator notification route.
- Passing evidence from every applicable authorized Stripe rehearsal scenario in section 9, with untested or unavailable cases explicitly identified and resolved before approval.
- The correct final merchant, live mode, live credentials, endpoint, HTTPS origin, live-ready Stripe account, catalog revision, event capacity, and no copied test commerce records.
- An incident contact, pause/rollback procedure, and the organizer's explicit approval to accept real payments.

After approval, check **Publish the catalog**, save while paused, and use **Review reopening sales → Reopen new sales** with the release reason. Verify that **Get tickets** in the site header/home leads to `/tickets`, that the published offer and totals are correct, and that the workspace identifies **Live payments**. A test deployment identifies **Test mode**. Missing/unpublished catalogs, paused sales, closed windows, and exhausted capacity prevent new eligible purchases. These indicators do not replace the merchant's readiness decision.

## 6. Support the payment and the attendee separately

In **Orders**, use **Find a purchaser or order**, **Payment state**, **Refund state**, and **Search orders**. Open an order reference for **Order details**. In **Admission tickets**, use **Find an attendee or ticket** and the ticket/claim/check-in filters. **Load more orders** and **Load more tickets** continue the submitted filters; edit and submit a search to start a different result set.

Collect the order reference, ticket code where relevant, time, event/mode, and displayed error. Verify the requester through the normal account/support process. Never request card numbers, CVC, a secret key, a raw webhook body, or an authentication token. Purchaser financial details belong to the purchaser; an attendee's ticket assignment does not authorize disclosure of the rest of the order.

| Situation | Attendee or purchaser guidance | Staff/operator response |
| --- | --- | --- |
| Checkout response lost or no payment URL | Use **Resume existing checkout** on `/tickets`, or **Recover existing checkout** on the order-status page. Keep the same saved purchase. | Find the order and use **Resync this order**. A creation timeout retains capacity. Recovery uses the exact saved provider request/key; after the 23-hour safe recovery boundary, escalate the exception for reviewed resolution. Do not create a replacement payment or delete the hold to clear the screen. |
| A different device finds a purchase already in progress | Sign in as the same verified purchaser; the site opens that purchaser's existing order. | Confirm ownership and the existing reference. Possession of an order ID or Checkout Session ID is not authorization. |
| Card declined while the order is still pending | Use **Continue your existing Stripe checkout** to try again within that Session. | A failed payment attempt does not close an open Session or free its reserved seats. Do not tell the purchaser to start another order. |
| Returned from Stripe, closed the window, or status is pending | Use **Check payment status** and allow confirmation to finish. A return link is not a receipt or admission. | Compare the order with **Open this payment in Stripe Dashboard**, then **Resync this order**. Check delivery and queue health. Processing/conflicting evidence retains capacity and may require operator review. |
| Order is expired | After server-confirmed closure, **Choose tickets for a new order** starts a new selection. | Reconciliation releases a held seat once only after authoritative expiry with no payment still able to complete. Browser time, a cancel redirect, or an expired worker lease cannot release it. |
| Paid/free order but recipient cannot claim | The recipient uses `/ticket/claim` with the order reference and the verified email assigned to that seat; then **View and print your tickets** opens `/tickets/mine`. | Check each seat's assignment and current validity. Use **Correct attendee** for a spelling/address correction on an unused, unclaimed ticket. Claimed or checked-in tickets allow name correction only. There is no in-app transfer workflow. |
| Confirmation did not arrive or the send outcome is uncertain | The purchaser can still open their order status; a claimed attendee can open **Your tickets**. | Check **Email log**, provider delivery/suppression, and recipient spelling before **Resend ticket confirmation**. A retry of the same resend request uses the same key. Investigate an uncertain send before intentionally issuing another resend. Payment receipts are managed by Stripe; Event Runner sends ticket/claim messages. |
| Attendee cannot attend; no money action approved | Explain the event's refund policy before changing admission. | Select the exact tickets, use **Review ticket cancellation**, read the order/amount/admission warning, add a reason, and confirm. Cancellation removes admission without sending money or restocking. Used tickets require an operator. |
| Full money refund approved or observed | Refer payment timing/questions to the organizer's finance contact. | The authorized organizer issues the refund in Stripe Dashboard. Use **Resync this order** and inspect **Refund history**. A succeeded full refund invalidates all seats; pending/failed refunds do not prove that money was returned. |
| Partial money refund succeeded | Explain which admission, if any, changes under the organizer's decision. | An operator selects **Refund to allocate** and affected tickets, or explicitly checks **Keep every ticket valid** for a price adjustment. Use **Review refund allocation**, provide a reason, and confirm. No refund money is created here, and no admission is guessed from an amount alone. |
| Refund pending, requires action, failed, or canceled | Avoid promising completion until the provider confirms it. | Inspect the individual refund state in Stripe Dashboard and the order, resync after correction, and resolve any exception. These states do not automatically remove valid tickets. |
| Payment disputed | Direct payment-case correspondence to the authorized merchant contact. | Review **Payment disputes**, respond in Stripe Dashboard, and record an explicit admission decision under event policy. A dispute does not silently cancel admission or authorize an in-app payout action. |
| Duplicate, invalid, or mistaken check-in | Present the human-readable ticket code; online validation remains authoritative. | Use **Ticket code for check-in → Check in attendee**. An already-used result does not create another check-in. An operator can use **Review check-in correction → Undo recorded check-in**, with a reason. Investigate an invalid ticket before admission. |
| Complimentary admission approved | Each named recipient still needs to claim with their verified email. | An operator opens **Issue complimentary admission**, supplies attendee details/reason, then **Review complimentary tickets** and the final issue confirmation. Comps consume real capacity. Retry a failed confirmation with its saved request; after a lost response or reload, inspect orders before intentionally issuing another comp. |
| Queue exhausted, conflicting amount/currency/account, or unresolved exception | Ask the purchaser to wait for the named support contact rather than paying again. | Pause new sales if the fault is systemic. Inspect the redacted exception, provider state, and audit trail; preserve the business records and alert evidence. Resync only after correcting the cause. Do not set paid/valid flags or inventory counters by hand. |

Public purchasers can have one unresolved reserved order and create at most five new orders per hour; retries are exempt. A rate-limit refusal creates no new order. Explain the cooldown and preserve an already-known order rather than using another account to bypass the limit.

Original order amounts remain historical financial facts after cancellation, refund allocation, or attendee correction. A cancelled/refunded seat remains sold for capacity purposes in this MVP. Locally removed admission is not revived by later provider delivery. Account approval granted or revoked explicitly by an admin retains its existing precedence over ticket-derived approval.

## 7. Pause, rotate credentials, and recover safely

For an incident or planned maintenance, use **Review pausing sales → Pause new sales**, enter the reason, and confirm. This stops new purchases. Existing Checkout Sessions may still complete; signed webhooks, the existing queue worker, reconciliation, email, order status, and check-in must remain available.

Rollback to a compatible build that still understands the saved Stripe order/attempt schema. Keep `EVENT_TICKETING_PROVIDER=stripe`, the same merchant/event/mode, secrets, endpoint, and durable records while obligations remain. Reverting to a build without the adapter, switching to `none` or Eventbrite, deleting the queue, clearing inventory, or changing event identity does not cancel payments. Before reopening, resolve every affected hold/payment, confirm queue health and notifications, reconcile a known order, and record the recovery decision.

Historical-demo mode freezes ticketing writes, including webhook intake and reconciliation. Do not use it to pause sales. Enable it only after accepted payment, refund, dispute, and support obligations are settled. Use the sales-pause control while existing payments still need to converge.

For a routine API-key rotation, create a replacement with the same reviewed account/mode/scope, save a new `TICKETING_API_TOKEN` version, redeploy every function that binds it, and verify successful account/Session/financial reads before retiring the previous key. Coordinate overlapping function revisions with the organizer's key-expiry schedule. Stripe's [API-key rotation procedure](https://docs.stripe.com/keys#rolling-keys) describes the current Dashboard options. If compromise is suspected, revoke the exposed key through the organizer's incident procedure immediately and accept a paused-sales outage while replacement access is restored.

For a webhook-secret rotation, the organizer uses the endpoint's **Roll secret** action. Stripe supports an overlap in which it signs with both active secrets. Bind the new value to `TICKETING_WEBHOOK_SECRET`, redeploy every consumer, verify a real matching signed delivery, and retire the old secret after all consumers have moved within the chosen overlap. The application validates one configured secret per instance; old and new instances can coexist only while Stripe supplies valid signatures for each. Keep reconciliation running and request provider redelivery for any missed events after recovery. See [Stripe's signing-secret rotation guidance](https://docs.stripe.com/webhooks#roll-endpoint-secrets).

Record the credential owner, secret version identifiers, scope review, deployment commit, verification time/result, and old-key retirement time. Never record the values. Test keys, live keys, and endpoint secrets are separate; rotating one is not evidence that the others changed.

## 8. Complete a retention schedule before live sales

The organizer must supply a written **duration, unit, start trigger, owner, exception/legal-hold process, and deletion or minimization method for each category** below. Blank entries, “keep as needed,” or one blanket order TTL do not satisfy launch readiness. Agree the durations with the organizer's records/privacy advisers; this repository does not select an accounting or legal retention period for them.

| Category | Required duration decision | Current behavior and constraints |
| --- | --- | --- |
| Financial order facts and minimal provider/uniqueness IDs | `___ years after ___`; finance/records owner | No automatic commerce purge. Preserve unresolved payment/refund/dispute obligations and required history. Never remove the durable order uniqueness guard merely because a short-lived webhook record expired. |
| Attendee names/emails, seat assignments, and claim/check-in history | `___ days/months after ___`; event/data owner | Private operational records remain after account deletion. Approve a scoped correction/minimization procedure that respects business obligations and access/audit consistency. |
| Payment-attempt parameters, return/Checkout URLs, and creation evidence | `___ hours/days after resolution`; operator with records owner | Preserve unresolved recovery evidence. The 23-hour safe creation-retry boundary is not permission to delete an unresolved attempt. After the approved interval, review minimization of expired URLs/PII while retaining replay-safe identifiers. |
| Webhook deduplication receipts | `___ days after receipt`; operator | Confirm the actual deployed TTL/maintenance policy. This feature adds no blanket receipt purge. Receipt removal must not make an old payment create a new ticket or erase order uniqueness. |
| Pending/exhausted reconciliation and incident evidence | `___ days after reviewed resolution`; operator | Active queue work must remain until resolved; exhausted work remains for diagnosis. Preserve incident evidence while an obligation or hold is open. |
| Organizer audit history | `___ years/months after action or event closure`; records owner | Actor, time, affected IDs, and reason remain private. No new audit purge is supplied. Avoid attendee details in free-text reasons unless necessary. |
| Sent-email delivery log | Confirm the existing **90 days after sending**, or commission a reviewed policy change; email/records owner | Existing scheduled maintenance removes old sent-email rows. Ticket email bodies are not retained. This does not erase the order, ticket, provider receipt, or organizer audit. |
| Stripe-side payment/receipt records and support exports | Written merchant policy for each system/copy; finance/data owner | The organizer controls Stripe and any approved export. Event Runner account deletion does not delete those records. |

Account deletion releases ticket claims and removes the account's documented profile/access data; it is not represented as erasure of a purchase. Before any maintenance deletion, inventory unresolved obligations, identify holds/exceptions, verify backup and audit implications, define scope, and obtain the records owner's approved procedure. No generic retention job is added by this feature. Record when the schedule will next be reviewed.

## 9. Keep CI evidence and Stripe rehearsal evidence separate

Credential-free tests use synthetic identities, fake provider responses, and emulator sign-in. They cover catalog validation, forged prices/ownership, capacity races, stable recovery IDs, signed-payload/replay handling, reconciliation/refund invariants, role gates, verified claims, demo restrictions, and UI behavior. The browser suite `e2e/stripe-ticketing-ui.spec.js` captures ticket selection, confirmation/print, and organizer dialogs at desktop, phone, and narrow widths under `test-results/admin-visual-evidence`. These tests make no real Stripe call and do not establish merchant readiness.

A separately authorized rehearsal against the organizer's Stripe sandbox must record the release commit, test account/mode, catalog revision, synthetic order references, each scenario's result, responsible reviewer, and redacted evidence:

| Rehearsal | Evidence to collect |
| --- | --- |
| Ordinary purchase, free order, and comp | Correct amounts/currency; one ticket per seat; no Stripe payment for free/comp; accurate inventory and recipient assignment. |
| Authentication/3DS and decline | Actual hosted provider behavior; a failed attempt resumes the same open Session without duplicate holds or charges. |
| Lost create response, reload, and another device | One durable attempt/order, exact saved-request recovery, and preserved capacity; purchaser ownership remains enforced. |
| Redirect before webhook, duplicate/reordered delivery, and replay | No admission from the return URL; authoritative final state; stable ticket IDs; no repeated capacity transition or claim. |
| Expiry and unresolved payment | Provider-confirmed expiry releases once; processing/unknown/conflicting state retains a hold and produces the expected support exception. |
| Full/partial refunds and pending/failed/requires-action states | Individual provider refund facts; full refund invalidation; explicit partial-refund admission choice; no false invalidation or restocking. Mark any provider state that cannot be induced as unrun and resolve that evidence gap before launch approval. |
| Disputes and operator notification | Merchant-case handoff, visible redacted exception, notification receipt, and no automatic admission cancellation. |
| Claim, group recipients, corrections, and email | Verified attendee isolation, purchaser-only financial details, one-person print view, protected claimed/used email, actual managed-email delivery, and a distinct Stripe payment receipt. |
| Sales pause, compatible rollback, and rotation | Existing Sessions still reconcile while intake is closed; new credentials verify correctly; missed delivery can be recovered without duplicate admission. |
| Check-in and correction | Online duplicate detection, invalid-ticket handling, operator-only undo, and audit evidence. |

**No real Stripe rehearsal is supplied by this implementation's synthetic test results.** Do not mark an unrun scenario passed or infer live readiness from a screenshot, a webhook registration stamp, or a successful build. Keep card data, secrets, raw provider payloads, and identifiable purchaser details out of PR artifacts. Live charges or refunds require their own organizer authorization; test-mode rehearsal permission does not authorize them.

## Source of truth

- [ADR 0004](../adr/0004-stripe-ticket-commerce.md): decision, invariants, commercial boundaries, and follow-on scope.
- [Admin guide: Ticketing](../ADMIN_GUIDE.md#ticketing): day-to-day controls and roles.
- [Deployment runbook](../DEPLOY_RUNBOOK.md): project provisioning, IAM, secret bindings, release workflow, and rollout.
- [Stripe adapter](../../functions/src/ticketing/providers/stripe.cjs), [checkout](../../functions/src/ticketing/stripeCheckout.cjs), and [reconciliation](../../functions/src/ticketing/stripeReconcile.cjs): required provider operations and recovery behavior.
- [Stripe API keys](https://docs.stripe.com/keys), [restricted keys](https://docs.stripe.com/keys/restricted-api-keys), [key handling](https://docs.stripe.com/keys-best-practices), and [webhooks](https://docs.stripe.com/webhooks): provider-owned credential and delivery procedures.
