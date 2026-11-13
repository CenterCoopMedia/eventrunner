# Client console

The client console is where a client opens a signup link, names its organization, invites its team and answers the guided setup for its event site. It runs at `console.eventrunner.org` in its own Firebase project, which CCM owns. It is not part of a client deployment, and no client project reads from it. [ADR 0007](../docs/adr/0007-client-console-self-serve-onboarding.md) is the decision record.

This folder holds sign-in, organizations and the team (P4), the guided setup with its status page (P5), account connections (P6), operator review (P7), signup links and the agreement (ADR 0007, amendments of 2026-11-04), and the start of the site builder (P8). The builder itself is `scripts/provision-client.cjs`, run by `.github/workflows/provision-client.yml`.

## What is here

| Path | What it is |
|---|---|
| `firebase.json` | The console project's own Firebase configuration: functions, rules, indexes and hosting. |
| `firestore.rules` | Read rules for the browser. The browser writes nothing. |
| `firestore.indexes.json` | The collection-group index for "my organizations", the review queue index (`status`, `updatedAt` descending), and the retention index (`status`, `updatedAt` ascending). |
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
| `organizations/{orgId}` | `name`, `createdAt`, `createdBy` (uid) | `redeemSignupLink`; deleted with its members and unused requests by `deleteOrganization` |
| `organizations/{orgId}/members/{uid}` | `uid`, `email` (lowercase), `role` (`owner` or `editor`), `joinedAt` | `redeemSignupLink`, `acceptInvite`, `changeMemberRole`, `removeMember` |
| `invites/{inviteId}` | `orgId`, `email` (lowercase), `role`, `tokenHash` (SHA-256 of the token), `status` (`pending`, `accepted` or `replaced`), `invitedBy`, `invitedByEmail`, `createdAt`, `expiresAt`, and after use `acceptedBy` and `acceptedAt` | `inviteMember`, `acceptInvite` |
| `signup_links/{linkId}` | `organizationName`, `tokenHash` (SHA-256 of the token), `status` (`open`, `used` or `revoked`), `createdBy`, `createdAt`, `expiresAt`, and after use `usedBy`, `usedEmail`, `usedAt`, `orgId` and `appId`. No browser can read it. | `createSignupLink`, `revokeSignupLink`, `redeemSignupLink` |
| `applications/{appId}` | `orgId`, `status`, `answers`, `frozen` (a copy of `answers` at acceptance, else null), `createdBy`, `createdAt`, `updatedAt`, `updatedBy`, `submittedAt`, `submittedBy`, `history` (a list of `{ status, at, by, note }`, oldest first), `review` (null, or `{ note, by, at, settings: null }` on a decline, a close or a launch), `agreementAcceptance` (null, or `{ id, version, sha256, name, legalName, title, email, at }`, the pointer to the current record), `buildStart` (`{ state, at }`, with `state` `pending`, `started` or `failed`), `connections` (see "Account connections") | `redeemSignupLink`, `saveApplicationStep`, `acceptAgreement`, `withdrawApplication`, `retryBuild`; `declineApplication`, `closeApplication`, `launchApplication`, `deleteSpamApplication`, the retention job. Only `declineApplication`, `closeApplication` and `launchApplication` write `review`. Only `completeConnection`, `disconnectAccount`, `chooseEventbriteEvent` and `closeApplication` write `connections`. |
| `console_connections/{appId}` | `stripe` (`accountId`, `connectedBy`, `livemode`), `eventbrite` (`accountId`, `connectedBy`, `eventOrganizationId`). No browser can read it, operators included. | `completeConnection`, `disconnectAccount`, `chooseEventbriteEvent`; deleted with the application by spam delete and the retention job |
| `console_connection_states/{hash}` | `uid`, `orgId`, `appId`, `provider`, `createdAt`, `expiresAt` for a connection in progress. The id is the SHA-256 of the `state` value. No browser can read it. | `startConnection`, `completeConnection`; the retention job sweeps expired ones |
| `console_token_deletions/{appId}` | `connected` (the accounts) and `at`, for a closed or deleted request whose token or route cleanup is unfinished; `routesOnly: true` when only a connection change's route release failed. No browser can read it. | Close or delete of a request, or a failed route release; removed after cleanup, with retention retrying unfinished work. A routes-only retry does not touch tokens. |
| `site_names/{name}` | `appId`, `orgId`, `reservedAt` | `saveApplicationStep` (web-address step), `withdrawApplication`; review frees a name on decline, spam delete and retention. |
| `console_config/operators` | `emails` (lowercase) | A CCM operator, by hand in the Firebase console |
| `console_config/settings` | `gcpFolder`, `billingAccount`, `region` | `saveConsoleSettings`. The site builder reads them for every build. |
| `console_config/agreement` | `version`, `title`, `body`, `sha256`, `savedAt`, `savedBy`: the current agreement | `saveAgreement` |
| `console_config/agreement/versions/{version}` | The same fields. Each version is created once and never changes. | `saveAgreement` |
| `agreement_acceptances/{id}` | `version`, `sha256`, `typedName`, `legalName`, `title`, `email` (verified), `uid`, `orgId`, `appId`, `at`. Created once, never changed, and kept when the request is deleted. | `acceptAgreement` |
| `console_rate_limits/{key}` | `count`, `windowStart` | The functions |
| `console_builds/{appId}` | The build record: `state` (`queued`, `running`, `failed` or `done`), `runUrl`, `testMode`, `startedAt`, `updatedAt`, `finishedAt`, `failedStep`, `error`, `ownersEmailedAt`, `steps` (a list of `{ id, label, state, at, detail }`). No browser can read it: an operator sees it through `getApplicationForReview`, and a client sees only the status. | `scripts/provision-client.cjs`, `retryBuild` |
| `console_audit/{id}` | `action`, `appId`, `linkId` or `orgId`, `by` (a uid, `retention`, `console`, `build` or `build-watch`), `at`, and `version` on `save-agreement`. No client data. Organization deletion writes only `action: delete-organization`, `orgId`, `by` and `at`. | `deleteOrganization`, `saveConsoleSettings`, `saveAgreement`, `createSignupLink`, `revokeSignupLink`, `closeApplication`, `deleteSpamApplication`, `retryBuild`, the retention job, the build watch, and a build that does not start |

An application is one event and one site. The client sees it as "your request". Its statuses are `draft`, `approved`, `building`, `ready`, `launched`, `withdrawn`, `declined` and `archived` (ADR 0007, the invoice and signup link amendment). One module, `packages/shared/src/consoleRequest.cjs`, holds the list, the groups the code checks, the moves the code makes and both sets of labels. An application is open unless it is `withdrawn` or `declined`. The hosting team moves a `ready` site to `launched` with **Mark as launched** when the event site opens to the public. `archived` is written by `scripts/decommission-client.cjs`.

A request is `draft` from the moment a signup link is used. It becomes `approved` when an Owner accepts the agreement, which starts the build, and nothing holds it in between.

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

A web-address name is 3 to 27 characters of lowercase letters, digits and hyphens. It does not start or end with a hyphen, and it is not on the reserved list in `functions/src/siteNames.cjs`. One `site_names` document per name means one holder per name.

A member record repeats its own uid. Firestore cannot query a collection group by document id, and "my organizations" is one collection-group query on that field.

## Roles

- **Owner**: runs the event site and manages the team. In the event admin, an Owner is an operator.
- **CCM support**: the builder merges `EVENT_SUPPORT_ADMIN_EMAILS` into the site's operator list. These accounts are labeled in Access, have full operator permissions, and use the same change/removal rules as other operators. A build retry adds the configured support accounts again and preserves client operators.

  The same setting gives those Google users permanent Editor access to the client Firebase/GCP project. The provisioner preserves existing IAM bindings and restores missing support grants on retry. Removing site access does not remove project access; CCM reviews that separately.
- **Editor**: edits the event content. In the event admin, an Editor is staff.
- **Operator**: a CCM person named in `console_config/operators`. An operator can read every organization and team, and reviews requests. An operator does not change a client's team.

An organization always keeps at least one Owner. The console recommends two Owners, so one lost inbox can't lock a team out. It is not a condition of finishing the setup, starting the build or launching.

## Functions

Each function is an HTTP POST with a JSON body and the person's ID token. The web app calls `/api/<name>`, and `firebase.json` sends that path to the function of the same name.

| Function | Who | What it does |
|---|---|---|
| `listOrganizations` | Anyone signed in | Lists my organizations. An operator also gets every organization. |
| `deleteOrganization` | Operators only | Requires `orgId` and `confirm: true`. One transaction checks that every request is draft, withdrawn or declined and was never approved, built or launched, with no build record, client project settings or retained agreement acceptance. Deletes the organization, members, invites, explicitly linked signup links, unused requests, reserved names, private connection rows and pending connection states. Writes a minimal audit entry. Stored account tokens use the existing durable cleanup and retention retry. |
| `getSignupLink` | Anyone signed in, with the token | Says whether a signup link can be used. See "Signup links". |
| `redeemSignupLink` | Anyone signed in, with the token | Uses the link: makes the organization, its Owner and a draft request in one transaction. See "Signup links". |
| `getTeam` | Members and operators | Lists the members, the open invites, and how many Owners launch still needs. |
| `inviteMember` | Owners | Emails an invite with an Owner or Editor role. Twenty a day for one organization, thirty a day for one person. |
| `acceptInvite` | The invited address | Joins the organization. The link works once and expires after seven days. |
| `changeMemberRole` | Owners | Changes a role. The last Owner cannot step down. |
| `removeMember` | Owners | Removes a member. The last Owner cannot be removed. |
| `listApplications` | Members and operators | Lists the organization's requests, newest first. |
| `getApplication` | Members and operators | Reads one request, with its errors by field, the progress of each step, the note from the hosting team, what the caller can do, `signups` (`{ open }`) and `build` (`{ failed, needsReconnect }`). The client never gets the error, the run link or the step detail. An operator also gets `frozen`, `review` and who made each change. |
| `saveApplicationStep` | Members | Saves one step's answers while the request is `draft`. Returns that step's errors by field. The web-address step saves only a name the request can hold: it reserves the name and releases the old one in one transaction. |
| `checkWebAddress` | Anyone signed in | Says at once if a name has a bad format, is reserved, or is held by another request. |
| `getAgreement` | Members and operators | Reads the current agreement. Once a request is accepted, reads the accepted version and who accepted it. `agreement` is null when none is set. |
| `acceptAgreement` | Owners | Needs a draft, every step to pass, sign-ups open, a live connection (on a live console, not a test-mode one), the version on the page, and a typed name, legal name and job title. Copies `answers` to `frozen`, creates the record in `agreement_acceptances`, sets `approved` and starts the build. See "Signup links and the agreement". Five a day for one account. An older version gets `409 agreement-changed`. |
| `withdrawApplication` | Owners | Sets `withdrawn` on a draft, releases the name, and emails the Owners. After acceptance it refuses, because the site is being built. |

A refusal for a form carries `error.fields`, a map of field path to message, for example `{ "event.days.0.date": "Enter a real date." }`.

The answers are checked with the same rules as `scripts/init-event.cjs` (ADR 0007 Principle 5). `functions/src/checks.cjs` turns them into the answers file `init-event.cjs` reads (`toInitAnswers`), builds `config/event` with the shared `buildEvent`, and checks it with the shared `validateEventConfig`. Each error goes back to its field in plain words. The sender address of a new site is `hello@<name>.eventrunner.org`.

A status email that fails is logged and does not undo the change. The status page shows the true state.

| `listApplicationsForReview` | Operators | Lists requests with one status, newest change first, with the organization name. |
| `getApplicationForReview` | Operators | One request: its `revision`, the frozen answers, the history, the team and its open invites, the ticket choice, the connection state and the build record. |
| `declineApplication` | Operators | `draft` to `declined`. Needs a note of at most 2,000 characters. Frees the web-address name. Emails the Owners. |
| `closeApplication` | Operators | Closes an accepted request once no run is alive, with a note: it becomes `declined`, ends its connections in the console, and writes an audit record. An Eventbrite token a run moved stays in the client project until that project is deleted. It frees its name only if no run ever began, because a run may have made the name's project. It removes nothing a run made. |
| `launchApplication` | Operators | `ready` to `launched` (**Mark as launched**), when the event site opens to the public. Emails the Owners. |
| `deleteSpamApplication` | Operators | Deletes a request that is not approved, frees its name, and writes an audit record. Needs `confirm: true`. |
| `retryBuild` | Owners and operators | Runs a failed build again. An Owner has a daily limit. A build that has not failed gets `409 not-retryable`, and a ticket account that is gone, in test mode or being changed gets `409 connection-needed`. |
| `createSignupLink` | Operators | Makes a signup link for an organization name. The answer holds the only copy of its URL. See "Signup links". |
| `listSignupLinks` | Operators | The newest 100 links, with an open link past its date shown as `expired`. Never the URL or the token hash. |
| `revokeSignupLink` | Operators | Revokes an open link. Any other link gets `409`. Writes an audit record. |
| `getConsoleSettings` | Operators | Reads `console_config/settings` and the current agreement. |
| `saveConsoleSettings` | Operators | Checks and saves the build settings, and writes an audit record. |
| `saveAgreement` | Operators | Saves the title and text as a new version, and writes an audit record. The same text saves nothing. |
| `startConnection` | Owners | Returns the provider's page to send the browser to. Thirty a day for one account. |
| `completeConnection` | The person who started it | Takes `state` and `code` from the return page, and finishes the connection. |
| `disconnectAccount` | Owners | Deletes the stored token and ends the connection at the provider, unless another request uses the account. Returns `revoked` and `shared`. |
| `listEventbriteEvents` | Owners | The client's upcoming Eventbrite events, for the picker. |
| `chooseEventbriteEvent` | Owners | Saves one event from that list. It checks the id against the list, so nothing typed can get in. |

The review functions read the operator allowlist on each call. A caller who is not on it gets `403 not-operator`, and the web page says "This page is for the hosting team".

The invite email carries the token after `#` in the link, so the browser does not send it to a server. The database keeps only its SHA-256. A new invite to the same address replaces the open one.

Mail goes through an injected mailer with four methods: `sendInvite`, `sendStatusChange` (to the Owners), `sendOperatorNotice` (to each operator) and `sendAgreementCopy` (to the signer). In production it is Postmark, with the console project's own `CONSOLE_POSTMARK_TOKEN` secret. The tests make no network call.

## Signup links and the agreement

The ADR 0007 amendment "invoice and signup link" is the decision. The event fee is invoiced outside the console, and the console holds no fee, price or invoice data. A client finishes with no human after the first step: an operator creates a link once the invoice is paid, the client signs in, enters the details, and an Owner accepts the agreement. The build then starts. [The runbook](../docs/DEPLOY_RUNBOOK.md) section 11.3 has the operator's steps.

**A link.** `functions/src/signupLinks.cjs` holds the code, modelled on invites. The address is `<CONSOLE_PUBLIC_URL>/start/<linkId>#token=<token>`. The token is 32 random bytes after `#`, so the browser does not send it to a server. The database keeps only its SHA-256, compared in constant time. A link works once and expires after 30 days. It is not tied to an email address, so a forwarded link works for the first person who uses it. `createSignupLink` returns the address, and nothing returns it again. `createLink(deps, { organizationName, by })` is the core, so automatic invoices can call it later.

**Refusals.** Before anything else, `getSignupLink` and `redeemSignupLink` check the token. A wrong token and a missing link get the same `404 link-invalid`. A link used by someone else gets `410 link-used`, a revoked one `410 link-revoked` and an old one `410 link-expired`. Each message tells the client to ask for a new link.

**Using a link.** `redeemSignupLink` runs one transaction: it reads the link and the signup terms again, creates the organization, the Owner and the draft request, and marks the link used. Any refusal leaves nothing behind. The same person repeating it gets the same organization and request, so a double click or a reload never makes two.

**Closed by default.** `readSignupTerms` returns `{ open, agreement, missing }`. `open` needs a usable agreement and `gcpFolder`, `billingAccount` and `region`, so nothing starts that cannot build. An agreement whose text no longer matches its `sha256` counts as missing. While closed, `createSignupLink`, `redeemSignupLink` and `acceptAgreement` refuse with `409 signups-closed`, and the message to the operator names what is missing. With `CONSOLE_PUBLIC_URL` unset, `createSignupLink` refuses with `not-configured`.

**Accepting.** One transaction sets `approved`, `frozen`, `submittedAt`, `submittedBy`, `agreementAcceptance`, `buildStart` (`pending`) and a history entry. A connection dropped since the first check refuses. After the commit it starts the build first, so a slow email can never lose it, then sends the signer a copy, emails the Owners and notifies operators. Each of those runs alone: a failure neither throws nor skips the next. The answer is `{ status, acceptanceId, copySent, emailed, buildStarted }`. A build that does not start is not an error to the client, and the status page shows it.

The agreement text is plain text. The web page renders it as text in paragraphs, never as HTML. This repository holds no agreement text: operators enter it at `/review/settings`. ADR 0007 asks for legal review of the text before a real client signs.

## Operator review

No operator decision stands between a client and a build (ADR 0007, the invoice and signup link amendment). The queue at `/review` and the page at `/review/<appId>` show the frozen answers, the team, the history and the build record. An operator can:

- **Decline** a draft with a note. The web-address name becomes free, and each Owner gets an email. A failed email does not undo the decision, and when any Owner was not emailed, the page says so.
- **Close request** for an accepted request once no run is alive, with a note. See `closeApplication`.
- **Mark as launched** when a `ready` site opens to the public.
- **Retry the build** when a build has failed.
- **Delete as spam**. See below.

A decline sends `revision`, the length of `history` that `getApplicationForReview` gave the page. It runs in one transaction that reads the request first. When the status is not `draft`, or the history length is not the revision, the operator gets `409 status-changed` and reloads.

**Build settings.** The site builder takes its settings from `console_config/settings` and the web-address name. Operators edit `gcpFolder`, `billingAccount` and `region` at `/review/settings`. `projectId` is `er-<name>` and `environment` is `<name>`. For `nclocal` they are `er-nclocal` and `nclocal`. A project id has 6 to 30 characters: lowercase letters, digits and hyphens, a letter first and no hyphen last. A long name is cut to fit, and a short one gets `-site`. The server checks every value and names the bad field.

**Starting and retrying a build.** `startBuild` dispatches `provision-client.yml` with a GitHub App token that holds `actions: write` on this one repository. With a setting missing, or a placeholder key, it refuses, and `runStartBuild` records `buildStart.state` as `failed`, writes an audit record and notifies operators. A run that fails sets the same flag, sends operators the error, and emails the Owners that it did not finish, with the status link. The status page says the same, offers **Retry the build**, and offers **Reconnect** when the failed step is `tickets`. The review page offers **Retry the build** too. `retryBuild` runs the same workflow again. One transaction checks and clears the failure, so a second click gets `409 not-retryable`. [The runbook](../docs/DEPLOY_RUNBOOK.md) section 12 has the setup and the error list.

**Spam.** **Delete as spam** deletes a request that is not yet approved and frees its name, unless a build began for it before it was closed. A request that is approved or later cannot be deleted this way, because a site can exist for it.

**Silent builds.** The scheduled function `runBuildWatch` runs every hour. A run that fails before it signs in to Google Cloud writes nothing, and a lost runner leaves its record at `running`. An hour after a start with no record, or six hours after a run started and never finished, it flags the request as failed, writes an audit record and emails the Owners and operators once. Retrying clears the flag.

**Retention.** The scheduled function `runApplicationRetention` runs each day at 04:17 Eastern time. It deletes `withdrawn` and `declined` requests 90 days after `updatedAt`, and frees their names unless a build began for them. A `draft` stays, because it belongs to a client whose invoice was paid. The records in `agreement_acceptances` are never deleted. It checks each request again inside its own transaction, so a request that changed after the query stays. A second run is safe. Each delete writes an audit record. A request with a connection change running stays. After the request is gone it deletes the stored account tokens and ends each connection at the provider, unless another request uses the account. A token that cannot be deleted keeps its `console_token_deletions` row, and the next run tries again. The same run sweeps expired `console_connection_states`.

## Account connections

ADR 0007 §4 is the decision. In the tickets step, and on the status page while the request is a draft or its build has failed, an Owner connects the client's own Stripe or Eventbrite account with a button, and picks an Eventbrite event from a list. `functions/src/connections.cjs` holds the flow, `connectors.cjs` the provider calls, and `secretStore.cjs` the Secret Manager calls. All three are injected, and the tests use fakes.

1. `startConnection` stores the SHA-256 of a random `state`, tied to the person, the request and the provider, for 60 minutes. It returns the provider's page, and the browser goes there.
2. The provider sends the browser to `/connect/<provider>/return`. That page removes the code from the address and posts it to `completeConnection`.
3. `completeConnection` uses up the `state` in a transaction, so it works once and only for the person who started it. It trades the code for a token, records the connection, and writes the token to the console's Secret Manager as `connection-<provider>-<appId>`.

The redirect address comes from `CONSOLE_PUBLIC_URL`, never from the request. The web app goes only to the provider's own https page, and comes back only to a request page inside the console.

**Where each thing is kept.**

| Where | What | Who can read it |
|---|---|---|
| `applications/{appId}.connections` | `stripe`: `connected`, `displayName`, `livemode`, `connectedAt`. `eventbrite`: `connected`, `displayName`, `connectedAt`, `event` (`id`, `name`, `start`). | Every member of the organization and every operator, directly |
| `console_connections/{appId}` | The account id, who connected it, Stripe's `livemode`, and the event's Eventbrite organization | The functions |
| Secret Manager | The token | The functions |

**Sharing an account.** One account can serve several requests, in one organization or several. Ending a connection at the provider ends it for all of them, live sites included. The Console checks other private connections and Stripe routes before revoking an account, keeping authorization when another request or site uses it, or when it cannot tell. A request's own token is always deleted. A row stays when the site builder moves a token to a client project, so it speaks for that site even if the application is later removed. A connection finishing in the moment between that check and the revoke can still be ended.

**Live Stripe delivery.** Distinct live accounts can connect independently. Each live site's build records a private route in `console_stripe_routes` and copies its site signing secret to the Console's `stripe-webhook-` secret prefix. One platform Connect endpoint sends events to `stripeConnectWebhook`. It verifies the platform signature before reading the route, then forwards the original bytes only to that site's `ticketingWebhook`, signed with the site's secret. A signed live account without a route is acknowledged without forwarding; a structured warning records only its account and event IDs. The `stripe_connect_unrouted` logs-based counter counts those warnings. This avoids retries for an unbuilt or retired site disabling the shared endpoint for every client. Bad or missing signatures return 400; missing HTTP paths return 404. A failed routed delivery remains retryable. Direct test accounts keep their own endpoints. The [migration runbook](../docs/runbooks/stripe-connect-receiver.md) records setup and verification.

[Live Connect endpoints also receive test events](https://support.stripe.com/questions/connect-account-webhook-configurations). After signature and account-ID validation, a boolean `livemode: false` receives `200 ignored` with one log line containing only validated account and event IDs. The receiver does not look up a route, read a site secret, forward the event or change state. Missing or invalid account IDs and non-boolean mode values return 400.

**When a connection can change.** While the request is `draft`, an Owner can connect, reconnect and disconnect. From `approved` on it cannot change, because the build uses it, with one exception: while the request is `approved` or `building` and its build has failed, an Owner can reconnect the chosen account, and only that one. The frozen answers stay frozen, and only the connection changes. A `withdrawn` or `declined` request can only disconnect. A `ready` or `launched` site's Owner can end its Stripe connection, through Stripe, unless another site uses the account. Its Eventbrite connection is an operator step ([runbook](../docs/DEPLOY_RUNBOOK.md) §12.5).

After a Stripe replacement, disconnect, operator close or request deletion, the Console releases only that application's routes whose accounts are no longer named by its private connection row. Recorded-token deletion retries use the same application identity and keep their existing work row until token and route cleanup finish. The transaction respects an active connection-change lease, so a replacement can still roll back to the previous route. Current and other applications' routes stay intact. The provider-revocation decision runs first; a failed route cleanup is logged and recorded as a routes-only retry for retention, while the completed connection keeps its normal reply.

**For the site builder (P8).** The builder reads the token with `connectionSecretId` and the details from `connections[provider]` and `console_connections`. `deleteStoredConnection(deps, appId, provider)` deletes the console's copy after the move, keeps the row in `console_connections`, and does not end the connection. Only the provider the client chose moves, so the builder also deletes any token left for the other one, and any test-mode token unless the run is in test mode.

The console does not hear about a client who removes the app from their provider account, so it shows that account as connected until the client reconnects. The builder tests each token before it moves it.

## Settings

| Name | Where | What it is |
|---|---|---|
| `CONSOLE_POSTMARK_TOKEN` | Secret Manager in the console project | The Postmark server token for invite and status email |
| The client folder, billing account and region | `/review/settings` | Where client sites are built. Signup links stay closed until all three are set. |
| The agreement | `/review/settings` | The title and text clients accept. Signup links stay closed until it is set. Each save with new text is a new version. |
| `CONSOLE_GITHUB_APP_ID`, `CONSOLE_GITHUB_INSTALLATION_ID` | `functions/.env` | The console's GitHub App, which holds `actions: write` only. Unset, a build does not start, and operators are told. |
| `CONSOLE_GITHUB_REPOSITORY` | `functions/.env` | The repository holding `provision-client.yml`, as `owner/name` |
| `CONSOLE_GITHUB_APP_PRIVATE_KEY` | Secret Manager in the console project | That App's private key. It must exist before a deploy, and a placeholder refuses to start a build. |
| `CONSOLE_TEST_MODE` | `functions/.env` | `true` on a rehearsal console only: a test-mode ticket account can accept, and every build runs in test mode. Only the ticket account is in test mode: a build still makes real, billed resources. Unset on a console that serves clients. |
| `CONSOLE_MAIL_FROM` | `functions/.env` | The sender, for example `Event Runner <hello@console.eventrunner.org>` |
| `CONSOLE_PUBLIC_URL` | `functions/.env` | `https://console.eventrunner.org`, for invite links, signup links, the links in status email and the addresses providers return to |
| `CONSOLE_STRIPE_SECRET_KEY` | Secret Manager in the console project | A live restricted platform key with Connect OAuth: Write for client connections, and Webhook Endpoints, Event Destinations: Write for operator endpoint maintenance (a test key on a rehearsal console). Live site builds register routes without reading this key. It must exist before a deploy, and a deploy picks up each new version. |
| `CONSOLE_STRIPE_WEBHOOK_SECRET` | Secret Manager in the console project | The shared platform endpoint's signing secret, bound only to `stripeConnectWebhook`. It must exist before a Console deployment. The receiver also needs read access to the `stripe-webhook-` prefix; the provisioner manages the per-site copies. |
| `CONSOLE_STRIPE_CLIENT_ID` | `functions/.env` | The platform's Connect client id. Unset, the choice says it is not available yet. |
| `CONSOLE_EVENTBRITE_CLIENT_SECRET` | Secret Manager in the console project | The Eventbrite app's client secret |
| `CONSOLE_EVENTBRITE_CLIENT_ID` | `functions/.env` | The Eventbrite app's API key. Unset, the choice says it is not available yet. |
| `CONSOLE_ALLOWED_ORIGINS` | `functions/.env` | Extra origins for a local dev server, comma-separated |
| `VITE_CONSOLE_FIREBASE_*` | Build environment | The console project's public web settings: `API_KEY`, `AUTH_DOMAIN`, `PROJECT_ID`, `APP_ID` |
| `VITE_CONSOLE_HELP_EMAIL` | Build environment | The address clients see for reaching the hosting team. Unset, no page shows one. |
| `CONSOLE_HELP_NAME` | Repo variable, passed to the web build and the functions | The person clients are told to ask, in the help line and in messages about signup links, withdrawn requests, failed builds and notes. Unset, they say the hosting team. |
| `VITE_CONSOLE_API_BASE` | Build environment | Only for local development against the functions emulator |
| `VITE_CONSOLE_SIGN_IN_PROVIDERS` | Repo variable, passed to the web build | The sign-in buttons, comma-separated. Unset: `google,microsoft` |
| `CONSOLE_REPORT_INTAKE_URL` | `functions/.env` | Where "Report a problem" sends reports (the operator's triage service) |
| `CONSOLE_REPORT_PROJECTS` | `functions/.env` | Extra client projects whose admins may report, for sites from before the console |
| `CONSOLE_REPORT_INTAKE_SECRET` | Secret Manager in the console project | The triage service's intake key |
| `CONSOLE_REPORT_ACCESS_ID`, `CONSOLE_REPORT_ACCESS_SECRET` | Secret Manager in the console project | The access-gate service token for that intake path: its id and its secret |

## The guided setup in the web app

| Address | Page |
|---|---|
| `/` | The reader's organizations. A reader with none is told that event sites start from a signup link, and that a teammate joins from an invite email. |
| `/start/:linkId` | A signup link. It reads the token from the address, then asks for the organization name. A link this person already used goes straight to the request. |
| `/organizations/:orgId` | The organization and its event site |
| `/organizations/:orgId/applications/:appId/<step>` | One step of the setup. The steps are `organization`, `event`, `web-address`, `team`, `tickets`, `email`, `review` and `agreement`. |
| `/organizations/:orgId/applications/:appId` | The status page: the plain stages, the note from the hosting team, the connected account, **Withdraw the request** on a draft, and the failed-build steps. |
| `/connect/:provider/return` | Where a provider sends the browser back. It finishes the connection and returns to the page the client left. |
| `/review/links` | Operators only: create a signup link, copy it once, and see and revoke links. |

Each step saves as the client types, after a short pause. Next, Back and the step list send a waiting save first. When a save fails, the step stays open and says the answers are not saved; the next try sends them again, and Next waits until they are saved. When the server refuses a web-address name, it keeps the old name, so the review holds the request and links to the step until a new name saves. Errors show by field once the client touches the field. Add `?check=1` to a step address to show all of its errors and put the focus on the first one; the review links use it. The tickets step saves the choice, then for Stripe and Eventbrite shows **Connect with Stripe** or **Connect with Eventbrite**. It saves waiting answers before the browser leaves for the provider. The answers check needs a live connection, and for Eventbrite a chosen event, before the request can move on.

The agreement step is last, and opens when every answer passes and sign-ups are open. After acceptance the client goes to the status page, which says the site is being built. An address for a step that is not open goes to the last open one. The step list shows those steps without a link.

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

Page titles use `web/src/PageHeading.jsx`, which keeps the semantic heading
and its route focus target while placing a still, decorative Badger beside
wrapping text. The drawing stays in the page flow at 48px, or 36px on phones.
Refresh and close actions remain beside their existing heading groups.
Loading and build feedback keep their separate waiting animation.

The masthead uses the running Badger mark. `web/public/favicon.svg` uses the
face on an accent tile, with a dark-mode variant. `web/public/og-console.png`
is the dark-panel sharing image. The PNG favicon, Apple touch icon, and app
icons use the same face. `web/public/manifest.webmanifest` lists the app icons
and uses the dark console theme and background colors.

Sources and the selected concepts are in [design/brand](../design/brand/README.md).
Run `node scripts/dev/build-social-cards.mjs` from the repository root to
rebuild the SVG cards, favicons, and all PNGs with system Chrome headless.
Run the render command in a local terminal outside the agent sandbox.
Use `--check` to compare without writing repository files. Set `CHROME` if
Chrome is not at the standard macOS path or on `PATH`.
