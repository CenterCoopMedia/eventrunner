'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeFakeDb } = require('../console/functions/src/fakes.cjs');
const { liveClients } = require('./dispatch-security-rollout.cjs');

test('rollout includes configured legacy and active sites and excludes archived, purged and incomplete builds', async () => {
  const db = makeFakeDb({
    'applications/live': { status: 'launched' }, 'applications/archived': { status: 'archived' },
    'applications/building': { status: 'building' }, 'console_deleted_sites/purged': {},
  });
  const config = { EVENT_FIREBASE_PROJECT_ID: 'example', WIF_PROVIDER: 'wif', WIF_SERVICE_ACCOUNT: 'deploy@example.test' };
  const names = ['legacy', 'live', 'archived', 'building', 'purged', 'console'];
  const selected = await liveClients({ db, environments: names.map((name) => ({ name })),
    variablesFor: async (name) => name === 'console' ? { CONSOLE_PROJECT_ID: 'console' }
      : { ...config, ...(name === 'legacy' ? {} : { EVENTRUNNER_REQUEST_ID: name }) },
  });
  assert.deepEqual(selected, ['legacy', 'live']);
});
