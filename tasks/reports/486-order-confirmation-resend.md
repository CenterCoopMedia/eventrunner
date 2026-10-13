# PR 486: ticket confirmation resend results

## Review comments

Comment `4253890484` reported that the resend button reused its first request ID after
a completed send. Comment `4253890497` reported that failed or skipped responses showed
a success message. This change addresses both in `StripeOrderDetail.jsx`.

The screen now states how many confirmation messages were sent. It identifies failed
or uncertain messages and explains each supported skipped reason. Already-recorded
requests show a caution message. An empty or unrecognized result cannot report success.

The request stays associated with its selected order. Failed, partial, and uncertain
outcomes keep the same request ID. A skipped operation also keeps its ID for retry.
After a clean response confirms a positive sent count, zero failures, and no earlier
uncertainty, the next deliberate resend gets a new ID. A second press during an active
request remains a no-op.

## Delivery contract

The existing email core claims each recipient before contacting the provider. It keeps
that claim after a failed or uncertain send. The confirmation endpoint's `alreadySent`
flag therefore means that the send claims already exist. It does not prove delivery.

A retry with a positive sent count and zero new failures can still skip a recipient
whose earlier send failed. Once this view has observed uncertainty, it preserves that
state and request ID. It tells the operator to review the email log before another send.
It does not infer completion from an already-recorded response. No email-core contract,
backend source, or shared workspace component changed in this follow-up.

## Verification

The 13 new component tests failed before the implementation change. A focused run also
reproduced the exact repeated-ID failure after a successful send. The tests render the
real order detail component and exercise the resend button with the backend's result
shapes. They cover successful later sends, duplicate presses, failure, partial delivery,
network uncertainty, replayed claims, skipped reasons, empty results, and order scope.

The final focused Node 22 web run passed 26 tests across the new
`StripeOrderDetail.test.jsx` and the existing `StripeTicketingWorkspace.test.jsx`.
Scoped ESLint passed with `--max-warnings=0`. `git diff --check` passed.

The director owns integration, generated output, hosted CI, and review-thread resolution.
No external messages were sent during these tests.
