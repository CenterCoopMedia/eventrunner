'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { ENDPOINTS, buildHandlers } = require('./handlers.cjs');

const firebaseJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'firebase.json'), 'utf8'));

test('every endpoint is an onRequest function with a Hosting rewrite at /api/<name>', () => {
  const handlers = buildHandlers();
  assert.deepEqual(Object.keys(handlers).sort(), Object.keys(ENDPOINTS).sort());
  for (const name of Object.keys(ENDPOINTS)) {
    assert.equal(typeof handlers[name], 'function', name);
    const rewrite = firebaseJson.hosting.rewrites.find((r) => r.source === `/api/${name}`);
    assert.ok(rewrite, `rewrite for ${name}`);
    assert.equal(rewrite.function.functionId, name);
  }
  const apiRewrites = firebaseJson.hosting.rewrites.filter((r) => r.source.startsWith('/api/'));
  assert.equal(apiRewrites.length, Object.keys(ENDPOINTS).length, 'no rewrite points at a missing function');
});

test('the deploy barrel exports the same endpoints', () => {
  const barrel = require('../index.js');
  assert.deepEqual(Object.keys(barrel).sort(), Object.keys(ENDPOINTS).sort());
});

test('only inviteMember needs the mail secret', () => {
  assert.deepEqual(
    Object.entries(ENDPOINTS).filter(([, spec]) => spec.mail).map(([name]) => name),
    ['inviteMember'],
  );
});
