'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createSyncUserPublic } = require('./projection.cjs');

const BADGES_CONFIG = {
  categories: [
    { id: 'craft', maxPicks: 2, badges: [{ id: 'writer' }, { id: 'editor' }] },
  ],
};

/** Minimal Firestore fake: doc get/set/delete plus a write audit. */
function fakeDb(seed = {}) {
  const docs = new Map(Object.entries(seed));
  const writes = [];
  return {
    docs,
    writes,
    collection(name) {
      return {
        doc(id) {
          const key = `${name}/${id}`;
          return {
            async get() {
              const data = docs.get(key);
              return { exists: data !== undefined, data: () => data };
            },
            async set(data) {
              docs.set(key, data);
              writes.push({ type: 'set', path: key });
            },
            async delete() {
              docs.delete(key);
              writes.push({ type: 'delete', path: key });
            },
          };
        },
      };
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
  const { db, sync } = build();
  const result = await sync({ uid: 'u1', after: userDoc() });

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

test('rewrites badges to the intersection with config/badges', async () => {
  const { db, sync } = build();
  await sync({ uid: 'u1', after: userDoc({ badges: ['writer', 'unconfigured'] }) });
  assert.deepEqual(db.docs.get('users_public/u1').badges, ['writer']);
});

test('an unreadable config/badges publishes no badges but still projects the profile', async () => {
  const { db, sync, errors } = build({}, { failConfig: true });
  await sync({ uid: 'u1', after: userDoc() });
  const pub = db.docs.get('users_public/u1');
  assert.deepEqual(pub.badges, []);
  assert.equal(pub.profileVisibility, 'attendees_only');
  assert.equal(errors.length, 1);
});

test('a deleted account deletes its projection', async () => {
  const { db, sync } = build({ 'users_public/u1': { displayName: 'Rae Okonkwo' } });
  const result = await sync({ uid: 'u1', after: null });
  assert.equal(result.action, 'deleted');
  assert.equal(db.docs.has('users_public/u1'), false);
});

test('a write that does not change the projection writes nothing', async () => {
  const { db, sync } = build();
  await sync({ uid: 'u1', after: userDoc() });
  db.writes.length = 0;

  // Only private fields moved: registrationStatus is not projected.
  const result = await sync({
    uid: 'u1',
    after: userDoc({ registrationStatus: 'revoked', lastSeenAt: 'now' }),
  });
  assert.equal(result.action, 'unchanged');
  assert.deepEqual(db.writes, []);
});

test('a visibility change is projected, because the read rules branch on it', async () => {
  const { db, sync } = build();
  await sync({ uid: 'u1', after: userDoc() });
  const result = await sync({
    uid: 'u1',
    after: userDoc({ profileVisibility: 'private' }),
  });
  assert.equal(result.action, 'written');
  assert.equal(db.docs.get('users_public/u1').profileVisibility, 'private');
});

test('a missing uid is logged and writes nothing', async () => {
  const { db, sync, errors } = build();
  const result = await sync({ uid: '', after: userDoc() });
  assert.equal(result.action, 'unchanged');
  assert.deepEqual(db.writes, []);
  assert.equal(errors.length, 1);
});
