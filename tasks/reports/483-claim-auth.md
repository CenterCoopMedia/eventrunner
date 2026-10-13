# Claim-link authentication repair — epic #483 / PR #486

## Review finding

Connector comment `4253992169` identified that a signed-out visitor to
`/ticket/claim?order=…` had to leave for `/signin`, whose normal success path
lost the claim route and its suggested order reference.

## Change

- Embed the existing `SignInPanel` on the claim page. Google and emailed-code
  authentication stay on the same route, preserving query parameters and any
  reference edit. Authentication never submits the claim.
- Require verified authentication and the current user's loaded account
  document from `ProfileContext` before rendering the explicit claim form.
  This covers the gap before the auth trigger creates `users/{uid}` and
  rejects a stale previous-account profile.
- After 15 seconds, offer a reload link that retains the reference and other
  query parameters. The existing profile subscription continues its recovery
  path. Neither the waiting nor recovery message implies a successful claim.
- Offer inline reauthentication for expired/refused authentication without
  exposing order details. The attendee must explicitly submit again.
- Scope claim results to the mounted, verified account. Signing out while
  obtaining a token prevents the request; a late result from a previous
  account is discarded. Existing indistinguishable order-refusal messages
  remain unchanged.

## Evidence

The new authentication/identity tests reproduced seven failures against the
previous page before the implementation. Final focused checks on Node 22:

- `TicketClaim.test.jsx`: 14 passing tests, including actual shared OTP panel
  transitions, verified/unverified identity, delayed/mismatched profile,
  bounded recovery, fresh sign-in after a server refusal, explicit claims,
  sign-out during token retrieval, and a late previous-account response.
- Together with `Login.test.jsx`, `Login.historicalDemo.test.jsx` and
  `ProfileContext.test.jsx`: **43 passed, 0 failed**, four files.
- Scoped ESLint on the page, tests and browser scenario: passed.
- `git diff --check`: passed.

`e2e/ticket-claim.spec.js` now begins at the emailed deep link, authenticates
through real OTP in place, waits for the account-backed claim form, verifies
that the reference survived and no claim request occurred, then explicitly
claims and retains the existing account-approval and persisted-bookmark
assertions. This revised browser scenario was **not run locally**; the parent
will run it in the final hosted CI head with the browser sandbox enabled.
No previous-head browser evidence is claimed as proof for this revision.

The pre-existing backend account-creation race was not redesigned. This repair
adds the requested client readiness gate using the existing profile contract.
No generated files, backend registration code, merchant configuration, or
GitHub state were changed in this commit.
