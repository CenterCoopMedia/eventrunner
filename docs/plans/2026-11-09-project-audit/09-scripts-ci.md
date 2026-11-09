# Audit 09: scripts/, .github/, root config, publisher/, e2e/

Read-only audit. Nothing in the repository was changed. Findings are ordered by severity.

Coverage note: I did not read every line of the area (about 51,000 lines). The CI scripts, all workflows, root config, e2e helpers and the small and mid-size scripts were read in full. The largest operator scripts were covered by cross-reference scans only. See "Files read" for the split.

---

### 1. Local CI (`run-local.cjs`) skips the console suites that the hosted jobs run, and its receipt replaces those jobs

- Category: inconsistent
- Confidence: certain
- Where:
  - `scripts/ci/run-local.cjs:21-23` (the `unit`, `unitWeb` and `build` entries of `CHECKS`)
  - `package.json` `test` script (the glob includes `console/functions/src/**/*.test.cjs`)
  - `.github/workflows/ci.yml:223` (`npm test`), `:251` (`npm run test:console`), `:286` (`npm run build:console`)
- Evidence:
  - `run-local.cjs` `unit` runs `node --test --test-concurrency=2 packages/shared/src/**/*.test.cjs functions/src/**/*.test.cjs scripts/**/*.test.cjs`. The `console/functions/src/**/*.test.cjs` glob that `npm test` has is missing.
  - `unitWeb` runs only `npm run test -w apps/web`. The hosted job also runs `npm run test:console` on shard 1.
  - `build` runs `npm run build` and the bundle budget. The hosted job also runs `npm run build:console` and checks `console/web/dist/index.html`.
  - `scripts/ci/run-local.test.cjs` does not compare `CHECKS` with `ci.yml`. `classify-changes.test.cjs:250-257` asserts only the hosted side.
- How it is reached / impact: `CONTRIBUTING.md` says "The runner selects the same tiers as Actions". When a trusted local status exists, every hosted tier is skipped (`needs.changes.outputs.local != 'true'`). The classifier sends a `console/functions/**` change to `lint, audit, unit` and a `console/web/**` change to `lint, audit, unitWeb, build`. So a console-only pull request validated locally merges with no console unit test, console web test or console build run anywhere.
- Proposed fix: in `scripts/ci/run-local.cjs`, add the console glob to `unit`, add `['npm','run','test:console']` to `unitWeb` and `['npm','run','build:console']` to `build`. Add a test in `run-local.test.cjs` that fails when `CHECKS.unit` and the `package.json` `test` globs differ.

### 2. Path-selected tiers skip unit tests that read files outside their own tier

- Category: inconsistent
- Confidence: likely (the table in `CONTRIBUTING.md` documents the selection, but the assumption behind it is false for the tests below)
- Where: `scripts/ci/classify-changes.cjs:186-203` (`resultForPaths`), `.github/workflows/ci.yml` jobs `docs`, `demo`, `unit`
- Evidence (classifier output from `node -e`):
  - `apps/web/src/x` selects `demo, lint, audit, unitWeb, build, hygiene, e2e`. `unit` is not selected. These `npm test` files read `apps/web`:
    - `scripts/lib/seed.test.cjs:160-196` (every `<SystemPage pageId>` in `apps/web/src/pages` has a seed; seeded paths match `App.jsx`)
    - `scripts/lib/site-manifest.test.cjs:165, 598` (private routes of `App.jsx`; `apps/web/public/manifest.webmanifest`)
    - `scripts/ci/bundle-budget.test.cjs:74` (walks the `apps/web/src` import graph)
    - `scripts/lib/tokens.test.cjs:374` (`apps/web/public/fonts/README.md`)
    - `scripts/build-preset-catalog.test.cjs:275` (`apps/web/src/admin/presetCopy.js`)
  - `firestore.rules` selects `rules, e2e` only. `packages/shared/src/badges.test.cjs:48`, `functions/src/email/log.test.cjs:674` and `functions/src/announcements/messages.test.cjs:249` read `firestore.rules`.
  - `docs/ADMIN_GUIDE.md` selects `docs, lint`. `functions/src/users/records.test.cjs:839` reads it.
  - `scripts/lib/pages-site.cjs` plus `scripts/lib/pages-site.test.cjs` selects `docs, demo, lint, audit`. Neither the `docs` job (`check-docs.test.cjs`, `build-pages.test.cjs`) nor the `demo` job (`build-demo.test.cjs`, `dev/build-demo-at.test.cjs`) runs `pages-site.test.cjs`, so a pull request that edits that test never runs it.
  - `scripts/lib/markdown-pages.cjs` selects `docs, lint, audit`. `scripts/lib/markdown-scroll-regions.test.cjs` requires it and is not run.
- How it is reached / impact: an app-only pull request can add a `<SystemPage pageId="x">` with no seed, or a rules-only pull request can change the badge cap, and pass the gate. CI has no `push` trigger ("Merges do not repeat the matrix"), so the failure first shows on a later, unrelated pull request that selects `unit`.
- Proposed fix (smallest): in `classify-changes.cjs` `resultForPaths`, set `unit: backend || shared || consoleBackend || app || rules || docsGenerator || demoGenerator || full`. For `docs/ADMIN_GUIDE.md`, either select `unit` for the copy-checked documents or move that assertion into the docs tier. Update the table in `CONTRIBUTING.md` and `classify-changes.test.cjs`.

### 3. `console/README.md` is scanned by the copy gate but does not select it

- Category: inconsistent
- Confidence: certain
- Where: `scripts/check-copy-style.cjs:25` (`ROOT_FILES` has `console/README.md`), `scripts/ci/classify-changes.cjs:37-45` (`COPY_CHECKED_DOC_FILES` does not)
- Evidence: `classifyPaths(['console/README.md'])` returns mode `docs`, jobs `docs` only. `README.md` returns `docs, lint`. The classifier comment at line 189 says "Scanned documentation selects this tier so the copy gate cannot be bypassed". `classify-changes.test.cjs:245` asserts only the mode.
- How it is reached / impact: a pull request that edits only `console/README.md` never runs `npm run check:copy`. Blocked wording lands and fails the next pull request that selects lint.
- Proposed fix: add `'console/README.md'` to `COPY_CHECKED_DOC_FILES`. Better, export the documentation entries of `ROOT_FILES` from `check-copy-style.cjs` and test that the two lists agree.

### 4. Two different support addresses across the community files

- Category: inconsistent
- Confidence: certain that they disagree; owner-decision on which is correct
- Where:
  - `info@collaborativejournalism.org`: `.github/ISSUE_TEMPLATE/config.yml:8,10`, `.github/ISSUE_TEMPLATE/bug.yml:13`, `.github/DISCUSSION_TEMPLATE/q-a.yml:10`, `.github/DISCUSSION_TEMPLATE/general.yml:8`, `GOVERNANCE.md:18-19`, `CODE_OF_CONDUCT.md:63`, `docs/handbook/*.md` (5 files)
  - `info@eventrunner.org`: `CONTRIBUTING.md:5,15,20`, `SUPPORT.md` (3), `SECURITY.md` (2), `README.md` (2)
- Evidence: grep counts above. `CONTRIBUTING.md:5` says Code of Conduct reports go to `info@eventrunner.org`, while `CODE_OF_CONDUCT.md:63` names the other address.
- Impact: a reporter gets a different address depending on which file they open.
- Proposed fix: pick one address and replace the other in the files listed. Rebuild `docs/docs/` after the handbook changes.

### 5. `migrate-console-signup-links.cjs` has no completion marker and rewrites every quarantined draft on each console deploy

- Category: inefficient / unneeded (one-time migration; owner-decision on removal)
- Confidence: certain for the repeated writes; owner-decision for retirement
- Where: `scripts/migrate-console-signup-links.cjs:17,27`, `.github/workflows/deploy-console.yml` step "Migrate signup-link provenance…"
- Evidence: the skip test is `app.status !== 'draft' || app.signupLinkId`. A quarantined draft still has no `signupLinkId`, so each deploy runs a transaction and a `signup_links` query for it and writes `quarantinedAt: now()` again. The other two migrations use a marker document. `quarantinedAt` is read nowhere (grep across `console/`, `packages/`, `scripts/`), so the only effect is wasted writes and a timestamp that means "last deploy".
- Whether its job is finished: every new draft is created with `signupLinkId` (`console/functions/src/signupLinks.cjs:178` is the only caller of `newApplicationData`). After one successful console deploy there is nothing left for it to link. The repository holds no record that this deploy has happened.
- Proposed fix: add `|| app.legacyQuarantined === true` to the skip test now. Remove the script, its test, the workflow step and the `console` entry in `.github/deploy-surfaces.json` once the owner confirms the console has been deployed with it.

### 6. One-time data migrations and the security rollout still run on every deploy (owner decision)

- Category: unneeded (when finished)
- Confidence: owner-decision
- Where: `scripts/migrate-security-data.cjs`, `scripts/migrate-pitch-declined.cjs` (both run by `deploy-client.yml:307-320`), `scripts/dispatch-security-rollout.cjs`, `.github/security-rollout-2026-11-06.json`, `deploy-console.yml` (`push.paths` trigger and the `rollout_clients` and `legacy_clients` inputs)
- Evidence:
  - `migrate-security-data.cjs` writes the marker `security_migrations/2026-11-06` per client project. It is finished for a project once that marker has `complete: true`, and costs one read per functions deploy afterwards.
  - `migrate-pitch-declined.cjs` writes the marker `data_migrations/pitch-declined-2026-11-08`. It is dated one day before this audit, so it is almost certainly not finished on every client. Its header says the legacy `rejected` read in `shared/pitch` can go once it has run.
  - `dispatch-security-rollout.cjs` exists to fan out one release (the json names PR 759). It reads only `legacyClients` from the json; `purpose`, `excludedFinding`, `scope` and `retry` are notes.
  - None of these can be proved finished from the repository. The proof is the marker documents in each client project and the "Deploy console" run history.
- Proposed fix: after the owner confirms the markers on every client, delete the two migration scripts, their tests and the two workflow steps. After the rollout run is confirmed green, delete `dispatch-security-rollout.cjs`, its test, the json, and the `push` trigger, the rollout step and the two inputs in `deploy-console.yml`. `docs/plans/2026-11-08-state-machine-map/04-console-provisioning.md` mentions the rollout script.

### 7. `CONTRIBUTING.md` drift from the classifier, `package.json` and `eslint.config.mjs`

- Category: inconsistent
- Confidence: certain
- Where: `CONTRIBUTING.md:108`, the "Changed paths" table (about lines 190-202), `:215`
- Evidence:
  - The table never names the `audit` tier. The classifier selects it for the generator, `apps/web`, `functions`, `packages/shared` and console rows (`classify-changes.cjs:194`).
  - The first row says Markdown and docs select "Documentation checks". The copy-checked files (`README.md`, `docs/index.html`, five named docs, `docs/handbook/**`) also select lint.
  - No row covers `tests/*.rules.test.js` (classifier: `lint, rules`). By the table it would be an "unrecognized path" and run the full matrix.
  - Line 108 says `npm test` covers "`packages/shared`, `functions` and `scripts`". The glob also covers `console/functions`.
  - Line 215 lists four hex-literal exceptions. `eslint.config.mjs` also exempts `console/functions/src/emailLayout.cjs`.
- Proposed fix: edit `CONTRIBUTING.md` only, then run `node scripts/build-pages.cjs` if it is a published page.

### 8. Action pinning differs between the privileged workflows

- Category: inconsistent
- Confidence: likely (owner-decision on policy)
- Where: `.github/workflows/*.yml`
- Evidence (`grep uses:`):
  - `deploy-console.yml` and `provision-client.yml` pin `actions/checkout@11d5960a… # v4.4.0`, `actions/setup-node@49933ea5… # v4.4.0` and `google-github-actions/auth@c200f369… # v2`. I confirmed the checkout SHA is the `v4.4.0` tag with `git ls-remote`.
  - `decommission-client.yml` pins `auth` by SHA but uses `actions/checkout@v4` and `actions/setup-node@v4` by tag.
  - `deploy-client.yml`, which holds each client's Workload Identity, uses mutable tags for everything: `google-github-actions/auth@v2` (6 uses), `google-github-actions/setup-gcloud@v2` and the third-party `dorny/paths-filter@v3`.
  - There is no Dependabot or Renovate config, so the SHA pins will not be updated automatically.
- Impact: the same trust boundary is pinned in three workflows and floating in the one with the most client access.
- Proposed fix: pin the actions in `deploy-client.yml` and `decommission-client.yml` to the SHAs already used elsewhere. Optionally add `.github/dependabot.yml` for `github-actions`.

### 9. `scripts/README.md` is stale in three places

- Category: inconsistent
- Confidence: certain
- Where: `scripts/README.md:12-13`, `:473-476`, the "Landed" list; `scripts/lib/firebase-init.cjs:12-13`
- Evidence:
  - Lines 12-13, and the header of `firebase-init.cjs`, say CI has a key file "from `FIREBASE_SERVICE_ACCOUNT`". `.env.example:124` and `docs/DEPLOY_RUNBOOK.md:271` say that secret deliberately does not exist; the workflows use Workload Identity.
  - "Planned" lists `register-ticketing-webhook`, which exists with a test and is called by `provision-client.cjs`. The other three (`grant-admin`, `export-attendees`, `generate-favicons`) appear only in ADR 0001; `dev/build-app-icons.mjs` now covers the icon case.
  - No heading for these operator scripts: `provision-client.cjs`, `decommission-client.cjs`, `deploy-functions.cjs`, `export-event-package.cjs`, `register-ticketing-webhook.cjs`, `remove-web-address.cjs`, `smoke-test.cjs`, `validate-deploy-env.cjs`, `check-copy-style.cjs`, `check-dco.cjs`, `check-docs.cjs`, `build-preset-catalog.cjs`, `dispatch-security-rollout.cjs`, the three `migrate-*.cjs`, all of `scripts/ci/`, and `dev/invite-smoke.mjs`, `dev/login-smoke.mjs`, `dev/run-e2e.sh`, `dev/build-og-placeholder.mjs`, `dev/build-demo-at.cjs`, `dev/capture-demo-visuals.mjs`. All are referenced from a workflow, `package.json`, a runbook or `CONTRIBUTING.md`, so none is orphaned.
  - The README names no script that is missing.
- Proposed fix: correct the credential sentence in both files, cut the "Planned" list down, and add a short index of the scripts with no heading, linking to the runbook section that covers each.

### 10. Small leftovers

- Category: unneeded / inefficient
- Confidence: certain unless noted
- Items:
  - `scripts/lib/site-manifest.cjs:45,542`: `SYSTEM_PAGE_FEATURE_GATES` is built and exported but read nowhere, including tests. Its comment says the robots reporting uses it; nothing does. Fix: delete the constant and the export.
  - `provision-client.yml:97-98` and `decommission-client.yml:80-81,131-132` run `npm run prepare:functions` and then `node scripts/prepare-functions.cjs --copy`. `main()` already calls `copyVendored` (`prepare-functions.cjs:128`). Fix: drop the `--copy` line in those three places.
  - `scripts/ci/classify-changes.cjs:114`: `path === 'vitest.rules.config.js'` in `isRulesPath` cannot change the result. The file matches `TOOL_CONFIGURATION_PATH_RE`, so it is always `full`. Fix: delete the clause.
  - `.gitignore:13`: `_upstream/` has no other reference in the repository. Owner-decision.
  - `playwright.config.js:61`: the comment says "The four journeys"; `e2e/` has 55 spec files. Comment only.
  - `scripts/dev/run-e2e.sh:32`: `E2E_EMULATOR_LOG` is exported and nothing reads it. The script comment says so.
  - `video/tests/*.test.mjs` (7 files) and `tasks/director/capture.spec.mjs` are not in the `npm test` glob and no CI job runs `npm run check` in `video/`. A `video/**` change selects the full matrix, which does not include them. Outside my area; owner-decision.

---

## Files read

- Read in full:
  - `.github/`: all 8 workflows, 5 issue templates, 5 discussion templates, the PR template, `CODEOWNERS`, `deploy-surfaces.json`, `security-rollout-2026-11-06.json`; the start of `smoke-endpoints.json`.
  - Root: `package.json`, `eslint.config.mjs`, `playwright.config.js`, `vitest.rules.config.js`, `.gitignore`, `.gitattributes`, `.dockerignore`, `.gitleaks.toml`, `CONTRIBUTING.md`.
  - `publisher/Dockerfile`.
  - `scripts/ci/`: `classify-changes.cjs`, `verify-gate.cjs`, `local-results.cjs`, `run-local.cjs` and its test, `no-ai-attribution.cjs`.
  - `scripts/`: `check-dco.cjs`, `check-docs.cjs`, `smoke-test.cjs`, `validate-deploy-env.cjs`, `prepare-functions.cjs`, the three `migrate-*.cjs` and the signup-links test, `remove-web-address.cjs`, `dispatch-security-rollout.cjs`, `dev/run-e2e.sh`.
  - `scripts/lib/`: `args.cjs`, `firebase-init.cjs`, `deploy-matrix.cjs`, `answers.cjs`, `readiness.cjs`, `shared-theme.cjs`, `pitch-route-check.cjs`.
  - `e2e/global-setup.mjs`; the export list and the sign-in section of `e2e/helpers.mjs`.
- Read in part: `scripts/deploy-functions.cjs` (first two thirds), `scripts/check-copy-style.cjs` (file lists and exclusions), `scripts/README.md` (headings, credentials, planned, tests), `scripts/lib/site-manifest.cjs` (header), the cross-tier parts of several script tests.
- Not read line by line, covered only by the reference, require and export scans: `provision-client.cjs`, `decommission-client.cjs`, `init-event.cjs`, `publish-site.cjs`, `build-pages.cjs`, `build-demo.cjs`, `build-preset-catalog.cjs`, `generate-content.cjs`, `write-site-files.cjs`, `verify-sender-domain.cjs`, `register-ticketing-webhook.cjs`, `export-event-*.cjs`, `seed-demo-event.cjs`, `ci/audit-policy.cjs`, `ci/bundle-budget.cjs`, the large `scripts/lib` modules (`seed`, `write`, `tokens`, `theme`, `emit`, `event-template`, `markdown-pages`, `pages-manifest`, `png`, `app-icons`, `legal`, `branding`, `idempotency`, `demo-*`), `scripts/dev/*.mjs`, the 55 e2e spec bodies, and most `*.test.cjs` files. Logic bugs inside these were not looked for.

## Checked and found correct

- `publisher/Dockerfile`: it copies only three workspace manifests and `functions/vendor/shared.tgz` before `npm ci`, while the lockfile records `functions/node_modules/shared` as `file:console/functions/vendor/shared.tgz`. I tested this in the scratchpad. A full `npm ci` with only those manifests succeeded. A minimal copy with an empty npm cache installed from `functions/vendor/shared.tgz` and failed with ENOENT on that path when it was removed. So npm resolves the tarball from the dependency spec, and the Dockerfile works.
- Every `scripts/lib` module is required by at least one production script. Every script is referenced by a workflow, `package.json`, another script or a doc.
- No workflow, doc or script names a script file that does not exist. The only hits are historical names in ADR 0001 and fixture paths in `classify-changes.test.cjs`.
- Workflow inputs are all used. `deploy.yml` and `deploy-client.yml` `provision` is passed through but never read; both descriptions say it is kept for operator intent only.
- The two "Write the functions runtime env" blocks in `deploy-client.yml` (jobs `functions` and `post`) match.
- `ci.yml` job outputs, the `gate` env names and `verify-gate.cjs` `JOBS` agree with `JOB_NAMES` in the classifier.
- `vitest.rules.config.js` includes `console/tests/*.rules.test.js`, which matches the classifier sending console rules to the `rules` job.
- `npm test` glob: every `*.test.cjs` under `scripts/`, `packages/shared/src`, `functions/src` and `console/functions/src` is picked up. No test in those trees uses another extension.
- e2e: every export of `helpers.mjs` and `webmcp-harness.mjs` is used; all three fixture folders are used.
- Root devDependencies are all used (`vite` by the two console e2e specs, `firebase` by `tests/` and e2e, the ESLint packages by `eslint.config.mjs`).
- `.gitleaks.toml`: each of the four allowlisted literals is present in the file its comment names.
- `eslint.config.mjs` allowlist paths all exist. `.dockerignore` and `.gitattributes` have no dead entries.
- Issue and discussion template names match the links in `CONTRIBUTING.md` and `config.yml`.
- The pinned `actions/checkout` SHA is the real `v4.4.0` tag.
