'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildNewUserDoc,
  createOnUserCreated,
  createMaintainProfileComplete,
} = require('./lifecycle.cjs');

const NOW = new Date('2026-08-21T12:00:00Z');

/** Minimal Firestore fake: doc create/update plus a write audit. */
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
            async create(data) {
              if (docs.has(key)) {
                const err = new Error('already exists');
                err.code = 6;
                throw err;
              }
              docs.set(key, data);
              writes.push({ type: 'create', path: key });
            },
            async update(patch) {
              if (!docs.has(key)) {
                const err = new Error('not found');
                err.code = 5;
                throw err;
              }
              docs.set(key, { ...docs.get(key), ...patch });
              writes.push({ type: 'update', path: key });
            },
          };
        },
      };
    },
  };
}

test('a new account starts pending, non-speaker, and attendees_only', () => {
  const doc = buildNewUserDoc({ uid: 'u1', email: 'Rae@Example.org', displayName: 'Rae' }, NOW);
  assert.equal(doc.registrationStatus, 'pending');
  assert.equal(doc.speakerId, null);
  assert.equal(doc.approvalSource, null);
  assert.equal(doc.profileVisibility, 'attendees_only');
  assert.equal(doc.profileComplete, false);
  assert.equal(doc.email, 'rae@example.org'); // lowercased for matching
  assert.equal(doc.displayName, 'Rae');
  assert.deepEqual(doc.createdAt, NOW);
});

test('a provider that supplies no name leaves displayName empty rather than guessing', () => {
  const doc = buildNewUserDoc({ uid: 'u1', email: 'rae@example.org', displayName: null }, NOW);
  assert.equal(doc.displayName, '');
  assert.equal(doc.email, 'rae@example.org');
});

test('onUserCreated seeds the account document', async () => {
  const db = fakeDb();
  const result = await createOnUserCreated({ db, now: () => NOW })({
    uid: 'u1',
    email: 'rae@example.org',
    displayName: 'Rae',
  });
  assert.equal(result.created, true);
  assert.equal(db.docs.get('users/u1').registrationStatus, 'pending');
});

test('a retried delivery never overwrites an existing account with pending defaults', async () => {
  const db = fakeDb({ 'users/u1': { registrationStatus: 'approved', approvalSource: 'admin' } });
  const result = await createOnUserCreated({ db, now: () => NOW })({ uid: 'u1' });
  assert.equal(result.created, false);
  assert.equal(db.docs.get('users/u1').registrationStatus, 'approved');
  assert.deepEqual(db.writes, []);
});

test('onUserCreated without a uid writes nothing', async () => {
  const db = fakeDb();
  const errors = [];
  const result = await createOnUserCreated({ db, now: () => NOW, log: { error: () => errors.push(1) } })(null);
  assert.equal(result.created, false);
  assert.deepEqual(db.writes, []);
  assert.equal(errors.length, 1);
});

test('maintainProfileComplete flips the derived flag once the profile is filled in', async () => {
  const db = fakeDb({ 'users/u1': { displayName: '', profileVisibility: 'attendees_only', profileComplete: false } });
  const maintain = createMaintainProfileComplete({ db });

  const unchanged = await maintain({ uid: 'u1', after: db.docs.get('users/u1') });
  assert.equal(unchanged.action, 'unchanged');

  const after = { displayName: 'Rae', profileVisibility: 'attendees_only', profileComplete: false };
  db.docs.set('users/u1', after);
  const written = await maintain({ uid: 'u1', after });
  assert.equal(written.action, 'written');
  assert.equal(db.docs.get('users/u1').profileComplete, true);

  // Loop safety: the write it just made must not produce another write.
  const settled = await maintain({ uid: 'u1', after: db.docs.get('users/u1') });
  assert.equal(settled.action, 'unchanged');
});

test('maintainProfileComplete clears the flag when a profile is emptied out', async () => {
  const after = { displayName: '  ', profileVisibility: 'attendees_only', profileComplete: true };
  const db = fakeDb({ 'users/u1': after });
  const result = await createMaintainProfileComplete({ db })({ uid: 'u1', after });
  assert.equal(result.action, 'written');
  assert.equal(db.docs.get('users/u1').profileComplete, false);
});

test('maintainProfileComplete ignores a deleted account', async () => {
  const db = fakeDb();
  const result = await createMaintainProfileComplete({ db })({ uid: 'u1', after: null });
  assert.equal(result.action, 'unchanged');
  assert.deepEqual(db.writes, []);
});
