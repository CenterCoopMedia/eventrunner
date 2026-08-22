'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createReactToSessionHandler,
  REACTION_KINDS,
  internals: { toggleSessionReaction, SessionNotFoundError, InvalidReactionError, emptyCounts },
} = require('./reactions.cjs');

// ---------------------------------------------------------------- fixtures

/**
 * Minimal in-memory Firestore fake: doc get/set/delete plus a transaction
 * that is atomic-enough for this module's needs (sequential apply, no
 * contention model). No emulator (house rule). Mirrors bookmarks.test.cjs's
 * fake, extended with nested-collection support for
 * sessionReactions/{sessionId}/users/{uid}.
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

const THUMBS_UP = REACTION_KINDS[0];
const HEART = REACTION_KINDS[1];

function countsWith(overrides) {
  return { ...emptyCounts(), ...overrides };
}

// ------------------------------------------------------- toggleSessionReaction

test('toggleSessionReaction: reacting creates the membership and starts that emoji at 1', async () => {
  const db = fakeDb(seedSession('s1'));
  const result = await toggleSessionReaction({ db, uid: 'u1', sessionId: 's1', emoji: THUMBS_UP, now });
  assert.deepEqual(result, { emoji: THUMBS_UP, counts: countsWith({ [THUMBS_UP]: 1 }) });
  assert.deepEqual(db.docs.get('sessionReactions/s1/users/u1'), { emoji: THUMBS_UP, reactedAt: new Date(NOW) });
  assert.deepEqual(db.docs.get('sessionReactions/s1'), {
    counts: countsWith({ [THUMBS_UP]: 1 }),
    updatedAt: new Date(NOW),
  });
});

test('toggleSessionReaction: a second attendee reacting with the same emoji increments that count only', async () => {
  const db = fakeDb(seedSession('s1'));
  await toggleSessionReaction({ db, uid: 'u1', sessionId: 's1', emoji: THUMBS_UP, now });
  const result = await toggleSessionReaction({ db, uid: 'u2', sessionId: 's1', emoji: THUMBS_UP, now });
  assert.deepEqual(result.counts, countsWith({ [THUMBS_UP]: 2 }));
  assert.ok(db.docs.has('sessionReactions/s1/users/u1'));
  assert.ok(db.docs.has('sessionReactions/s1/users/u2'));
});

test('toggleSessionReaction: clearing (emoji: null) removes the membership and decrements the aggregate', async () => {
  const db = fakeDb(seedSession('s1'));
  await toggleSessionReaction({ db, uid: 'u1', sessionId: 's1', emoji: THUMBS_UP, now });
  const result = await toggleSessionReaction({ db, uid: 'u1', sessionId: 's1', emoji: null, now });
  assert.deepEqual(result, { emoji: null, counts: countsWith() });
  assert.equal(db.docs.has('sessionReactions/s1/users/u1'), false);
});

test('toggleSessionReaction: switching emoji decrements the old count and increments the new one atomically', async () => {
  const db = fakeDb(seedSession('s1'));
  await toggleSessionReaction({ db, uid: 'u1', sessionId: 's1', emoji: THUMBS_UP, now });
  const result = await toggleSessionReaction({ db, uid: 'u1', sessionId: 's1', emoji: HEART, now });
  assert.deepEqual(result, { emoji: HEART, counts: countsWith({ [HEART]: 1 }) });
  assert.deepEqual(db.docs.get('sessionReactions/s1/users/u1'), { emoji: HEART, reactedAt: new Date(NOW) });
});

test('toggleSessionReaction: per-user dedup — one membership doc per user regardless of how many times they react', async () => {
  const db = fakeDb(seedSession('s1'));
  await toggleSessionReaction({ db, uid: 'u1', sessionId: 's1', emoji: THUMBS_UP, now });
  await toggleSessionReaction({ db, uid: 'u1', sessionId: 's1', emoji: HEART, now });
  await toggleSessionReaction({ db, uid: 'u1', sessionId: 's1', emoji: THUMBS_UP, now });
  const membershipKeys = [...db.docs.keys()].filter((k) => k.startsWith('sessionReactions/s1/users/'));
  assert.deepEqual(membershipKeys, ['sessionReactions/s1/users/u1']);
});

test('toggleSessionReaction: the aggregate never goes negative even under drift', async () => {
  const db = fakeDb({ ...seedSession('s1'), 'sessionReactions/s1': { counts: emptyCounts() } });
  const result = await toggleSessionReaction({ db, uid: 'u1', sessionId: 's1', emoji: null, now });
  assert.deepEqual(result.counts, countsWith());
});

test('toggleSessionReaction: requesting the already-current reaction is a no-op (idempotent retry)', async () => {
  const db = fakeDb(seedSession('s1'));
  await toggleSessionReaction({ db, uid: 'u1', sessionId: 's1', emoji: THUMBS_UP, now });
  const writesBefore = db.docs.size;
  const result = await toggleSessionReaction({ db, uid: 'u1', sessionId: 's1', emoji: THUMBS_UP, now });
  assert.deepEqual(result, { emoji: THUMBS_UP, counts: countsWith({ [THUMBS_UP]: 1 }) });
  assert.equal(db.docs.size, writesBefore);

  const cleared = await toggleSessionReaction({ db, uid: 'u2', sessionId: 's1', emoji: null, now });
  assert.deepEqual(cleared, { emoji: null, counts: countsWith({ [THUMBS_UP]: 1 }) });
});

test('toggleSessionReaction: an unknown session throws SessionNotFoundError', async () => {
  const db = fakeDb();
  await assert.rejects(
    () => toggleSessionReaction({ db, uid: 'u1', sessionId: 'ghost', emoji: THUMBS_UP, now }),
    SessionNotFoundError,
  );
});

test('toggleSessionReaction: a hidden (visible:false) session is treated as not found', async () => {
  const db = fakeDb(seedSession('s1', { visible: false }));
  await assert.rejects(
    () => toggleSessionReaction({ db, uid: 'u1', sessionId: 's1', emoji: THUMBS_UP, now }),
    SessionNotFoundError,
  );
});

test('toggleSessionReaction: an emoji outside REACTION_KINDS throws InvalidReactionError', async () => {
  const db = fakeDb(seedSession('s1'));
  await assert.rejects(
    () => toggleSessionReaction({ db, uid: 'u1', sessionId: 's1', emoji: '🍕', now }),
    InvalidReactionError,
  );
});

// ------------------------------------------------------- createReactToSessionHandler

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

function fakeGetConfig(featureOverrides = {}, bootstrap = null) {
  return async () => ({ features: { sessionReactions: true, ...featureOverrides }, bootstrap });
}

test('handler: rejects non-POST', async () => {
  const db = fakeDb(seedSession('s1'));
  const handler = createReactToSessionHandler({
    db,
    auth: fakeAuth({}),
    getConfig: fakeGetConfig(),
    now,
  });
  const res = fakeRes();
  await handler({ method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 405);
});

test('handler: 404s when config/features.sessionReactions is off (defense in depth)', async () => {
  const db = fakeDb(seedSession('s1'));
  const handler = createReactToSessionHandler({
    db,
    auth: fakeAuth({ good: ATTENDEE_TOKEN }),
    getConfig: fakeGetConfig({ sessionReactions: false }),
    now,
  });
  const res = fakeRes();
  await handler(
    { method: 'POST', headers: { authorization: 'Bearer good' }, body: { sessionId: 's1', emoji: THUMBS_UP } },
    res,
  );
  assert.equal(res.statusCode, 404);
});

test('handler: 401 with no auth token', async () => {
  const db = fakeDb(seedSession('s1'));
  const handler = createReactToSessionHandler({ db, auth: fakeAuth({}), getConfig: fakeGetConfig(), now });
  const res = fakeRes();
  await handler({ method: 'POST', headers: {}, body: { sessionId: 's1', emoji: THUMBS_UP } }, res);
  assert.equal(res.statusCode, 401);
});

test('handler: 403 when the caller is not an approved attendee', async () => {
  const db = fakeDb(seedSession('s1'));
  const handler = createReactToSessionHandler({
    db,
    auth: fakeAuth({ good: ATTENDEE_TOKEN }),
    getConfig: fakeGetConfig(),
    now,
  });
  const res = fakeRes();
  await handler(
    { method: 'POST', headers: { authorization: 'Bearer good' }, body: { sessionId: 's1', emoji: THUMBS_UP } },
    res,
  );
  assert.equal(res.statusCode, 403);
});

test('handler: 400 on a malformed body', async () => {
  const db = fakeDb({ ...seedSession('s1'), 'users/u1': { registrationStatus: 'approved' } });
  const handler = createReactToSessionHandler({
    db,
    auth: fakeAuth({ good: ATTENDEE_TOKEN }),
    getConfig: fakeGetConfig(),
    now,
  });
  for (const body of [
    {},
    { sessionId: 's1' },
    { sessionId: '', emoji: THUMBS_UP },
    { sessionId: 's1', emoji: 'yes' },
    { sessionId: 's1', emoji: '🍕' },
    { sessionId: 's1', emoji: 1 },
  ]) {
    const res = fakeRes();
    await handler({ method: 'POST', headers: { authorization: 'Bearer good' }, body }, res);
    assert.equal(res.statusCode, 400, `expected 400 for body ${JSON.stringify(body)}`);
  }
});

test('handler: 404 for an unknown session', async () => {
  const db = fakeDb({ 'users/u1': { registrationStatus: 'approved' } });
  const handler = createReactToSessionHandler({
    db,
    auth: fakeAuth({ good: ATTENDEE_TOKEN }),
    getConfig: fakeGetConfig(),
    now,
  });
  const res = fakeRes();
  await handler(
    { method: 'POST', headers: { authorization: 'Bearer good' }, body: { sessionId: 'ghost', emoji: THUMBS_UP } },
    res,
  );
  assert.equal(res.statusCode, 404);
});

test('handler: approved attendee reacts to a session end-to-end -> 200', async () => {
  const db = fakeDb({ ...seedSession('s1'), 'users/u1': { registrationStatus: 'approved' } });
  const handler = createReactToSessionHandler({
    db,
    auth: fakeAuth({ good: ATTENDEE_TOKEN }),
    getConfig: fakeGetConfig(),
    now,
  });
  const res = fakeRes();
  await handler(
    { method: 'POST', headers: { authorization: 'Bearer good' }, body: { sessionId: 's1', emoji: THUMBS_UP } },
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { emoji: THUMBS_UP, counts: countsWith({ [THUMBS_UP]: 1 }) });
});

test('handler: an approved attendee can clear their reaction end-to-end -> 200', async () => {
  const db = fakeDb({ ...seedSession('s1'), 'users/u1': { registrationStatus: 'approved' } });
  const handler = createReactToSessionHandler({
    db,
    auth: fakeAuth({ good: ATTENDEE_TOKEN }),
    getConfig: fakeGetConfig(),
    now,
  });
  const res1 = fakeRes();
  await handler(
    { method: 'POST', headers: { authorization: 'Bearer good' }, body: { sessionId: 's1', emoji: THUMBS_UP } },
    res1,
  );
  const res2 = fakeRes();
  await handler(
    { method: 'POST', headers: { authorization: 'Bearer good' }, body: { sessionId: 's1', emoji: null } },
    res2,
  );
  assert.equal(res2.statusCode, 200);
  assert.deepEqual(res2.body, { emoji: null, counts: countsWith() });
});

test('handler: a linked speaker (pending registration) may still react', async () => {
  const db = fakeDb({
    ...seedSession('s1'),
    'users/u1': { registrationStatus: 'pending', speakerId: 'spk-1' },
  });
  const handler = createReactToSessionHandler({
    db,
    auth: fakeAuth({ good: ATTENDEE_TOKEN }),
    getConfig: fakeGetConfig(),
    now,
  });
  const res = fakeRes();
  await handler(
    { method: 'POST', headers: { authorization: 'Bearer good' }, body: { sessionId: 's1', emoji: THUMBS_UP } },
    res,
  );
  assert.equal(res.statusCode, 200);
});

// A bootstrap admin's users/{uid}.role is 'attendee' by default (the auth
// trigger has no way to know an email is on config/bootstrap.adminEmails,
// functions/src/core/auth.cjs module doc) — the UI already enables the
// reaction pill for such a caller, so the handler must accept the click,
// not 403 it. Mirrors bookmarks.test.cjs's equivalent case.
test('handler: a bootstrap admin with a pending, non-speaker profile can still react', async () => {
  const db = fakeDb({
    ...seedSession('s1'),
    'users/u1': { registrationStatus: 'pending', speakerId: null, role: 'attendee' },
  });
  const handler = createReactToSessionHandler({
    db,
    auth: fakeAuth({ good: ATTENDEE_TOKEN }),
    getConfig: fakeGetConfig({}, { adminEmails: ['attendee@example.org'] }),
    now,
  });
  const res = fakeRes();
  await handler(
    { method: 'POST', headers: { authorization: 'Bearer good' }, body: { sessionId: 's1', emoji: THUMBS_UP } },
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { emoji: THUMBS_UP, counts: countsWith({ [THUMBS_UP]: 1 }) });
});
