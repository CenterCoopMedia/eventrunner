'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createSetScheduleVisibilityHandler,
  internals: { buildScheduleShare, sameProjection, storedVisibility, syncScheduleShare, VISIBILITIES },
} = require('./share.cjs');
const { makeFakeDb } = require('../cms/firestoreFake.cjs');

async function shareDb() {
  const db = makeFakeDb({
    'users/u1': { displayName: 'Alex', registrationStatus: 'approved' },
    'schedule_shares/u1': { sessionIds: [], displayName: 'Alex', scheduleVisibility: 'public' },
  });
  await db.collection('users/u1/bookmarks').doc('s1').set({});
  return db;
}

test('a concurrent privacy choice survives a delayed bookmark projection', async () => {
  const db = await shareDb();
  db.beforeCommit = async () => {
    await db.collection('schedule_shares').doc('u1').update({ scheduleVisibility: 'private' });
  };
  await syncScheduleShare({ db, uid: 'u1' });
  const share = (await db.collection('schedule_shares').doc('u1').get()).data();
  assert.equal(share.scheduleVisibility, 'private');
  assert.deepEqual(share.sessionIds, ['s1']);
});

test('account deletion removes the share and delayed bookmark triggers cannot restore it', async () => {
  const db = await shareDb();
  db.beforeCommit = async () => db.collection('users').doc('u1').delete();
  await syncScheduleShare({ db, uid: 'u1' });
  await syncScheduleShare({ db, uid: 'u1' });
  assert.equal((await db.collection('schedule_shares').doc('u1').get()).exists, false);
});

test('failed projection reads reject without replacing consent or content', async () => {
  const db = await shareDb();
  const original = (await db.collection('schedule_shares').doc('u1').get()).data();
  db.runTransaction = async () => { throw new Error('read unavailable'); };
  await assert.rejects(syncScheduleShare({ db, uid: 'u1' }), /read unavailable/);
  assert.deepEqual((await db.collection('schedule_shares').doc('u1').get()).data(), original);
});

test('an owner can revoke consent after losing attendee access, but cannot publish', async () => {
  const db = await shareDb();
  await db.collection('users').doc('u1').update({ registrationStatus: 'pending' });
  const handler = createSetScheduleVisibilityHandler({
    db, auth: { verifyIdToken: async () => ({ uid: 'u1' }) }, getConfig: async () => ({}),
  });
  const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
  const req = { method: 'POST', headers: { authorization: 'Bearer fixture' }, body: { visibility: 'private', uid: 'other' } };
  await handler(req, res);
  assert.equal(res.code, 200);
  assert.equal((await db.collection('schedule_shares').doc('u1').get()).data().scheduleVisibility, 'private');
  assert.equal((await db.collection('schedule_shares').doc('other').get()).exists, false);
  await handler({ ...req, body: { visibility: 'public' } }, res);
  assert.equal(res.code, 403);
  await handler({ ...req, headers: {} }, res);
  assert.equal(res.code, 401);
});

test('buildScheduleShare: sorts and de-duplicates the session ids', () => {
  const share = buildScheduleShare({
    sessionIds: ['s3', 's1', 's1', 's2'],
    displayName: 'Alex',
    existing: null,
  });
  assert.deepEqual(share.sessionIds, ['s1', 's2', 's3']);
  assert.equal(share.displayName, 'Alex');
});

test('buildScheduleShare: a missing, unknown, or malformed stored visibility reads as private', () => {
  for (const stored of [undefined, null, 'friends', 7, {}]) {
    assert.equal(
      buildScheduleShare({ sessionIds: [], displayName: null, existing: { scheduleVisibility: stored } })
        .scheduleVisibility,
      'private',
      String(stored),
    );
  }
  assert.equal(storedVisibility('public'), 'public');
});

test('buildScheduleShare: an explicit visibility (the consent act) is the one stored', () => {
  const share = buildScheduleShare({
    sessionIds: [],
    displayName: null,
    existing: { scheduleVisibility: 'private' },
    visibility: 'attendees_only',
  });
  assert.equal(share.scheduleVisibility, 'attendees_only');
});

test('buildScheduleShare: a blank or non-string display name stores null', () => {
  assert.equal(buildScheduleShare({ sessionIds: [], displayName: '   ', existing: null }).displayName, null);
  assert.equal(buildScheduleShare({ sessionIds: [], displayName: 42, existing: null }).displayName, null);
});

test('sameProjection: only the projected fields matter, never updatedAt', () => {
  const next = { sessionIds: ['s1'], displayName: 'Alex', scheduleVisibility: 'private' };
  assert.equal(sameProjection({ ...next, updatedAt: new Date('2026-01-01') }, next), true);
  assert.equal(
    sameProjection({ ...next, sessionIds: ['s2'], updatedAt: new Date('2026-01-01') }, next),
    false,
  );
  assert.equal(sameProjection(null, next), false);
  // An unsorted stored list against the sorted next still differs.
  assert.equal(sameProjection({ ...next, sessionIds: [] }, next), false);
});

test('the visibility list is the closed list the rules read', () => {
  assert.deepEqual([...VISIBILITIES], ['private', 'attendees_only', 'public']);
});
