'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const path = require('node:path');

const { getEndpointFilters } = require('firebase-tools/lib/deploy/functions/functionsDeployHelper.js');
const { promptForFailurePolicies } = require('firebase-tools/lib/deploy/functions/prompts.js');
const { createDeploymentPlan } = require('firebase-tools/lib/deploy/functions/release/planner.js');
const { endpointFromFunction } = require('firebase-tools/lib/gcp/cloudfunctionsv2.js');

const {
  main,
  readCompleteInventory,
  discoverLocalFunctions,
  planNewRetryFunctions,
} = require('./deploy-functions.cjs');

const PROJECT = 'demo-project';
const REGION = 'us-central1';
const EVENT_TYPE = 'google.cloud.firestore.document.v1.written';
const eventTrigger = (retry) => ({ eventType: EVENT_TYPE, retry });
const quiet = { log() {}, error() {} };
const FULL_DEPLOY = ['firebase', 'deploy', '--project', PROJECT, '--non-interactive', '--only', 'functions'];

const deployed = (id, region = REGION) => ({ id, region, platform: 'gcfv2', codebase: 'default' });
const deployedRetry = (id, retry = true) => ({ ...deployed(id), eventTrigger: eventTrigger(retry) });
const local = (id, retry, regions = [REGION]) => ({
  id, retry, regions, platform: 'gcfv2', eventTrigger: retry ? eventTrigger(true) : null,
});

async function runDeploy({
  bootstrap,
  completeInventory = [],
  localFunctions = [],
  discover,
  status = () => 0,
  // The inventory read after a deploy. By default every local function is
  // there, as after a deploy that did all its work.
  deployedInventory = localFunctions.flatMap((fn) => (fn.regions || []).map((region) => deployed(fn.id, region))),
}) {
  const calls = [];
  const messages = [];
  const errors = [];
  const discoveredAfter = [];
  const code = await main({
    env: {
      EVENT_FIREBASE_PROJECT_ID: PROJECT,
      EVENT_BOOTSTRAP: String(bootstrap),
    },
    log: { log: (message) => messages.push(message), error: (message) => errors.push(message) },
    verifyCompleteInventory: async () => {
      if (calls.length === 0) return completeInventory;
      if (deployedInventory instanceof Error) throw deployedInventory;
      return deployedInventory;
    },
    discoverFunctions: discover || (async () => {
      discoveredAfter.push(calls.length);
      return localFunctions;
    }),
    run(args, options) {
      calls.push({ args, options });
      return { status: status(args) };
    },
  });
  return { calls, code, messages, errors, discoveredAfter };
}

// Every Firebase call that carries --force must name functions one by one.
// A bare `--only functions` with --force could approve deletions and unsafe
// migrations of existing functions; only the verified-empty bootstrap may.
function assertNoBareForce(calls) {
  for (const { args } of calls) {
    if (!args.includes('--force')) continue;
    const only = args[args.indexOf('--only') + 1];
    assert.notEqual(only, 'functions', `bare --only functions with --force: ${args.join(' ')}`);
    for (const selector of only.split(',')) assert.match(selector, /^functions:[A-Za-z0-9_-]+$/);
  }
}

test('ordinary deploys with no new retry functions use one plain full deploy', async () => {
  const { calls, code } = await runDeploy({
    bootstrap: false,
    completeInventory: [deployed('existingHttp')],
    localFunctions: [local('existingHttp', false)],
  });
  assert.equal(code, 0);
  assert.deepEqual(calls.map((call) => call.args), [FULL_DEPLOY]);
});

test('a new retry function on an existing deployment gets one targeted forced deploy, then a plain full deploy', async () => {
  const { calls, code, messages } = await runDeploy({
    bootstrap: false,
    completeInventory: [deployed('existingHttp'), deployedRetry('onTicketWritten')],
    localFunctions: [
      local('existingHttp', false),
      local('onTicketWritten', true),
      local('onTicketOrderConfirmation', true),
    ],
  });
  assert.equal(code, 0);
  assert.deepEqual(calls.map((call) => call.args), [
    [
      'firebase', 'deploy', '--only', 'functions:onTicketOrderConfirmation',
      '--project', PROJECT, '--non-interactive', '--force',
    ],
    FULL_DEPLOY,
  ]);
  assertNoBareForce(calls);
  assert.ok(messages.some((message) => /onTicketOrderConfirmation\(us-central1\)/.test(message)));
});

test('several new retry functions share one targeted forced deploy', async () => {
  const { calls, code } = await runDeploy({
    bootstrap: false,
    completeInventory: [deployed('existingHttp')],
    localFunctions: [local('existingHttp', false), local('newRetryB', true), local('newRetryA', true)],
  });
  assert.equal(code, 0);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].args[3], 'functions:newRetryA,functions:newRetryB');
  assert.deepEqual(calls[1].args, FULL_DEPLOY);
  assertNoBareForce(calls);
});

test('an existing retry function deploys without force', async () => {
  const { calls, code } = await runDeploy({
    bootstrap: false,
    completeInventory: [deployedRetry('onTicketWritten')],
    localFunctions: [local('onTicketWritten', true)],
  });
  assert.equal(code, 0);
  assert.deepEqual(calls.map((call) => call.args), [FULL_DEPLOY]);
});

// Failed deploy 40971642963: the GCFv2 API reports retryPolicy, while the
// pinned Firebase adapter gives the inventory a boolean eventTrigger.retry.
const syncUserPublicApi = {
  name: `projects/${PROJECT}/locations/${REGION}/functions/syncUserPublic`,
  environment: 'GEN_2', state: 'ACTIVE',
  buildConfig: { runtime: 'nodejs22', entryPoint: 'syncUserPublic' },
  serviceConfig: { serviceAccountEmail: '123456789-compute@developer.gserviceaccount.com' },
  labels: { 'deployment-tool': 'cli-firebase' },
  eventTrigger: {
    eventType: EVENT_TYPE, retryPolicy: 'RETRY_POLICY_DO_NOT_RETRY', triggerRegion: 'nam5',
    serviceAccountEmail: '123456789-compute@developer.gserviceaccount.com',
    eventFilters: [
      { attribute: 'database', value: '(default)' },
      { attribute: 'namespace', value: '(default)' },
      { attribute: 'document', value: 'users/{uid}', operator: 'match-path-pattern' },
    ],
  },
};
const syncUserPublicSource = () => ({
  ...local('syncUserPublic', true),
  eventTrigger: {
    eventType: EVENT_TYPE, retry: true,
    eventFilters: { database: '(default)', namespace: '(default)' },
    eventFilterPathPatterns: { document: 'users/{uid}' },
  },
});

test('an existing retry upgrade gets a targeted force and the pinned planner has no deletes or recreates', async () => {
  const config = [{ codebase: 'default', source: 'functions' }];
  const existing = endpointFromFunction(syncUserPublicApi);
  assert.equal(existing.eventTrigger.retry, false);
  assert.equal(existing.eventTrigger.region, 'nam5');
  assert.equal(existing.eventTrigger.serviceAccountEmail, undefined);
  assert.equal(existing.serviceAccount, '123456789-compute@developer.gserviceaccount.com');
  const enabled = { ...existing, eventTrigger: { ...existing.eventTrigger, retry: true } };
  const alreadyRetrying = deployedRetry('onApprovalPolicyWritten');
  const localFunctions = [syncUserPublicSource(), local('onApprovalPolicyWritten', true)];
  const { calls, code } = await runDeploy({
    bootstrap: false, completeInventory: [existing, alreadyRetrying], localFunctions,
    deployedInventory: [enabled, alreadyRetrying],
  });
  assert.equal(code, 0);
  assert.deepEqual(calls.map((call) => call.args), [
    ['firebase', 'deploy', '--only', 'functions:syncUserPublic', '--project', PROJECT, '--non-interactive', '--force'],
    FULL_DEPLOY,
  ]);
  assertNoBareForce(calls);
  const { selectors } = planNewRetryFunctions([existing, alreadyRetrying], localFunctions, config);
  const backendOf = (...endpoints) => ({
    endpoints: { [REGION]: Object.fromEntries(endpoints.map((endpoint) => [endpoint.id, endpoint])) },
  });
  const have = backendOf(existing, alreadyRetrying);
  const want = backendOf(enabled, alreadyRetrying);
  const plan = createDeploymentPlan({
    wantBackend: want, haveBackend: have, codebase: 'default',
    filters: getEndpointFilters({ only: selectors.join(',') }, config), deleteAll: false,
  });
  const changes = Object.values(plan);
  assert.deepEqual(changes.flatMap((change) => change.endpointsToCreate), []);
  assert.deepEqual(changes.flatMap((change) => change.endpointsToDelete), []);
  assert.deepEqual(changes.flatMap((change) => change.endpointsToUpdate), [{ endpoint: enabled, unsafe: false }]);
  await assert.rejects(promptForFailurePolicies({ nonInteractive: true }, want, have), /Pass the --force option/);
  await assert.doesNotReject(promptForFailurePolicies({ nonInteractive: true }, want, want));
});

test('retry upgrades refuse changed trigger identity, platform, codebase and selector collisions', () => {
  const existing = endpointFromFunction(syncUserPublicApi);
  const source = syncUserPublicSource();
  const config = [{ codebase: 'default', source: 'functions' }];
  for (const changed of [
    { ...source, platform: 'gcfv1' },
    { ...source, eventTrigger: { ...source.eventTrigger, eventType: 'google.cloud.firestore.document.v1.created' } },
    { ...source, eventTrigger: { ...source.eventTrigger, eventFilters: { database: 'other', namespace: '(default)' } } },
    { ...source, eventTrigger: { ...source.eventTrigger, eventFilterPathPatterns: { document: 'other/{uid}' } } },
    { ...source, eventTrigger: { ...source.eventTrigger, region: 'us-east1' } },
  ]) {
    assert.throws(() => planNewRetryFunctions([existing], [changed], config), /cannot safely enable retries/);
  }
  assert.throws(() => planNewRetryFunctions([{ ...existing, codebase: 'other' }], [source], config), /cannot safely enable retries/);
  for (const collateral of [
    { ...existing, region: 'us-east1' },
    { ...existing, id: 'syncUserPublic-legacy' },
  ]) {
    assert.throws(() => planNewRetryFunctions([existing, collateral], [source], config), /would also change deployed/);
  }
});

test('a new function without retry deploys without force', async () => {
  const { calls, code } = await runDeploy({
    bootstrap: false,
    completeInventory: [deployed('existingHttp')],
    localFunctions: [local('existingHttp', false), local('newHttp', false)],
  });
  assert.equal(code, 0);
  assert.deepEqual(calls.map((call) => call.args), [FULL_DEPLOY]);
});

test('a retry function deployed in another region stops before any deploy', async () => {
  const { calls, code, errors } = await runDeploy({
    bootstrap: false,
    completeInventory: [deployed('onTicketOrderConfirmation', 'europe-west1')],
    localFunctions: [local('onTicketOrderConfirmation', true)],
  });
  assert.equal(code, 1);
  assert.deepEqual(calls, []);
  assert.match(errors[0], /onTicketOrderConfirmation\(europe-west1\)/);
});

test('a targeted selector that also matches a deployed function stops before any deploy', async () => {
  // Firebase matches `functions:newRetry` against ids split on "-", so it
  // also selects the deployed group member newRetry-legacy.
  const { calls, code, errors } = await runDeploy({
    bootstrap: false,
    completeInventory: [deployed('newRetry-legacy')],
    localFunctions: [local('newRetry', true), local('newRetry-legacy', false)],
  });
  assert.equal(code, 1);
  assert.deepEqual(calls, []);
  assert.match(errors[0], /newRetry-legacy\(us-central1\)/);
});

test('a targeted selector that also matches another local function stops before any deploy', async () => {
  const { calls, code, errors } = await runDeploy({
    bootstrap: false,
    completeInventory: [deployed('existingHttp')],
    localFunctions: [local('existingHttp', false), local('newRetry', true), local('newRetry-extra', false)],
  });
  assert.equal(code, 1);
  assert.deepEqual(calls, []);
  assert.match(errors[0], /newRetry-extra/);
});

test('a failed targeted deploy stops before the full deploy', async () => {
  const { calls, code } = await runDeploy({
    bootstrap: false,
    completeInventory: [deployed('existingHttp')],
    localFunctions: [local('existingHttp', false), local('newRetry', true)],
    status: (args) => (args.includes('--force') ? 2 : 0),
  });
  assert.equal(code, 2);
  assert.equal(calls.length, 1);
});

test('a failed local function discovery stops before any deploy', async () => {
  const { calls, code, errors } = await runDeploy({
    bootstrap: false,
    completeInventory: [deployed('existingHttp')],
    discover: async () => {
      throw new Error('functions source did not load');
    },
  });
  assert.equal(code, 1);
  assert.deepEqual(calls, []);
  assert.match(errors[0], /could not read the local functions: functions source did not load/);
});

test('a failed inventory read on an ordinary deploy stops before any deploy', async () => {
  const calls = [];
  const errors = [];
  const code = await main({
    env: { EVENT_FIREBASE_PROJECT_ID: PROJECT, EVENT_BOOTSTRAP: 'false' },
    log: { log() {}, error: (message) => errors.push(message) },
    run: (...args) => calls.push(args),
    verifyCompleteInventory: async () => {
      throw new Error('unreachable region');
    },
    discoverFunctions: async () => [local('newRetry', true)],
  });
  assert.equal(code, 1);
  assert.equal(calls.length, 0);
  assert.match(errors[0], /could not verify a complete functions inventory: unreachable region/);
});

test('force never reaches a bare functions deploy outside the empty bootstrap', async () => {
  const scenarios = [
    { bootstrap: false, completeInventory: [deployedRetry('a')], localFunctions: [local('a', true), local('b', true)] },
    { bootstrap: true, completeInventory: [deployedRetry('a')], localFunctions: [local('a', true), local('b', true)] },
    { bootstrap: false, completeInventory: [deployedRetry('a')], localFunctions: [local('a', true)] },
    { bootstrap: false, completeInventory: [deployedRetry('a', false)], localFunctions: [local('a', true)] },
    { bootstrap: false, completeInventory: [], localFunctions: [local('b', true)] },
  ];
  for (const scenario of scenarios) {
    const { calls, code } = await runDeploy(scenario);
    assert.equal(code, 0);
    assertNoBareForce(calls);
  }
});

test('a bootstrap over a partial deploy creates the absent retry handlers first', async () => {
  const { calls, code } = await runDeploy({
    bootstrap: true,
    completeInventory: [deployed('existingHttp')],
    localFunctions: [local('existingHttp', false), local('onUserCreated', true)],
  });
  assert.equal(code, 0);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].args[3], 'functions:onUserCreated');
  assert.ok(calls[0].args.includes('--force'));
  assert.deepEqual(calls[1].args, FULL_DEPLOY);
  assertNoBareForce(calls);
});

test('bootstrap deploys use force only after a successful complete empty inventory', async () => {
  const { calls, code, discoveredAfter } = await runDeploy({ bootstrap: true });
  assert.equal(code, 0);
  // The forced bootstrap reads the local functions only to verify the deploy.
  assert.deepEqual(discoveredAfter, [1]);
  assert.deepEqual(calls.map((call) => call.args), [[...FULL_DEPLOY, '--force']]);
});

test('bootstrap deploys with existing functions retain the normal safeguards', async () => {
  const { calls, code } = await runDeploy({
    bootstrap: true,
    completeInventory: [{ id: 'existingFunction', region: 'us-central1' }],
  });
  assert.equal(code, 0);
  assert.equal(calls.length, 1);
  assert.doesNotMatch(calls[0].args.join(' '), /--force/);
});

// firebase-tools 15.22.4 can exit 0 after a quota 429 on a create, with the
// create still unfinished and no summary printed (run 39329645906 left
// downloadEventPackage absent). The script reads the inventory again.
test('a full deploy that exits 0 but leaves a function absent fails and names it', async () => {
  const { calls, code, errors } = await runDeploy({
    bootstrap: false,
    completeInventory: [deployed('existingHttp')],
    localFunctions: [local('existingHttp', false), local('downloadEventPackage', false)],
    deployedInventory: [deployed('existingHttp')],
  });
  assert.equal(code, 1);
  assert.deepEqual(calls.map((call) => call.args), [FULL_DEPLOY]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /1 function\(s\) are not deployed: downloadEventPackage\(us-central1\)/);
  assert.doesNotMatch(errors[0], /existingHttp/);
});

test('a function deployed only in another region counts as absent', async () => {
  const { code, errors } = await runDeploy({
    bootstrap: false,
    completeInventory: [deployed('existingHttp')],
    localFunctions: [local('existingHttp', false, [REGION, 'europe-west1'])],
    deployedInventory: [deployed('existingHttp')],
  });
  assert.equal(code, 1);
  assert.match(errors[0], /not deployed: existingHttp\(europe-west1\)/);
});

test('a forced bootstrap deploy that leaves a function absent fails', async () => {
  const { calls, code, errors } = await runDeploy({
    bootstrap: true,
    localFunctions: [local('onUserCreated', true), local('downloadEventPackage', false)],
    deployedInventory: [deployed('onUserCreated')],
  });
  assert.equal(code, 1);
  assert.deepEqual(calls.map((call) => call.args), [[...FULL_DEPLOY, '--force']]);
  assert.match(errors[0], /not deployed: downloadEventPackage\(us-central1\)/);
});

test('a function with no literal region fails the deploy check closed', async () => {
  const { code, errors } = await runDeploy({
    bootstrap: false,
    completeInventory: [deployed('paramRegion')],
    localFunctions: [{ id: 'paramRegion', retry: false, regions: null }],
    deployedInventory: [deployed('paramRegion')],
  });
  assert.equal(code, 1);
  assert.match(errors[0], /paramRegion\(no literal region\)/);
});

test('a failed inventory read after the deploy fails closed', async () => {
  const { calls, code, errors } = await runDeploy({
    bootstrap: false,
    completeInventory: [deployed('existingHttp')],
    localFunctions: [local('existingHttp', false)],
    deployedInventory: new Error('unreachable region(s): us-east1'),
  });
  assert.equal(code, 1);
  assert.equal(calls.length, 1);
  assert.match(errors[0], /could not verify the deployed functions: unreachable region/);
});

test('a failed full deploy reports its own exit code before any inventory check', async () => {
  let reads = 0;
  const code = await main({
    env: { EVENT_FIREBASE_PROJECT_ID: PROJECT, EVENT_BOOTSTRAP: 'false' },
    log: quiet,
    run: () => ({ status: 2 }),
    verifyCompleteInventory: async () => {
      reads += 1;
      return [deployed('existingHttp')];
    },
    discoverFunctions: async () => [local('existingHttp', false)],
    readConfig: () => [{ codebase: 'default', source: 'functions' }],
  });
  assert.equal(code, 2);
  assert.equal(reads, 1);
});

test('invalid workflow inputs stop before any Firebase command', async () => {
  const calls = [];
  const run = (...args) => calls.push(args);
  assert.equal(await main({ env: { EVENT_BOOTSTRAP: 'true' }, run, log: quiet }), 1);
  assert.equal(await main({
    env: { EVENT_FIREBASE_PROJECT_ID: PROJECT, EVENT_BOOTSTRAP: '' }, run, log: quiet,
  }), 1);
  assert.deepEqual(calls, []);
});

test('an unreachable region makes the complete inventory check fail closed', async () => {
  await assert.rejects(
    readCompleteInventory(PROJECT, {
      authenticate: async () => {},
      loadBackend: async (context) => {
        context.unreachableRegions = { gcfV1: [], gcfV2: ['us-east1'], run: [] };
        return { endpoints: {} };
      },
      allEndpoints: () => [],
    }),
    /inventory is incomplete; unreachable region\(s\): us-east1/,
  );
});

test('missing regional availability makes the complete inventory check fail closed', async () => {
  await assert.rejects(
    readCompleteInventory(PROJECT, {
      authenticate: async () => {},
      loadBackend: async () => ({ endpoints: {} }),
      allEndpoints: () => [],
    }),
    /did not report regional availability/,
  );
});

test('a failed complete inventory check stops before deployment', async () => {
  const calls = [];
  const errors = [];
  const code = await main({
    env: { EVENT_FIREBASE_PROJECT_ID: PROJECT, EVENT_BOOTSTRAP: 'true' },
    log: { log() {}, error: (message) => errors.push(message) },
    run: (...args) => calls.push(args),
    verifyCompleteInventory: async () => {
      throw new Error('unreachable region');
    },
  });
  assert.equal(code, 1);
  assert.equal(calls.length, 0);
  assert.match(errors[0], /could not verify a complete functions inventory: unreachable region/);
});

const delegateFor = (endpoints) => async () => ({
  validate: async () => {},
  build: async () => {},
  discoverBuild: async () => ({ endpoints, params: [] }),
});
const discoveryOptions = (endpoints) => ({
  projectDir: path.resolve(__dirname, '..'),
  loadFirebaseConfig: async () => ({ projectId: PROJECT }),
  getDelegate: delegateFor(endpoints),
});

test('local discovery reports each function with its retry flag and regions', async () => {
  const functions = await discoverLocalFunctions(PROJECT, discoveryOptions({
    onRetry: { platform: 'gcfv2', region: [REGION], eventTrigger: eventTrigger(true) },
    onNoRetry: { platform: 'gcfv2', region: [REGION], eventTrigger: eventTrigger(false) },
    httpOnly: { platform: 'gcfv2', region: [REGION], httpsTrigger: {} },
  }));
  assert.deepEqual(functions, [
    { id: 'httpOnly', retry: false, regions: [REGION], platform: 'gcfv2', eventTrigger: null },
    { id: 'onNoRetry', retry: false, regions: [REGION], platform: 'gcfv2', eventTrigger: eventTrigger(false) },
    { id: 'onRetry', retry: true, regions: [REGION], platform: 'gcfv2', eventTrigger: eventTrigger(true) },
  ]);
});

test('local discovery fails closed on a retry flag or region it cannot read', async () => {
  const expression = '{{ params.RETRY }}';
  await assert.rejects(
    discoverLocalFunctions(PROJECT, discoveryOptions({
      onRetry: { platform: 'gcfv2', region: [REGION], eventTrigger: eventTrigger(expression) },
    })),
    /onRetry has a retry setting that is not a literal true or false/,
  );
  await assert.rejects(
    discoverLocalFunctions(PROJECT, discoveryOptions({
      onRetry: { platform: 'gcfv2', region: ['{{ params.REGION }}'], eventTrigger: eventTrigger(true) },
    })),
    /onRetry has no literal deploy region/,
  );
  await assert.rejects(
    discoverLocalFunctions(PROJECT, discoveryOptions({
      onRetry: { platform: 'gcfv2', eventTrigger: eventTrigger(true) },
    })),
    /onRetry has no literal deploy region/,
  );
});

test('local discovery fails closed when the functions source does not load', async () => {
  await assert.rejects(
    discoverLocalFunctions(PROJECT, {
      ...discoveryOptions({}),
      getDelegate: async () => ({
        validate: async () => {},
        build: async () => {},
        discoverBuild: async () => {
          throw new Error('Failed to generate manifest from function source');
        },
      }),
    }),
    /Failed to generate manifest/,
  );
  await assert.rejects(
    discoverLocalFunctions(PROJECT, {
      ...discoveryOptions({}),
      getDelegate: async () => undefined,
    }),
    /no functions runtime/,
  );
});

test('the real functions source reports onTicketOrderConfirmation as a retry function', async () => {
  // Runs the pinned firebase-tools discovery against functions/, with no
  // network call: the Firebase config is the only remote input and it does
  // not change which functions exist or retry.
  const functions = await discoverLocalFunctions(PROJECT, {
    loadFirebaseConfig: async () => ({ projectId: PROJECT }),
  });
  const confirmation = functions.find((fn) => fn.id === 'onTicketOrderConfirmation');
  assert.equal(confirmation.retry, true);
  assert.equal(confirmation.platform, 'gcfv2');
  assert.deepEqual(confirmation.regions, [REGION]);
  assert.equal(confirmation.eventTrigger.retry, true);
  assert.ok(functions.filter((fn) => fn.retry).length >= 11);
  assert.ok(functions.some((fn) => !fn.retry));
});

test('the pinned Firebase planner sees only creates under the targeted selectors', async () => {
  const config = [{ codebase: 'default', source: 'functions' }];
  const endpoint = (id, retry) => ({
    id,
    region: REGION,
    platform: 'gcfv2',
    codebase: 'default',
    eventTrigger: { eventType: 'google.cloud.firestore.document.v1.written', retry },
  });
  const backendOf = (...endpoints) => ({
    endpoints: { [REGION]: Object.fromEntries(endpoints.map((e) => [e.id, e])) },
  });
  const existing = endpoint('onTicketWritten', true);
  const created = endpoint('onTicketOrderConfirmation', true);
  const sibling = endpoint('onTicketOrderConfirmationAudit', false);
  const have = backendOf(existing);
  const want = backendOf(existing, created, sibling);

  const { selectors } = planNewRetryFunctions(
    [deployedRetry('onTicketWritten')],
    [local('onTicketWritten', true), local('onTicketOrderConfirmation', true),
      local('onTicketOrderConfirmationAudit', false)],
    config,
  );
  assert.deepEqual(selectors, ['functions:onTicketOrderConfirmation']);

  const filters = getEndpointFilters({ only: selectors.join(',') }, config);
  const plan = createDeploymentPlan({
    wantBackend: want, haveBackend: have, codebase: 'default', filters, deleteAll: false,
  });
  const changes = Object.values(plan);
  assert.deepEqual(changes.flatMap((change) => change.endpointsToCreate), [created]);
  assert.deepEqual(changes.flatMap((change) => change.endpointsToUpdate), []);
  assert.deepEqual(changes.flatMap((change) => change.endpointsToDelete), []);

  // Before the targeted step, the plain full deploy stops at the retry prompt;
  // after it, the same deploy needs no --force.
  await assert.rejects(
    promptForFailurePolicies({ nonInteractive: true }, want, have),
    /Pass the --force option/,
  );
  await assert.doesNotReject(
    promptForFailurePolicies({ nonInteractive: true }, want, backendOf(existing, created)),
  );
});
