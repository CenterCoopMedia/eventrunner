# Spec f3: Send the welcome email

Audit 02 finding 9 (`docs/plans/2026-11-09-project-audit/02-functions-core.md`). ADR 0001 section 3.1 ("Send-once semantics" and the `onceKey` table), section 6.2 (the template table) and section 6.3 ("Phase 2").

## Goal

A new account gets the `account.welcome` email one time. The email has a sign-in link, the next steps and a link to the profile. Today the template exists and nothing sends it.

## When it is sent

- The auth create trigger (`onUserCreated` in `functions/src/users/lifecycle.cjs`) sends it. This trigger runs for every new Firebase Auth account: Google sign-in, the one-time code, and an account that staff make from a ticket.
- The trigger writes the account document first. Then it sends the email.
- The trigger also sends the email when the account document is already there (a repeat delivery, or the ticket path wrote it first). The send-once key stops a second email.

## The message

- Template `account.welcome`, through the one send path (`functions/src/email/send.cjs`).
- `onceKey`: `welcome:{uid}`. `source`: `account-welcome`. `tag`: `account.welcome`.
- Tokens: `first_name` is the first word of the name from the identity provider, or `there` when there is no name. `profile_url` is `{site}/profile`. `next_steps_html` and `login_url` come from the config, as the renderer already does.
- The template override in `email_templates/account.welcome` applies. A broken override uses the shipped wording and logs a warning.
- The email goes on the transactional message stream, as the other notices do.

## When it is not sent

- The account has no email address.
- The address is on `config/bootstrap` `adminEmails` (Owner) or `staffEmails` (Editor). The check is `listedAdminTier`, the same check the ticket prompt uses. The account document is still written.
- The historical demo policy refuses writes. The trigger then writes no account document and sends nothing (as today). The send path checks the policy again.
- The event has no public site address (`config.tierA.publicUrl`). The required sign-in link would be empty.
- The transactional stream is the announcement stream.
- The trigger has no `sendEmail` dependency (unit tests that do not test mail).

## Who may do it

Nobody calls it. Only the auth trigger sends it. No endpoint, no admin action.

## Error cases

- A failure to read `config/bootstrap`, the config or the template, to render, or to send is logged. It does not throw. The trigger does not retry, so the account document is not written a second time. The email for that account is then lost; an admin resend is the recovery path (ADR 0001 section 3.1).
- A provider refusal is logged with the uid and the error code. A refusal from the demo policy at the send boundary is not an error.
- A retried delivery after a send finds the claim and sends nothing.

## Deployment

- The trigger binds the send secrets of the configured provider (`SEND_SECRETS_BY_PROVIDER`), as the other mail senders do.
- The trigger builds the email provider when it sends, not when the handlers are built. A deployment with no provider set still seeds accounts; only the email fails, and that failure is logged.

## What proves it

`functions/src/users/lifecycle.test.cjs`:

- A new account gets one send with template `account.welcome`, `onceKey` `welcome:{uid}`, source `account-welcome`, the first name, the profile link and the sign-in link.
- A second delivery for the same account makes a send call with the same `onceKey` (the core then skips it), and does not write the account again.
- An account with no email address gets no send.
- An address on the Owner list and one on the Editor list get no send, and their account documents are written. An ordinary address still gets the send.
- A send that throws, or a config read that fails, leaves the account document written, and the trigger does not throw.
- A historical demo makes no send.
- No public site address makes no send.
