# Epic 483: reconciliation and connector review follow-up

## Scope and changes

This follow-up addresses integration review findings and the initial connector comments
on the foundation PR. The director owns publishing, thread resolution, generated output,
and the integrated CI run.

- A newer webhook generation gets a fresh retry budget when an older in-flight queue
  lease reaches exhaustion. A new delivery that re-arms an already exhausted row also
  clears its payment-wait counter. Pending deliveries still preserve bounded retries.
- Persisted historical-demo policy is checked before Stripe work and in the transactions
  that commit reconciliation, payment-attempt recovery, webhook claims, queue changes,
  and ticket synchronization. A policy change during provider work or before commit
  preserves the archive. The core helper's transaction support matches the operator
  branch's existing change. The deployment runbook requires settling all commercial
  obligations before freezing an event.
- Successful refunds totaling the entire order now produce aggregate `refundStatus:
  'full'`. Earlier failed or action-required attempts remain in the refund history without
  keeping a fully returned payment in refund attention. Active disputes still require
  review. Partial refunds keep the conservative attention and allocation rules.
- Once an order records a PaymentIntent, future snapshots must retain that exact ID.
  Missing or changed identity produces an explicit reconciliation exception and leaves
  capacity and the saved financial history unchanged.
- A Checkout URL returned by a verified Stripe Session may use the organizer's custom
  domain. HTTPS without embedded credentials remains required. Client requests cannot
  supply the redirect URL. This addresses connector comment `4253696442` on PR #484.
- New paid reservations schedule their first durable queue recovery for five seconds
  after the creation lease ends. This lets a process that died before calling Stripe
  recover the frozen creation request while its expiration still meets Stripe's minimum
  window. An open Session then schedules the authoritative expiry check. This addresses
  connector comment `4253696447` on PR #484.

The reconciliation policy transaction also addresses the underlying mutation reported
in connector comment `4253723362` on PR #485. The operator wrapper remains in that PR.

## Evidence

The adversarial tests reproduced the stale-generation exhaustion, full-refund attention,
missing PaymentIntent, frozen reconciliation, custom-domain redirect, and late initial
recovery failures before the implementation changes. Additional failing regressions
identified frozen webhook writes and an exhausted payment-wait counter that could not
be re-armed.

The final focused Node 22 run passes 125 tests across Checkout, Stripe reconciliation,
the provider, queue synchronization, webhook intake, native HTTP wrappers, and the
existing Eventbrite end-to-end path. It includes policy changes during external work and
transaction commits. The automatic crash-recovery test uses a synthetic Stripe service
that rejects creation with less than 30 minutes remaining before the frozen expiration.
Scoped ESLint and `git diff --check` pass.

These tests use synthetic providers and the repository's transaction-aware Firestore
fake. They do not claim an external Stripe sandbox rehearsal or production deployment.
The director must apply the follow-up across the PR stack and run the integrated gates.
