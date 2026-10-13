# Epic #483 — checkout recovery follow-up

## Scope and behavior

This focused follow-up fixes a purchaser lockout in `apps/web/src/pages/Tickets.jsx`. It does not claim the epic's complete “Done when” condition. The director owns integration, generated output, hosted CI, and pull request review.

A first checkout submission rejected with `account-not-ready` has not reserved an order. The page now clears its saved request reference, refreshes the catalog, and restores the editable selection. The entered attendees stay in memory on that page. Reload starts ticket selection without a stale resume requirement or saved attendee details.

An explicit resume that returns both HTTP 404 and `not-found` clears a saved request or order reference. The page focuses a private error message and makes selection available again. It does not treat a 404 from an initial creation request as proof that no order exists. If another valid order already holds seats, the next submission still follows the server's owner-scoped `purchase-in-progress` response to that existing order.

Network errors and `ticketing-unavailable` responses retain the original attempt. Same-page retries keep the frozen request and selections. Reload retries the same saved identifier. A later `account-not-ready` response also preserves an earlier uncertain attempt, since the server checks the purchaser profile before looking up an existing reservation. This distinction follows the server regression for profile deletion during checkout recovery.

## Tests and final checks

`apps/web/src/pages/Tickets.test.jsx` adds eight rendered component cases. They cover first-submission profile rejection and reload, stale request and order references, recovery of a different active hold, ambiguous creation errors, and profile loss before same-page or post-reload retries. Four new cases failed before the production fix, reproducing the lockout.

Final checks after the report and source edits:

- Targeted Vitest: **19 tests passed in one file**.
- ESLint for the two changed JavaScript files, with `--max-warnings 0`: **passed**.
- Copy-style check: **517 files checked; no blocked patterns**.
- `git diff --check`: **passed**.

The existing server contract supplies the duplicate-order guard; the UI test proves its returned existing-order reference is followed. This follow-up did not change server code, the Checkout URL helper, routing, manifests, or generated output. It did not run real Stripe calls or browser tests. The director will verify the integrated stack and regenerate output.
