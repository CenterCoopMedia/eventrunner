# 22-deploy-exit: a Functions deploy that reported success with a function absent

## Cause

The cause is in `firebase-tools` 15.22.4. Our script and workflow pass the exit code on
correctly, but the CLI exited 0.

- Run 39329645906 started 136 function operations and logged 135 successes.
  `downloadEventPackage` logged "failed to create function" after a quota 429, then nothing.
  The step ended 66 ms after the last "Successful update operation" line, with no
  "Deploy complete!" and no error summary.
- `lib/deploy/functions/release/fabricator.js:72-75` makes one `SourceTokenScraper` per
  changeset. The changeset key is codebase, region and memory (`release/planner.js:93`).
  `downloadEventPackage` is the only 1GiB function (`functions/src/admin/eventPackage.cjs:499`),
  so it is alone in its changeset.
- `fabricator.js:313-316`: each create try calls `scraper.getToken()` first, because the
  `functionsv2deployoptimizations` experiment is on by default (`experiments.js:29-34`).
- `sourceTokenScraper.js:17-28`: the first call sets `FETCHING` and returns. A later call in
  `FETCHING` waits on a promise that only the poller of the first try (`:51-63`) or `abort()`
  resolves.
- `executor.js:19-20` rethrows a 429 to the queue. `throttler/throttler.js:183-194` retries the
  same function. The retry calls `getToken()` in `FETCHING` and waits forever. `abort()` is only
  called after the queue gives up (`fabricator.js:324-325`), which never happens.
- `Fabricator.applyPlan` (`fabricator.js:77`) then never settles. No timer or socket is left, so
  Node exits with code 0. `bin/cli.js:66` sets no exit code for this case.
- A scratch reproduction drove the real 15.22.4 `Fabricator.createV2Function` with a fake API that
  answers 429 once. The create is never sent again, the summary never prints, and the process exits
  0. Without the 429, the summary prints. Against 15.34.0 (the `wt-u2` upgrade) the same 429 is
  retried and the deploy completes.

`scripts/deploy-functions.cjs` treats any non-zero status or spawn error as a failure. The
workflow step is `node scripts/deploy-functions.cjs` under `bash -e`, with no pipe and no
`|| true`.

## Change

- `scripts/deploy-functions.cjs`: after the full deploy exits 0, discover the local functions
  (if the bootstrap path has not yet) and read the complete inventory again. Each local function
  must be there by id and region. The step names each absent function and exits 1. A failed
  inventory read also exits 1.
- `scripts/deploy-functions.test.cjs`: six new tests, written first (five failed before the fix,
  plus the bootstrap discovery assertion). They cover an absent function after exit 0, a function
  in the wrong region, the forced bootstrap path, a function with no literal region, a failed
  inventory read after the deploy, and a failed full deploy that keeps its own exit code.
- `docs/DEPLOY_RUNBOOK.md` §5: the check after the full deploy, and what to do on a quota 429.
- `CHANGELOG.md` under Unreleased, Fixed.

## Decisions the owner may want to change

- A local function with no literal region fails the check, because the script cannot prove it is
  deployed. Every current function has a literal region (136 functions, all `us-central1`).
- The bootstrap path that forces the full deploy now discovers the local functions after the
  deploy, to check it. It still does not discover before the forced deploy.
- The upstream fix is the `firebase-tools` upgrade on `wt-u2` (15.34.0). The check stays useful
  after that upgrade.

## Checks

See the final message for the counts from the last run.
