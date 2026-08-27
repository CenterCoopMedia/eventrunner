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
`config/bootstrap.adminEmails`, seeds the twelve default pages (§5.3) and their placeholder content
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
| `--attest-auth` | record that the manual Auth console steps are done, and refresh the still-seeded legal copy that describes sign-in |
| `--dry-run` | report every write without performing it |
| `--skip-branding` | do not upload the placeholder branding assets |
| `--seeded-threshold <n>` | how many seeded blocks `--check` tolerates (default 0) |

**Init exits 0 even with unmet readiness rows, by design** (§5.1.1): `legal.reviewRequired` is true
on every fresh deployment because init sets it, and clearing it needs an admin UI that only exists
after the hosting deploy a non-zero exit would have blocked. `--check` is the gate on going live;
`init` is the gate on nothing.

Init validates Tier A (`packages/shared/src/config/deploy.cjs`) before its first write: a missing or
invalid `EVENT_*` key is fatal, missing `VITE_*` keys warn (they gate the build, not the seed), and
under `FIRESTORE_EMULATOR_HOST` everything is a warning because the emulator is not a deployment.

**Re-running never clobbers a client.** A seeded document is refreshed only while it still carries
`seeded: true`; editing it in the CMS clears the flag and init leaves it alone from then on — even
under `--force`, which only relaxes the "this project is already initialized" refusal. Both
revisions are checked, so an unpublished editor draft protects its document too. Branding follows
the same rule in Storage: init stamps `metadata.seeded=true` on what it uploads and never overwrites
an object without that stamp. `config/*`
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
placeholder speakers, sponsors, and sessions. Refuses a project id that is not a demo project —
either an exact `DEMO_PROJECT_ID` or a delimited `demo` component (`demo-run-of-show`, not
`democratic-media-prod`) — unless `--i-know-this-is-not-a-demo-project` is passed — the one thing this script must never do is
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
fork PRs can run it. Reading a real project **requires** an output directory outside the checkout:
any `--out` (or `GENERATED_DIR`) path inside the repository is refused, because a client's content
sitting anywhere in the working tree of a public repo is one `git add -A` from being committed
(§8.6). The hygiene gate also runs as a unit test
(`scripts/lib/emit.test.cjs`), which fails if the committed snapshot is stale or has been
overwritten with anything other than demo data.

`seed-demo-event.cjs` and `generate-content.cjs --demo` read the same fixture, so the demo instance
and the committed snapshot cannot drift apart.

### `publish-site.cjs`

The entrypoint of the `site-publisher` Cloud Run job (§8.4 phase 5, issue #36): generate the
content snapshot from this project's published collections, build the web app against it, deploy
hosting. It is the only script here that normally runs inside a container rather than from a
laptop — `publisher/Dockerfile` is a packaging of this repository whose `ENTRYPOINT` is this file.

```sh
node scripts/publish-site.cjs             # what the job runs
node scripts/publish-site.cjs --dry-run   # print the plan, execute nothing
```

Configuration is the ordinary per-client Tier A environment, validated by the same
`validateDeployEnv` the deploy workflow uses, so there is one definition of "configured" rather
than a second that can drift. `PUBLISH_QUEUE_ID`, which `cmsPublish` passes as a per-execution
override, names the `cmsPublishQueue` row the terminal status is written back to; without it the
job publishes and writes no status, which is what makes a hand-started execution safe.

Exit codes name the stage — `2` configuration, `3` generation, `4` build, `5` hosting deploy — so
`gcloud run jobs executions describe` is usually enough to triage without opening the log. Setup,
verification, and the rollback interaction: `docs/DEPLOY_RUNBOOK.md` §9.

### `build-demo.cjs`

Builds the public click-through demo and syncs it into `docs/demo/`, which GitHub Pages serves at
`https://centercoopmedia.github.io/eventrunner/demo/`. The one script here that touches no
Firestore at all: it is `vite build` with `VITE_DEMO_MODE=1` and `--base /eventrunner/demo/`, run
against the committed synthetic snapshot.

```sh
npm run build:demo                              # build + sync into docs/demo/
node scripts/build-demo.cjs --dry-run           # print the plan, execute nothing
node scripts/build-demo.cjs --base /x/ --out docs/preview
```

`VITE_DEMO_MODE` (read once, in `apps/web/src/lib/demoMode.js`) is what makes the output safe to
serve with no backend: HashRouter instead of BrowserRouter (GitHub Pages has no rewrites, and the
site-root `404.html` shim would belong to the docs site, not to this build), the Firestore client
taken offline before any listener attaches, the content overlay not subscribed at all (an empty
offline read would otherwise wholesale-replace the snapshot), App Check never initialized, sign-in
replaced with a "disabled in this demo" notice, and a standing demo banner. A normal client build
never sets the flag, so every one of those branches compiles away — `deploy-client.yml` and
`publish-site.cjs` are unaffected.

`GENERATED_DIR` is cleared for the child process: the demo is the committed fixture, never a
deploy-time export of a real client (§8.6). `--out` is refused outside the repository, because the
destination is deleted before the copy. The script commits nothing.

### `build-pages.cjs`

Renders the documentation site GitHub Pages serves at
`https://centercoopmedia.github.io/eventrunner/docs/`. The Markdown in this repository is the only
source; the HTML under `docs/docs/` is generated output and is committed.

```sh
node scripts/build-pages.cjs                    # write docs/tokens.css + docs/docs/
node scripts/build-pages.cjs --check            # compare only, write nothing
```

It also writes `docs/tokens.css`, the Pages site's scale and palette. Those values are not a copy:
they are resolved from `design/tokens/` through `scripts/lib/tokens.cjs`, the same generator that
writes `apps/web/src/generated/theme.css`, narrowed to the tokens the site uses. `docs/styles.css`
is the handwritten half — layout, devices, rhythm — and reads them by name. The token generator is
reached through `scripts/lib/shared-theme.cjs` rather than the bare `shared/theme` specifier,
because the documentation CI tier has no `node_modules` for the workspace link to live in.

`scripts/lib/pages-manifest.cjs` lists every published document and its route. A document reaches
the site only by being listed there, so historical planning records under `docs/plans/` stay out of
the navigation. `scripts/lib/markdown-pages.cjs` is a small dependency-free Markdown renderer that
escapes every character it takes from the source, so no document can inject markup into the site.
Relative links to other published documents become site routes; links to anything else in the
repository become GitHub URLs, and the build lists them.

`--check` is the freshness gate, and it works like `generate-content.cjs --check`: it fails on any
file whose committed bytes differ from a fresh render, on any unexpected file left in `docs/docs/`,
and on a `docs/tokens.css` that no longer matches `design/tokens/`. `scripts/build-pages.test.cjs`
runs it, so the documentation CI tier enforces it with the runner's Node and no `npm install`.

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

`webhook` and `console` expose no domain API. For those, `--attest` records an operator attestation
(`sender.domainVerifiedBy = 'operator-attested'`) after you have checked the relay's DNS yourself —
without it the launch-readiness sender row could never be cleared and a webhook deployment would be
permanently unlaunchable. A capable provider refuses `--attest`; its own check is the answer. A
definitive DKIM/return-path failure on the configured domain also CLEARS a previously stored
verification, so `--check` can never pass on a stamp that live DNS has just contradicted (an
inconclusive "unknown" result never clears it).

The verification gate is **DKIM + return-path**. SPF is reported for information only and never
decides the verdict: Postmark's Domains API deprecates the field and satisfies SPF through the
return-path CNAME, so there is no separate SPF record to publish (issue #93).

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
