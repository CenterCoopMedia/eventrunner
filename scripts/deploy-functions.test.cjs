'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { main, readCompleteInventory } = require('./deploy-functions.cjs');

const PROJECT = 'demo-project';
const quiet = { log() {}, error() {} };

async function runDeploy({ bootstrap, completeInventory = [] }) {
  const calls = [];
  const code = await main({
    env: {
      EVENT_FIREBASE_PROJECT_ID: PROJECT,
      EVENT_BOOTSTRAP: String(bootstrap),
    },
    log: quiet,
    verifyCompleteInventory: async () => completeInventory,
    run(args, options) {
      calls.push({ args, options });
      return { status: 0 };
    },
  });
  return { calls, code };
}

test('ordinary deploys skip inventory and never use force', async () => {
  const { calls, code } = await runDeploy({ bootstrap: false });
  assert.equal(code, 0);
  assert.deepEqual(calls.map((call) => call.args), [[
    'firebase', 'deploy', '--project', PROJECT, '--non-interactive', '--only', 'functions',
  ]]);
});

test('bootstrap deploys use force only after a successful complete empty inventory', async () => {
  const { calls, code } = await runDeploy({ bootstrap: true });
  assert.equal(code, 0);
  assert.deepEqual(calls.map((call) => call.args), [[
    'firebase', 'deploy', '--project', PROJECT, '--non-interactive', '--only', 'functions', '--force',
  ]]);
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
