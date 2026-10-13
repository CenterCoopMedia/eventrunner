# Epic #483: confirmation review follow-up

## Scope

This signed follow-up starts from the organizer operations branch at
`8603c611625afff01565a51934d9cfd66906aca6` and addresses three connector comments
on PR #485. It changes confirmation selection and its existing email template;
it adds no payment operations, admission writes, queue, or UI.

## Review comments addressed

- `4253723372`: claim invitations now include only valid tickets that have no
  `claimedByUid`. The separate purchaser confirmation remains available on an
  explicit resend after all attendees have claimed. For a recipient with both
  claimed and unclaimed seats, the invitation counts only outstanding claims.
  This does not require another account's contact information or disclose order
  amounts to an attendee.
- `4253723376`: confirmation scope uses the provider's exported `stripeScope`
  normalizer and existing scope comparison. Event ID, account ID, and explicit
  test/live mode therefore match the values persisted by checkout when valid
  environment values include surrounding whitespace. These helpers do not
  construct a Stripe client or read payment secrets. Invalid scope configuration
  fails closed instead of treating an arbitrary mode as test mode.
- `4253723355`: the purchaser's button opens `/profile`, which is already
  mounted by the organizer PR's web router. The label says “Open your event
  profile”; the order reference, ticket count, and total remain in the email.
  The UI branch will restore the order-specific status URL and label in the
  same commit stack that mounts that route. This intermediate PR therefore
  does not emit a link to an unimplemented page.

## Verification

Four focused assertions failed against the unchanged implementation: the
purchaser route, a resend after claiming, the count for mixed claim state, and
the normalized deployment identity. After the fixes:

- `node --test functions/src/ticketing/commerceEmail.test.cjs
  functions/src/email/templates.test.cjs functions/src/email/render.test.cjs`:
  **64 passed, zero failed** on Node 22.
- Scoped ESLint for the changed source, tests, and email template: **passed**.
- `git diff --check`: **passed**.

The email tests exercise the existing send-once core for initial delivery and
explicit resend, preserve purchaser/attendee separation, and verify that
rendered bodies are not stored. No real email was sent and no Stripe API was
called. Root integration owns the final remote CI head, review replies, and
thread resolution; this report does not claim those have completed.
