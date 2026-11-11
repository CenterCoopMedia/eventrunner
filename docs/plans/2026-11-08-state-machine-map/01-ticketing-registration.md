# Ticketing, registration, payments, invoices, promo codes, attendee/user lifecycle

Scope read: functions/src/ticketing/** (incl. providers/), functions/src/admin/invoice*.cjs, functions/src/users/**, functions/src/auth/**, packages/shared/src/{registration,registrationForm,invoice,promoCodes,ticketCommerce}.cjs, apps/web/src/lib/{ticketClaim,ticketingCommerce,registrationAnswersApi,registrationFormSource,accountViews}.js, firestore.rules, ADR 0004, docs/operator/stripe-ticketing.md. Some client copies (pages/components) were followed where they duplicate a lifecycle. `shared/answers.cjs` is the provisioning-answers file and `shared/badges.cjs` holds no lifecycle. Neither has a state machine.

---

## 1. Account registration status  (explicit)
- Entity / storage: `users/{uid}.registrationStatus`, `approvalSource` (`'admin' | 'ticket' | null`) and server-owned `revocationReason` (`'entitlement_lost' | 'admin_revocation' | null`). Vocabulary and transitions live in packages/shared/src/registration.cjs.
- States: `pending`, `ticketed`, `approved`, `revoked` (+ no document = account missing).
- Transitions:
  - (none) -> pending: auth onCreate, functions/src/users/lifecycle.cjs:68,103. The same doc is also seeded by createUserFromTicket at functions/src/ticketing/registration.cjs:396-398, which reuses `buildNewUserDoc`.
  - pending -> ticketed (`ticket_claimed`): applyTicketClaimToUser functions/src/ticketing/registration.cjs:78-80, and again recomputeEntitlement functions/src/ticketing/entitlement.cjs:197-199. Guard: shared table.
  - ticketed -> approved (`auto_approve`, approvalSource `ticket`, needs `config/features.autoApproveTicketHolders` and a paid seat): registration.cjs:81-84 and entitlement.cjs:200-203. Paid-seat check is at entitlement.cjs:136-147.
  - pending|ticketed -> approved (`admin_approval`), revoked -> approved (`admin_reapproval`), approved(source ticket) -> approved(source admin) re-pin: functions/src/users/approval.cjs:89-113.
  - approved -> ticketed (`auto_approval_disabled`, which also fires when only a free ticket remains): entitlement.cjs:188-192.
  - ticketed|approved -> revoked (`entitlement_lost`): entitlement.cjs:212-220. (`admin_revocation`): approval.cjs:155-166.
  - revoked -> ticketed (`ticket_restored`): a valid claimed ticket returns and `revocationReason` is `entitlement_lost`. Both the claim and entitlement transactions enforce the reason; the current automatic-approval policy may then approve a paid ticket holder. Ticket recovery clears the reason.
  - revoked(entitlement_lost) -> revoked(admin_revocation): an organizer selects Revoke access on a Ticket access ended row. New tickets cannot undo this explicit decision.
  - a `pending_info` ticket holds the current state (`held`): entitlement.cjs:205-210.
- Terminal states / reversibility: Explicit or unclassified revocation requires admin re-approval. Only `revocationReason: 'entitlement_lost'` can recover from a valid ticket.
- Other copies of this lifecycle:
  - firestore.rules:449-454 `requesterIsApprovedAttendee` reads `'approved' || speakerId`. shared `hasAttendeeAccess` (registration.cjs:79-84) also admits `role` admin. functions/src/core/auth.cjs:450-455 bridges the gap by spoofing `role:'admin'`, so they agree in effect but not textually.
  - The status list is restated, not imported, at functions/src/users/export.cjs:70 (`STATUS_FILTER_VALUES`), apps/web/src/admin/pages/AdminAttendees.jsx:81-94 (filters + labels), apps/web/src/components/ProfileSidebar.jsx:28-33, apps/web/src/admin/pages/AdminAttendees.jsx:109-114 (which actions are allowed, hand-coded), apps/web/src/lib/accountViews.js:10, and functions/src/announcements/audience.cjs:10-13,88. All agree today. eventStats imports the shared list (functions/src/admin/eventStats.cjs:57,75).
- Problems:
  - **Two writers implement the promotion half of the machine.** applyTicketClaimToUser (registration.cjs:57-91) and recomputeEntitlement (entitlement.cjs:149-233) both do pending->ticketed->approved. They differ: only recompute demotes approved->ticketed when auto-approve is off or only free seats remain. Only recompute applies the `pending_info` hold. The claim's own ticket write (registration.cjs:156) then fires onTicketWritten (entitlement.cjs:311-333), which runs recompute anyway, so the claim-side copy is redundant.
  - The trigger name `auto_approval_disabled` is reused for "only a free ticket is left" (entitlement.cjs:188), so the table's trigger vocabulary no longer describes the cause.

## 2. Ticket admission status  (explicit)
- Entity / storage: `tickets/{externalId}.status`. Defined at functions/src/ticketing/index.cjs:35 (`TICKET_STATUSES`), which lives in functions only. There is no shared definition.
- States: `valid`, `refunded`, `cancelled`, `pending_info`. Any unknown value normalizes to `pending_info` (functions/src/ticketing/sync.cjs:90).
- Transitions:
  - created: provider upsert sync.cjs:132-141. Stripe free/comp creates `valid` at functions/src/ticketing/stripeCommerce.cjs:225 via stripeCheckout.cjs:355. Stripe paid creates on reconcile at stripeReconcile.cjs:277-289. Manual CSV goes through upsertTickets (functions/src/ticketing/csvImport.cjs:284). Status mapping for providers: eventbrite.cjs:358-362, csvImport.cjs:60-65,117-125.
  - valid|pending_info -> refunded|cancelled: provider upsert (sync.cjs:143-146). Stripe reconcile `admissionStatus` (stripeReconcile.cjs:158-165). Staff cancel/allocate (functions/src/ticketing/commerceAdmin.cjs:321-328; operator required for checked-in tickets, :301).
  - cancelled -> refunded: allowed by allocateRefund (commerceAdmin.cjs:323).
  - refunded|cancelled -> valid|pending_info: blocked by sync.cjs:144-145 and stripeReconcile.cjs:15,159.
- Terminal states / reversibility: `refunded` and `cancelled` are terminal against provider writes. No admin "restore" exists.
- Other copies of this lifecycle: the terminal set is defined twice, at sync.cjs:144 (inline lambda) and stripeReconcile.cjs:15 (`TERMINAL_TICKET_STATES`). They agree. Client copies of the value list: apps/web/src/admin/components/StripeTicketList.jsx:60, apps/web/src/admin/pages/AdminTicketing.jsx:406-411, apps/web/src/admin/overview/EventFigures.jsx:66, apps/web/src/lib/ticketingCommerce.js:130. All agree. A mirror is kept in `ticket_answers.ticketStatus` (see 10).
- Problems:
  - An allocated refund writes `cancelledAt`/`cancelledByUid`/`cancellationReason` on a `refunded` ticket (commerceAdmin.cjs:325-326). The field names say "cancelled" for both outcomes.
  - Stripe never produces `pending_info`. It is only an Eventbrite/manual/CSV state.

## 3. Ticket claim  (implicit)
- Entity / storage: `tickets.claimedByUid` + `claimedAt` (+ `claimPromptSentAt`).
- States: unclaimed (`claimedByUid:null`) -> claimed(uid) -> unclaimed (released).
- Transitions:
  - unclaimed -> claimed: claimTicket functions/src/ticketing/registration.cjs:104-195. Guards: valid status (:126), email match (:119), account exists (:128).
  - claimed -> unclaimed: deleteAttendee phase 1 (functions/src/users/records.cjs:384-387) and its sweep (records.cjs:483-497). Both clear only `claimedByUid` and `claimedAt` (records.cjs:119).
  - Reassignment of a claimed ticket is refused (commerceAdmin.cjs:253-255).
- Terminal states / reversibility: reversible only through account deletion.
- Problems:
  - **The Firebase Auth delete trigger does not release claims.** onUserDeleted (functions/src/users/lifecycle.cjs:146-162) deletes `users`, `users_public` and `schedule_shares` only. It leaves claims, `ticket_answers`, notes and photos. An account removed from the Auth console therefore leaves tickets claimed by a dead uid, and claimTicket answers `claimed_by_other` for good (registration.cjs:115). The operator doc says account deletion releases claims (docs/operator/stripe-ticketing.md:205). That holds only for the deleteAttendee path.
  - **`claimPromptSentAt` is a dead field.** It is initialized to null at sync.cjs:137, stripeCommerce.cjs:229 and imports/registrationImport.cjs:173, and copied at stripeReconcile.cjs:285. Nothing ever sets it. Send-once is done by the email onceKey instead (registrationPrompt.cjs:201-213). Release does not clear it either (records.cjs:119).

## 4. Ticket check-in  (implicit)
- Entity / storage: `tickets.checkedInAt` / `checkedInByUid`.
- States: not checked in (null) <-> checked in (timestamp).
- Transitions: check in at commerceAdmin.cjs:432-438. Guard: ticket `valid` + order `inventoryState==='sold'` + `paymentStatus==='succeeded'` + account not `revoked`. Undo (operator, reason) at commerceAdmin.cjs:426-430. Repeat scan returns `already_checked_in` (:434).
- Terminal states / reversibility: reversible by an operator.
- Problems: Stripe only (commerceAdmin.cjs:405). Undo does not re-check ticket validity. The check-in guard re-derives "paid" from two order fields (see cross-cutting 3).

## 5. Stripe order status  (explicit, plus 3 parallel fields)
- Entity / storage: `ticket_orders/{id}`: `status`, `paymentStatus`, `inventoryState`, `refundStatus`, `reconciliationException`, `reconciliationLease`, `statusRefreshAfter`. Created at functions/src/ticketing/stripeCheckout.cjs:301-322.
- States:
  - `status`: `pending`, `free`, `paid`, `expired`, `refunded`, `exception` (+ `cancelled`, read but never written).
  - `paymentStatus`: `pending`, `succeeded`, `unpaid`, `failed`, `expired`.
  - `inventoryState`: `held`, `sold`, `released`.
  - `refundStatus`: `none`, `partial`, `full`, `pending`, `requires_action`, `failed`.
- Transitions:
  - create: paid -> pending/pending/held; free or comp -> free/succeeded/sold (stripeCheckout.cjs:309-310).
  - pending -> exception: recoverCheckoutAttempt after 23h (stripeCheckout.cjs:409-419) or on a Session mismatch (:460-467). Also ReconciliationMismatch via finishException (stripeReconcile.cjs:176-187,305-309), which writes `exception` only when `paymentStatus !== 'succeeded'` (:184).
  - pending|exception -> paid|free|expired|pending, and -> refunded (sticky): financialPatch stripeReconcile.cjs:139-146. Paid after released capacity -> exception (:263-266).
  - inventory held -> sold|released: inventoryTransitionPatch stripeCommerce.cjs:115-132 (guard: only from `held`).
  - refundStatus derived each reconcile: stripeReconcile.cjs:114-124.
- Terminal states / reversibility: `refunded` is sticky (:145). `expired`+`released` is final. `exception` is not terminal: the next successful reconcile recomputes `status` from scratch (:140) and resets `reconciliationException` to null unless re-derived (:118).
- Other copies of this lifecycle:
  - apps/web/src/pages/TicketStatus.jsx:16-17,41-45 (`COMPLETE={paid,free}`, `TERMINAL={failed,expired,cancelled}`, showTickets list). Differs: it lists `failed` and `cancelled`, which an order never takes.
  - apps/web/src/lib/ticketingCommerce.js:200-215 labels `processing`, `complete`, `completed`, `fulfilled`, `refunded_partial` and underscore audit names (`catalog_saved`, `comp_issued`...). The server never emits these. The live audit labels are a separate map at apps/web/src/admin/components/StripeOrderDetail.jsx:47-59.
  - Admin filter value lists at apps/web/src/admin/components/StripeTicketList.jsx:56-57 agree with the server.
- Problems:
  - **Dead state `cancelled` on orders.** It is read at stripeReconcile.cjs:146,160, but nothing writes it: cancelTickets changes tickets only (commerceAdmin.cjs:321-329). Order status `failed` is likewise never set. Only `paymentStatus` reaches `failed` (stripeReconcile.cjs:143), and the order then stays `pending`.
  - **`exception` has no operator exit.** commerceAdmin offers no resolve action (ACTIONS at commerceAdmin.cjs:19-22). `checkout-outcome-unknown` orders keep `status==='exception'`, no session and `inventoryState:'held'`. recoverCheckoutAttempt returns early because `status!=='pending'` (stripeCheckout.cjs:399). Such an order leaves `exception` only if a webhook attaches a Session id (providers/stripe.cjs:276-295). The runbook says "resolve any exception" (docs/operator/stripe-ticketing.md:151,155), but no code path does it.
  - **An exception order with held inventory blocks its purchaser for good.** The purchaser pointer lock refuses any new order while the previous order is `held` (stripeCheckout.cjs:254-258), and nothing releases it.
  - `reconciliationException` and `status==='exception'` encode the same fact inconsistently. Refund-allocation, dispute and refund-attention exceptions leave `status` at `paid` (stripeReconcile.cjs:125-137). The purchaser UI keys off `status` (TicketStatus.jsx:43), while admin keys off `reconciliationException` (commerceAdmin.cjs:95-97).
  - Admins cannot filter orders by `status` or exception. matchesFilters supports paymentStatus and refundStatus only (commerceAdmin.cjs:183-186).
  - The "checkout-outcome-unknown" message string is duplicated at stripeCheckout.cjs:413-414 and stripeReconcile.cjs:221-222.

## 6. Stripe payment attempt  (explicit)
- Entity / storage: `ticket_payment_attempts/{attemptId}.state`, leased by `leaseToken`/`leaseUntil`/`retryNotBefore`. Created at stripeCheckout.cjs:326-332.
- States: `prepared`, `succeeded` (free orders), `creating`, `unknown`, `created`, `exception`.
- Transitions:
  - prepared|unknown -> creating: lease taken at stripeCheckout.cjs:422-427 (guard: no live lease, backoff elapsed, age < 23h).
  - creating -> unknown on a lost answer (:454-458), -> created (:476), -> exception (:466).
  - any -> exception at 23h (:418).
- Terminal states / reversibility: `created`, `exception` and `succeeded` are final. Nothing later reflects the payment outcome.
- Problems:
  - **The webhook recovery bypasses the attempt machine.** It writes `stripeSessionId` on the order and the attempt but leaves `state` at `creating` or `unknown` (providers/stripe.cjs:293-294). The order's `checkoutUrl` also stays null.
  - The attempt row for a free order (state `succeeded`, `stripeRequest:null`) is never read.

## 7. Ticket sync queue row  (explicit + lease)
- Entity / storage: `ticket_sync_queue/{orderId}.status` (functions/src/ticketing/index.cjs:31-32), plus `attempts`, `paymentChecks`, `readyAt`, `leaseId`/`leaseExpiresAt` and `generation`.
- States: `pending`, `exhausted`, (deleted = done).
- Transitions:
  - (none)|pending|exhausted -> pending: webhook claimAndEnqueue functions/src/ticketing/webhook.cjs:146-160. It re-arms `exhausted` and bumps `generation`. A Stripe reservation creates the row at stripeCheckout.cjs:347-353.
  - pending -> leased: sync.cjs:213-230.
  - leased -> deleted (complete) at sync.cjs:384; -> pending with backoff at :334,:358-361,:372; -> exhausted at :305-319 (6 attempts, or 48 payment checks).
  - A generation mismatch on finish keeps the work at sync.cjs:238-243.
- Terminal states / reversibility: `exhausted` is kept for forensics until the next delivery re-arms it.
- Other copies of this lifecycle: `exhaustRow` (sync.cjs:183-210) is an unfenced duplicate of the inline `exhaust` closure (:305-319). It is exported only via `internals` (:530) and is dead in production.
- Problems: a Stripe reservation's `tx.create` of the queue row (stripeCheckout.cjs:347) omits `generation`. finishQueueRow treats it as 0 (sync.cjs:238), which is safe but implicit.

## 8. Webhook delivery dedup  (implicit)
- Entity / storage: `ticket_webhook_deliveries/{deliveryId}`. Presence = processed. Written with `tx.create` in the same transaction as the queue row (webhook.cjs:135-141) or the invoice step (functions/src/admin/invoicePayLink.cjs:538).
- States: absent -> claimed. A duplicate create fails and maps to `duplicate` (webhook.cjs:81-86,165; invoicePayLink.cjs:663-665).
- Problems: none in-area. Two different writers share one collection, with different `eventType` vocabularies (`order.*` and `invoice.checkout`).

## 9. Inventory, purchaser and free-seat guards  (implicit)
- Entity / storage: `ticket_inventory/current {held, sold, types{}}` (stripeCommerce.cjs:76-108). Also `purchaser_<hash> {orderId, windowStart, ordersInWindow}` (stripeCheckout.cjs:223,343), `free_budget_<hash> {allocated}` (:282,299,334) and `free_recipient_<hash>` (:287,335).
- States:
  - held/sold counters move with the order's `inventoryState`.
  - Purchaser lock = "referenced order is `held`" (:246-260).
  - Free budget and recipient: monotonic, never released (ADR 0004 and docs/operator/stripe-ticketing.md:129 say this is intentional).
- Problems: the lock state is derived from another document, so an order stuck `held` (see 5) also leaves the purchaser locked. The purchaser rate window is one of four separate fixed-window limiters (see cross-cutting 7).

## 10. Registration answers custody  (implicit, document moves between collections)
- Entity / storage: `ticket_orders.seats[].answers` (stripeCheckout.cjs:269-272), `ticket_answer_holds/{ticketId}` (import), `ticket_answers/{ticketId|account-uid}` (functions/src/ticketing/ticketAnswers.cjs:32-35).
- States: on-seat | held -> recorded (`ticket_answers`), or dropped.
- Transitions:
  - seat -> ticket_answers at claim (registration.cjs:157-181). Privacy keys are stripped (:162-163).
  - hold -> ticket_answers at claim, and the hold is deleted (:182-192).
  - seat answers are dropped on an attendee email change (commerceAdmin.cjs:260-266).
  - ticket_answers is saved by its holder until the event phase closes (ticketAnswers.cjs:37,144-146) and removed by the deleteAttendee sweep (records.cjs:143).
  - `ticketStatus` is mirrored by syncAnswerStatus (ticketAnswers.cjs:174-189). A deleted ticket reads as `cancelled`.
- Other copies of this lifecycle: `ticketStatus` is written at claim (registration.cjs:170,188), at save (ticketAnswers.cjs:81,91) and by the trigger. The counting rule is in shared registrationForm.cjs:406-409 (`undefined || 'valid'`). firestore.rules:819-822 allows reads only.
- Problems:
  - `ticket_answers.ticketStatus` duplicates `tickets.status` and is kept in step by trigger (two fields, one fact).
  - `CLOSED_PHASES` (ticketAnswers.cjs:37) hard-codes event-phase names instead of importing them from shared config.
  - onUserDeleted does not remove `ticket_answers` (see 3).

## 11. Promo code  (explicit flag + derived window + counter)
- Entity / storage: `ticket_promo_codes/{CODE}` with `active`, `startsAt`, `endsAt`, `used`, `maxUses` and `maxPerOrder` (packages/shared/src/promoCodes.cjs:14,33-67).
- States (derived): inactive | scheduled | open | ended | exhausted (shared promoCodes.cjs:84-99). Deleted only when `used===0` (functions/src/ticketing/promoCodes.cjs:126-128).
- Transitions:
  - `used += seats` in the reservation transaction (stripeCheckout.cjs:337-339).
  - `used -= seats` only when an expired hold is released (stripeReconcile.cjs:247-248,261,293; promoCodes.cjs:29-33).
  - A save preserves `used` (promoCodes.cjs:108-111).
- Problems: an order stuck in `exception`/`held` keeps its promo use forever (no release path, as for inventory in 5). The guard on the check budget is a separate limiter (promoCodes.cjs:41-58).

## 12. Catalog sales availability  (implicit, flags combine)
- Entity / storage: `ticket_catalog/current {published, salesPaused, commercialTermsConfirmed, salesStartAt/EndAt, revision}`, per-type `active`/`visibility`/window, and `ticket_catalog/connection {ended}`.
- States: closed (unpublished or unconfigured), paused, window closed, sold out, open (stripeCheckout.cjs:142-171; priceSelections at stripeCommerce.cjs:156-164). Paid-only closed when `connection.ended` (stripeCheckout.cjs:151,266).
- Transitions:
  - publish/edit through saveCatalog with an optimistic `revision` (commerceAdmin.cjs:137-164).
  - pause/resume, which bumps `revision` (:166-180).
  - `connection.ended=true` on a Stripe 401 (stripeCheckout.cjs:441).
- Problems:
  - `connection.ended` is one-way in code. Re-opening means deleting the document by hand (docs/DEPLOY_RUNBOOK.md:1402).
  - pause/resume bumps the catalog `revision` (commerceAdmin.cjs:176), so a buyer mid-checkout gets `catalog-changed` (stripeCheckout.cjs:241) even though prices did not change.

## 13. Order reconciliation lease / status refresh  (implicit locks)
- Entity / storage: `ticket_orders.reconciliationLease {id, expiresAt}` (stripeReconcile.cjs:201-202,294,314) and `statusRefreshAfter` / `reconciledAt` (stripeCheckout.cjs:553-554).
- States: free -> leased -> free.
- Problems: one order carries three leases: the queue lease (sync.cjs:225), the attempt lease (stripeCheckout.cjs:425) and the reconcile lease (stripeReconcile.cjs:202). Each has its own TTL (5 min, 30 s, 5 min).

## 14. Invoice status  (explicit)
- Entity / storage: `invoices/{id}.status`, defined at packages/shared/src/invoice.cjs:48. Reads normalize unknown values to `draft` (functions/src/admin/invoices.cjs:120-122).
- States: `draft`, `issued`, `paid`, `void` (+ deleted draft).
- Transitions:
  - create draft at invoices.cjs:386; delete draft at :418 (guard: draft + revision).
  - draft -> issued at :468,513.
  - issued -> paid by hand at :549,559 (guard: not sending, :551). issued -> paid by Stripe webhook at functions/src/admin/invoicePayLink.cjs:638-650.
  - issued|paid -> void (operator) at invoices.cjs:601-612.
  - paid -> issued reopen (operator; payment moves to `paymentHistory`) at :645-657.
  - duplicate -> new draft at :706.
- Terminal states / reversibility: `void` is terminal. `paid` is reversible by reopen.
- Other copies of this lifecycle:
  - linkRefusal reads raw `stored.status` with no `statusOf` (invoicePayLink.cjs:207-212).
  - apps/web/src/admin/pages/InvoiceRecord.jsx:347-387 holds the button guards.
  - There is no transition table. Each action hand-checks its from-state.
- Problems:
  - **`statusOf` defaults unknown values to the most permissive state.** A corrupted status reads as `draft`, which is editable and deletable (invoices.cjs:121,397,416). Elsewhere in the same file, unknown send states default to `uncertain` (:216) and unknown pay-link states to `failed` (:233).
  - **The webhook payment skips the central helper.** applyInvoiceCheckout writes `status:'paid'` directly (invoicePayLink.cjs:638-650). markPaid's `refuseWhileSending` guard (invoices.cjs:202-207) does not run, so an invoice email reserved at that moment can state the old status.

## 15. Invoice pay link  (explicit, array element)
- Entity / storage: `invoices.payLinks[]` `.status` (shared invoice.cjs:59-73).
- States: `creating`, `open`, `paid`, `expired`, `cancelled`, `failed`. `closedReason` is one of `replaced`, `paid`, `void`, `suspended`, `ended`, `no-answer`, `mismatch`, `refused`, or an invoice status.
- Transitions:
  - (new) -> creating at invoicePayLink.cjs:359-365 (guard: issued, no open review, < 25 links, :325-330,356).
  - creating -> open (:428), -> failed (no-answer :350-353, mismatch :410-415, refused :453-462), -> cancelled (race :418-424).
  - open -> expired: settleEnded (:295-302) and the webhook (:563-566). open -> cancelled: replace (:342), void or markPaid (:237-250), suspended (:600-605) or paid-elsewhere (:630-636).
  - any -> paid when a payment lands on it (:590-594), including `cancelled`, `expired` and `failed`.
- Terminal states / reversibility: everything except `creating`/`open` is meant to be terminal, but every state can still become `paid` (:591).
- Other copies of this lifecycle: "is the link usable now" is computed in three places: server currentPayLink (invoicePayLink.cjs:143-151), client openPayLink (apps/web/src/admin/pages/InvoiceCardPayment.jsx:68-80) and settleEnded (:295). A stored `open` past its `expiresAt` stays `open` until one of those runs or Stripe sends an expiry.
- Problems:
  - The creating->failed (no-answer) branch deletes `request` but keeps `idempotencyKey` (invoicePayLink.cjs:350-353). ADR 0004:241-242 says both are kept only while `creating`.
  - `stripeClosed`/`stripeCheckedAt` (:285-286) is a second, best-effort sub-state on cancelled links.

## 16. Invoice payment review  (implicit)
- Entity / storage: `invoices.paymentReviews[] {resolved}` + `system_errors/invoice_review_<hash> {resolved}` (invoicePayLink.cjs:612-622,688-697).
- States: open (`resolved:false`) -> resolved.
- Transitions: flagged in the webhook transaction (:609-622). Resolved by an operator with a note, which also closes the alert (:487-497). An open review blocks new links (:327-329).
- Problems: the same fact is stored twice (review entry + system_errors row), kept in step only by resolvePaymentReview. Resolving the alert from the System errors page would leave the review open.

## 17. Invoice email send  (explicit)
- Entity / storage: `invoices.sends[].status` (functions/src/admin/invoices.cjs:186; functions/src/admin/invoiceEmail.cjs:101).
- States: `sending`, `sent`, `failed`, `uncertain`.
- Transitions:
  - (new) -> sending, a reservation that blocks status changes for 5 min (invoiceEmail.cjs:374; invoices.cjs:192,202-207).
  - sending -> sent|failed|uncertain (invoiceEmail.cjs:406-428).
  - stale sending -> uncertain|failed, decided by whether an `email_claims` claim exists (:340-345).
- Terminal states / reversibility: terminal once settled.
- Problems: none beyond the bypass in 14.

## 18. Ticket confirmation email  (implicit)
- Entity / storage: email onceKey `ticket-confirmation:{order}:{template}:{addrHash}:{resendKey|initial}` (functions/src/ticketing/commerceEmail.cjs:85) + `admin_logs` outcome row (:96-104).
- States: unsent -> sent | needs-attention. An explicit resend gets a fresh key.
- Problems: the onTicketOrderConfirmation trigger fires on every order write (:121-127) and re-checks "confirmed" as `inventoryState==='sold' && paymentStatus==='succeeded'` (:33-36), another copy of cross-cutting 3.

## 19. OTP sign-in challenge  (implicit)
- Entity / storage: `auth_challenges/{token} {attempts, expiresAt, consumedAt}` (functions/src/auth/challenges.cjs:7-8,263-271).
- States: open -> consumed -> deleted (finalized). Exhausted (attempts >= 5) and expired are derived (:98-105).
- Transitions:
  - consume at :328-330; failed attempt at :332.
  - finalize (delete) at :338-340.
  - **consumed -> open** (releaseChallenge, :347-354), used by otp.cjs:374 after a token-issuance failure.
  - sweep of expired challenges at :383.
- Problems: releaseChallenge has no guard (it does not check that the challenge was consumed or is unexpired). isVerifiable re-checks those later, so this is safe but implicit.

## 20. Profile photo upload slot  (explicit)
- Entity / storage: `profile_photo_uploads/{uid}.slots[id].state` (functions/src/users/photos.cjs).
- States: `uploading`, `ready`, `deleting`, (deleted).
- Transitions: reserve -> uploading (photos.cjs:108-109); uploading -> ready (:125-126, guard unexpired); expired and unreferenced -> deleting (:33-36); deleting -> removed after Storage delete (:50-52).
- Other copies of this lifecycle: firestore.rules:322-328 admits only `ready` + unexpired as a new `photoPath`. It agrees.

---

## Cross-cutting findings
1. **There are two account-deletion paths with different cleanup.** deleteAttendee releases claims and sweeps answers, notes and photos (functions/src/users/records.cjs:108-143,384-387). The Auth onDelete trigger (functions/src/users/lifecycle.cjs:146-162) does none of that, so claimed tickets end up stuck on a dead uid (registration.cjs:115). Fix: have onUserDeleted run the same `PER_ACCOUNT_STORES` sweep (records.cjs `sweepAccount`).
2. **The promotion logic is written twice and the copies differ.** applyTicketClaimToUser (functions/src/ticketing/registration.cjs:57-91) and recomputeEntitlement (functions/src/ticketing/entitlement.cjs:149-233) both promote. Only recompute demotes and holds, and the claim write already triggers recompute (entitlement.cjs:311-333). Fix: have claimTicketsForUser call recomputeEntitlement and delete applyTicketClaimToUser.
3. **Four order fields encode "this order is done".** They are `status in {paid,free}`, `paymentStatus==='succeeded'`, `inventoryState==='sold'` and the absence of `reconciliationException`. Each consumer checks a different subset:
   - check-in: inventoryState + paymentStatus (functions/src/ticketing/commerceAdmin.cjs:432)
   - email: the same pair (functions/src/ticketing/commerceEmail.cjs:34)
   - resend and admission change: inventoryState only (commerceAdmin.cjs:296,382)
   - purchaser UI: status + paymentStatus (apps/web/src/pages/TicketStatus.jsx:41)
   - checkoutResponse: status only (functions/src/ticketing/stripeCheckout.cjs:485)
   - reconcile short-circuit: total + paymentStatus + inventoryState (functions/src/ticketing/stripeReconcile.cjs:211)

   Fix: one shared `isOrderFulfilled(order)` predicate used everywhere.
4. **An order can get stuck in `exception`, holding inventory, the purchaser lock and its promo use.** The recovery path returns early (stripeCheckout.cjs:399), and there is no admin action to resolve it (commerceAdmin.cjs:19-22). The purchaser lock (stripeCheckout.cjs:254-258) and the promo counter (stripeReconcile.cjs:247) stay taken. Fix: an operator "resolve exception" action that releases or settles the hold, plus a status filter for exception orders in listCommerce.
5. **Dead or unreachable states:**
   - Order `cancelled` is read but never written (stripeReconcile.cjs:146,160).
   - Order `failed` is never set, though the client polls for it (TicketStatus.jsx:17).
   - The ticketStatusLabel keys `processing`, `complete`, `completed`, `fulfilled`, `refunded_partial` and the underscore audit names are never emitted (apps/web/src/lib/ticketingCommerce.js:203-213).
   - `tickets.claimPromptSentAt` is never set (sync.cjs:137, stripeCommerce.cjs:229).
   - `exhaustRow` is dead (sync.cjs:183).
   - The free-order attempt `succeeded` row is never read (stripeCheckout.cjs:328).

   Fix: delete them, or start writing order `cancelled` when every ticket is cancelled.
6. **Value lists are not shared.**
   - Ticket statuses live only in functions/src/ticketing/index.cjs:35. Clients restate them at StripeTicketList.jsx:56-60, AdminTicketing.jsx:406-411, EventFigures.jsx:66 and ticketingCommerce.js:200-215.
   - Order, payment and refund vocabularies have no definition anywhere. They exist only as literals in stripeCheckout.cjs:309-313 and stripeReconcile.cjs:114-146.
   - The registration list is re-typed at users/export.cjs:70 and AdminAttendees.jsx:81-94.

   Fix: put `TICKET_STATUSES`, `ORDER_STATUSES`, `PAYMENT_STATUSES` and `REFUND_STATUSES` in shared/ticketCommerce and import them.
7. **The same helpers are copy-pasted between files.**
   - `CommerceError` takes `(code,message,status)` at stripeCommerce.cjs:18 but `(status,code,message)` at commerceAdmin.cjs:25.
   - `scopeMatches` exists three times: providers/stripe.cjs:76 (scope.externalEventId), commerceAdmin.cjs:52 (provider.externalEventId) and stripeCommerce.cjs:61 (assertOrderScope).
   - millis/toMillis/timeOf/iso appear at stripeCommerce.cjs:279-288, stripeReconcile.cjs:21, sync.cjs:62, invoices.cjs:89,180 and invoicePayLink.cjs:115.
   - `safeId` and `objectId` appear in both providers/stripe.cjs:18-24 and invoicePayLink.cjs:109-114.
   - There are four fixed-window limiters: purchaserWindow (stripeCheckout.cjs:100-123), takePromoCheck (promoCodes.cjs:41-58), acquireLookupBudget (lookupBudget.cjs:14-33) and auth_rate_limits (challenges.cjs:116).

   Fix: one module for commerce errors, scope and time helpers, and one rate-window helper.
8. **Leases are multiplied.** One Stripe order carries a queue lease (sync.cjs:225), an attempt lease (stripeCheckout.cjs:425), a reconcile lease (stripeReconcile.cjs:202) and a refresh cooldown (stripeCheckout.cjs:554). Each has a different TTL and field names (leaseId, leaseToken, reconciliationLease.id). Fix: name and document one lease shape; consider dropping the reconcile lease, since the queue lease already fences the worker.
9. **Writes bypass the central helper:**
   - The webhook marks an invoice paid outside markPaid, skipping refuseWhileSending (invoicePayLink.cjs:638-650 vs invoices.cjs:551).
   - The webhook attaches a Session id outside recoverCheckoutAttempt and leaves the attempt `state` stale (providers/stripe.cjs:293-294).

   Fix: route both through shared transition functions.
10. **Unknown-status fallbacks are inconsistent.** An unknown invoice status reads as `draft`, the most permissive state (invoices.cjs:121). An unknown ticket status reads as `pending_info`, the least permissive (sync.cjs:90). Unknown send and pay-link states read as `uncertain` and `failed` (invoices.cjs:216,233). linkRefusal does not normalize at all (invoicePayLink.cjs:207). Fix: fail closed (refuse writes) on an unknown invoice status.
11. **Pay-link "usable now" is computed three times** (invoicePayLink.cjs:143-151, InvoiceCardPayment.jsx:68-80, settleEnded :295). Every state can become `paid` (:591), so terminal states are not terminal. A `failed` link keeps `idempotencyKey` (:350-353). Fix: export currentPayLink to the client via shared/invoice. Record a payment through a closed link only in the review, not by overwriting the link's terminal status.
12. **The same fact is mirrored in pairs:**
    - `ticket_answers.ticketStatus` mirrors `tickets.status` (ticketAnswers.cjs:174-189).
    - `paymentReviews[].resolved` mirrors `system_errors.resolved` (invoicePayLink.cjs:492-496).
    - `reconciliationException` mirrors order `status==='exception'` (stripeReconcile.cjs:125-137,184).

    Fix: derive one from the other at read time, or document which side is authoritative.
13. **Firestore rules restate the attendee-access predicate.** firestore.rules:449-454 omits the `role` admin branch that shared `hasAttendeeAccess` has (packages/shared/src/registration.cjs:83). It agrees only because core/auth.cjs:450-455 spoofs the role. Fix: a comment-level cross-reference, plus a rules test asserting parity.
14. **Pause/resume bumps the catalog `revision`** (commerceAdmin.cjs:176), which invalidates in-flight checkouts as "prices changed" (stripeCheckout.cjs:241-243). Fix: keep a separate `termsRevision`, or leave `revision` alone on pause.
