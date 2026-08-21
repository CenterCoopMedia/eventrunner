'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveClients, buildSmokeUrls } = require('./deploy-matrix.cjs');

test('workflow_dispatch resolves to the single dispatched client', () => {
  const clients = resolveClients({
    eventName: 'workflow_dispatch',
    dispatchClient: 'cjs2027',
    autoDeployEnvironments: 'a,b,c',
  });
  assert.deepEqual(clients, ['cjs2027']);
});

test('workflow_dispatch with an empty client resolves to no clients', () => {
  assert.deepEqual(resolveClients({ eventName: 'workflow_dispatch', dispatchClient: '' }), []);
  assert.deepEqual(resolveClients({ eventName: 'workflow_dispatch' }), []);
});

test('workflow_dispatch trims the dispatched client', () => {
  const clients = resolveClients({ eventName: 'workflow_dispatch', dispatchClient: '  cjs2027  ' });
  assert.deepEqual(clients, ['cjs2027']);
});

test('push ignores inputs.client entirely — the exact bug this exists to prevent', () => {
  // A push run must never bind an environment from a leftover/empty
  // dispatch input; only AUTO_DEPLOY_ENVIRONMENTS decides.
  const clients = resolveClients({
    eventName: 'push',
    dispatchClient: '',
    autoDeployEnvironments: 'cjs2027,summit2026',
  });
  assert.deepEqual(clients, ['cjs2027', 'summit2026']);
});

test('push with an unset AUTO_DEPLOY_ENVIRONMENTS resolves to no clients', () => {
  assert.deepEqual(resolveClients({ eventName: 'push' }), []);
  assert.deepEqual(resolveClients({ eventName: 'push', autoDeployEnvironments: '' }), []);
});

test('push splits, trims, drops blanks, and de-duplicates', () => {
  const clients = resolveClients({
    eventName: 'push',
    autoDeployEnvironments: ' cjs2027 ,, summit2026,cjs2027,  ',
  });
  assert.deepEqual(clients, ['cjs2027', 'summit2026']);
});

test('buildSmokeUrls composes the Cloud Functions domain per endpoint', () => {
  const urls = buildSmokeUrls({
    region: 'us-central1',
    projectId: 'cjs2027-prod',
    endpoints: ['getSiteContent', 'sendOtpCode'],
  });
  assert.deepEqual(urls, [
    'https://us-central1-cjs2027-prod.cloudfunctions.net/getSiteContent',
    'https://us-central1-cjs2027-prod.cloudfunctions.net/sendOtpCode',
  ]);
});

test('buildSmokeUrls rejects missing region, project, or endpoints', () => {
  assert.throws(() => buildSmokeUrls({ projectId: 'p', endpoints: ['a'] }));
  assert.throws(() => buildSmokeUrls({ region: 'r', endpoints: ['a'] }));
  assert.throws(() => buildSmokeUrls({ region: 'r', projectId: 'p', endpoints: [] }));
  assert.throws(() => buildSmokeUrls({ region: 'r', projectId: 'p', endpoints: [''] }));
});
