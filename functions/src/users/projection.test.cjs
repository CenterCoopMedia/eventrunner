'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createSyncUserPublic } = require('./projection.cjs');

const BADGES_CONFIG = {
  categories: [
    { id: 'craft', maxPicks: 2, badges: [{ id: 'writer' }, { id: 'editor' }] },
  ],
};

/**
 * Minimal Firestore fake: doc refs plus a transaction with get/set/delete
 * and a write audit. The transaction applies its writes immediately —
 * enough to pin the property that matters here, that the handler projects
 * the SOURCE document it reads rather than anything an event handed it.
 */
function fakeDb(seed = {}) {
  const docs = new Map(Object.entries(seed));
  const writes = [];
  const reads = [];
  const ref = (key) => ({ key });
  return {
    docs,
    writes,
    reads,
    collection(name) {
      return { doc: (id) => ref(`${name}/${id}`) };
    },
    async runTransaction(fn) {
      return fn({
        async get({ key }) {
          reads.push(key);
          const data = docs.get(key);
          return { exists: data !== undefined, data: () => data };
        },
        set({ key }, data) {
          docs.set(key, data);
          writes.push({ type: 'set', path: key });
        },
        delete({ key }) {
          docs.delete(key);
          writes.push({ type: 'delete', path: key });
        },
      });
    },
  };
}

function userDoc(overrides = {}) {
  return {
    uid: 'u1',
    email: 'rae@example.org',
    displayName: 'Rae Okonkwo',
    bio: 'Community reporter.',
    badges: ['writer'],
    profileVisibility: 'attendees_only',
    registrationStatus: 'approved',
    approvalSource: 'admin',
    role: 'attendee',
    speakerId: null,
    ...overrides,
  };
}

function build(seed = {}, { badges = BADGES_CONFIG, failConfig = false } = {}) {
  const db = fakeDb(seed);
  const errors = [];
  const sync = createSyncUserPublic({
    db,
    getConfig: async () => {
      if (failConfig) throw new Error('firestore down');
      return { badges };
    },
    now: () => new Date('2026-08-21T12:00:00Z'),
    log: { error: (...args) => errors.push(args) },
  });
  return { db, sync, errors };
}

test('projects a public-safe document and leaves private fields behind', async () => {
  const { db, sync } = build({ 'users/u1': userDoc() });
  const result = await sync({ uid: 'u1' });

  assert.equal(result.action, 'written');
  const pub = db.docs.get('users_public/u1');
  assert.equal(pub.displayName, 'Rae Okonkwo');
  assert.equal(pub.profileVisibility, 'attendees_only');
  assert.equal(pub.uid, 'u1');
  assert.deepEqual(pub.updatedAt, new Date('2026-08-21T12:00:00Z'));
  for (const secret of ['email', 'registrationStatus', 'approvalSource', 'role']) {
    assert.equal(pub[secret], undefined, `${secret} must not reach users_public`);
  }
});

test('projects the CURRENT account document, so an out-of-order delivery cannot republish a stale one', async () => {
  // The user went public, then private. The private write already landed;
  // the public write's (older) trigger delivery arrives afterwards. It must
  // project what the account says now, not what its event carried.
  const { db, sync } = build({ 'users/u1': userDoc({ profileVisibility: 'public' }) });
  await sync({ uid: 'u1' });
  assert.equal(db.docs.get('users_public/u1').profileVisibility, 'public');

  db.docs.set('users/u1', userDoc({ profileVisibility: 'private' }));
  await sync({ uid: 'u1' }); // the private write's own delivery
  await sync({ uid: 'u1' }); // the older public write's delayed delivery

  assert.equal(db.docs.get('users_public/u1').profileVisibility, 'private');
  // Both documents are read inside the transaction, so the write is
  // conditioned on the source it just read.
  assert.ok(db.reads.includes('users/u1'));
  assert.ok(db.reads.includes('users_public/u1'));
});

test('rewrites badges to the intersection with config/badges', async () => {
  const { db, sync } = build({ 'users/u1': userDoc({ badges: ['writer', 'unconfigured'] }) });
  await sync({ uid: 'u1' });
  assert.deepEqual(db.docs.get('users_public/u1').badges, ['writer']);
});

test('an unreadable config/badges publishes no badges but still projects the profile', async () => {
  const { db, sync, errors } = build({ 'users/u1': userDoc() }, { failConfig: true });
  await sync({ uid: 'u1' });
  const pub = db.docs.get('users_public/u1');
  assert.deepEqual(pub.badges, []);
  assert.equal(pub.profileVisibility, 'attendees_only');
  assert.equal(errors.length, 1);
});

test('a deleted account deletes its projection', async () => {
  const { db, sync } = build({ 'users_public/u1': { displayName: 'Rae Okonkwo' } });
  const result = await sync({ uid: 'u1' });
  assert.equal(result.action, 'deleted');
  assert.equal(db.docs.has('users_public/u1'), false);
});

test('a write that does not change the projection writes nothing', async () => {
  const { db, sync } = build({ 'users/u1': userDoc() });
  await sync({ uid: 'u1' });
  db.writes.length = 0;

  // Only private fields moved: registrationStatus is not projected.
  db.docs.set('users/u1', userDoc({ registrationStatus: 'revoked', lastSeenAt: 'now' }));
  const result = await sync({ uid: 'u1' });
  assert.equal(result.action, 'unchanged');
  assert.deepEqual(db.writes, []);
});

test('a visibility change is projected, because the read rules branch on it', async () => {
  const { db, sync } = build({ 'users/u1': userDoc() });
  await sync({ uid: 'u1' });
  db.docs.set('users/u1', userDoc({ profileVisibility: 'private' }));
  const result = await sync({ uid: 'u1' });
  assert.equal(result.action, 'written');
  assert.equal(db.docs.get('users_public/u1').profileVisibility, 'private');
});

test('a non-string value in a rendered field is coerced, never projected as an object', async () => {
  const { db, sync } = build({
    'users/u1': userDoc({ displayName: { first: 'Rae' }, bio: ['line'], photoPath: 7 }),
  });
  await sync({ uid: 'u1' });
  const pub = db.docs.get('users_public/u1');
  assert.equal(pub.displayName, '');
  assert.equal(pub.bio, '');
  assert.equal(pub.photoPath, null);
});

test('a missing uid is logged and writes nothing', async () => {
  const { db, sync, errors } = build({ 'users/u1': userDoc() });
  const result = await sync({ uid: '' });
  assert.equal(result.action, 'unchanged');
  assert.deepEqual(db.writes, []);
  assert.equal(errors.length, 1);
});
