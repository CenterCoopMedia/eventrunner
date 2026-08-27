# npm name claim

Operator runbook for claiming the `eventrunner` / `event-runner` npm package names and the
matching `@eventrunner` / `@event-runner` scopes, before anyone else can take them. See issue #99
for the full scope and safety boundaries this runbook implements.

**Who runs this:** a human operator with an authenticated, 2FA-protected npm account for the
Center for Cooperative Media (CCM) organization. Nothing here should be delegated to an unattended
session — steps 5 and 6 are explicit safety stops that need a human's go-ahead in the moment.

## 0. Before you start

- Confirm you're logged into the **organization's** npm account, not a personal one: `npm whoami`
  should print the CCM org account name, not your personal handle.
- Confirm that account has 2FA and organization-controlled recovery information configured (npm
  website → Account → Two-Factor Authentication, and Account → Profile for the recovery email).
  This is a one-time console check, not a command.

## 1. Recheck availability (do this first, and again immediately before publishing — step 5)

```sh
npm view eventrunner
npm view event-runner
npm view @eventrunner
npm view @event-runner
```

Expected result for all four: `npm ERR! 404 Not Found` (or the npm CLI's equivalent "not found"
message). If any of them resolves to a real package or org, stop — someone else has claimed it —
and tell the maintainer before doing anything else in this runbook.

## 2. Create the placeholder packages (scratch directory, outside this repo)

```sh
mkdir -p /tmp/eventrunner-npm-claim/eventrunner
mkdir -p /tmp/eventrunner-npm-claim/event-runner
```

For each directory, write a `package.json` with this content (only the `name` field differs
between the two):

```json
{
  "name": "eventrunner",
  "version": "0.0.0",
  "private": false,
  "description": "Reserved. Not a published product yet — see https://github.com/CenterCoopMedia/eventrunner.",
  "license": "UNLICENSED"
}
```

Do not add any other files (no README, no code) — this is a placeholder claim, not a release. Do
not commit the placeholder packages to this repo; they are published from a scratch directory
outside it.

## 3. Confirm npm login and 2FA before publishing

```sh
npm login
```

If prompted, complete 2FA. If you already have a session (`npm whoami` succeeds), you can skip
`npm login`, but still confirm you're the org account, not a personal one (see step 0).

## 4. Publish the placeholders

```sh
cd /tmp/eventrunner-npm-claim/eventrunner && npm publish --access public
cd /tmp/eventrunner-npm-claim/event-runner && npm publish --access public
```

`npm publish` with 2FA enabled prompts for a one-time code (or an npm-website approval, if you've
configured "Authorization for publishing" instead). Complete that prompt interactively. Do not
script around the 2FA prompt or store an automation token that skips it for this account.

## 5. Safety stop: recheck immediately before publication

Re-run step 1's four `npm view` commands **right before** step 4, not just once at the start of
this session, in case someone else claimed a name in between. If you're working through this
runbook in one sitting with no gap, the step-1 check already satisfies this. If any time has
passed — a different day, a paused session — rerun step 1 before step 4.

## 6. Safety stop: explicit final go-ahead

Publishing an npm package and creating an npm organization are both public, externally-visible
actions with no undo (an unpublished name is typically not immediately re-claimable, and org
creation is similarly hard to walk back cleanly). Before running step 4 (publish) and step 7
(create orgs), get an explicit "yes, go ahead" from the maintainer in the same session — a plan
approval from an earlier conversation does not count as this go-ahead.

## 7. Create the two npm organizations/scopes

Via the npm website (Account → Add Organization) or, if the installed npm CLI version supports it:

```sh
npm org create eventrunner
npm org create event-runner
```

An org claims the `@eventrunner` / `@event-runner` scope even before anything is published under
it — this step alone secures the scope. Add the maintainer (and anyone else who should have
publish rights) as an org member with the appropriate role.

## 8. Verify

```sh
npm view eventrunner
npm view event-runner
```

Both should now return the placeholder package's metadata (version `0.0.0`, the description text
above), not a 404.

```sh
npm view @eventrunner
```

(or the npm website's org page) should show the org as owned by the CCM account.

## 9. Record ownership — operator storage only, never this repo

Record the following in the team's operator password/secrets manager (the same store
[`docs/POSTMARK_PROVISIONING.md`](POSTMARK_PROVISIONING.md) uses for the Postmark account token),
**not** in this repository, any issue, or any commit:

- Which npm account (username/email) owns the `eventrunner` and `event-runner` packages and the
  two org scopes.
- Recovery email and 2FA recovery codes for that account.
- Date the placeholders were published and the orgs created.
- Who else was added as an org member and with what role.

Do not paste any npm token, one-time code, or recovery code into this repo, an issue comment, or
any doc — only *where* the ownership record lives.

## Done when

- `npm view eventrunner` and `npm view event-runner` both return the placeholder metadata.
- `@eventrunner` and `@event-runner` both resolve to npm orgs owned by the intended CCM account,
  with 2FA and recoverable ownership confirmed.
- Ownership and recovery details are recorded in operator storage, not in this repo.
