'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { checkEnvironment, validateReceipt } = require('./run-local.cjs');

const current = { base: 'a'.repeat(40), head: 'b'.repeat(40), tree: 'c'.repeat(40) };
const jobs = { unit: true, build: true };
const now = Date.parse('2026-10-02T14:00:00Z');
const receipt = {
  version: 1, ...current,
  startedAt: '2026-10-02T13:00:00Z', completedAt: '2026-10-02T13:15:00Z',
  results: { unit: 'success', build: 'success' },
};
const verify = (value) => validateReceipt(value, current, jobs, now);

test('requires every selected suite to pass on the exact base, head, and tree', () => {
  assert.doesNotThrow(() => verify(receipt));
  for (const key of ['base', 'head', 'tree']) {
    assert.throws(() => verify({ ...receipt, [key]: 'd'.repeat(40) }), /does not prove/);
  }
  assert.throws(() => verify({ ...receipt, results: { unit: 'success' } }), /does not prove/);
  assert.throws(() => verify({ ...receipt, results: { unit: 'success', build: 'failure' } }), /does not prove/);
  assert.throws(() => verify({ ...receipt, completedAt: undefined }), /does not prove/);
  assert.throws(() => verify({ ...receipt, version: 0 }), /does not prove/);
});

test('a stale receipt cannot be republished as a fresh result', () => {
  assert.throws(() => verify({ ...receipt, startedAt: '2026-09-30T13:00:00Z' }), /expired/);
});

test('dummy build config does not enter web unit tests', () => {
  const inherited = { PATH: '/opt/node/bin' };
  assert.equal(checkEnvironment('build', inherited).VITE_FIREBASE_PROJECT_ID, 'ci-dummy');
  assert.deepEqual(checkEnvironment('unitWeb', inherited), { ...inherited, CI: 'true' });
});
