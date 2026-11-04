# Client console

The client console is where a client signs up, names its organization and invites its team. It runs at `console.eventrunner.org` in its own Firebase project, which CCM owns. It is not part of a client deployment, and no client project reads from it. [ADR 0007](../docs/adr/0007-client-console-self-serve-onboarding.md) is the decision record.

This folder holds the first part (P4): sign-in, organizations and the team. The guided setup, account connections, operator review and provisioning come in later parts.

## What is here

| Path | What it is |
|---|---|
| `firebase.json` | The console project's own Firebase configuration: functions, rules, indexes and hosting. |
| `firestore.rules` | Read rules for the browser. The browser writes nothing. |
| `firestore.indexes.json` | The collection-group index for "my organizations". |
| `functions/` | The server functions. They own every write. |
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
| `console_config/operators` | `emails` (lowercase) | A CCM operator, by hand in the Firebase console |
| `console_rate_limits/{key}` | `count`, `windowStart` | The functions |

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

The invite email carries the token after `#` in the link, so the browser does not send it to a server. The database keeps only its SHA-256. A new invite to the same address replaces the open one.

Mail goes through an injected mailer. In production it is Postmark, with the console project's own `CONSOLE_POSTMARK_TOKEN` secret. The tests use a fake and make no network call.

## Settings

| Name | Where | What it is |
|---|---|---|
| `CONSOLE_POSTMARK_TOKEN` | Secret Manager in the console project | The Postmark server token for invite email |
| `CONSOLE_MAIL_FROM` | `functions/.env` | The sender, for example `Event Runner <hello@console.eventrunner.org>` |
| `CONSOLE_PUBLIC_URL` | `functions/.env` | `https://console.eventrunner.org`, for invite links |
| `CONSOLE_ALLOWED_ORIGINS` | `functions/.env` | Extra origins for a local dev server, comma-separated |
| `VITE_CONSOLE_FIREBASE_*` | Build environment | The console project's public web settings: `API_KEY`, `AUTH_DOMAIN`, `PROJECT_ID`, `APP_ID` |
| `VITE_CONSOLE_API_BASE` | Build environment | Only for local development against the functions emulator |

## Tests

Run these from the repository root. None of them needs credentials.

```sh
npm test               # includes console/functions/src/*.test.cjs (fake database, fake auth, fake mailer)
npm run test:console   # the web pages (vitest); npm run test:web runs it too
npm run test:rules     # includes console/tests/console.rules.test.js on the emulator
npm run lint           # covers console/
```

## Deploy

The one-time setup and the deploy steps are in [docs/DEPLOY_RUNBOOK.md](../docs/DEPLOY_RUNBOOK.md), section "Client console".

## Brand files

`web/public/favicon.svg` is the Event Runner mark reversed out of the house accent. `web/public/og-console.png` is the sharing image. `scripts/dev/build-social-cards.mjs` draws it with the docs cards.
