'use strict';

const REGION = 'us-central1';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { ENDPOINTS, SCHEDULED, WEBHOOKS, buildHandlers } = require('./handlers.cjs');

const firebaseJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'firebase.json'), 'utf8'));
const ALL_FUNCTIONS = [...Object.keys(ENDPOINTS), ...Object.keys(WEBHOOKS), ...Object.keys(SCHEDULED)].sort();
const HTTP_FUNCTIONS = [...Object.keys(ENDPOINTS), ...Object.keys(WEBHOOKS)];

test('every endpoint is an onRequest function with a Hosting rewrite at /api/<name>', () => {
  const handlers = buildHandlers();
  assert.deepEqual(Object.keys(handlers).sort(), ALL_FUNCTIONS);
  for (const name of HTTP_FUNCTIONS) {
    assert.equal(typeof handlers[name], 'function', name);
    const rewrite = firebaseJson.hosting.rewrites.find((r) => r.source === `/api/${name}`);
    assert.ok(rewrite, `rewrite for ${name}`);
    assert.equal(rewrite.function.functionId, name);
  }
  const apiRewrites = firebaseJson.hosting.rewrites.filter((r) => r.source.startsWith('/api/'));
  assert.equal(apiRewrites.length, HTTP_FUNCTIONS.length, 'no rewrite points at a missing function');
});

test('the deploy barrel exports the same endpoints', () => {
  const barrel = require('../index.js');
  assert.deepEqual(Object.keys(barrel).sort(), ALL_FUNCTIONS);
});

test('the retention job is scheduled and has no Hosting rewrite', () => {
  assert.deepEqual(Object.keys(SCHEDULED), ['runApplicationRetention']);
  assert.ok(!firebaseJson.hosting.rewrites.some((r) => r.function?.functionId === 'runApplicationRetention'));
  assert.equal(typeof buildHandlers().runApplicationRetention, 'function');
});

test('only the functions that send email get the mail secret', () => {
  assert.deepEqual(
    Object.entries(ENDPOINTS).filter(([, spec]) => spec.mail).map(([name]) => name),
    ['inviteMember', 'submitApplication', 'withdrawApplication', 'acceptAgreement', 'reopenApplication', 'requestChanges', 'declineApplication', 'approveApplication'],
  );
});

test('only the functions that reach the payment service get its key', () => {
  assert.deepEqual(
    Object.entries(ENDPOINTS).filter(([, spec]) => spec.stripe).map(([name]) => name),
    ['withdrawApplication', 'reopenApplication', 'startFeeCheckout', 'declineApplication', 'deleteSpamApplication'],
  );
});

test('the functions run in the region the Hosting rewrites name, whatever the environment says', () => {
  const firebaseJson = require('../../firebase.json');
  const regions = new Set(firebaseJson.hosting.rewrites.filter((r) => r.function).map((r) => r.function.region));
  assert.deepEqual([...regions], [REGION]);
  assert.equal(require('./handlers.cjs').REGION, REGION);
});
