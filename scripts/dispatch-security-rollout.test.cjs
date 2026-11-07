'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeFakeDb } = require('../console/functions/src/fakes.cjs');
const { liveClients } = require('./dispatch-security-rollout.cjs');

test('console records select active sites and exclude archived, purged and building targets even from an explicit legacy list', async () => {
  const db = makeFakeDb({
    'applications/live': { status: 'launched' }, 'console_builds/live': { resources: { githubEnvironment: 'live-site' } },
    'applications/archived': { status: 'archived' }, 'console_builds/archived': { environmentClaim: 'archived-site' },
    'applications/building': { status: 'building' }, 'console_builds/building': { resources: { environment: 'building-site' } },
    'console_deleted_sites/purged': { resources: { githubEnvironment: 'purged-site' } },
  });
  const selected = await liveClients({ db, legacyClients: ['legacy', 'live-site', 'archived-site', 'building-site', 'purged-site'] });
  assert.deepEqual(selected, ['legacy', 'live-site']);
});

test('an active site with missing target provenance fails closed instead of guessing an environment', async () => {
  const db = makeFakeDb({ 'applications/live': { status: 'ready' } });
  await assert.rejects(liveClients({ db }), /no valid recorded deployment environment/);
});

test('explicit targets cannot name console, provisioning or a malformed environment', async () => {
  for (const name of ['console', 'provisioning', '../wrong', '']) {
    await assert.rejects(liveClients({ db: makeFakeDb(), legacyClients: [name] }), /Invalid legacy/);
  }
});
