'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { leaseIsLive, holdsLease, newLeaseToken } = require('./lease.cjs');

const NOW = 1_000_000;
const TTL = 60_000;

test('a lease is live until its end, for both stored shapes', () => {
  assert.equal(leaseIsLive({ until: new Date(NOW + 1) }, NOW, TTL), true);
  assert.equal(leaseIsLive({ until: new Date(NOW) }, NOW, TTL), false);
  assert.equal(leaseIsLive({ startedAt: new Date(NOW - TTL + 1) }, NOW, TTL), true);
  assert.equal(leaseIsLive({ startedAt: new Date(NOW - TTL) }, NOW, TTL), false);
  assert.equal(leaseIsLive({ startedAt: { toMillis: () => NOW } }, NOW, TTL), true);
  assert.equal(leaseIsLive(null, NOW, TTL), false);
  assert.equal(leaseIsLive({}, NOW, TTL), false);
});

test('only the run that took a lease holds it', () => {
  const token = newLeaseToken();
  assert.match(token, /^[0-9a-f-]{36}$/);
  assert.notEqual(newLeaseToken(), token);
  assert.equal(holdsLease({ token }, token), true);
  assert.equal(holdsLease({ token: 'other' }, token), false);
  assert.equal(holdsLease(null, token), false);
  assert.equal(holdsLease({ token: undefined }, undefined), false);
});
