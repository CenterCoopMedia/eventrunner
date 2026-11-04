# Client console

The client console is where a client signs up, names its organization, invites its team and answers the guided setup for each event site. It runs at `console.eventrunner.org` in its own Firebase project, which CCM owns. It is not part of a client deployment, and no client project reads from it. [ADR 0007](../docs/adr/0007-client-console-self-serve-onboarding.md) is the decision record.

This folder holds the first two parts: sign-in, organizations and the team (P4), and the guided setup with its status page (P5). Account connections, operator review and provisioning come in later parts.

## What is here

| Path | What it is |
|---|---|
| `firebase.json` | The console project's own Firebase configuration: functions, rules, indexes and hosting. |
| `firestore.rules` | Read rules for the browser. The browser writes nothing. |
| `firestore.indexes.json` | The collection-group index for "my organizations". |
| `functions/` | The server functions. They own every write. `functions/vendor/shared.tgz` is the shared package, packed by `npm run prepare:functions`. |
| `web/` | The web app (Vite and React). It builds to `web/dist`. |
| `tests/` | The rules suite. It runs on the Firestore emulator. |

The client deploy (`.github/workflows/deploy-client.yml` with the root `firebase.json`) never reads this folder. `scripts/console-isolation.test.cjs` checks that.

## Sign-in

A person signs in with Google, with Microsoft, or with a link sent by email. Every write needs a verified email address. When a provider does not confirm the address, the console asks the person to get a sign-in link by email, which confirms it.

The console uses plain words. It never says Firebase, project, tenant, environment, webhook or secret.

## Data model

| Document | Fields | Written by |
|---|---|---|
| `organizations/{orgId}` | `name`, `createdAt`, `createdBy` (uid) | `createOrganization` |
| `organizations/{orgId}/members/{uid}` | `uid`, `email` (lowercase), `role` (`owner` or `editor`), `joinedAt` | `createOrganization`, `acceptInvite`, `changeMemberRole`, `removeMember` |
| `invites/{inviteId}` | `orgId`, `email` (lowercase), `role`, `tokenHash` (SHA-256 of the token), `status` (`pending`, `accepted` or `replaced`), `invitedBy`, `invitedByEmail`, `createdAt`, `expiresAt`, and after use `acceptedBy` and `acceptedAt` | `inviteMember`, `acceptInvite` |
| `applications/{appId}` | `orgId`, `status`, `answers`, `frozen` (a copy of `answers` at submit, else null), `createdBy`, `createdAt`, `updatedAt`, `updatedBy`, `submittedAt`, `submittedBy`, `history` (a list of `{ status, at, by, note }`, oldest first), `review` (null, or `{ note, by, at, settings }`) | `createApplication`, `saveApplicationStep`, `submitApplication`, `withdrawApplication`; `review` only by operator review (P7) |
| `site_names/{name}` | `appId`, `orgId`, `reservedAt` | `saveApplicationStep` (web-address step), `withdrawApplication` |
| `console_config/operators` | `emails` (lowercase) | A CCM operator, by hand in the Firebase console |
| `console_config/settings` | `gcpFolder`, `billingAccount`, `region` | Operator review (P7). The guided setup does not read it. |
| `console_rate_limits/{key}` | `count`, `windowStart` | The functions |

An application is one event and one site. The client sees it as "your request". Its statuses are `draft`, `submitted`, `changes_requested`, `approved`, `building`, `ready`, `launched`, `withdrawn` and `declined` (ADR 0007 §5). An application is open unless it is `withdrawn` or `declined`.

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
- **Operator**: a CCM person named in `console_config/operators`. An operator can read every organization and team. An operator does not change a client's team.

An organization always keeps at least one Owner. The console asks for two Owners before launch, because launch readiness needs two operators.

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
| `submitApplication` | Owners | Needs every step to pass and two Owners. Copies `answers` to `frozen`, sets `submitted`, adds to `history`, and emails the Owners and each operator. Five a day for one account. |
| `withdrawApplication` | Owners | Sets `withdrawn` before approval, releases the name, and emails the Owners. |

A refusal for a form carries `error.fields`, a map of field path to message, for example `{ "event.days.0.date": "Enter a real date." }`.

The answers are checked with the same rules as `scripts/init-event.cjs` (ADR 0007 Principle 5). `functions/src/checks.cjs` turns them into the answers file `init-event.cjs` reads (`toInitAnswers`), builds `config/event` with the shared `buildEvent`, and checks it with the shared `validateEventConfig`. Each error goes back to its field in plain words. The sender address of a new site is `hello@<name>.eventrunner.org`.

A status email that fails is logged and does not undo the change. The status page shows the true state.

The invite email carries the token after `#` in the link, so the browser does not send it to a server. The database keeps only its SHA-256. A new invite to the same address replaces the open one.

Mail goes through an injected mailer with three methods: `sendInvite`, `sendStatusChange` (to the Owners) and `sendOperatorNotice` (to each operator). In production it is Postmark, with the console project's own `CONSOLE_POSTMARK_TOKEN` secret. The tests use a fake and make no network call.

## Settings

| Name | Where | What it is |
|---|---|---|
| `CONSOLE_POSTMARK_TOKEN` | Secret Manager in the console project | The Postmark server token for invite and status email |
| `CONSOLE_MAIL_FROM` | `functions/.env` | The sender, for example `Event Runner <hello@console.eventrunner.org>` |
| `CONSOLE_PUBLIC_URL` | `functions/.env` | `https://console.eventrunner.org`, for invite links and the links in status email |
| `CONSOLE_ALLOWED_ORIGINS` | `functions/.env` | Extra origins for a local dev server, comma-separated |
| `VITE_CONSOLE_FIREBASE_*` | Build environment | The console project's public web settings: `API_KEY`, `AUTH_DOMAIN`, `PROJECT_ID`, `APP_ID` |
| `VITE_CONSOLE_API_BASE` | Build environment | Only for local development against the functions emulator |

## The guided setup in the web app

| Address | Page |
|---|---|
| `/organizations/:orgId` | The organization: its event sites and **Set up a new event site** |
| `/organizations/:orgId/applications/:appId/<step>` | One step of the setup. The steps are `organization`, `event`, `web-address`, `team`, `tickets`, `email` and `review`. |
| `/organizations/:orgId/applications/:appId` | The status page: the plain stages, the note from the hosting team, and **Withdraw the request** |

Each step saves as the client types, after a short pause. Next, Back and the step list send a waiting save first. When a save fails, the step stays open and says the answers are not saved; the next try sends them again, and **Create my site** waits until they are saved. Errors show by field once the client touches the field. Add `?check=1` to a step address to show all of its errors and put the focus on the first one; the review links use it. The tickets step records the choice only. For Stripe and Eventbrite it says "You connect this account after we approve your request." The connect buttons come in P6.

## Tests

Run these from the repository root. None of them needs credentials.

```sh
npm run prepare:functions   # once, so console/functions can load the shared package
npm test               # includes console/functions/src/*.test.cjs (fake database, fake auth, fake mailer)
npm run test:console   # the web pages (vitest); npm run test:web runs it too
npm run test:rules     # includes console/tests/console.rules.test.js on the emulator
npm run lint           # covers console/
```

## Deploy

The one-time setup and the deploy steps are in [docs/DEPLOY_RUNBOOK.md](../docs/DEPLOY_RUNBOOK.md), section "Client console".

## Brand files

`web/public/favicon.svg` is the Event Runner mark reversed out of the house accent. `web/public/og-console.png` is the sharing image. `scripts/dev/build-social-cards.mjs` draws it with the docs cards.
