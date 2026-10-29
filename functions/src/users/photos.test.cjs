'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeFakeDb } = require('../cms/firestoreFake.cjs');
const { createProfilePhotoUploadHandler, reclaim, MAX_OBJECTS, MAX_BYTES, MAX_PER_HOUR, HOUR } = require('./photos.cjs');

function fixture(seed = {}) {
  const db = makeFakeDb({ 'users/owner': { photoPath: null }, ...seed });
  const files = new Map();
  const saved = [];
  let clock = HOUR * 10;
  let serial = 0;
  let failDelete = false;
  let failSave = false;
  const bucket = { file(path) { return {
    async save(bytes, options) {
      files.set(path, bytes);
      saved.push({ path, bytes, options });
      if (failSave) throw new Error('ambiguous save failure');
    },
    async delete() {
      if (failDelete) throw new Error('delete failed');
      files.delete(path);
    },
  }; } };
  const auth = { async verifyIdToken(token, checkRevoked) {
    assert.equal(checkRevoked, true);
    if (token !== 'valid') throw new Error('invalid token');
    return { uid: 'owner' };
  } };
  const now = () => clock;
  const handler = createProfilePhotoUploadHandler({ db, bucket, auth, now, render: async (buffer) => buffer, newId: () => `id-${++serial}`, log: { error() {} } });
  return { db, files, saved, bucket, now,
    advance(ms) { clock += ms; },
    failDelete(value) { failDelete = value; },
    failSave(value) { failSave = value; },
    async upload(body = {}, token = 'valid', method = 'POST') {
      const res = { status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; }, set() {} };
      await handler({ method, headers: { authorization: `Bearer ${token}` }, body: { contentType: 'image/png', data: 'AQID', ...body } }, res);
      return res;
    },
  };
}

test('auth, live account, MIME, size, and method are enforced before storage', async () => {
  const f = fixture();
  assert.equal((await f.upload({}, 'invalid')).code, 401);
  assert.equal((await f.upload({}, 'valid', 'GET')).code, 405);
  for (const body of [{ contentType: 'image/svg+xml' }, { data: '?' }, { data: '' }, { data: Buffer.alloc(MAX_BYTES).toString('base64') }]) {
    assert.equal((await f.upload(body)).code, 400);
  }
  await f.db.collection('users').doc('owner').delete();
  assert.equal((await f.upload()).code, 403);
  assert.equal(f.saved.length, 0);
});

test('server chooses fresh owner paths; valid types below the strict cap succeed', async () => {
  const f = fixture();
  for (const contentType of ['image/png', 'image/jpeg', 'image/webp']) {
    const res = await f.upload({ uid: 'victim', path: 'branding/logo.svg', contentType, data: Buffer.alloc(MAX_BYTES - 1).toString('base64') });
    assert.equal(res.code, 200);
    assert.match(res.body.path, /^profile-photos\/owner\/id-\d\/photo\.webp$/);
    assert.equal(res.body.expiresAtMs, f.now() + HOUR);
  }
  assert.equal(new Set(f.saved.map((x) => x.path)).size, 3);
  assert.deepEqual(f.saved[0].options.preconditionOpts, { ifGenerationMatch: 0 });
});

test('object quota bounds stored bytes, including concurrent requests', async () => {
  const f = fixture();
  await Promise.all(Array.from({ length: 8 }, () => f.upload()));
  assert.ok(f.saved.length <= MAX_OBJECTS);
  assert.equal((await f.upload()).code, 429);
  assert.ok(f.files.size <= MAX_OBJECTS);
});

test('rate budget survives quota refusals and resets after the window', async () => {
  const f = fixture();
  for (let i = 0; i < MAX_PER_HOUR; i++) await f.upload();
  assert.equal((await f.upload()).body.error.code, 'photo-rate-limit');
  f.advance(HOUR + 1);
  assert.equal((await f.upload()).code, 200);
  assert.equal(f.files.size, 1);
});

test('expired orphans are removed, while canonical and public photos survive', async () => {
  const f = fixture();
  const a = (await f.upload()).body.path;
  const b = (await f.upload()).body.path;
  const orphan = (await f.upload()).body.path;
  await f.db.collection('users').doc('owner').set({ photoPath: a });
  await f.db.collection('users_public').doc('owner').set({ photoPath: b });
  f.advance(HOUR + 1);
  assert.equal((await f.upload()).code, 200);
  assert.ok(f.files.has(a));
  assert.ok(f.files.has(b));
  assert.ok(!f.files.has(orphan));
});

test('deletion failure retains quota and a later request retries it', async () => {
  const f = fixture();
  for (let i = 0; i < MAX_OBJECTS; i++) await f.upload();
  f.advance(HOUR + 1);
  f.failDelete(true);
  assert.equal((await f.upload()).code, 500);
  assert.equal(f.files.size, MAX_OBJECTS);
  const ledger = (await f.db.collection('profile_photo_uploads').doc('owner').get()).data();
  assert.equal(Object.keys(ledger.slots).length, MAX_OBJECTS);
  assert.ok(Object.values(ledger.slots).every((slot) => slot.state === 'deleting'));
  f.failDelete(false);
  assert.equal((await f.upload()).code, 200);
  assert.equal(f.files.size, 1);
});

test('ambiguous save failures cannot release reservations and grow storage', async () => {
  const f = fixture();
  f.failSave(true);
  for (let i = 0; i < MAX_OBJECTS; i++) assert.equal((await f.upload()).code, 500);
  assert.equal((await f.upload()).body.error.code, 'photo-quota');
  assert.equal(f.files.size, MAX_OBJECTS);
  f.failSave(false);
  f.advance(HOUR + 1);
  assert.equal((await f.upload()).code, 200);
  assert.equal(f.files.size, 1);
});

test('a save racing cleanup forces its transaction to retry and keep the photo', async () => {
  const f = fixture();
  const path = (await f.upload()).body.path;
  f.advance(HOUR + 1);
  f.db.beforeCommit = () => f.db.collection('users').doc('owner').set({ photoPath: path });
  await reclaim({ db: f.db, bucket: f.bucket, uid: 'owner', now: f.now });
  assert.ok(f.files.has(path));
});

test('account deletion during storage write cannot leave a new public object', async () => {
  const f = fixture();
  const file = f.bucket.file.bind(f.bucket);
  f.bucket.file = (path) => {
    const stored = file(path);
    return { ...stored, async save(...args) {
      await stored.save(...args);
      await f.db.collection('users').doc('owner').delete();
      await f.db.collection('profile_photo_uploads').doc('owner').delete();
    } };
  };
  assert.equal((await f.upload()).code, 409);
  assert.equal(f.files.size, 0);
});

test('a late save with failed cleanup retains only an object whose account no longer exists', async () => {
  const f = fixture();
  const file = f.bucket.file.bind(f.bucket);
  f.bucket.file = (path) => {
    const stored = file(path);
    return { ...stored, async save(...args) {
      await f.db.collection('users').doc('owner').delete();
      f.files.clear();
      await f.db.collection('profile_photo_uploads').doc('owner').delete();
      await stored.save(...args);
    } };
  };
  f.failDelete(true);
  assert.equal((await f.upload()).code, 500);
  assert.equal(f.files.size, 1);
  assert.equal(f.saved[0].options.metadata.metadata.profilePhotoValidated, 'v1');
  assert.equal((await f.db.collection('users').doc('owner').get()).exists, false);
  assert.equal((await f.db.collection('profile_photo_uploads').doc('owner').get()).exists, false);
  // Storage rules require both the stamp and a live account for public reads.
});

test('four successful reservations leave less than eight MiB allocated', async () => {
  const f = fixture();
  for (let i = 0; i < MAX_OBJECTS; i++) assert.equal((await f.upload()).code, 200);
  assert.equal((await f.upload()).body.error.code, 'photo-quota');
  assert.equal(f.files.size, MAX_OBJECTS);
  assert.ok([...f.files.values()].reduce((sum, bytes) => sum + bytes.length, 0) < MAX_OBJECTS * MAX_BYTES);
});
