# PR 486: accepted catalog revision

## Contract

Review comment `4253992183` identified a purchase that could use prices or refund terms
changed after the purchaser reviewed the catalog. The public catalog now returns
`catalogRevision`, a nonnegative safe integer. Unavailable catalog responses return
`null`. Internal catalog revision metadata remains outside the public response.

A new checkout request must include `{ requestId, catalogRevision, lines }`. Missing or
invalid acceptance returns HTTP 400 `invalid-checkout`. A revision that differs from the
current catalog returns HTTP 409 `catalog-changed` with this message:

> Ticket prices or terms have changed. Review the updated catalog before continuing.

The reservation transaction reads and compares the persisted catalog revision before
reserving capacity, spending order quota, creating tickets, writing an audit, or creating
a payment attempt. A catalog change before transaction commit forces a retry against the
new revision. Existing organizer save and pause actions already increment that revision.

## Recovery and operator authority

Existing durable orders return before the current catalog is read. Retrying the original
request body or using `{ requestId, resume: true }` or `{ orderId, resume: true }` keeps
the saved price, refund terms, assignments, and exact payment request. A recovery request
does not accept a new catalog revision or cart.

For new orders, the accepted revision is part of the immutable request fingerprint.
Changing it under an existing request ID returns `idempotency-conflict` rather than
repricing that order. Requests made before revision acceptance was introduced retain
their original fingerprint when the field is omitted. Shared parsing permits omission
for those durable requests and trusted comps; the reservation transaction enforces it
for every new public paid or free order. Staff comps keep their explicit-authority path.

The director owns the frontend acceptance and refresh behavior. This server change alone
does not complete the display and renewed-acceptance part of the review comment.

## Verification and packaging

The regressions failed before the transaction guard. Missing acceptance, stale prices,
changed refund terms, and a concurrent catalog change were accepted before this fix.
Tests cover paid and free orders, no mutation on refusal, quota preservation, refreshed
acceptance, internal-helper enforcement, private response fields, comp behavior, and
recovery after both price and refund terms change. The recovery test also checks exact
saved Stripe parameters and rejection of a replacement accepted revision.

The final focused Node 22 run passes 60 tests across Checkout, native HTTP wrappers, and
the shared catalog/checkout contract. Scoped ESLint passes with `--max-warnings=0`.
`git diff --check` passes.

The existing ESM shim re-exports the updated validator; no new export was introduced.
`npm run prepare:functions` rebuilt the shared tarball and both lockfile integrity values.
The Functions shared package was removed and reinstalled from the tarball before the
final tests. Lockfile-only generated changes are in a separate
`Regenerate generated output` commit so the director can regenerate them at the stack tip.
