'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createBookmarkSessionHandler,
  internals: { toggleSessionBookmark, SessionNotFoundError },
} = require('./bookmarks.cjs');

// ---------------------------------------------------------------- fixtures

/**
 * Minimal in-memory Firestore fake: doc get/set/delete plus a transaction
 * that is atomic-enough for this module's needs (sequential apply, no
 * contention model — the config.test.cjs fake covers the optimistic-retry
 * case elsewhere). No emulator (house rule).
 */
function fakeDb(seed = {}) {
  const docs = new Map(Object.entries(seed).map(([k, v]) => [k, v]));
  function docRef(col, id) {
    const key = `${col}/${id}`;
    return {
      _key: key,
      async get() {
        const data = docs.get(key);
        return { exists: data !== undefined, data: () => data };
      },
      async set(data) {
        docs.set(key, data);
      },
      async delete() {
        docs.delete(key);
      },
    };
  }
  return {
    docs,
    collection(name) {
      return { doc: (id) => docRef(name, id) };
    },
    async runTransaction(fn) {
      const tx = {
        async get(ref) {
          return ref.get();
        },
        set(ref, data) {
          docs.set(ref._key, data);
        },
        delete(ref) {
          docs.delete(ref._key);
        },
      };
      return fn(tx);
    },
  };
}

function seedSession(id, overrides = {}) {
  return { [`cmsSchedule/${id}`]: { title: 'Fixture session', visible: true, ...overrides } };
}

const NOW = Date.UTC(2026, 9, 15, 12, 0, 0);
const now = () => NOW;

// ------------------------------------------------------- toggleSessionBookmark

test('toggleSessionBookmark: bookmarking a session creates the membership and starts the count at 1', async () => {
  const db = fakeDb(seedSession('s1'));
  const result = await toggleSessionBookmark({ db, uid: 'u1', sessionId: 's1', bookmarked: true, now });
  assert.deepEqual(result, { bookmarked: true, count: 1 });
  assert.deepEqual(db.docs.get('users/u1/bookmarks/s1'), { bookmarkedAt: new Date(NOW) });
  assert.deepEqual(db.docs.get('sessionBookmarks/s1'), { count: 1, updatedAt: new Date(NOW) });
});

test('toggleSessionBookmark: a second attendee bookmarking the same session increments the aggregate', async () => {
  const db = fakeDb(seedSession('s1'));
  await toggleSessionBookmark({ db, uid: 'u1', sessionId: 's1', bookmarked: true, now });
  const result = await toggleSessionBookmark({ db, uid: 'u2', sessionId: 's1', bookmarked: true, now });
  assert.deepEqual(result, { bookmarked: true, count: 2 });
  assert.ok(db.docs.has('users/u1/bookmarks/s1'));
  assert.ok(db.docs.has('users/u2/bookmarks/s1'));
});

test('toggleSessionBookmark: un-bookmarking removes the membership and decrements the aggregate', async () => {
  const db = fakeDb(seedSession('s1'));
  await toggleSessionBookmark({ db, uid: 'u1', sessionId: 's1', bookmarked: true, now });
  const result = await toggleSessionBookmark({ db, uid: 'u1', sessionId: 's1', bookmarked: false, now });
  assert.deepEqual(result, { bookmarked: false, count: 0 });
  assert.equal(db.docs.has('users/u1/bookmarks/s1'), false);
});

test('toggleSessionBookmark: the aggregate never goes negative even under drift', async () => {
  // Simulates a corrupted/pre-existing aggregate with a lower count than
  // the memberships actually on file — defensive floor, not a real path.
  const db = fakeDb({ ...seedSession('s1'), 'sessionBookmarks/s1': { count: 0 } });
  const result = await toggleSessionBookmark({ db, uid: 'u1', sessionId: 's1', bookmarked: false, now });
  assert.equal(result.count, 0);
});

test('toggleSessionBookmark: requesting the already-current state is a no-op (idempotent retry)', async () => {
  const db = fakeDb(seedSession('s1'));
  await toggleSessionBookmark({ db, uid: 'u1', sessionId: 's1', bookmarked: true, now });
  const writesBefore = db.docs.size;
  const result = await toggleSessionBookmark({ db, uid: 'u1', sessionId: 's1', bookmarked: true, now });
  assert.deepEqual(result, { bookmarked: true, count: 1 });
  assert.equal(db.docs.size, writesBefore);

  const unbookmarked = await toggleSessionBookmark({ db, uid: 'u2', sessionId: 's1', bookmarked: false, now });
  assert.deepEqual(unbookmarked, { bookmarked: false, count: 1 });
});

test('toggleSessionBookmark: an unknown session throws SessionNotFoundError', async () => {
  const db = fakeDb();
  await assert.rejects(
    () => toggleSessionBookmark({ db, uid: 'u1', sessionId: 'ghost', bookmarked: true, now }),
    SessionNotFoundError,
  );
});

test('toggleSessionBookmark: a hidden (visible:false) session is treated as not found', async () => {
  const db = fakeDb(seedSession('s1', { visible: false }));
  await assert.rejects(
    () => toggleSessionBookmark({ db, uid: 'u1', sessionId: 's1', bookmarked: true, now }),
    SessionNotFoundError,
  );
});

// ------------------------------------------------------- createBookmarkSessionHandler

/** Minimal Express-response fake capturing status/json/headers. */
function fakeRes() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
  };
}

function fakeAuth(tokens) {
  return {
    async verifyIdToken(t) {
      if (t in tokens) return tokens[t];
      throw new Error('auth/argument-error');
    },
  };
}

const ATTENDEE_TOKEN = { uid: 'u1', email: 'attendee@example.org', email_verified: true };

function fakeGetConfig(overrides = {}) {
  return async () => ({ features: { sessionBookmarks: true, ...overrides } });
}

test('handler: rejects non-POST', async () => {
  const db = fakeDb(seedSession('s1'));
  const handler = createBookmarkSessionHandler({
    db,
    auth: fakeAuth({}),
    getConfig: fakeGetConfig(),
    now,
  });
  const res = fakeRes();
  await handler({ method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 405);
});

test('handler: 404s when config/features.sessionBookmarks is off (defense in depth)', async () => {
  const db = fakeDb(seedSession('s1'));
  const handler = createBookmarkSessionHandler({
    db,
    auth: fakeAuth({ good: ATTENDEE_TOKEN }),
    getConfig: fakeGetConfig({ sessionBookmarks: false }),
    now,
  });
  const res = fakeRes();
  await handler(
    { method: 'POST', headers: { authorization: 'Bearer good' }, body: { sessionId: 's1', bookmarked: true } },
    res,
  );
  assert.equal(res.statusCode, 404);
});

test('handler: 401 with no auth token', async () => {
  const db = fakeDb(seedSession('s1'));
  const handler = createBookmarkSessionHandler({ db, auth: fakeAuth({}), getConfig: fakeGetConfig(), now });
  const res = fakeRes();
  await handler({ method: 'POST', headers: {}, body: { sessionId: 's1', bookmarked: true } }, res);
  assert.equal(res.statusCode, 401);
});

test('handler: 403 when the caller is not an approved attendee', async () => {
  const db = fakeDb(seedSession('s1'));
  const handler = createBookmarkSessionHandler({
    db,
    auth: fakeAuth({ good: ATTENDEE_TOKEN }),
    getConfig: fakeGetConfig(),
    now,
  });
  const res = fakeRes();
  await handler(
    { method: 'POST', headers: { authorization: 'Bearer good' }, body: { sessionId: 's1', bookmarked: true } },
    res,
  );
  assert.equal(res.statusCode, 403);
});

test('handler: 400 on a malformed body', async () => {
  const db = fakeDb({ ...seedSession('s1'), 'users/u1': { registrationStatus: 'approved' } });
  const handler = createBookmarkSessionHandler({
    db,
    auth: fakeAuth({ good: ATTENDEE_TOKEN }),
    getConfig: fakeGetConfig(),
    now,
  });
  for (const body of [{}, { sessionId: 's1' }, { sessionId: '', bookmarked: true }, { sessionId: 's1', bookmarked: 'yes' }]) {
    const res = fakeRes();
    await handler({ method: 'POST', headers: { authorization: 'Bearer good' }, body }, res);
    assert.equal(res.statusCode, 400);
  }
});

test('handler: 404 for an unknown session', async () => {
  const db = fakeDb({ 'users/u1': { registrationStatus: 'approved' } });
  const handler = createBookmarkSessionHandler({
    db,
    auth: fakeAuth({ good: ATTENDEE_TOKEN }),
    getConfig: fakeGetConfig(),
    now,
  });
  const res = fakeRes();
  await handler(
    { method: 'POST', headers: { authorization: 'Bearer good' }, body: { sessionId: 'ghost', bookmarked: true } },
    res,
  );
  assert.equal(res.statusCode, 404);
});

test('handler: approved attendee bookmarks a session end-to-end → 200', async () => {
  const db = fakeDb({ ...seedSession('s1'), 'users/u1': { registrationStatus: 'approved' } });
  const handler = createBookmarkSessionHandler({
    db,
    auth: fakeAuth({ good: ATTENDEE_TOKEN }),
    getConfig: fakeGetConfig(),
    now,
  });
  const res = fakeRes();
  await handler(
    { method: 'POST', headers: { authorization: 'Bearer good' }, body: { sessionId: 's1', bookmarked: true } },
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { bookmarked: true, count: 1 });
});

test('handler: a linked speaker (pending registration) may still bookmark', async () => {
  const db = fakeDb({
    ...seedSession('s1'),
    'users/u1': { registrationStatus: 'pending', speakerId: 'spk-1' },
  });
  const handler = createBookmarkSessionHandler({
    db,
    auth: fakeAuth({ good: ATTENDEE_TOKEN }),
    getConfig: fakeGetConfig(),
    now,
  });
  const res = fakeRes();
  await handler(
    { method: 'POST', headers: { authorization: 'Bearer good' }, body: { sessionId: 's1', bookmarked: true } },
    res,
  );
  assert.equal(res.statusCode, 200);
});
