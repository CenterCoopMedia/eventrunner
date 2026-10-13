# Epic 483: public catalog sales windows

## Change

The public catalog endpoint now returns overall `salesStartAt` and `salesEndAt` fields.
They use the same normalized ISO UTC string or `null` convention as the ticket-type
windows. Published catalogs expose their configured windows even when those windows
currently close sales. Unset windows are `null`. Unpublished, invalid, missing, and
otherwise unavailable catalogs keep the closed response with both fields `null`.

The endpoint still selects its public fields explicitly. It does not expose organizer
identity, catalog revision, capacity, commercial confirmation, or Stripe account data.
Pricing and purchase authorization do not change.

The frontend builder owns the display of the intersection of overall and per-type
windows in the event timezone. This server follow-up alone does not complete that
display requirement.

## Verification

Two new endpoint regressions failed before the response change. They check normalized
offset timestamps, independent type windows, omitted organizer fields, unset windows,
unpublished deadlines, and malformed configuration. The director owns the integrated
test and CI run after this commit is applied.

The final focused Node 22 run passes 46 tests across Checkout and native HTTP wrappers.
Scoped ESLint and `git diff --check` pass.
