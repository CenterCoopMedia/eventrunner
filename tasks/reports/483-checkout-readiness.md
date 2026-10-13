# Epic 483: checkout configuration safeguards

## Scope and changes

This follow-up starts at foundation commit `d907750`. It fixes two failures found during integration review. The director owns integration, generated output, hosted CI, and review completion. This follow-up does not claim that the full epic is complete.

`functions/src/ticketing/providers/stripe.cjs` exposes a local `hasPaymentCredentials` value. It accepts a nonempty secret or restricted key only in the configured test/live mode. It does not contact Stripe or establish merchant launch readiness. An explicitly injected test client supplies that capability in unit tests.

`functions/src/ticketing/stripeCheckout.cjs` closes paid ticket availability when local payment credentials are unavailable. A direct paid request returns HTTP 503 before reserving capacity or writing an order, attempt, queue row, or audit. A previously uncertain creation attempt keeps its saved state and held capacity when credentials are unavailable. Genuine provider uncertainty still uses the original request and key. Free purchases and operator comps keep their existing path without payment credentials.

`functions/src/ticketing/commerceHttp.cjs` exports `invokeCommerceHandler(factory, req, res)`. It catches dependency construction and uncaught handler failures, then returns a redacted HTTP 503 `ticketing-unavailable` response. Operator wrappers can use the same guard after their CORS check. Native commerce endpoints use only the provider name for Eventbrite, manual, and none deployments. Their closed catalog does not require unrelated adapter credentials. Existing legacy ticketing endpoints keep their complete adapters.

## Evidence

The new tests reproduced six failures before the implementation changes. They exercise deployed HTTP wrapper callbacks with substituted Firebase entry points, real native endpoint factories, and real provider selection. Checkout regressions use real Stripe provider configuration with synthetic keys, plus the repository Firestore fake. No Stripe network call or production credential was used.

The final focused run passed 61 tests. The full shared and ticketing run passed 557 tests. Scoped ESLint and `git diff --check` passed after the report was written. Tests use Node 22.

The tests cover missing and wrong-mode keys, malformed empty keys, free sales and comps, absent catalogs, a public catalog that cannot call Stripe, unchanged uncertain attempts, all native endpoint construction errors, legacy provider selection, and CORS preflight without runtime credentials.

## Limits

Local key validation cannot confirm whether a key is revoked or whether it belongs to the configured merchant. The provider still verifies the account before external payment operations. Merchant verification and the separate Stripe sandbox rehearsal remain launch gates. The director must rerun the integrated checks after applying this commit and generating the stack output.
