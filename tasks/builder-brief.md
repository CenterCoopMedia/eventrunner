# Builder brief

Every builder agent reads this file first. The director gives you an id, a
worktree, a branch, and a list of issues.

## Where you work

- Work only inside your worktree. Never edit `/home/user/eventrunner` or another
  builder's worktree. Never run `git push`, open a pull request, or comment on
  GitHub. The director does that.
- Other agents share this machine and its process table. Never kill a process
  you did not start. Never run `pkill` or `killall`.
- The worktree has its dependencies installed. If you add a dependency, run
  `npm install` in your worktree and commit the lockfile change.
- Scratch files (runner scripts, logs, captures) go in a folder named for your
  group id inside the shared scratchpad, for example `scratchpad/c3/`. Other
  builders write to the same scratchpad, and a shared file name gets
  overwritten.

## Read before you write

1. `tasks/lessons.md`: rules written after the owner's corrections.
2. `CONTRIBUTING.md`: tiers, the one-queue rule, the hex literal ban, DCO.
3. `docs/interface-guidelines.md` and `docs/COPY_STYLE.md` for any UI or copy.
4. `docs/plans/2026-09-09-cjs-parity-gap.md`: the section for your milestone and
   "Risks and constraints".
5. `docs/plans/2026-09-10-design-vocabulary-expansion.md` for any UI.
6. The code around the change. Match its naming, comment density, and idiom.

## Rules

- Bug fix: write the failing test first, then the fix.
- Tests sit next to the code (`*.test.cjs` or `*.test.jsx`). A Firestore or
  Storage rule change needs a test in `tests/firestore.rules.test.js` or
  `tests/storage.rules.test.js`.
- Brand neutral: no event name, city, hex colour, or domain in code, tests,
  fixtures, or seed. Colours come from theme tokens.
- UI: a keyboard path, visible focus, and no state shown by colour alone.
- Copy and docs: sentence case, short sentences, active voice, no filler words
  (comprehensive, robust, seamless, leverage, and the like).
- Public write surfaces: rate limit like `submitFeedback`, write an `admin_logs`
  row, and give an admin a way to remove an entry. New features that accept
  text from strangers sit behind a feature flag that is off by default.
- There is one queue (`ticket_sync_queue`). Do not add another.
- A change under `packages/shared` needs a `.mjs` re-export shim beside every
  new `.cjs` module, then `npm run prepare:functions && rm -rf
  functions/node_modules/shared && npm install` so the lockfile hashes match.
- Keep docs current in the same branch: `docs/ADMIN_GUIDE.md`,
  `docs/design-reference.md`, `docs/interface-guidelines.md`, `apps/web/README.md`,
  `functions/README.md`, and a `CHANGELOG.md` entry under `[Unreleased]`, as the
  change needs. Tick the issue in `docs/ROADMAP.md`.
- If a choice is not clear, take the simplest option that fits the parity plan
  and the design record, and write it down in your report. Do not stop to ask.
- Before you write "Done when met", quote each clause of the issue's "Done
  when" line and name the test that proves it. Reproduce the issue's own
  evidence path (its screenshot, its fixture, its named file), not a nearby
  case. A test that calls an internal helper does not prove what a user sees:
  render the real surface (the shipped email template, the page, the endpoint).
- A timeout or wait fix is proven only when no explicit value in the file
  still overrides the new budget.

## Commits

- The git identity is set in the shared repository config. Do not change it.
- Sign off every commit: `git commit -s`. No AI attribution, no
  `Co-authored-by` trailer.
- One commit per issue where you can. The subject says what changed in the
  product; the body says why.
- Generated output goes in one last commit with the exact subject
  `Regenerate generated output`: `docs/docs/**`, `docs/demo/**`,
  `apps/web/src/generated/**`, and lockfile integrity changes caused only by a
  `packages/shared` edit. The director drops that commit and regenerates on the
  stack tip. Commit nothing generated anywhere else.

## Heavy commands

Wrap these in the shared lock so parallel builders do not starve each other:

```sh
flock /tmp/eventrunner-heavy.lock npm run test -w apps/web
flock /tmp/eventrunner-heavy.lock npm run test:rules
flock /tmp/eventrunner-heavy.lock npm run test:e2e
flock /tmp/eventrunner-heavy.lock npm run build -w apps/web
flock /tmp/eventrunner-heavy.lock node scripts/build-demo.cjs
flock /tmp/eventrunner-heavy.lock node scripts/build-demo.cjs --check
```

A single test file (`npx vitest run path/to/file.test.jsx` inside `apps/web`, or
`node --test path/to/file.test.cjs`) does not need the lock.

## Checks, last

Run every check as the last step, after docs and generated output, and report
the exact result of that final run. A report of "all green" from a run before
your last edit is the failure this rule exists for.

```sh
npm run lint
npm test
flock /tmp/eventrunner-heavy.lock npm run test -w apps/web
flock /tmp/eventrunner-heavy.lock npm run test:rules          # rules, functions, or shared touched
flock /tmp/eventrunner-heavy.lock npm run build -w apps/web
node scripts/generate-content.cjs --demo --check              # after regenerating
flock /tmp/eventrunner-heavy.lock node scripts/build-demo.cjs --check
node scripts/build-pages.cjs --check
npm run check:copy
```

To regenerate: `node scripts/generate-content.cjs --demo`,
`flock /tmp/eventrunner-heavy.lock node scripts/build-demo.cjs`, and
`node scripts/build-pages.cjs`.

## Report

Write `tasks/reports/<id>.md` and commit it before the regenerate commit:

- Per issue: what changed, the files, the tests added, and whether the issue's
  "Done when" line is met in full. Say plainly if it is not.
- Decisions you made that the owner may want to change.
- The final check results, with counts, from the last run.
- Anything left undone and why.

Your final message to the director is the same report, short.
