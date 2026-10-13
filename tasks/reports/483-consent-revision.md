# Atomic catalog consent — epic #483 / PR #486

## Review finding

Connector comment `4254137133` identified a consent mismatch: the purchase page
stored only a boolean and cleared it in a passive effect when the displayed
catalog revision changed. React could commit the new prices and refund policy
while that old boolean still rendered a checked consent control.

## Change

The page stores the explicitly accepted catalog revision, initially null, and
the accepting purchaser's UID. The checkbox and submit validation derive
acceptance during render: the displayed revision must be a nonnegative safe
integer, it must equal the accepted revision, and the purchaser must match.
A new offer is therefore unchecked in its first committed render. The passive
catalog-reset effect is removed.

A new checkout sends the accepted revision itself. Definitive catalog-change
responses and purchaser changes clear acceptance. Frozen uncertain requests
retain their original body and accepted revision; saved-reference resume
continues to omit catalog revision as required by the backend contract.

## Regression and verification

A test wrapper around the real checkbox records its actual checked DOM state
and the displayed refund policy from `useLayoutEffect`, before any parent
passive effects. On the old implementation, all three refresh cases—sold out,
rate limited and account not ready—reproduced a committed new policy with old
checked consent. All three failed the new assertion.

After the fix, each case proves that every commit showing the new policy is
unchecked until an explicit acceptance. The second checkout carries revision
2 and a new request ID; an attempted submission before acceptance produces no
additional checkout call. Additional coverage rejects malformed revisions,
accepts revision zero, and proves a new purchaser cannot inherit checked
consent in the first commit even when the catalog revision is unchanged.

Final Node 22 verification:

- `Tickets.test.jsx`: **40 passed, 0 failed**, including all 32 existing cases
  and the existing frozen-request and revision-free resume coverage.
- Scoped ESLint on the page and tests: passed.
- `git diff --check`: passed.

No backend, browser-test assertions, generated output, or GitHub state was
changed. The parent owns integration, generated output and exact-head CI.
