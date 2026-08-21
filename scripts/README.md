# scripts

Operator tools. Every one of them runs against a Firestore emulator or a real project with
application-default credentials — none of them starts an interactive login, because they also run in
CI and over SSH where a browser prompt is a hang.

## Credentials

`scripts/lib/firebase-init.cjs` resolves credentials in one order, with no per-script variation:

1. `FIRESTORE_EMULATOR_HOST` — the emulator path; the Admin SDK needs no key.
2. `GOOGLE_APPLICATION_CREDENTIALS` — a service-account key file (what CI has, from
   `FIREBASE_SERVICE_ACCOUNT`).
3. Application-default credentials already on the machine.

The project id always comes from `EVENT_FIREBASE_PROJECT_ID` (Tier A, `.env.example`). No script
hardcodes one.

Against the emulator:

```sh
firebase emulators:start --only firestore --project demo-run-of-show
# in another shell
export FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
export EVENT_FIREBASE_PROJECT_ID=demo-run-of-show
node scripts/init-event.cjs --answers answers.json --admin ops@example.org --skip-branding
```

`firebase emulators:exec --only firestore --project demo-run-of-show "<command>"` does the same in
one shot, which is how the scripts are smoke-tested.

## Landed

### `prepare-functions.cjs`

Packs `packages/shared` into `functions/vendor/shared.tgz` (spec §1.1); run by CI and the
`firebase.json` functions predeploy hook.

### `init-event.cjs`

Bootstraps a fresh deployment (spec §5.1, issue #18). Writes the five `config/*` documents plus
`config/bootstrap.adminEmails`, seeds the ten default pages (§5.3) and their placeholder content
(§5.4), seeds the provider-aware privacy and terms templates (§5.5), uploads the neutral branding
placeholders, then prints the manual checklist (§5.6) and the launch-readiness table.

```sh
node scripts/init-event.cjs --answers client-answers.json --admin ops@example.org
node scripts/init-event.cjs --check          # launch-readiness gate; exits non-zero if unmet
node scripts/init-event.cjs --attest-auth    # record the manual Firebase Auth steps
```

| Flag | Meaning |
|---|---|
| `--answers <file>` | client answers JSON; without it the script prompts interactively (needs a TTY) |
| `--admin <email>` | first admin address, repeatable; wins over the answers file |
| `--force` | re-run against a project that already has `config/event` |
| `--check` | read-only launch-readiness check (the seven §5.1.1 rows) |
| `--attest-auth` | record that the manual Auth console steps are done |
| `--dry-run` | report every write without performing it |
| `--skip-branding` | do not upload the placeholder branding assets |
| `--seeded-threshold <n>` | how many seeded blocks `--check` tolerates (default 0) |

**Init exits 0 even with unmet readiness rows, by design** (§5.1.1): `legal.reviewRequired` is true
on every fresh deployment because init sets it, and clearing it needs an admin UI that only exists
after the hosting deploy a non-zero exit would have blocked. `--check` is the gate on going live;
`init` is the gate on nothing.

**Re-running never clobbers a client.** A seeded document is refreshed only while it still carries
`seeded: true`; editing it in the CMS clears the flag and init leaves it alone from then on — even
under `--force`, which only relaxes the "this project is already initialized" refusal. `config/*`
documents are skipped on re-run unless `--force`, and even then the fields another writer owns
(sender verification, the legal review flag, `announcedAt`/`archivedAt`, the auth attestation,
ticketing webhook stamps) are preserved. `config/bootstrap.adminEmails` is always additive.

The answers file is JSON:

```json
{
  "adminEmails": ["ops@example.org"],
  "event": { "name": "…", "shortName": "…", "timezone": "America/New_York",
             "days": [{ "id": "day-1", "label": "Day one", "date": "2027-05-13",
                        "startTime": "09:00", "endTime": "17:00" }],
             "venue": { "…": "…" }, "sender": { "email": "hello@example.org" },
             "legal": { "operatorName": "…", "supportEmail": "…" } },
  "features": { "badges": true }
}
```

Provider selection is deliberately NOT read from the file: it is Tier A
(`EVENT_EMAIL_PROVIDER`, `EVENT_TICKETING_PROVIDER`, `EVENT_OPERATOR_NOTIFIER`), and Tier A wins on
conflict (§2.2). An answers file that sets one gets a warning.

### `seed-demo-event.cjs`

Seeds the public demo instance (§5.4, milestone issue #35): a fictional three-day event with
placeholder speakers, sponsors, and sessions. Refuses a project id that does not contain `demo`
unless `--i-know-this-is-not-a-demo-project` is passed — the one thing this script must never do is
publish placeholder speakers on a client's live site. Idempotent on the same terms as init.

```sh
node scripts/seed-demo-event.cjs [--dry-run] [--force]
```

### `generate-content.cjs`

Writes the five `apps/web/src/generated/*` files the web app renders on first paint (§2.4, §8.6).

```sh
node scripts/generate-content.cjs --demo                       # regenerate the committed snapshot
node scripts/generate-content.cjs --demo --check               # diff only; exits non-zero on drift
node scripts/generate-content.cjs --out "$RUNNER_TEMP/generated"   # deploy-time, out of tree
```

`--demo` reads the in-repo fixture (`scripts/lib/demo-event.cjs`) — no credentials, no network, so
fork PRs can run it. Reading a real project **requires** `--out` (or `GENERATED_DIR`): deploy-time
generation must never write into the working tree, or a client's content would sit in a public repo
one `git add -A` from being committed (§8.6). The hygiene gate also runs as a unit test
(`scripts/lib/emit.test.cjs`), which fails if the committed snapshot is stale or has been
overwritten with anything other than demo data.

`seed-demo-event.cjs` and `generate-content.cjs --demo` read the same fixture, so the demo instance
and the committed snapshot cannot drift apart.

### `verify-sender-domain.cjs`

Wraps the configured EmailProvider's `verifySenderDomain()` as the onboarding checklist command
(§5.6 item 4, issue #9). The domain comes from `config/event.sender.email` unless `--domain` is
given. On a pass it stamps `config/event.sender.domainVerified/domainVerifiedAt` — this script is
the only writer of that pair (§1.3) — which clears the launch-readiness sender row.

```sh
EVENT_EMAIL_PROVIDER=postmark EMAIL_PROVIDER_API_KEY=… EMAIL_ACCOUNT_API_KEY=… \
  node scripts/verify-sender-domain.cjs
node scripts/verify-sender-domain.cjs --domain example.org --no-write
```

Exit codes: `0` verified (or the provider has no domain to verify), `1` not verified, `2`
misconfigured. Postmark reports domain state only to an **account** token, so
`EMAIL_ACCOUNT_API_KEY` is needed in addition to the server token; without it the provider reports
`unknown` rather than guessing.

## Planned

`grant-admin`, `register-ticketing-webhook`, `export-attendees`, `generate-favicons`. Credentials go
through `scripts/lib/firebase-init.cjs` and the Tier A env vars. No hardcoded project IDs.

## Tests

Pure logic is unit-tested with `node:test`, colocated next to each module (`scripts/**/*.test.cjs`,
run by `npm test`): answers parsing, seed document shapes against the REAL `validatePageDoc` and
config validators, the readiness table, the idempotency merge rules, the generated-file emitters
(including the byte-for-byte snapshot check), and the write path against the in-memory Firestore
fake. The end-to-end path is exercised against the Firestore emulator with
`firebase emulators:exec`, as documented above.
