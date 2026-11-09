'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeFakeDb } = require('../console/functions/src/fakes.cjs');
const { migrateDrafts } = require('./migrate-console-signup-links.cjs');

test('only a uniquely matching redeemed link can backfill a legacy draft', async () => {
  const draft = { status: 'draft', orgId: 'o1', createdBy: 'owner' };
  const db = makeFakeDb({
    'applications/paid': draft, 'applications/unpaid': draft, 'applications/wrong-owner': draft,
    'applications/done': { ...draft, status: 'approved' },
    'signup_links/good': { status: 'used', appId: 'paid', orgId: 'o1', usedBy: 'owner' },
    'signup_links/wrong': { status: 'used', appId: 'wrong-owner', orgId: 'o1', usedBy: 'stranger' },
  });
  const result = await migrateDrafts({ db, now: () => new Date(0) });
  assert.deepEqual(result, { linked: 1, quarantined: 2 });
  assert.equal(db.read('applications/paid').signupLinkId, 'good');
  assert.equal(db.read('applications/unpaid').legacyQuarantined, true);
  assert.equal(db.read('applications/wrong-owner').legacyQuarantined, true);
  assert.equal(db.read('applications/done').legacyQuarantined, undefined);
});

test('a completion marker makes a later run do nothing', async () => {
  const draft = { status: 'draft', orgId: 'o1', createdBy: 'owner' };
  const db = makeFakeDb({ 'applications/unpaid': draft });
  assert.deepEqual(await migrateDrafts({ db, now: () => new Date(0) }), { linked: 0, quarantined: 1 });
  const marker = db.read('data_migrations/console-signup-links-2026-11-06');
  assert.equal(marker.complete, true);
  assert.deepEqual(marker.totals, { linked: 0, quarantined: 1 });
  // A second run neither scans nor writes the quarantined draft again.
  const writes = db.writes.length;
  assert.deepEqual(await migrateDrafts({ db, now: () => new Date(1) }), { skipped: true });
  assert.equal(db.writes.length, writes);
  assert.deepEqual(db.read('applications/unpaid').quarantinedAt, new Date(0));
});
