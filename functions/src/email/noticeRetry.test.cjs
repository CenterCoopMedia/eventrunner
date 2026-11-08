'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { QUEUED_STALE_MS, noticeRetryState, toMillis } = require('./noticeRetry.cjs');

const NOW = 1_000_000_000;

test('refuses a sent or freshly queued email, and flags one that may have gone', () => {
  assert.equal(noticeRetryState({ state: 'sent' }, NOW).refusal.code, 'already-sent');
  assert.equal(noticeRetryState({ state: 'queued', queuedAt: new Date(NOW - 1000) }, NOW).refusal.code, 'in-progress');
  assert.equal(noticeRetryState({ state: 'queued', queuedAt: null }, NOW).refusal.code, 'in-progress');
  assert.deepEqual(noticeRetryState({ state: 'queued', queuedAt: new Date(NOW - QUEUED_STALE_MS) }, NOW), { mayHaveBeenSent: true });
  assert.deepEqual(noticeRetryState({ state: 'uncertain' }, NOW), { mayHaveBeenSent: true });
  // Records stored before November 2026 said `unknown`.
  assert.deepEqual(noticeRetryState({ state: 'unknown' }, NOW), { mayHaveBeenSent: true });
  assert.deepEqual(noticeRetryState({ state: 'failed' }, NOW), { mayHaveBeenSent: false });
  assert.deepEqual(noticeRetryState(null, NOW), { mayHaveBeenSent: false });
});

test('reads Firestore timestamps, dates and numbers', () => {
  assert.equal(toMillis({ toMillis: () => 5 }), 5);
  assert.equal(toMillis(new Date(7)), 7);
  assert.equal(toMillis(9), null);
  assert.equal(toMillis('x'), null);
  assert.equal(toMillis(null), null);
});
