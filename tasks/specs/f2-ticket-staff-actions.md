# Spec f2: Ticket staff actions (sync all tickets, create account from ticket)

Audit 01 #5 (`docs/plans/2026-11-09-project-audit/01-functions-ticketing.md`). ADR 0001 section 3.3 and the `ticketing/` row of the module table. Two staff endpoints exist and no screen calls them: `ticketingSync` and `createUserFromTicket`. This spec adds the two staff actions to admin Ticketing.

## A. Sync all tickets

### Goal

Staff can repair the ticket list after the provider missed webhook deliveries. The action calls `ticketingSync`. The endpoint reads every ticket that the provider has and writes each one to `tickets/{externalId}`.

### When the action has a use

The use comes from the provider code (`functions/src/ticketing/providers/*.cjs`):

| Provider | `listTickets` reads | Use of a full sync |
|---|---|---|
| `eventbrite` | The Eventbrite orders API, 50 pages at most | Yes. It recovers missed webhook deliveries. |
| `stripe` | Each `ticket_orders` row, then `reconcileOrder` reads Stripe and commits the order and its tickets | Yes. It recovers missed Stripe events. |
| `manual` | Its own `tickets` rows (`provider == 'manual'`) | No. It writes the same rows back. The CSV import is the update path. |
| `none` | Nothing | No. |

The rule: a provider that has a webhook can miss a delivery, so a full sync has a use. A provider with no webhook has nothing to recover. `getTicketingStatus` reports this as a new capability flag, `fullSyncSupported: typeof provider.registerWebhook === 'function'`. The web app shows the action only when the flag is true. The web app does not compare provider names for this.

### Behaviour

1. The "Ticket updates" panel shows a **Sync all tickets** button when `fullSyncSupported` is true.
2. The button opens the ticketing confirmation dialog. The dialog says what the sync does, that saved and claimed tickets stay as they are, that the sync starts from the beginning and can take several minutes, and that staff select **Continue sync** if it stops early.
3. While the request runs, the confirm button says "Syncing…" and is busy. A second press does nothing. The dialog shows the admin loading status, which adds the elapsed-time words.
4. On success the dialog closes. A result line in the panel gives the counts in words: new tickets, existing tickets checked, records skipped. The status and the ticket lists load again.
5. When a run stopped early (`truncated: true`), the result line says why (time limit, page limit, or the provider could not be read) and gives the totals so far. When the answer has a `nextCursor`, the panel shows **Continue sync** and the line says to select it. When it has none, the line says to select **Sync all tickets** to start again from the beginning.
6. **Continue sync** sends `{ cursor: nextCursor }` without a second confirmation. The button says "Syncing…" and is busy while the run goes. The result line adds the new run's counts to the totals of the earlier runs of the same sync. When a run completes, the line says "Sync finished" and, after more than one run, how many runs there were. **Continue sync** then goes away.
7. **Sync all tickets** always sends `{}` and resets the totals.
8. When the demo policy stopped the sync (`skippedReason: 'read-only-demo'`), the result line says that the demo is read-only.
9. On an error of a fresh sync the dialog stays open and shows the error. On an error of a continued run the error shows below the result line and **Continue sync** stays, except for a refused cursor (`bad-cursor`): then the cursor is dropped and staff start again.

### Server changes

- `ticketingSync` gets `timeoutSeconds: 540`. This is the value the other long staff endpoints in this repository use (`downloadSessionMaterialsArchive`, `deleteAttendee`).
- `runFullSync` stops before it starts a new page after 7 minutes (`SYNC_TIME_BUDGET_MS`). The last page then has 2 minutes to finish before the function limit. A Stripe page reconciles up to 25 orders, each with several Stripe reads.
- Resume. The request takes an optional `cursor`. The cursor is the provider's own page token as `listTickets` takes and returns it: the Eventbrite `continuation`, or for Stripe the id of the last `ticket_orders` row of the previous page (`startAfter`). The handler treats it as opaque. It must be a string, 1 to 1024 characters after trimming, with no control characters. Any other value gets 400 `bad-cursor` before the provider is read.
- A provider that refuses the token throws an error with `code: 'invalid-page-token'` (Stripe: a token that is not a safe id; Eventbrite: a 400 answer to a request with a continuation). The handler answers 400 `bad-cursor`: "The sync cannot continue from this point. Start the sync again from the beginning."
- A stopped run answers 200 with `truncated: true`, `stoppedReason` (`'time-limit'`, `'page-limit'` or `'provider-error'`), its own counts and `nextCursor`. A complete run answers `nextCursor: null`.
- `nextCursor` is the page token of the first page the run did not finish. On a provider or write error it is the token of the failed page, so **Continue sync** tries that page again. This covers a Stripe page that fails because an order is still reconciling. When the failed page is the first page of a fresh run, `nextCursor` is null.
- The cursor is not stored. It travels only in the response and in the next request. `ticket_sync_queue` stays the only queue (ADR 0001 §10 question 9).
- The counts are per run and include every ticket written, also on a page that failed part way. Each ticket is written in its own transaction and the write is idempotent (`upsertTicket`). Stripe commits one order and its tickets in one transaction (`reconcileStripeOrder`). A stopped run therefore leaves no ticket half written. A retried page writes the same values again.
- A provider failure on the first page of a fresh run, with nothing saved, stays a 502 `provider-error`.

### Who may do it

Staff and operators (`requireAdmin` tier `staff`, no change).

### Error cases

| Case | Answer | Words on screen |
|---|---|---|
| Not signed in, not staff | 401, 403 | Server message |
| Provider fails on the first page of a fresh run | 502 | "The ticketing provider could not be read. No tickets changed. Try again in a few minutes." |
| Provider or write fails later | 200, `stoppedReason: 'provider-error'` | "The sync stopped because the ticketing provider could not be read.", the totals, then the next step |
| Cursor not usable, or refused by the provider | 400 `bad-cursor` | "The sync cannot continue from this point. Start the sync again from the beginning." |
| No answer (network, function limit) | 0, 5xx | "The sync did not answer. Some tickets may be saved. Run the sync again. It does not make duplicate tickets." |
| Demo is read-only | 200, `skippedReason` | "This historical demo is read-only. No tickets changed." |
| Page or time limit | 200, `truncated` | The reason, the totals, then "Select Continue sync to go on from where it stopped." |

### What proves it

- `functions/src/ticketing/sync.test.cjs`: time budget stop and page cap with `nextCursor`, a complete run with no cursor, resume from a cursor with per-run counts, a failed page returns its own cursor (also on the first page of a resumed run), cursor validation, a provider refusal, partial counts on a write failure, `timeoutSeconds` on the export, existing idempotency tests.
- `functions/src/ticketing/providers/eventbrite.test.cjs`, `stripe.test.cjs`: a refused page token has `code: 'invalid-page-token'`.
- `functions/src/ticketing/index.test.cjs`: `fullSyncSupported` for a provider with and without a webhook, and for the real adapters.
- `apps/web/src/admin/pages/AdminTicketing.test.jsx`: the button shows only with the flag, confirm, busy, result words, Continue sync with running totals until complete, a fresh sync resets, a stopped run with no cursor, a refused cursor, a continued run that did not answer, error words.

## B. Create account from ticket

### Goal

Staff can make the sign-in account for a ticket holder who cannot claim the ticket alone. The action calls `createUserFromTicket` with `{ externalId }`. The endpoint makes the account for the ticket email address (or uses the account that has that address) and claims the ticket for it.

### When the action shows

On a ticket row in the admin ticket list (the manual list and the Stripe admission ticket list) when all of these are true:

- the ticket is not claimed (`claimedByUid` is empty),
- the ticket status is `valid`,
- the ticket has an email address.

### Behaviour

1. The row shows a **Create account** button.
2. The button opens the ticketing confirmation dialog. The dialog names the email address. It says that Event Runner creates a sign-in account for the address, or uses the account that already has it, and claims this ticket for that account. It says that the person then signs in with a code sent to that address. It says nothing else about email.
3. While the request runs, the confirm button says "Creating…" and is busy.
4. On success the dialog closes, the row shows the ticket as claimed and the button goes away. A result line above the table says what happened:
   - `created: true`: "Account created for {email}. The ticket is claimed."
   - `created: false`: "{email} already had an account. The ticket is now claimed for it."
   - `alreadyClaimed: true`: "This ticket was already claimed. Nothing changed."
5. On a refusal the dialog stays open and shows words the staff member can act on.

### Who may do it

Staff and operators (`requireAdmin` tier `staff`, no change).

### Error cases (from `createCreateUserFromTicketHandler` and its tests)

| Case | Answer | Words on screen |
|---|---|---|
| Demo is read-only | 403 `read-only-demo` | Server message |
| Event settings unavailable | 503 `config-unavailable` | Server message |
| Ticket not found | 404 `not-found` | "This ticket is no longer in the list. Search again." |
| Ticket not valid, or the claim lost a race (refund, other claim) | 409 `conflict` | "This ticket could not be claimed. Its status may have changed. Search again to see the current status." |
| Ticket has no email address | 422 `unprocessable` | "This ticket has no email address. Add the address to the ticket, then try again." |
| Other failure | 5xx | "The account could not be created. Try again. If the problem continues, contact support." |

No server change. The handler already answers each case.

### What proves it

- `functions/src/ticketing/registration.test.cjs` (existing): every answer above.
- `apps/web/src/admin/pages/AdminTicketing.test.jsx` and `apps/web/src/admin/components/StripeTicketList.test.jsx`: the button shows only for an unclaimed valid ticket with an email, the confirm text names the address, busy, the row updates, each refusal shows its words.
