'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { FirebaseError } = require('firebase-tools/lib/error.js');
const firebaseLogger = require('firebase-tools/lib/logger.js').logger;

const { getEndpointFilters } = require('firebase-tools/lib/deploy/functions/functionsDeployHelper.js');
const { promptForFailurePolicies } = require('firebase-tools/lib/deploy/functions/prompts.js');
const { createDeploymentPlan } = require('firebase-tools/lib/deploy/functions/release/planner.js');
const { endpointFromFunction } = require('firebase-tools/lib/gcp/cloudfunctionsv2.js');
const { endpointFromFunction: v1EndpointFromFunction } = require('firebase-tools/lib/gcp/cloudfunctions.js');

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
  inventoryReads,
  // The inventory read after a deploy. By default every local function is
  // there, as after a deploy that did all its work.
  deployedInventory = localFunctions.flatMap((fn) => (fn.regions || []).map((region) => (
    fn.retry ? { ...deployedRetry(fn.id), region } : deployed(fn.id, region)
  ))),
}) {
  const calls = [];
  const messages = [];
  const errors = [];
  const waits = [];
  const discoveredAfter = [];
  let inventoryRead = 0;
  const code = await main({
    env: {
      EVENT_FIREBASE_PROJECT_ID: PROJECT,
      EVENT_BOOTSTRAP: String(bootstrap),
    },
    log: { log: (message) => messages.push(message), error: (message) => errors.push(message) },
    verifyCompleteInventory: async () => {
      if (inventoryReads) {
        const value = inventoryReads[inventoryRead];
        inventoryRead += 1;
        if (value instanceof Error) throw value;
        return value;
      }
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
    wait: async (milliseconds) => waits.push(milliseconds),
  });
  return { calls, code, messages, errors, waits, discoveredAfter, inventoryRead };
}

// Every forced deploy uses isolated selectors; broad force could approve deletions and migrations.
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

test('the post-deploy inventory records pinned v1 and v2 runtime and secret-name metadata only', async () => {
  const account = '123456789-compute@developer.gserviceaccount.com';
  const apiAuth = (id, secretEnvironmentVariables) => ({
    name: `projects/${PROJECT}/locations/${REGION}/functions/${id}`,
    runtime: 'nodejs22', entryPoint: id, serviceAccountEmail: account,
    eventTrigger: { eventType: `providers/firebase.auth/eventTypes/user.${id === 'onUserDeleted' ? 'delete' : 'create'}`, resource: `projects/${PROJECT}` },
    environmentVariables: { PRIVATE_VALUE: 'private-environment-sentinel' },
    secretEnvironmentVariables,
    sourceUploadUrl: 'https://example.test/private-upload',
  });
  const created = v1EndpointFromFunction(apiAuth('onUserCreated', [{
    key: 'EMAIL_PROVIDER_API_KEY', secret: 'EMAIL_PROVIDER_API_KEY', projectId: PROJECT, version: '7',
    value: 'private-secret-sentinel',
  }]));
  const deleted = v1EndpointFromFunction(apiAuth('onUserDeleted', []));
  const v2 = endpointFromFunction(syncUserPublicApi);
  const after = [created, deleted, v2];
  const before = after.map((fn) => ({ ...fn, serviceAccount: `${PROJECT}@appspot.gserviceaccount.com` }));
  const { code, messages } = await runDeploy({
    bootstrap: false, completeInventory: before,
    localFunctions: after.map((fn) => local(fn.id, false)), deployedInventory: after,
  });
  assert.equal(code, 0);
  const prefix = 'deploy-functions: inventory ';
  const records = messages.filter((line) => line.startsWith(prefix)).map((line) => JSON.parse(line.slice(prefix.length)));
  assert.deepEqual(records, [
    { id: 'onUserCreated', region: REGION, platform: 'gcfv1', serviceAccountEmail: account,
      secretEnvironmentVariables: [{ key: 'EMAIL_PROVIDER_API_KEY', secret: 'EMAIL_PROVIDER_API_KEY' }] },
    { id: 'onUserDeleted', region: REGION, platform: 'gcfv1', serviceAccountEmail: account, secretEnvironmentVariables: [] },
    { id: 'syncUserPublic', region: REGION, platform: 'gcfv2', serviceAccountEmail: account, secretEnvironmentVariables: [] },
  ]);
  assert.doesNotMatch(JSON.stringify(messages), /private-|example\.test|appspot|projectId|"version"/);
});

test('inventory metadata omits malformed runtime and secret fields without logging their contents', async () => {
  const endpoint = {
    ...deployed('existingHttp'), serviceAccount: 'https://example.test/?token=private-sentinel',
    secretEnvironmentVariables: [
      { key: 'TOKEN', secret: 'https://example.test/private-sentinel' },
      { key: 'private-sentinel\nAuthorization: bearer', secret: 'TOKEN' },
      { key: 'TOKEN', secret: 'TOKEN', value: 'private-sentinel' },
      null,
    ],
    context: { headers: { Authorization: 'private-sentinel' } },
  };
  const { code, messages } = await runDeploy({
    bootstrap: false, completeInventory: [endpoint],
    localFunctions: [local('existingHttp', false)], deployedInventory: [endpoint],
  });
  assert.equal(code, 0);
  const record = JSON.parse(messages.find((line) => line.startsWith('deploy-functions: inventory ')).slice('deploy-functions: inventory '.length));
  assert.deepEqual(record, {
    id: 'existingHttp', region: REGION, platform: 'gcfv2', serviceAccountEmail: null,
    secretEnvironmentVariables: [{ key: 'TOKEN', secret: 'TOKEN' }],
  });
  assert.doesNotMatch(JSON.stringify(messages), /private-sentinel|Authorization|example\.test/);
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
      throw Object.assign(new Error('functions source did not load'), { code: 'FUNCTIONS_ANALYSIS_FAILED' });
    },
  });
  assert.equal(code, 1);
  assert.deepEqual(calls, []);
  assert.match(errors[0], /could not read the local functions:/);
  assert.match(errors[0], /"phase":"pre-deploy-discovery"/);
  assert.match(errors[0], /"code":"FUNCTIONS_ANALYSIS_FAILED"/);
});

test('a failed inventory read on an ordinary deploy stops before any deploy', async () => {
  const calls = [];
  const errors = [];
  const code = await main({
    env: { EVENT_FIREBASE_PROJECT_ID: PROJECT, EVENT_BOOTSTRAP: 'false' },
    log: { log() {}, error: (message) => errors.push(message) },
    run: (...args) => calls.push(args),
    verifyCompleteInventory: async () => {
      throw Object.assign(new Error('unreachable region'), { code: 'INVENTORY_UNREACHABLE_REGIONS', regions: [REGION] });
    },
    discoverFunctions: async () => [local('newRetry', true)],
  });
  assert.equal(code, 1);
  assert.equal(calls.length, 0);
  assert.match(errors[0], /could not verify a complete functions inventory:/);
  assert.match(errors[0], /"phase":"pre-deploy-inventory"/);
  assert.match(errors[0], /"code":"INVENTORY_UNREACHABLE_REGIONS"/);
  assert.match(errors[0], /"regions":\["us-central1"\]/);
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
  const { calls, code, discoveredAfter } = await runDeploy({ bootstrap: true, localFunctions: [local('firstHandler', true)] });
  assert.equal(code, 0);
  assert.deepEqual(discoveredAfter, [0], 'the complete create plan is known before any writes');
  assert.deepEqual(calls.map((call) => call.args), [[
    'firebase', 'deploy', '--only', 'functions:firstHandler', '--project', PROJECT, '--non-interactive', '--force',
  ]]);
  assertNoBareForce(calls);
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

test('a fresh deploy stays within every rolling v1 and v2 write-quota window', async () => {
  const config = [{ codebase: 'default', source: 'functions' }];
  const localFunctions = Array.from({ length: 140 }, (_, index) => ({
    ...local(`handler${String(index).padStart(3, '0')}`, index % 7 === 0,
      index % 11 === 0 ? [REGION, 'us-east1'] : [REGION]),
    platform: index < 2 ? 'gcfv1' : 'gcfv2',
  }));
  const desired = localFunctions.flatMap((fn) => fn.regions.map((region) => ({
    ...deployed(fn.id, region), platform: fn.platform,
    ...(fn.retry ? { eventTrigger: eventTrigger(true) } : {}),
  })));
  const backendOf = (endpoints) => {
    const endpointsByRegion = {};
    for (const fn of endpoints) (endpointsByRegion[fn.region] ??= {})[fn.id] = fn;
    return { endpoints: endpointsByRegion };
  };
  let inventory = [];
  let clock = 0;
  const writes = [];
  const calls = [];
  const code = await main({
    env: { EVENT_FIREBASE_PROJECT_ID: PROJECT, EVENT_BOOTSTRAP: 'true' }, log: quiet,
    readConfig: () => config, discoverFunctions: async () => localFunctions,
    verifyCompleteInventory: async () => inventory,
    wait: async (milliseconds) => { clock += milliseconds; },
    run: (args) => {
      calls.push(args);
      const plan = createDeploymentPlan({
        wantBackend: backendOf(desired), haveBackend: backendOf(inventory), codebase: 'default',
        filters: getEndpointFilters({ only: args[args.indexOf('--only') + 1] }, config), deleteAll: false,
      });
      for (const change of Object.values(plan)) {
        assert.deepEqual(change.endpointsToDelete, []);
        assert.deepEqual(change.endpointsToUpdate, [], 'initial batches must not redeploy previous batches');
        for (const fn of change.endpointsToCreate) writes.push({ ...fn, at: clock });
        inventory = [...inventory, ...change.endpointsToCreate];
      }
      return { status: 0 };
    },
  });
  assert.equal(code, 0);
  assert.equal(writes.length, desired.length);
  for (const write of writes) {
    const window = write.platform === 'gcfv1' ? 100_000 : 60_000;
    const limit = write.platform === 'gcfv1' ? 80 : 60;
    const inWindow = writes.filter((other) => other.platform === write.platform
      && (write.platform === 'gcfv1' || other.region === write.region)
      && other.at >= write.at && other.at < write.at + window);
    assert.ok(inWindow.length <= limit, `${write.platform} ${write.region}: ${inWindow.length} writes in ${window} ms`);
  }
  assert.ok(calls.length > 1, 'a fresh site must not create all functions in one burst');
  assert.ok(calls.every((args) => args[args.indexOf('--only') + 1] !== 'functions'));
});

test('the complete initial plan rejects unknown regions and selector expansion before any writes', async () => {
  for (const [localFunctions, reason] of [
    [[...Array.from({ length: 51 }, (_, index) => local(`handler${index}`, false)), { ...local('unknownRegion', false), regions: null }], 'FUNCTIONS_INITIAL_REGIONS'],
    [[local('group', false), local('group-child', false)], 'FUNCTIONS_INITIAL_SELECTORS'],
  ]) {
    const { code, calls, waits, errors } = await runDeploy({ bootstrap: true, localFunctions });
    assert.equal(code, 1);
    assert.deepEqual(calls, []);
    assert.deepEqual(waits, []);
    assert.match(errors[0], new RegExp(`"code":"${reason}"`));
  }
});

test('a paced initial deploy recovers a missing create through a later unforced deploy', async () => {
  const config = [{ codebase: 'default', source: 'functions' }];
  const localFunctions = Array.from({ length: 51 }, (_, index) => local(`handler${String(index).padStart(3, '0')}`, false));
  const desired = localFunctions.map((fn) => ({
    ...deployed(fn.id), httpsTrigger: {}, state: 'ACTIVE', hash: 'unchanged-source',
  }));
  const backendOf = (endpoints) => {
    const endpointsByRegion = {};
    for (const fn of endpoints) (endpointsByRegion[fn.region] ??= {})[fn.id] = fn;
    return { endpoints: endpointsByRegion };
  };
  let inventory = [];
  const calls = [];
  const waits = [];
  const code = await main({
    env: { EVENT_FIREBASE_PROJECT_ID: PROJECT, EVENT_BOOTSTRAP: 'true' }, log: quiet,
    readConfig: () => config, discoverFunctions: async () => localFunctions,
    verifyCompleteInventory: async () => inventory,
    wait: async (milliseconds) => waits.push(milliseconds),
    run: (args) => {
      calls.push({ args });
      const plan = createDeploymentPlan({
        wantBackend: backendOf(desired), haveBackend: backendOf(inventory), codebase: 'default',
        filters: getEndpointFilters({ only: args[args.indexOf('--only') + 1] }, config), deleteAll: false,
      });
      for (const change of Object.values(plan)) {
        assert.deepEqual(change.endpointsToDelete, []);
        assert.deepEqual(change.endpointsToUpdate, []);
        const created = change.endpointsToCreate.filter((fn) => calls.length !== 1 || fn.id !== 'handler000');
        inventory = [...inventory, ...created];
      }
      return { status: 0 };
    },
  });
  assert.equal(code, 0);
  assert.equal(inventory.length, 51);
  assert.equal(new Set(inventory.map((fn) => fn.id)).size, 51);
  assert.equal(calls.length, 3);
  assert.ok(calls[0].args.includes('--force'));
  assert.ok(calls[1].args.includes('--force'));
  assert.deepEqual(calls[2].args, FULL_DEPLOY);
  assertNoBareForce(calls);
  assert.deepEqual(waits, [105_000, 105_000]);
});

test('later forced initial groups stop on an unknown inventory or an already deployed target', async () => {
  const localFunctions = Array.from({ length: 51 }, (_, index) => local(`handler${String(index).padStart(3, '0')}`, false));
  for (const deployedInventory of [new Error('unreachable'), [deployed('handler050')]]) {
    const { code, calls, waits } = await runDeploy({ bootstrap: true, localFunctions, deployedInventory });
    assert.equal(code, 1);
    assert.equal(calls.length, 1);
    assert.deepEqual(waits, [105_000]);
    assertNoBareForce(calls);
  }
});

test('a failed initial group stops before waiting or creating the next group', async () => {
  const { code, calls, waits } = await runDeploy({
    bootstrap: true, localFunctions: Array.from({ length: 51 }, (_, index) => local(`handler${index}`, false)), status: () => 2,
  });
  assert.equal(code, 2);
  assert.equal(calls.length, 1);
  assert.deepEqual(waits, []);
});

// firebase-tools 15.22.4 can exit 0 after a quota 429 on a create, with the
// create still unfinished and no summary printed. Run 43091008410 left 17
// functions absent during the fresh-client proof for #827.
test('a full deploy that repeatedly exits 0 with a function absent exhausts bounded quota recovery', async () => {
  const { calls, code, errors, waits } = await runDeploy({
    bootstrap: false,
    completeInventory: [deployed('existingHttp')],
    localFunctions: [local('existingHttp', false), local('downloadEventPackage', false)],
    deployedInventory: [deployed('existingHttp')],
  });
  assert.equal(code, 1);
  assert.deepEqual(calls.map((call) => call.args), [FULL_DEPLOY, FULL_DEPLOY, FULL_DEPLOY]);
  assert.deepEqual(waits, [105_000, 105_000]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /1 function\(s\) are not deployed: downloadEventPackage\(us-central1\)/);
  assert.match(errors[0], /Quota recovery was exhausted after 3 guarded attempts/);
  assert.doesNotMatch(errors[0], /existingHttp/);
});

test('a partial fresh-client bootstrap waits for quota and succeeds through a fresh guarded deploy', async () => {
  const existing = deployed('existingHttp');
  const complete = [existing, deployed('downloadEventPackage')];
  const { calls, code, errors, waits, inventoryRead } = await runDeploy({
    bootstrap: true,
    localFunctions: [local('existingHttp', false), local('downloadEventPackage', false)],
    inventoryReads: [[], [existing], [existing], complete],
  });
  assert.equal(code, 0);
  assert.deepEqual(calls.map((call) => call.args), [
    ['firebase', 'deploy', '--only', 'functions:downloadEventPackage,functions:existingHttp',
      '--project', PROJECT, '--non-interactive', '--force'],
    FULL_DEPLOY,
  ]);
  assert.deepEqual(waits, [105_000]);
  assert.equal(inventoryRead, 4);
  assert.equal(errors.length, 0);
  assert.doesNotMatch(calls[1].args.join(' '), /--force/);
});

test('an incomplete inventory read during quota recovery stops before another deploy', async () => {
  const existing = deployed('existingHttp');
  const unavailable = Object.assign(new Error('unreachable region'), {
    code: 'INVENTORY_UNREACHABLE_REGIONS', regions: [REGION],
  });
  const { calls, code, errors, waits, inventoryRead } = await runDeploy({
    bootstrap: true,
    localFunctions: [local('existingHttp', false), local('downloadEventPackage', false)],
    inventoryReads: [[], [existing], unavailable],
  });
  assert.equal(code, 1);
  assert.deepEqual(calls.map((call) => call.args), [[
    'firebase', 'deploy', '--only', 'functions:downloadEventPackage,functions:existingHttp',
    '--project', PROJECT, '--non-interactive', '--force',
  ]]);
  assert.deepEqual(waits, [105_000]);
  assert.equal(inventoryRead, 3);
  assert.match(errors[0], /"phase":"quota-recovery-inventory"/);
  assert.match(errors[0], /"code":"INVENTORY_UNREACHABLE_REGIONS"/);
});

test('a targeted retry deploy that exits 0 incomplete waits before any full deploy', async () => {
  const existing = deployed('existingHttp');
  const retry = deployedRetry('onUserCreated');
  const complete = [existing, retry];
  const { calls, code, errors, waits, inventoryRead } = await runDeploy({
    bootstrap: true,
    localFunctions: [local('existingHttp', false), local('onUserCreated', true)],
    inventoryReads: [
      [existing],
      [existing],
      [existing],
      complete,
      complete,
    ],
  });
  assert.equal(code, 0);
  assert.deepEqual(calls.map((call) => call.args), [
    ['firebase', 'deploy', '--only', 'functions:onUserCreated', '--project', PROJECT, '--non-interactive', '--force'],
    ['firebase', 'deploy', '--only', 'functions:onUserCreated', '--project', PROJECT, '--non-interactive', '--force'],
    FULL_DEPLOY,
  ]);
  assertNoBareForce(calls);
  assert.deepEqual(waits, [105_000]);
  assert.equal(inventoryRead, 5);
  assert.equal(errors.length, 0);
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

test('a forced bootstrap deploy never reuses broad force after inventory becomes partial', async () => {
  const { calls, code, errors, waits } = await runDeploy({
    bootstrap: true,
    localFunctions: [local('onUserCreated', true), local('downloadEventPackage', false)],
    deployedInventory: [deployedRetry('onUserCreated')],
  });
  assert.equal(code, 1);
  assert.deepEqual(calls.map((call) => call.args), [
    ['firebase', 'deploy', '--only', 'functions:downloadEventPackage,functions:onUserCreated',
      '--project', PROJECT, '--non-interactive', '--force'],
    FULL_DEPLOY,
    FULL_DEPLOY,
  ]);
  assert.deepEqual(waits, [105_000, 105_000]);
  assert.equal(calls.filter((call) => call.args.includes('--force')).length, 1);
  assertNoBareForce(calls);
  assert.match(errors[0], /not deployed: downloadEventPackage\(us-central1\)/);
});

test('a function with no literal region fails the deploy check closed', async () => {
  const { code, errors, waits } = await runDeploy({
    bootstrap: false,
    completeInventory: [deployed('paramRegion')],
    localFunctions: [{ id: 'paramRegion', retry: false, regions: null }],
    deployedInventory: [deployed('paramRegion')],
  });
  assert.equal(code, 1);
  assert.deepEqual(waits, []);
  assert.match(errors[0], /paramRegion\(no literal region\)/);
});

test('a failed inventory read after the deploy fails closed', async () => {
  const { calls, code, errors, waits } = await runDeploy({
    bootstrap: false,
    completeInventory: [deployed('existingHttp')],
    localFunctions: [local('existingHttp', false)],
    deployedInventory: Object.assign(new Error('unreachable region(s): us-east1'), { code: 'INVENTORY_UNREACHABLE_REGIONS', regions: ['us-east1'] }),
  });
  assert.equal(code, 1);
  assert.equal(calls.length, 1);
  assert.deepEqual(waits, []);
  assert.match(errors[0], /could not verify the deployed functions:/);
  assert.match(errors[0], /"phase":"post-deploy-inventory"/);
  assert.match(errors[0], /"code":"INVENTORY_UNREACHABLE_REGIONS"/);
  assert.match(errors[0], /"regions":\["us-east1"\]/);
});

test('post-deploy diagnostics retain pinned Firebase status and nested transport code without secret data', async () => {
  const transport = Object.assign(new Error('secret transport URL https://example.test/?token=private'), {
    code: 'ECONNRESET', request: { headers: { authorization: 'private bearer token' } },
  });
  const original = new FirebaseError('secret response body', { status: 503, original: transport });
  const error = new FirebaseError('Failed to list functions for demo-project', { status: 503, original });
  error.context = { response: { body: 'private response' }, signedUrl: 'https://example.test/?signature=private' };
  const { calls, code, errors } = await runDeploy({
    bootstrap: false, completeInventory: [deployed('existingHttp')],
    localFunctions: [local('existingHttp', false)], deployedInventory: error,
  });
  assert.equal(code, 1);
  assert.deepEqual(calls.map((call) => call.args), [FULL_DEPLOY]);
  assert.match(errors[0], /"phase":"post-deploy-inventory"/);
  assert.match(errors[0], /"sdkStatus":503/);
  assert.doesNotMatch(errors[0], /"httpStatus"/);
  assert.match(errors[0], /"code":"ECONNRESET"/);
  assert.doesNotMatch(errors[0], /private|secret|https:|authorization|signedUrl|response body/);
});

test('inventory diagnostics bound cyclic cause chains and refuse unknown string fields', async () => {
  const error = Object.assign(new Error('private outer message'), { name: 'private type', code: 'private code' });
  const cause = Object.assign(new Error('private inner message'), { code: 'ETIMEDOUT' });
  error.cause = cause;
  cause.original = error;
  const { code, errors } = await runDeploy({ bootstrap: false, deployedInventory: error });
  assert.equal(code, 1);
  assert.match(errors[0], /"code":"ETIMEDOUT"/);
  assert.doesNotMatch(errors[0], /private/);
  assert.ok(errors[0].length < 600);
});

test('a default Firebase status is SDK metadata rather than proof of an HTTP response', async () => {
  const error = new FirebaseError('untrusted wrapper message', {
    original: Object.assign(new Error('untrusted transport message'), { code: 'ECONNRESET' }),
  });
  const { errors } = await runDeploy({ bootstrap: false, deployedInventory: error });
  assert.match(errors[0], /"sdkStatus":500/);
  assert.match(errors[0], /"code":"ECONNRESET"/);
  assert.doesNotMatch(errors[0], /"httpStatus"|untrusted/);
});

test('inventory diagnostics stop at four wrappers instead of logging arbitrary depth', async () => {
  let error = Object.assign(new Error('private deepest message'), { code: 'ECONNRESET' });
  for (let index = 0; index < 4; index += 1) error = new FirebaseError('private wrapper', { original: error });
  const { code, errors } = await runDeploy({ bootstrap: false, deployedInventory: error });
  assert.equal(code, 1);
  assert.doesNotMatch(errors[0], /ECONNRESET|private/);
  assert.equal((errors[0].match(/"type":"FirebaseError"/g) || []).length, 4);
});

test('an initial local discovery failure stops before deployment and is distinguished from the inventory read', async () => {
  const { code, calls, errors } = await runDeploy({
    bootstrap: true,
    discover: async () => { throw new Error('private discovery details'); },
  });
  assert.equal(code, 1);
  assert.equal(calls.length, 0);
  assert.match(errors[0], /"phase":"pre-deploy-discovery"/);
  assert.doesNotMatch(errors[0], /private/);
});

test('each inventory structural failure retains its fixed reason before and after deployment', async () => {
  const available = { gcfV1: [], gcfV2: [], run: [] };
  for (const [reason, availability, endpoints] of [
    ['INVENTORY_NO_AVAILABILITY', undefined, []],
    ['INVENTORY_UNREACHABLE_REGIONS', { ...available, gcfV2: ['us-east1', 'https://example.test/private'] }, []],
    ['INVENTORY_BAD_ENDPOINTS', available, {}],
  ]) {
    const check = () => readCompleteInventory(PROJECT, {
      authenticate: async () => {},
      loadBackend: async (context) => { context.unreachableRegions = availability; return {}; },
      allEndpoints: () => endpoints,
    });
    let failure;
    await assert.rejects(check, (error) => { failure = error; return error.code === reason; });
    const preErrors = [];
    const preCode = await main({
      env: { EVENT_FIREBASE_PROJECT_ID: PROJECT, EVENT_BOOTSTRAP: 'false' },
      verifyCompleteInventory: check,
      log: { log() {}, error: (message) => preErrors.push(message) },
      run: () => assert.fail('an inventory refusal must not deploy'),
    });
    const post = await runDeploy({ bootstrap: false, deployedInventory: failure });
    assert.equal(preCode, 1);
    assert.equal(post.code, 1);
    assert.equal(post.calls.length, 1);
    for (const [phase, message] of [['pre-deploy-inventory', preErrors[0]], ['post-deploy-inventory', post.errors[0]]]) {
      assert.match(message, new RegExp(`"phase":"${phase}"`));
      assert.match(message, new RegExp(`"code":"${reason}"`));
      assert.doesNotMatch(message, /private|https:/);
      if (reason === 'INVENTORY_UNREACHABLE_REGIONS') assert.match(message, /"regions":\["us-east1"\]/);
    }
  }
});

test('a failed full deploy reports its own exit code before any inventory check', async () => {
  let reads = 0;
  let waits = 0;
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
    wait: async () => { waits += 1; },
  });
  assert.equal(code, 2);
  assert.equal(reads, 1);
  assert.equal(waits, 0);
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
      throw Object.assign(new Error('unreachable region'), { code: 'INVENTORY_UNREACHABLE_REGIONS', regions: [REGION] });
    },
  });
  assert.equal(code, 1);
  assert.equal(calls.length, 0);
  assert.match(errors[0], /could not verify a complete functions inventory:/);
  assert.match(errors[0], /"phase":"pre-deploy-inventory"/);
  assert.match(errors[0], /"code":"INVENTORY_UNREACHABLE_REGIONS"/);
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

test('bootstrap and ordinary discovery preserve fixed validation reasons and the function identifier', async () => {
  for (const [reason, endpoint] of [
    ['FUNCTIONS_RETRY_VALUE', { platform: 'gcfv2', region: [REGION], eventTrigger: eventTrigger('{{ params.RETRY }}') }],
    ['FUNCTIONS_RETRY_REGIONS', { platform: 'gcfv2', eventTrigger: eventTrigger(true) }],
  ]) {
    let failure;
    await assert.rejects(discoverLocalFunctions(PROJECT, discoveryOptions({ onRetry: endpoint })), (error) => {
      failure = error;
      return error.code === reason;
    });
    for (const bootstrap of [false, true]) {
      const { code, errors } = await runDeploy({ bootstrap, discover: async () => { throw failure; } });
      assert.equal(code, 1);
      assert.match(errors[0], /"phase":"pre-deploy-discovery"/);
      assert.match(errors[0], new RegExp(`"code":"${reason}"`));
      assert.match(errors[0], /"function":"onRetry"/);
    }
  }
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

test('script-owned discovery config errors retain fixed reasons before bootstrap and ordinary deploys', async () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'functions-config-'));
  try {
    for (const [reason, config] of [
      ['FUNCTIONS_CONFIG_CODEBASE', [{ source: 'functions', codebase: 'default' }, { source: 'other-functions', codebase: 'other' }]],
      ['FUNCTIONS_CONFIG_SOURCE', { source: 'functions', codebase: 'default', prefix: 'nested' }],
    ]) {
      fs.writeFileSync(path.join(projectDir, 'firebase.json'), JSON.stringify({ functions: config }));
      let failure;
      await assert.rejects(discoverLocalFunctions(PROJECT, { projectDir, getDelegate: async () => ({}) }), (error) => {
        failure = error;
        return error.code === reason;
      });
      for (const bootstrap of [false, true]) {
        const { code, calls, errors } = await runDeploy({ bootstrap, discover: async () => { throw failure; } });
        assert.equal(code, 1);
        assert.equal(calls.length, 0);
        assert.match(errors[0], /"phase":"pre-deploy-discovery"/);
        assert.match(errors[0], new RegExp(`"code":"${reason}"`));
      }
    }
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

test('analysis failures retain only safe SDK body, stderr and debug-tail details before deploy', async () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'functions-analysis-'));
  try {
    fs.writeFileSync(path.join(projectDir, 'firebase.json'), JSON.stringify({ functions: { source: 'functions', codebase: 'default' } }));
    fs.mkdirSync(path.join(projectDir, 'functions'));
    fs.writeFileSync(path.join(projectDir, 'functions', 'index.js'), 'module.exports = {};\n');
    const logFile = path.join(projectDir, 'firebase-debug.log');
    let writeFreshLog = true;
    const options = {
      projectDir,
      loadFirebaseConfig: async () => ({ projectId: PROJECT }),
      getDelegate: async () => ({
        validate: async () => {}, build: async () => {},
        discoverBuild: async () => {
          if (writeFreshLog) {
            fs.writeFileSync(logFile, `${'ReferenceError: fixture-credential-placeholder\n'.repeat(30)}Authorization: Bearer fixture-credential-placeholder\n`);
            // Avoid filesystem timestamp granularity obscuring the new write.
            const nextTick = new Date(Date.now() + 1000);
            fs.utimesSync(logFile, nextTick, nextTick);
          }
          firebaseLogger.debug('Got response code 400; body TypeError: fixture-credential-placeholder');
          firebaseLogger.error('Error: MODULE_NOT_FOUND fixture-credential-placeholder\n    at /workspace/functions/index.js:17:3');
          throw new FirebaseError('Functions codebase could not be analyzed successfully. fixture-credential-placeholder');
        },
      }),
    };
    let failure;
    await assert.rejects(discoverLocalFunctions(PROJECT, options), (error) => { failure = error; return error.code === 'FUNCTIONS_ANALYSIS_FAILED'; });
    for (const bootstrap of [false, true]) {
      const { code, calls, errors } = await runDeploy({ bootstrap, discover: async () => { throw failure; } });
      assert.equal(code, 1);
      assert.equal(calls.length, 0);
      assert.match(errors[0], /"phase":"pre-deploy-discovery"/);
      assert.match(errors[0], /"httpStatus":400/);
      assert.match(errors[0], /"type":"TypeError"/);
      assert.match(errors[0], /"code":"MODULE_NOT_FOUND"/);
      assert.match(errors[0], /functions\/index.js:17:3/);
      assert.match(errors[0], /"source":"firebase-debug.log"/);
      assert.match(errors[0], /"source":"sdk"/);
      assert.doesNotMatch(errors[0], /fixture-credential-placeholder|Authorization|Bearer|https:|\/workspace/);
      const payload = JSON.parse(errors[0].slice(errors[0].indexOf('{')));
      assert.ok(payload.analysis.length <= 8);
    }
    writeFreshLog = false;
    fs.utimesSync(logFile, new Date(0), new Date(0));
    await assert.rejects(discoverLocalFunctions(PROJECT, options), (error) => { failure = error; return error.code === 'FUNCTIONS_ANALYSIS_FAILED'; });
    const stale = await runDeploy({ bootstrap: false, discover: async () => { throw failure; } });
    assert.equal(stale.code, 1);
    assert.equal(stale.calls.length, 0);
    assert.match(stale.errors[0], /"httpStatus":400/);
    assert.doesNotMatch(stale.errors[0], /firebase-debug\.log|ReferenceError|fixture-credential-placeholder/);
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
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
