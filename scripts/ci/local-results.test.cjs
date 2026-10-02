'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { hasTrustedResult, statusContext } = require('./local-results.cjs');

const base = 'a'.repeat(40);
const now = Date.parse('2026-10-02T14:00:00Z');
const result = {
  context: statusContext(base),
  state: 'success',
  creator: { id: 123 },
  created_at: '2026-10-02T13:00:00Z',
};
const verify = (statuses, actorId = '123') => hasTrustedResult({ statuses, base, actorId, now });

test('accepts a recent result from the configured publisher for the exact base', () => {
  assert.equal(verify([result]), true);
});

test('rejects absent, wrong-publisher, wrong-base, and non-success evidence', () => {
  assert.equal(verify([]), false);
  assert.equal(verify([result], ''), false);
  assert.equal(verify([result], '456'), false);
  assert.equal(verify([{ ...result, context: statusContext('b'.repeat(40)) }]), false);
  for (const state of ['pending', 'error', 'failure']) {
    assert.equal(verify([{ ...result, state }]), false);
  }
});

test('a newer failure cannot fall back to an older pass', () => {
  assert.equal(verify([{ ...result, state: 'failure' }, result]), false);
});

test('rejects expired, future, or malformed timestamps', () => {
  for (const created_at of ['2026-09-30T13:00:00Z', '2026-10-03T13:00:00Z', 'invalid']) {
    assert.equal(verify([{ ...result, created_at }]), false);
  }
});
