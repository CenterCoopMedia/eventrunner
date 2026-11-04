'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { makeFakeDb } = require('./fakes.cjs');
const { takeSlot } = require('./rateLimit.cjs');

const HOUR = 60 * 60 * 1000;

test('takeSlot allows max calls in one window, then refuses with a retry time', async () => {
  const db = makeFakeDb();
  let now = Date.parse('2026-11-04T12:00:00Z');
  const take = () => takeSlot(db, { key: 'invite-org:o1', max: 2, windowMs: HOUR, now: () => now });
  await take();
  await take();
  await assert.rejects(take(), (err) => {
    assert.equal(err.status, 429);
    assert.equal(err.code, 'rate-limited');
    assert.equal(err.retryAfterSeconds, 3600);
    return true;
  });
  now += HOUR;
  await take();
  assert.equal(db.read('console_rate_limits/invite-org:o1').count, 1);
});

test('takeSlot keys are separate', async () => {
  const db = makeFakeDb();
  const now = () => 0;
  await takeSlot(db, { key: 'a', max: 1, windowMs: HOUR, now });
  await takeSlot(db, { key: 'b', max: 1, windowMs: HOUR, now });
  await assert.rejects(takeSlot(db, { key: 'a', max: 1, windowMs: HOUR, now }), { status: 429 });
});

test('takeSlot refuses a key that is not one document id', async () => {
  await assert.rejects(takeSlot(makeFakeDb(), { key: 'a/b', max: 1, windowMs: HOUR }), TypeError);
});
