# Releasing

Tags mark a point in the platform's history other people can build on, cite, or deploy from —
they are not the deploy mechanism. `deploy-client.yml` (`docs/DEPLOY_RUNBOOK.md`) always deploys
from `main`, at whatever commit is there when an operator dispatches it or when a push lands. A
tag is a label a fork, a downstream integrator, or an operator doing a deliberate rollback
(`docs/DEPLOY_RUNBOOK.md` § Rolling back) can point at instead of an arbitrary SHA.

## Version scheme

[Semantic Versioning](https://semver.org/), tracked in `package.json`'s root `version` field:

- **Patch** (`0.1.x`): bug fixes, docs, CI/tooling changes — no schema or contract change.
- **Minor** (`0.x.0`): new features, new admin surfaces, new config fields with a safe default.
  Backward compatible — an existing client deployment keeps working unmigrated.
- **Major** (`x.0.0`): a breaking change to `config/*` shape, Firestore rules, or anything an
  existing client deployment would need a migration step for. Reserved and rare; discuss the
  break in an issue before it lands, per [CONTRIBUTING.md](CONTRIBUTING.md)'s contribution policy.

The project is pre-1.0 (`0.x`) until the v1 feature set in
[docs/adr/0001-event-platform-v1.md](docs/adr/0001-event-platform-v1.md) is complete and has run a
real client event end to end. Before 1.0, a minor bump can still include a breaking change if it's
called out plainly in the changelog entry — SemVer's normal pre-1.0 allowance.

## CHANGELOG hygiene

[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format, already in use in
[CHANGELOG.md](CHANGELOG.md).

- Every pull request that changes behavior (not a pure refactor, not a test-only change) adds an
  entry under `## [Unreleased]`, in the category it belongs to (`Added`, `Changed`, `Fixed`,
  `Removed`, `Security`) — creating the category heading if this PR is the first entry in it.
- Write the entry for the person reading the changelog cold, not for someone who already read the
  PR: what changed and why it matters, not the PR title. One line is normal; link the spec section
  or issue number the way existing entries do.
- Do not pre-date or pre-number an entry. It stays under `Unreleased` until the tag that ships it
  exists.

## Cutting a tag

1. Confirm `main` is green: CI (lint, unit, web unit, build, hygiene, rules, DCO, secret scan) —
   see [CONTRIBUTING.md](CONTRIBUTING.md)'s test table.
2. Open a PR that:
   - Retitles `## [Unreleased]` in `CHANGELOG.md` to `## [x.y.z] - YYYY-MM-DD`, and adds a fresh
     empty `## [Unreleased]` above it.
   - Bumps `version` in the root `package.json` (and `apps/web/package.json` /
     `functions/package.json` if their versions are tracked independently at that point) to match.
   - Sign off the commit(s) — same DCO rule as any other PR.
3. Merge it to `main` like any other PR (review, green CI).
4. Tag the merge commit and push the tag:

   ```sh
   git checkout main && git pull
   git tag -s vX.Y.Z -m "vX.Y.Z"
   git push origin vX.Y.Z
   ```

   `-s` signs the tag if you have a configured signing key; use `-a` instead if you don't — an
   annotated tag either way, never a lightweight one, so the tag carries a message and a date.
5. Draft the GitHub Release from the tag (Releases → Draft a new release → choose the tag). Body
   is the same `## [x.y.z]` section just added to `CHANGELOG.md` — do not write a second, different
   description of the same release.

This document does not itself cut a tag — it describes the process for the next person (or
session) that does.

## What a release includes

A tag is a marker on the platform's source, not a build artifact and not a deploy. There is
nothing to attach to the GitHub Release beyond the changelog excerpt: no compiled bundle (each
client's `apps/web` build is produced fresh per deploy from `EVENT_*`/`VITE_FIREBASE_*` env, so a
prebuilt artifact would be wrong for every client but one), no Docker image, no npm package publish
(this repo is not published to a registry).

An operator who wants to deploy a specific tagged version rather than the tip of `main` checks out
that ref before dispatching, or passes it to whatever provisioning mechanism reads a
`source_revision` (see `docs/DEPLOY_RUNBOOK.md`); `deploy-client.yml` itself is triggered from
`main` (§1–2 of the runbook, and the WIF binding in particular is scoped to `refs/heads/main`), so
deploying from an arbitrary tag currently means merging that tag's tree to `main` first, not
dispatching against the tag directly.
