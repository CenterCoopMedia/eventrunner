# Ticket grant lifecycle

Issue #556 extends the #555 contract without activating granular authorization.
Claim completion and ticket-change triggers share the same transaction: read the
account, live approval policy, complete claimed-ticket set and canonical resource
policy; then write registration changes and the private ticket contribution.
No valid-ticket existence limit truncates a union. Paid, free and comp admissions
retain their existing persistence, claim IDs, financial records and approval rules.

`ticket_access_grants/{uid}` contains schemaVersion, provider/event scope,
policyRevision, sorted classIds and the unioned resources. It contains no order,
payment, attendee address or source payload. Both grant and policy collections
deny every browser read/write, including staff. Public projections and exports
do not receive this record. Account deletion clears it through the existing
per-account store registry.

Only valid tickets currently claimed by that account contribute. Refunds,
cancellations, unknown classes and pending_info contribute nothing. When provider
information becomes unresolved, former granular contributions disappear while
the existing binary registration status can remain held for review. Other valid
tickets retain their own contributions. Reassignments recompute both holders;
replays and delayed events read current records, never the event's resource data.

Explicit admin approval stays a separate full-access source and survives ticket
refunds. Admin revocation atomically removes the cached ticket grant. A later
recompute stores an empty contribution and cannot undo that revocation. #557
must also check the current account approval/revocation and existing trusted role
exceptions; a ticket contribution alone never approves an account.

The server-only `publishTicketAccessPolicy` helper takes a validated immutable
revision and an expected effective revision. It stages the candidate privately,
recomputes all accounts inline in pages of 100 and advances the effective pointer
only after the final page. Progress on `ticket_access_policies/current` records
the last completed cursor and processed/remaining counts. Errors carry the same
progress receipt. Calling the helper again with the same policy resumes the
unfinished page; concurrent identical calls cannot double-count completed pages.
Counts describe sweep rows; a new account behind the cursor is handled by its
synchronous claim rather than counted twice by the sweep.
A different policy cannot overwrite an immutable revision or an unfinished sweep.
There is no new worker, queue, scheduled retry, endpoint, UI or activation flag.
The helper is for a trusted organizer-initiated server caller; the future operator
boundary must enforce that authority. No invocation against a live project is
part of this change.

Each claim/recompute transaction reads the candidate pointer, so claims racing a
sweep derive the candidate too. Accounts created behind the pagination cursor
have no ticket rights until claim completion derives them. The sweep reads current
policy and current canonical resources again for each account. New revisions
must reference canonical resources when first staged. Later CMS session/day
deletions remove that membership without invalidating the immutable revision or
blocking binary claim/refund reconciliation. Malformed private policy data clears
the cached contribution while the existing binary policy continues to reconcile.
Recomputation reports `grantStatus: invalid` to its caller in that case. Publication
stops with its progress receipt instead of declaring a revision complete with
invalid derived grants; the same candidate resumes after canonical data is fixed.
Financial snapshots stay
unchanged. A failed publication leaves the old effective pointer intact and is
resumable with the identical candidate after the failure is corrected.

The coordinator approved one grant per account. During a future policy sweep,
processed accounts can temporarily carry a candidate grant while the effective
pointer still names the previous revision. #557 must fail closed on that mismatch
and show **Access updating** rather than an unexplained denial. This availability
tradeoff avoids parallel old/new grant stores. No runtime access reader consumes
these grants in #556; activation, historical backfill and boundary enforcement
remain in #557.

Existing self-read of bookmarks, reactions and notes, and self-delete of notes,
remain available after downgrade. Bookmark/reaction removal keeps its existing
attendee-gated handler policy. #557 must make any broader post-downgrade removal
decision explicitly; it must require matching current grants for new protected
writes. Existing public content and material embargo/release are unchanged.
