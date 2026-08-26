# Contributing

Thanks for wanting to help. This is the public platform repo. The live Collaborative Journalism Summit site stays in `jamditis/cjs2026` and is not the place to send platform PRs.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). Reports go to info@collaborativejournalism.org.

## Where to start

Pick the path that matches what you are doing. If you are not changing code, you probably want [Discussions](https://github.com/CenterCoopMedia/eventrunner/discussions) or the [wiki](https://github.com/CenterCoopMedia/eventrunner/wiki), not a pull request.

| You are… | Do this |
|---|---|
| An attendee who cannot sign in, find a session, or open materials | [Q&A](https://github.com/CenterCoopMedia/eventrunner/discussions/new?category=q-a) |
| Event staff stuck in the CMS, schedule, or speaker tools | [Q&A](https://github.com/CenterCoopMedia/eventrunner/discussions/new?category=q-a) |
| An organization that wants CCM to run your event | [General](https://github.com/CenterCoopMedia/eventrunner/discussions/new?category=general) or email info@collaborativejournalism.org |
| Reporting a bug in the shared product | [Bug form](https://github.com/CenterCoopMedia/eventrunner/issues/new?template=bug.yml) |
| Asking for a product change | [Feature form](https://github.com/CenterCoopMedia/eventrunner/issues/new?template=feature.yml) |
| Sending code or docs | Open or link an issue, then a pull request |

If CCM is operating the event site for you and the problem is access, content, or your specific deployment, email info@collaborativejournalism.org. That is support, not a public ticket.

## Contribution policy

We take:

- Bug fixes with a failing test when one can exist
- Features that match the [roadmap](docs/ROADMAP.md) or have a linked, accepted issue
- Docs, wiki corrections, and accessibility fixes
- Repro cases that do not include real attendee or client data

We will bounce:

- Hardcoded event names, cities, hex colors, or domains
- Personal infrastructure (hostnames, chat IDs, personal emails, private operator adapters)
- Secrets, live-project credentials, or real PII in tests, fixtures, screenshots, or logs
- A second queue. `ticket_sync_queue` is the only queue in the system
- Features already cut from v1 (video generator, bulk broadcast, invoicing, social feeds, speaker chat) unless a linked issue reopens the case
- Drive-by refactors with no product change

The [governance](GOVERNANCE.md) note is the short version of who decides.

## Dev setup

1. Fork and clone this repository.
2. Use Node 22 (`node -v`) — the Cloud Functions runtime pins that major, so `functions/package.json` declares `"node": "22"` and npm warns (`EBADENGINE`) on newer majors.
3. From the repo root:

```bash
npm run prepare:functions   # packs packages/shared into functions/vendor/ — required before install
npm install
npm run lint
npm test
npm run test:rules   # needs Java 21+ for the Firebase emulators
```

No `.env` and no cloud credentials are required for any of these — `test:rules` starts local Firestore and Storage emulators against a `demo-*` project id.

`apps/web` has its own vitest suite (`npm run test -w apps/web`) and its own dev loop against the Functions/Firestore/Auth emulators — see [apps/web/README.md](apps/web/README.md) for the full commands, including the Playwright-driven sign-in smoke test (`scripts/dev/login-smoke.mjs`).

## How to send a change

1. Search issues and the [project board](https://github.com/orgs/CenterCoopMedia/projects/2). The **What this is** column is the plain-language version of each title.
2. Open an issue first if the change is more than a typo. Use the form that matches the work.
3. Branch from `main`. One logical change per branch.
4. Add or update tests next to the code (`*.test.cjs` beside the module).
5. Fill in the pull request template, including how you verified the change.
6. Sign off each commit (`git commit -s`) under the [Developer Certificate of Origin](https://developercertificate.org/).

### Sign your commits (DCO)

Every commit needs a `Signed-off-by` trailer:

```
git commit -s -m "Fix schedule timezone rollover"
```

That adds a line to the commit message — `Signed-off-by: Your Name <you@example.org>` — using the name and email from your git config. It is not a CLA and nobody countersigns it; by adding it you are personally certifying the [Developer Certificate of Origin](https://developercertificate.org/) (spec §1.5): that you wrote the change or otherwise have the right to submit it under this project's license, and that you understand it is public and permanently recorded with your contribution.

Forgot on a commit that is not pushed yet: `git commit --amend -s`. Forgot on several: `git rebase --signoff <base-branch>` rewrites every commit on your branch to add the trailer, then force-push your branch (never `main`).

**CI enforces this.** The `dco` job in `.github/workflows/ci.yml` walks every non-merge commit in the pull request's range and fails if any is missing the trailer — `node scripts/check-dco.cjs <base-sha> <head-sha>`, credential-free, so it runs identically on a fork PR. A PR failing only the DCO check does not need new code: sign off the existing commits as above and push.

### Shared package

`packages/shared` is CommonJS first. Add a `.mjs` re-export shim next to every new `.cjs` module.

### There is exactly one queue

`ticket_sync_queue` is the only queue in this system, and it is not a precedent. It exists for one reason the code cannot work around: the ticketing provider's own read APIs are eventually consistent, so an order a webhook announces is often not readable yet. It is scoped to `functions/src/ticketing/`, capped at six attempts, and raises an operator alert when it gives up — nothing is ever dropped silently.

Everything else sends, writes, or fails in the request that asked for it. Email in particular has no queue: a managed provider owns retry and pacing (spec §3.1). A pull request that adds a second queue, a scheduled retry collection, a "pending work" document set, or a drain function needs an ADR first — say what makes the work impossible to do inline, and why a provider or a trigger cannot do it. See [docs/adr/0001-event-platform-v1.md](docs/adr/0001-event-platform-v1.md) §3.3 and §10 question 9.

### Accessibility

UI changes need a keyboard path and visible focus. If you change a flow that attendees or staff use, say how you checked it (keyboard, zoom, or a screen reader). Do not rely on color alone.

The full interface bar — accessibility, typography, color tokens, motion, and microcopy — is [docs/interface-guidelines.md](docs/interface-guidelines.md). UI pull requests are reviewed against it.

## Tests

| Command | What it covers |
|---|---|
| `npm run lint` | ESLint over every workspace, including the hex-literal ban (spec §7.6) and `react-hooks/rules-of-hooks` |
| `npm test` | `packages/shared` and `functions` unit tests (Node `--test`, fakes — no emulator) |
| `npm run test:rules` | Firestore and Storage security rules on the Firebase emulators |
| `npm run test -w apps/web` | `apps/web` component/context/lib unit tests (vitest + Testing Library, jsdom — no emulator) |
| `npm run build -w apps/web` | Production build of `apps/web`; credential-free with dummy `VITE_FIREBASE_*` values |
| `npm run test:e2e` | Playwright end-to-end suite (OTP sign-in, CMS edit → publish → public, speaker invite → accept → wizard, ticket claim → approved → bookmark) against the full Firebase emulator suite, seeded from the synthetic demo fixture — see [`e2e/`](e2e/) |
| `./gitleaks detect --source .` | Secret scan (`.gitleaks.toml`) — CI downloads and checksum-verifies the gitleaks CLI directly rather than a marketplace action, so it stays credential-free on a fork PR (an org-repo license secret is not something a fork PR could ever have) |
| `node scripts/check-dco.cjs <base> <head>` | Every non-merge commit in the pull request's range carries a DCO `Signed-off-by` trailer — see [Sign your commits](#sign-your-commits-dco) |
| `node scripts/dev/login-smoke.mjs` | Live Playwright smoke test of the emailed-code sign-in flow against the Functions/Firestore/Auth emulators (dev tool, not run by CI) |

CI runs the trust checks and selected tiers on every pull request, credential-free. Every push to `main` runs the full matrix. Fork PRs must be able to run every check without credentials.

### Proportional CI

Pull requests run the trust checks (DCO and secret scanning) plus the smallest
path-selected tier. The repository-owned `scripts/ci/classify-changes.cjs`
classifier emits the selections; mixed changes take the union of their tiers.
The `CI gate` job is the stable aggregate check for branch protection. A job
that the classifier did not select is expected to be skipped. Pushes to `main`
fail open to the full matrix. All tiers remain credential-free so fork pull
requests can run them without secrets.

| Changed paths | Selected tier |
|---|---|
| Markdown, `docs/**` except `docs/demo/**`, handbook files, and issue/discussion templates | Documentation checks: local links and generated Pages HTML markup |
| Documentation generators (`scripts/build-pages.cjs`, `scripts/build-pages.test.cjs`, `scripts/lib/pages-*.cjs`, `scripts/lib/markdown-pages.cjs`) | Documentation checks and lint |
| `scripts/build-demo.cjs`, `scripts/build-demo.test.cjs`, or `docs/demo/**` | Lint, demo generator tests, and committed-demo hygiene |
| `apps/web/**` | Lint, web unit tests, web build, generated-content hygiene, demo hygiene, and E2E |
| `functions/**` | Lint, shared/functions unit tests, rules emulators, and E2E |
| `packages/shared/**` | Lint, shared/functions unit tests, web unit tests, web build, generated-content hygiene, demo hygiene, rules emulators, and E2E |
| `firestore.rules` or `storage.rules` | Rules emulators and E2E |
| Workflows, tool configuration, package manifests or locks, Firebase configuration, `e2e/**`, `publisher/**`, other scripts, or an unrecognized path | Full matrix: documentation checks, lint, shared/functions unit tests, web unit tests, web build, generated-content hygiene, demo hygiene, rules emulators, and E2E |

Changes that match more than one row run the union of the selected tiers. The
main branch protection rule should require `CI gate` after this workflow is
merged; the existing `Shared package tests` requirement remains unchanged
until that operator update is made.

`npm run test:e2e` needs Java 21+ (the same Firestore/Storage emulators `test:rules` uses) and a Chromium build Playwright can find. It never runs `playwright install` itself: point `PLAYWRIGHT_BROWSERS_PATH` at an existing install, or run `npx playwright install --with-deps chromium` once yourself first — `.github/workflows/ci.yml`'s `e2e` job does the latter, cached.

## Releases

Tags, `CHANGELOG.md` hygiene, and what a release includes are in [RELEASING.md](RELEASING.md).

One lint rule to know about before it bites you: hex color literals (`#336699`) are banned everywhere except `functions/src/email/templates/**`, `functions/src/schedule/pdf.cjs`, and `apps/web/src/generated/theme.css`. Colors come from theme tokens.

## Security

Do not open a public issue for a vulnerability. Use [private reporting](https://github.com/CenterCoopMedia/eventrunner/security) or see [SECURITY.md](SECURITY.md).

## Questions

- Product and "how do I": [Discussions](https://github.com/CenterCoopMedia/eventrunner/discussions)
- Handbook for attendees, staff, and clients: [wiki](https://github.com/CenterCoopMedia/eventrunner/wiki)
- Hosted-event support: info@collaborativejournalism.org
