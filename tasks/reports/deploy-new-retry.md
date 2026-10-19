# deploy-new-retry: new retry handlers block Functions deploys

Branch: `joe/blissful-einstein-9qvtd1-21-deploy-new-retry`, from `origin/main` at 346ec6a.

## Failure

Demo deploy run 39318358467, job "Deploy (demo) / Deploy functions", stopped with
"Pass the --force option to deploy functions with a failure policy" for
`onTicketOrderConfirmation(us-central1)`. That handler (`retry: true`) came in with #485,
after the last demo deploy. `scripts/deploy-functions.cjs` passed `--force` only on a
verified-empty bootstrap inventory. So any new retry handler on an existing deployment
blocked every later deploy.

## What changed

`scripts/deploy-functions.cjs`:

1. Every run reads the complete inventory with `readCompleteInventory` (fails closed on
   missing or unreachable regions).
2. Bootstrap with an empty inventory: unchanged. One full `--only functions --force` deploy,
   and no local discovery.
3. Every other run: `discoverLocalFunctions` runs the pinned firebase-tools node runtime
   delegate (`getRuntimeDelegate`, `validate`, `build`, `discoverBuild`), with the same
   discovery environment as `firebase deploy` (`loadFirebaseEnvs` plus
   `GOOGLE_CLOUD_QUOTA_PROJECT`, Firebase config from `getFirebaseConfig`). It returns each
   function with its retry flag and regions. A non-literal retry flag or retry region fails
   closed. A discovery failure stops the deploy.
4. `planNewRetryFunctions`: new = local retry functions whose id and region are not in the
   inventory. Each selector `functions:<id>` is checked with firebase-tools'
   `parseFunctionSelector` and `endpointMatchesFilter`. If a selector reaches any deployed
   function (same id in another region, or a dash group member such as `foo-bar`), or any
   other local function, the script deploys nothing.
5. If there are new handlers: log them, run
   `firebase deploy --only functions:<id>[,...] --project <p> --non-interactive --force`,
   then the full deploy without `--force`. A failed targeted deploy stops before the full
   deploy. If there are none, one plain full deploy, as before.

Docs: `docs/DEPLOY_RUNBOOK.md` retry-policy section (the two `--force` cases, the refusal
cases, retry turned on for an existing function, and the shorter partial-bootstrap
recovery). `CHANGELOG.md` under Unreleased, Fixed.

## Tests

`scripts/deploy-functions.test.cjs`: 24 tests (was 7). Before the fix, 13 of the 23 tests
then in the file failed. New or changed:

- ordinary deploys with no new retry functions use one plain full deploy (replaces "ordinary
  deploys skip inventory and never use force")
- a new retry function on an existing deployment gets one targeted forced deploy, then a
  plain full deploy
- several new retry functions share one targeted forced deploy
- an existing retry function deploys without force
- a new function without retry deploys without force
- a retry function deployed in another region stops before any deploy
- a targeted selector that also matches a deployed function stops before any deploy
- a targeted selector that also matches another local function stops before any deploy
- a failed targeted deploy stops before the full deploy
- a failed local function discovery stops before any deploy
- a failed inventory read on an ordinary deploy stops before any deploy
- force never reaches a bare functions deploy outside the empty bootstrap
- a bootstrap over a partial deploy creates the absent retry handlers first
- bootstrap deploys use force only after a successful complete empty inventory (now also
  asserts no discovery)
- local discovery reports each function with its retry flag and regions
- local discovery fails closed on a retry flag or region it cannot read
- local discovery fails closed when the functions source does not load
- the real functions source reports onTicketOrderConfirmation as a retry function (runs the
  real firebase-tools discovery on `functions/`; about 11 seconds)
- the pinned Firebase planner sees only creates under the targeted selectors (feeds the
  computed selectors to firebase-tools `getEndpointFilters` and `createDeploymentPlan`, and
  shows `promptForFailurePolicies` passes without force after the targeted step)

## Decisions the owner may want to change

- Every deploy now reads the inventory and runs local discovery. Before, an ordinary deploy
  did neither. An unreachable region now stops an ordinary deploy, by design (fail closed).
- Discovery reuses firebase-tools internals (`runtimes/index.js`, `functions/env.js`,
  `functionsConfig.js`, `functionsDeployHelper.js`, `functions/projectConfig.js`). These are
  pinned by the lockfile (`~15.22.4`) and covered by the real-discovery and planner tests.
  A firebase-tools upgrade must keep those tests green.
- Retry turned on for an already deployed function is out of scope. The full deploy still
  stops at the prompt there. The runbook gives the manual step.
- The script requires one functions codebase named `default` with no prefix. Anything else
  fails closed.
- A bootstrap run over a nonempty inventory now also gets the targeted step. This replaces
  most of the old manual partial-bootstrap recovery in the runbook.
- The old runbook list of retry handlers missed `onTicketOrderConfirmation`. It is removed;
  the script discovers the list.

## Not verified (needs real GCP credentials)

- `getFirebaseConfig` (`adminSdkConfig` API call) and the real targeted deploy against a
  project. Tests inject the Firebase config and the deploy runner.
- That a targeted `--force` deploy in the demo project accepts only the expected prompts
  (retry policy; cleanup policy already exists there).

## Final checks

Run after the last code and docs edit, with `docs/docs` regenerated:

- `npm run lint`: pass.
- `npm test`: 3174 of 3174 pass.
- `npm run check:copy`: 527 files, no blocked patterns.
- `node scripts/build-pages.cjs --check`: 30 files and `docs/tokens.css` match.
- Not run: web tests, web build, rules tests, demo build. No file under `apps/web`,
  `packages/shared`, `functions`, or the rules changed.
