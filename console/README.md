# Client console

The client console is where a client signs up, names its organization, invites its team and answers the guided setup for each event site. It runs at `console.eventrunner.org` in its own Firebase project, which CCM owns. It is not part of a client deployment, and no client project reads from it. [ADR 0007](../docs/adr/0007-client-console-self-serve-onboarding.md) is the decision record.

This folder holds sign-in, organizations and the team (P4), the guided setup with its status page (P5), account connections (P6), operator review (P7), the agreement and event fee (ADR 0007, amendment 2026-11-04), and the start of the site builder (P8). The builder itself is `scripts/provision-client.cjs`, run by `.github/workflows/provision-client.yml`.

## What is here

| Path | What it is |
|---|---|
| `firebase.json` | The console project's own Firebase configuration: functions, rules, indexes and hosting. |
| `firestore.rules` | Read rules for the browser. The browser writes nothing. |
| `firestore.indexes.json` | The collection-group index for "my organizations", and the review queue index (`status`, `updatedAt` descending). |
| `functions/` | The server functions. They own every write. `functions/vendor/shared.tgz` is the shared package, packed by `npm run prepare:functions`. |
| `web/` | The web app (Vite and React). It builds to `web/dist`. |
| `tests/` | The rules suite. It runs on the Firestore emulator. |

The client deploy (`.github/workflows/deploy-client.yml` with the root `firebase.json`) never reads this folder. `scripts/console-isolation.test.cjs` checks that.

## Sign-in

A person signs in with Google, with Microsoft, or with a link sent by email. Every write needs a verified email address. When a provider does not confirm the address, the console asks the person to get a sign-in link by email, which confirms it.

The console uses plain words. It never says Firebase, project, tenant, environment, webhook or secret. The hosting team's review pages are the one exception: they name the build settings (project id, environment name) as the provisioner uses them, and only operators see them.

## Data model

| Document | Fields | Written by |
|---|---|---|
| `organizations/{orgId}` | `name`, `createdAt`, `createdBy` (uid) | `createOrganization` |
| `organizations/{orgId}/members/{uid}` | `uid`, `email` (lowercase), `role` (`owner` or `editor`), `joinedAt` | `createOrganization`, `acceptInvite`, `changeMemberRole`, `removeMember` |
| `invites/{inviteId}` | `orgId`, `email` (lowercase), `role`, `tokenHash` (SHA-256 of the token), `status` (`pending`, `accepted` or `replaced`), `invitedBy`, `invitedByEmail`, `createdAt`, `expiresAt`, and after use `acceptedBy` and `acceptedAt` | `inviteMember`, `acceptInvite` |
| `applications/{appId}` | `orgId`, `status`, `answers`, `frozen` (a copy of `answers` at submit, else null), `createdBy`, `createdAt`, `updatedAt`, `updatedBy`, `submittedAt`, `submittedBy`, `history` (a list of `{ status, at, by, note }`, oldest first), `review` (null, or `{ note, by, at, settings }`), `agreementAcceptance` (null, or `{ id, version, sha256, name, email, at }`, the pointer to the current record), `feeCheckout` (null, or `{ sessionId, amount, currency, attempt, createdAt }`), `payment` (`{ sessionId, paymentIntentId, amount, currency, paidAt, eventId }`), `feeProblem` (`{ code, sessionId, paymentIntentId, at }`), `buildStart` (`{ state, at }`, with `state` `pending`, `started` or `failed`), `connections` (see "Account connections") | `createApplication`, `saveApplicationStep`, `acceptAgreement`, `reopenApplication`, `startFeeCheckout`, `submitApplication`, `withdrawApplication`; `requestChanges`, `declineApplication`, `approveApplication`, `deleteSpamApplication`, the retention job; `consoleFeeWebhook` writes `payment`, `feeProblem` and `buildStart`. Only review writes `review`. Only `completeConnection`, `disconnectAccount` and `chooseEventbriteEvent` write `connections`. |
| `console_connections/{appId}` | `stripe` (`accountId`, `connectedBy`), `eventbrite` (`accountId`, `connectedBy`, `eventOrganizationId`). No browser can read it, operators included. | `completeConnection`, `disconnectAccount`, `chooseEventbriteEvent`; deleted with the application by spam delete and the retention job |
| `console_connection_states/{hash}` | `uid`, `orgId`, `appId`, `provider`, `createdAt`, `expiresAt` for a connection in progress. The id is the SHA-256 of the `state` value. No browser can read it. | `startConnection`, `completeConnection`; the retention job sweeps expired ones |
| `site_names/{name}` | `appId`, `orgId`, `reservedAt` | `saveApplicationStep` (web-address step), `withdrawApplication`; review frees a name on decline, spam delete and retention. A request waiting for payment keeps its name. |
| `console_config/operators` | `emails` (lowercase) | A CCM operator, by hand in the Firebase console |
| `console_config/settings` | `gcpFolder`, `billingAccount`, `region`, `feeAmount` (a whole number in the currency's smallest unit), `feeCurrency` (three lowercase letters) | `saveConsoleSettings`, `saveEventFee`. The guided setup reads only the fee, and only on the server. |
| `console_config/agreement` | `version`, `title`, `body`, `sha256`, `savedAt`, `savedBy`: the current agreement | `saveAgreement` |
| `console_config/agreement/versions/{version}` | The same fields. Each version is created once and never changes. | `saveAgreement` |
| `agreement_acceptances/{id}` | `version`, `sha256`, `typedName`, `email` (verified), `uid`, `orgId`, `appId`, `at`. Created once, never changed, and kept when the request goes back to edit or is deleted. | `acceptAgreement` |
| `console_fee_events/{sessionId}` | `eventId`, `sessionId`, `paymentIntentId`, `appId`, `orgId`, `amount`, `currency`, `outcome` (`approved`, or the reason it did not approve), `at`. Kept when the request is deleted. | `consoleFeeWebhook` |
| `console_rate_limits/{key}` | `count`, `windowStart` | The functions |
| `console_builds/{appId}` | The build record: `state` (`queued`, `running`, `failed` or `done`), `runUrl`, `testMode`, `startedAt`, `updatedAt`, `finishedAt`, `failedStep`, `error`, `ownersEmailedAt`, `steps` (a list of `{ id, label, state, at, detail }`). No browser can read it: an operator sees it through `getApplicationForReview`, and a client sees only the status. | `scripts/provision-client.cjs`, `retryBuild` |
| `console_audit/{id}` | `action`, `appId`, `by` (a uid, `retention`, `payment`, `console` or `build`), `at`, and `version` on `save-agreement`. No client data. | `saveConsoleSettings`, `saveEventFee`, `saveAgreement`, `deleteSpamApplication`, the retention job, `consoleFeeWebhook` when a build does not start |

An application is one event and one site. The client sees it as "your request". Its statuses are `draft`, `awaiting_payment`, `submitted`, `changes_requested`, `approved`, `building`, `ready`, `launched`, `withdrawn` and `declined` (ADR 0007 §5 and its amendment). An application is open unless it is `withdrawn` or `declined`.

The usual path is `draft`, then `awaiting_payment` when an Owner accepts the agreement, then `approved` when the payment is confirmed. `submitted` and `changes_requested` remain for requests that were sent before the amendment.

`answers` has one part for each step that takes answers:

```json
{
  "organization": { "name": "", "website": "", "address": "" },
  "event": {
    "name": "", "shortName": "", "tagline": "", "timezone": "",
    "days": [{ "date": "2027-05-13", "startTime": "09:00", "endTime": "17:00", "label": "Workshops" }],
    "venue": { "name": "", "address": "" }
  },
  "webAddress": { "name": "nclocal" },
  "tickets": { "choice": "stripe" },
  "email": { "senderName": "", "replyTo": "" }
}
```

`tickets.choice` is `stripe`, `eventbrite`, `spreadsheet`, `none`, or null before the client chooses. The team step has no answers: it uses the members and invites.

A web-address name is 3 to 30 characters of lowercase letters, digits and hyphens. It does not start or end with a hyphen, and it is not on the reserved list in `functions/src/siteNames.cjs`. One `site_names` document per name means one holder per name.

A member record repeats its own uid. Firestore cannot query a collection group by document id, and "my organizations" is one collection-group query on that field.

## Roles

- **Owner**: runs the event site and manages the team. In the event admin, an Owner is an operator.
- **Editor**: edits the event content. In the event admin, an Editor is staff.
- **Operator**: a CCM person named in `console_config/operators`. An operator can read every organization and team, and reviews requests. An operator does not change a client's team.

An organization always keeps at least one Owner. Two Owners are a condition of launch, because launch readiness needs two operators. They are not a condition of finishing the setup or of paying.

## Functions

Each function is an HTTP POST with a JSON body and the person's ID token. The web app calls `/api/<name>`, and `firebase.json` sends that path to the function of the same name.

| Function | Who | What it does |
|---|---|---|
| `listOrganizations` | Anyone signed in | Lists my organizations. An operator also gets every organization. |
| `createOrganization` | Anyone signed in | Makes an organization. The caller becomes its Owner. Five a day for one account. |
| `getTeam` | Members and operators | Lists the members, the open invites, and how many Owners launch still needs. |
| `inviteMember` | Owners | Emails an invite with an Owner or Editor role. Twenty a day for one organization, thirty a day for one person. |
| `acceptInvite` | The invited address | Joins the organization. The link works once and expires after seven days. |
| `changeMemberRole` | Owners | Changes a role. The last Owner cannot step down. |
| `removeMember` | Owners | Removes a member. The last Owner cannot be removed. |
| `createApplication` | Owners | Starts a request as a draft, with the organization name and the browser time zone preset. Three open requests for one organization. |
| `listApplications` | Members and operators | Lists the organization's requests, newest first, and whether the caller can start one. |
| `getApplication` | Members and operators | Reads one request, with its errors by field, the progress of each step, the note from the hosting team, and what the caller can do. An operator also gets `frozen`, `review` and who made each change. |
| `saveApplicationStep` | Members | Saves one step's answers while the request is `draft` or `changes_requested`. Returns that step's errors by field. The web-address step saves only a name the request can hold: it reserves the name and releases the old one in one transaction. |
| `checkWebAddress` | Anyone signed in | Says at once if a name has a bad format, is reserved, or is held by another request. |
| `getAgreement` | Members and operators | Reads the current agreement. Once a request is accepted, reads the accepted version and who accepted it. `agreement` is null when none is set. |
| `acceptAgreement` | Owners | Needs every step to pass, a set agreement and fee, the version on the page, and a typed name. Copies `answers` to `frozen`, creates the record in `agreement_acceptances`, sets `awaiting_payment`, and emails the signer a copy. Shares the five a day of `submitApplication`. An older version gets `409 agreement-changed`. |
| `reopenApplication` | Owners | `awaiting_payment` to `draft`. Closes the payment page first, clears `frozen`, `agreementAcceptance` and `feeCheckout`, and keeps the record. Refused with `409 payment-received` when the page was already paid. |
| `startFeeCheckout` | Owners | Opens a payment page for a request in `awaiting_payment`. The amount and currency come from `console_config/settings`; anything in the request body is ignored. An open page for the same fee is reused, and a page with an old fee is closed first. A paid page returns `alreadyPaid` and no new page. |
| `submitApplication` | Owners | Sends a `changes_requested` request back to the hosting team. Needs every step to pass. Copies `answers` to `frozen`, sets `submitted`, adds to `history`, and emails the Owners and each operator. Five a day for one account. A `draft` gets `409 agreement-required`. |
| `withdrawApplication` | Owners | Sets `withdrawn` before approval, closes any open payment page, releases the name, and emails the Owners. |

A refusal for a form carries `error.fields`, a map of field path to message, for example `{ "event.days.0.date": "Enter a real date." }`.

The answers are checked with the same rules as `scripts/init-event.cjs` (ADR 0007 Principle 5). `functions/src/checks.cjs` turns them into the answers file `init-event.cjs` reads (`toInitAnswers`), builds `config/event` with the shared `buildEvent`, and checks it with the shared `validateEventConfig`. Each error goes back to its field in plain words. The sender address of a new site is `hello@<name>.eventrunner.org`.

A status email that fails is logged and does not undo the change. The status page shows the true state.

| `listApplicationsForReview` | Operators | Lists requests with one status (default `submitted`), newest change first, with the organization name. |
| `getApplicationForReview` | Operators | One request: its `revision`, the frozen answers, the history, the team and its open invites, the ticket choice, the connection state and the approval defaults. |
| `requestChanges` | Operators | `submitted` to `changes_requested`. Needs a note of at most 2,000 characters. Emails the Owners. |
| `declineApplication` | Operators | `submitted`, `changes_requested` or `awaiting_payment` to `declined`. Needs a note. Closes any open payment page. Frees the web-address name. Emails the Owners. |
| `approveApplication` | Operators | `submitted` to `approved`. Refuses with `409 connection-needed` when the chosen account is not connected. Records `review.settings`. Emails the Owners: "We are building your site". |
| `deleteSpamApplication` | Operators | Deletes a request that is not approved, closes any open payment page, frees its name, and writes an audit record. Needs `confirm: true`. |
| `getConsoleSettings` | Operators | Reads `console_config/settings`, the fee and the current agreement. |
| `saveConsoleSettings` | Operators | Checks and saves the build settings, and writes an audit record. Other fields on the document stay. |
| `saveEventFee` | Operators | Checks and saves the amount and currency, and writes an audit record. New payment pages use it. |
| `saveAgreement` | Operators | Saves the title and text as a new version, and writes an audit record. The same text saves nothing. |
| `consoleFeeWebhook` | Stripe, by signature | See "The agreement and the event fee". No sign-in and no CORS. |
| `startConnection` | Owners | Returns the provider's page to send the browser to. Thirty a day for one account. |
| `completeConnection` | The person who started it | Takes `state` and `code` from the return page, and finishes the connection. |
| `disconnectAccount` | Owners | Deletes the stored token and ends the connection at the provider, unless another request uses the account. Returns `revoked` and `shared`. |
| `listEventbriteEvents` | Owners | The client's upcoming Eventbrite events, for the picker. |
| `chooseEventbriteEvent` | Owners | Saves one event from that list. It checks the id against the list, so nothing typed can get in. |

The review functions read the operator allowlist on each call. A caller who is not on it gets `403 not-operator`, and the web page says "This page is for the hosting team".

The invite email carries the token after `#` in the link, so the browser does not send it to a server. The database keeps only its SHA-256. A new invite to the same address replaces the open one.

Mail goes through an injected mailer with four methods: `sendInvite`, `sendStatusChange` (to the Owners), `sendOperatorNotice` (to each operator) and `sendAgreementCopy` (to the signer). In production it is Postmark, with the console project's own `CONSOLE_POSTMARK_TOKEN` secret. The Stripe client is injected the same way, with `makeFakeStripe` in `functions/src/fakes.cjs` for tests. The tests make no network call.

## The agreement and the event fee

The amendment to ADR 0007 is the decision. A client finishes with no human: the steps pass, an Owner accepts the agreement, an Owner pays, and the request is `approved`.

**Closed by default.** With no usable agreement or fee, `getApplication` returns `signups.open: false`, the page says the site is not taking sign-ups right now, and `acceptAgreement` refuses with `409 signups-closed`. An agreement whose text no longer matches its `sha256` counts as missing.

**Going back.** Before paying, an Owner can return the request to `draft`. The record in `agreement_acceptances` stays, and accepting again creates a new one.

**The webhook.** `consoleFeeWebhook` is the only thing that counts a fee as paid. Returning from the payment page changes nothing: the status page says it is waiting for payment confirmation and checks again. The function:

1. Checks the Stripe signature on the raw request body, and refuses a bad one with 400.
2. Ignores every event except `checkout.session.completed` with `payment_status: paid`.
3. In one transaction, claims `console_fee_events/{sessionId}`, so a repeated event does nothing, and checks the request. It approves only when the request is in `awaiting_payment`, in the same organization, and this session and its amount and currency match `feeCheckout`.
4. On a match, sets `approved`, records `payment`, and adds a history entry with `by: 'payment'`.
5. After the commit, emails the Owners and operators and calls `deps.startBuild({ orgId, appId })` if it is present. A build that does not start is logged, sets `buildStart.state` to `failed`, writes an audit record and notifies operators. The payment stands.

**A payment that does not approve.** The money has moved, so the status stays and the operator gets what they need to refund it in the Stripe dashboard. The claim records the reason as its `outcome`: `wrong-status`, `not-current-session`, `amount-mismatch`, `wrong-organization` or `request-missing`. Each operator gets an email with the session and payment intent ids. When the request still exists it also gets `feeProblem`, which shows on the review page and in the queue. For a deleted request, the email and the claim are the only pointers. The console has no refund button and no way to clear `feeProblem`.

**Closing a request.** Withdraw, decline, delete as spam and going back to edit close the payment page first, then compare `feeCheckout.sessionId` with their first read inside the transaction. When a new page opened in between, they refuse with `409 status-changed`, and a second try closes the new page. The retention job re-checks `updatedAt` in its transaction, and opening a page changes `updatedAt`.

**Paid requests.** A paid request cannot be declined here, so the "decline one with a refund" path in the amendment is not built. An operator refunds in the Stripe dashboard.

The agreement text is plain text. The web page renders it as text in paragraphs, never as HTML. This repository holds no agreement text and no fee: operators enter both at `/review/settings`. ADR 0007 asks for legal review of the text before a real client signs.

## Operator review

ADR 0007 §5 is the decision. A paid request needs no operator decision, so this path is for requests that were sent before the amendment and any a client sends back after changes. No cloud resource exists before a request is approved.

1. The client submits. The request is `submitted` and appears in the queue at `/review`.
2. The operator opens it at `/review/<appId>` and reads the frozen answers, the team and the history.
3. The operator takes one decision:
   - **Request changes** with a note. The client changes the answers and submits again.
   - **Decline** with a note. The web-address name becomes free.
   - **Approve**. The form shows the build settings with their defaults. The operator can change each value.
4. The console emails each Owner of the organization, one message each. A failed email does not undo the decision, and one refused address does not stop the others. When any Owner was not emailed, the page says so.

Each decision sends `revision`, the length of `history` that `getApplicationForReview` gave the page. The decision runs in one transaction that reads the request first. When the status is not one the decision allows, or the history length is not the revision, the operator gets `409 status-changed` and reloads. So a second operator acting at the same time is refused, and so is a page opened before the client sent changed answers, even when the status is `submitted` again. Each decision adds `{ status, at, by, note }` to `history` and writes `review` = `{ note, by, at, settings }`.

Approval records `review.settings` = `{ gcpFolder, billingAccount, region, projectId, environment }`:

- `gcpFolder`, `billingAccount` and `region` come from `console_config/settings`. Operators edit them at `/review/settings`.
- `projectId` is `er-<name>` and `environment` is `<name>`, from the web-address name. For `nclocal` they are `er-nclocal` and `nclocal`. A project id has 6 to 30 characters: lowercase letters, digits and hyphens, a letter first and no hyphen last. A long name is cut to fit, and a short one gets `-site`.
- The server checks every value, the defaults included, and names the bad field.

Approval by an operator does not start the build yet. `runStartBuild` (`functions/src/buildDispatch.cjs`) starts it for any caller, and the site builder takes its settings from `review.settings`, or from `console_config/settings` when a request has none.

**Starting and retrying a build.** `startBuild` dispatches `provision-client.yml` with a GitHub App token that holds `actions: write` on this one repository. With a setting missing, or a placeholder key, it refuses, and `runStartBuild` records `buildStart.state` as `failed`, writes an audit record and notifies operators. A run that fails sets the same flag and sends operators the error. Either way the review queue shows the request, and its page offers **Retry the build** (`retryBuild`, operators only), which runs the same workflow again. One transaction checks and clears the failure, so a second click gets `409 not-retryable`. [The runbook](../docs/DEPLOY_RUNBOOK.md) section 12 has the setup and the error list.

**Spam.** **Delete as spam** deletes a request that is not yet approved, closes any open payment page and frees its name. A request that is approved or later cannot be deleted this way, because a site can exist for it.

**Retention.** The scheduled function `runApplicationRetention` runs each day at 04:17 Eastern time. It deletes `withdrawn`, `declined` and abandoned `awaiting_payment` requests 90 days after `updatedAt`, and frees their names. A request with a `feeProblem` stays. The records in `agreement_acceptances` and `console_fee_events` are never deleted. It checks each request again inside its own transaction, so a request that changed after the query stays. A second run is safe. Each delete writes an audit record. It deletes the request's stored account tokens first, and when one cannot be deleted the request stays for the next run. After the request is gone it ends each connection at the provider, unless another request uses the account. The same run sweeps expired `console_connection_states`.

## Account connections

ADR 0007 §4 is the decision. In the tickets step, and on the status page until the site is built, an Owner connects the client's own Stripe or Eventbrite account with a button, and picks an Eventbrite event from a list. `functions/src/connections.cjs` holds the flow, `connectors.cjs` the provider calls, and `secretStore.cjs` the Secret Manager calls. All three are injected, and the tests use fakes.

1. `startConnection` stores the SHA-256 of a random `state`, tied to the person, the request and the provider, for 60 minutes. It returns the provider's page, and the browser goes there.
2. The provider sends the browser to `/connect/<provider>/return`. That page removes the code from the address and posts it to `completeConnection`.
3. `completeConnection` uses up the `state` in a transaction, so it works once and only for the person who started it. It trades the code for a token, records the connection, and writes the token to the console's Secret Manager as `connection-<provider>-<appId>`.

The redirect address comes from `CONSOLE_PUBLIC_URL`, never from the request. The web app goes only to the provider's own https page, and comes back only to a request page inside the console.

**Where each thing is kept.**

| Where | What | Who can read it |
|---|---|---|
| `applications/{appId}.connections` | `stripe`: `connected`, `displayName`, `livemode`, `connectedAt`. `eventbrite`: `connected`, `displayName`, `connectedAt`, `event` (`id`, `name`, `start`). | Every member of the organization and every operator, directly |
| `console_connections/{appId}` | The account id, who connected it, and the event's Eventbrite organization | The functions |
| Secret Manager | The token | The functions |

**Sharing an account.** One account can serve several requests, in one organization or several. Ending a connection at the provider ends it for all of them, live sites included. So the only code that ends one is `revokeIfUnused`. It looks in `console_connections` for any request that names the account, and keeps the connection when it finds one, or when it cannot tell. A request's own token is always deleted. A row stays when the site builder moves a token to a client project, so it speaks for that site even if the application is later removed. A connection finishing in the moment between that check and the revoke can still be ended.

**When a connection can change.** While the request is `draft`, `changes_requested` or `submitted`, an Owner can connect, reconnect and disconnect. In `awaiting_payment` it cannot change, because payment approves the request with no further check: **Change your answers** closes the payment page and returns the request to `draft`. From `approved` on it cannot change, because the build uses it. A `withdrawn` or `declined` request can only disconnect.

**For the site builder (P8).** The builder reads the token with `connectionSecretId` and the details from `connections[provider]` and `console_connections`. `deleteStoredConnection(deps, appId, provider)` deletes the console's copy after the move, keeps the row in `console_connections`, and does not end the connection. Only the provider the client chose moves, so the builder also deletes any token left for the other one, and any test-mode token unless the run is in test mode.

The console does not hear about a client who removes the app from their provider account, so it shows that account as connected until the client reconnects. The builder tests each token before it moves it.

## Settings

| Name | Where | What it is |
|---|---|---|
| `CONSOLE_POSTMARK_TOKEN` | Secret Manager in the console project | The Postmark server token for invite and status email |
| `CONSOLE_STRIPE_SECRET_KEY` | Secret Manager in the console project | CCM's Stripe key, for the event fee. It must exist before a deploy. |
| `CONSOLE_STRIPE_FEE_WEBHOOK_SECRET` | Secret Manager in the console project | The signing secret of the Stripe webhook endpoint `https://console.eventrunner.org/api/consoleFeeWebhook`, which sends `checkout.session.completed`. It must exist before a deploy. |
| The event fee | `/review/settings` | The amount and currency clients pay. Sign-ups stay closed until it is set. |
| The agreement | `/review/settings` | The title and text clients accept. Sign-ups stay closed until it is set. Each save with new text is a new version. |
| `CONSOLE_GITHUB_APP_ID`, `CONSOLE_GITHUB_INSTALLATION_ID` | `functions/.env` | The console's GitHub App, which holds `actions: write` only. Unset, a build does not start, and operators are told. |
| `CONSOLE_GITHUB_REPOSITORY` | `functions/.env` | The repository holding `provision-client.yml`, as `owner/name` |
| `CONSOLE_GITHUB_APP_PRIVATE_KEY` | Secret Manager in the console project | That App's private key. It must exist before a deploy, and a placeholder refuses to start a build. |
| `CONSOLE_MAIL_FROM` | `functions/.env` | The sender, for example `Event Runner <hello@console.eventrunner.org>` |
| `CONSOLE_PUBLIC_URL` | `functions/.env` | `https://console.eventrunner.org`, for invite links, the links in status email and the addresses providers return to |
| `CONSOLE_STRIPE_SECRET_KEY` | Secret Manager in the console project | The Stripe platform account's secret key |
| `CONSOLE_STRIPE_CLIENT_ID` | `functions/.env` | The platform's Connect client id. Unset, the choice says it is not available yet. |
| `CONSOLE_EVENTBRITE_CLIENT_SECRET` | Secret Manager in the console project | The Eventbrite app's client secret |
| `CONSOLE_EVENTBRITE_CLIENT_ID` | `functions/.env` | The Eventbrite app's API key. Unset, the choice says it is not available yet. |
| `CONSOLE_ALLOWED_ORIGINS` | `functions/.env` | Extra origins for a local dev server, comma-separated |
| `VITE_CONSOLE_FIREBASE_*` | Build environment | The console project's public web settings: `API_KEY`, `AUTH_DOMAIN`, `PROJECT_ID`, `APP_ID` |
| `VITE_CONSOLE_API_BASE` | Build environment | Only for local development against the functions emulator |

## The guided setup in the web app

| Address | Page |
|---|---|
| `/organizations/:orgId` | The organization: its event sites and **Set up a new event site** |
| `/organizations/:orgId/applications/:appId/<step>` | One step of the setup. The steps are `organization`, `event`, `web-address`, `team`, `tickets`, `email`, `review`, `agreement` and `fee`. |
| `/organizations/:orgId/applications/:appId` | The status page: the plain stages, the note from the hosting team, the connected account, and **Withdraw the request**. `?payment=done` and `?payment=cancelled` are where the payment page returns. |
| `/connect/:provider/return` | Where a provider sends the browser back. It finishes the connection and returns to the page the client left. |

Each step saves as the client types, after a short pause. Next, Back and the step list send a waiting save first. When a save fails, the step stays open and says the answers are not saved; the next try sends them again, and Next waits until they are saved. When the server refuses a web-address name, it keeps the old name, so the review holds the request and links to the step until a new name saves. Errors show by field once the client touches the field. Add `?check=1` to a step address to show all of its errors and put the focus on the first one; the review links use it. The tickets step saves the choice, then for Stripe and Eventbrite shows **Connect with Stripe** or **Connect with Eventbrite**. It saves waiting answers before the browser leaves for the provider. The answers check needs a live connection, and for Eventbrite a chosen event, before the request can move on.

The agreement step opens when every answer passes and sign-ups are open. The event fee step opens when the request is in `awaiting_payment`, and the answer steps then stay closed until an Owner selects **Change your answers**. An address for a step that is not open goes to the last open one. The step list shows those steps without a link.

## Tests

Run these from the repository root. None of them needs credentials.

```sh
npm run prepare:functions   # once, so console/functions can load the shared package
npm test               # includes console/functions/src/*.test.cjs (fake database, fake auth, fake mailer, a fixed clock)
npm run test:console   # the web pages (vitest); npm run test:web runs it too
npm run test:rules     # includes console/tests/console.rules.test.js on the emulator
npm run lint           # covers console/
```

## Deploy

The one-time setup and the deploy steps are in [docs/DEPLOY_RUNBOOK.md](../docs/DEPLOY_RUNBOOK.md), section "Client console".

## Brand files

`web/public/favicon.svg` is the Event Runner mark reversed out of the house accent. `web/public/og-console.png` is the sharing image. `scripts/dev/build-social-cards.mjs` draws it with the docs cards.
