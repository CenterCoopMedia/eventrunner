'use strict';

// The attendee feed's report and removal handlers (issue #506) against the
// in-memory fake, for the cases that need a transaction retried on purpose:
// the fake's beforeCommit hook writes between a transaction's reads and its
// commit, and its read set makes that write abort and re-run the body, as
// Firestore does. The emulator suite (tests/social-feed.rules.test.js)
// covers the access matrix and commit orders against real transactions.
// Expected values come from the #506 contract, not from the handler.

const test = require('node:test');
const assert = require('node:assert/strict');

const { makeFakeDb } = require('../cms/firestoreFake.cjs');
const {
  createReportSocialPostHandler,
  createRemoveSocialPostHandler,
  internals: { reportIdFor, MAX_BODY_BYTES },
} = require('./feed.cjs');

const OPERATOR = 'ops@example.org';
const STAFF = 'desk@example.org';
const T0 = Date.parse('2026-11-10T15:00:00.000Z');
const ENDS = T0 + 60_000;
const QUIET = { error() {}, warn() {}, info() {} };

const TOKENS = {
  ada: { uid: 'uid-ada', email: 'ada@example.org', email_verified: true },
  staff: { uid: 'uid-staff', email: STAFF, email_verified: true },
  operator: { uid: 'uid-ops', email: OPERATOR, email_verified: true },
};
const auth = {
  async verifyIdToken(token) {
    if (!TOKENS[token]) throw new Error('invalid token');
    return TOKENS[token];
  },
};

const ACTIVE_POST = {
  state: 'active', authorUid: 'uid-bo', text: 'Lunch is at noon.', createdAt: new Date(T0), parentPostId: null,
};

function seeded(extra = {}) {
  return makeFakeDb({
    'config/features': { socialFeed: true, attendeeDirectory: true },
    'config/bootstrap': { adminEmails: [OPERATOR], staffEmails: [STAFF] },
    'users/uid-ada': { uid: 'uid-ada', registrationStatus: 'approved', speakerId: null },
    'social_posts/p1': ACTIVE_POST,
    ...extra,
  });
}

function makeRes() {
  const res = {
    statusCode: null, body: null, headers: {},
    set(n, v) { res.headers[n] = v; return res; },
    status(c) { res.statusCode = c; return res; },
    json(p) { res.body = p; return res; },
  };
  return res;
}

async function call(create, deps, token, body, method = 'POST') {
  const res = makeRes();
  await create({ auth, log: QUIET, ...deps })(
    { method, headers: token ? { authorization: `Bearer ${token}` } : {}, body },
    res,
  );
  return res;
}

const report = (deps, token, body = { postId: 'p1' }) => call(createReportSocialPostHandler, deps, token, body);
const removal = (deps, token, body = { postId: 'p1' }) => call(createRemoveSocialPostHandler, deps, token, body);
const logs = (db) => db.ids('admin_logs').map((id) => db.read('admin_logs', id));

/** A clock that answers each value in turn, then the last one. */
function clockOf(...values) {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}

/** A no-op rewrite of config/bootstrap: enough to abort a transaction that read it. */
async function touchBootstrap(db, data) {
  await db.collection('config').doc('bootstrap').set(data ?? db.read('config', 'bootstrap'));
}

test('a temporary staff grant that ends during a report retry stores nothing', async () => {
  // The staff member has no account, so the bootstrap grant is the only one.
  const db = seeded({ 'config/bootstrap': { adminEmails: [OPERATOR], staffEmails: [STAFF], staffExpiry: { [STAFF]: new Date(ENDS) } } });
  // First attempt: before the end. The write below aborts it. Retry: after the end.
  db.beforeCommit = () => touchBootstrap(db);
  const res = await report({ db, now: clockOf(ENDS - 1, ENDS + 1) }, 'staff');
  assert.equal(res.statusCode, 403);
  assert.deepEqual(db.ids('social_reports'), []);
});

test('a bootstrap revocation that commits during a report attempt refuses the retry', async () => {
  const db = seeded();
  db.beforeCommit = () => touchBootstrap(db, { adminEmails: [OPERATOR], staffEmails: [] });
  const res = await report({ db, now: () => T0 }, 'staff');
  assert.equal(res.statusCode, 403);
  assert.deepEqual(db.ids('social_reports'), []);
});

test('a revocation during a report still admits a caller with an independent account grant', async () => {
  const db = seeded({ 'users/uid-staff': { uid: 'uid-staff', registrationStatus: 'approved', speakerId: null } });
  db.beforeCommit = () => touchBootstrap(db, { adminEmails: [OPERATOR], staffEmails: [] });
  const res = await report({ db, now: () => T0 }, 'staff');
  assert.equal(res.statusCode, 201);
  assert.deepEqual(db.ids('social_reports'), [reportIdFor('p1', 'uid-staff')]);
});

test('an account delete that commits during a report attempt refuses the retry', async () => {
  const db = seeded();
  db.beforeCommit = () => db.collection('users').doc('uid-ada').delete();
  const res = await report({ db, now: () => T0 }, 'ada');
  assert.equal(res.statusCode, 403);
  assert.deepEqual(db.ids('social_reports'), []);
});

test('a flag turned off during a report attempt refuses the retry', async () => {
  const db = seeded();
  db.beforeCommit = () => db.collection('config').doc('features').set({ socialFeed: false, attendeeDirectory: true });
  const res = await report({ db, now: () => T0 }, 'ada');
  assert.equal(res.statusCode, 404);
  assert.deepEqual(db.ids('social_reports'), []);
});

test('a removal that commits during a report attempt refuses the retry', async () => {
  const db = seeded();
  db.beforeCommit = () => db.collection('social_posts').doc('p1').set({
    state: 'removed', parentPostId: null, createdAt: new Date(T0), removedAt: new Date(T0),
  });
  const res = await report({ db, now: () => T0 }, 'ada');
  assert.equal(res.statusCode, 404);
  assert.deepEqual(db.ids('social_reports'), []);
});

test('a temporary staff grant that ends during a removal retry removes nothing', async () => {
  const db = seeded({ 'config/bootstrap': { adminEmails: [OPERATOR], staffEmails: [STAFF], staffExpiry: { [STAFF]: new Date(ENDS) } } });
  // requireAdmin reads the clock once before the transaction, then each attempt reads it.
  db.beforeCommit = () => touchBootstrap(db);
  const res = await removal({ db, now: clockOf(ENDS - 2, ENDS - 1, ENDS + 1) }, 'staff');
  assert.equal(res.statusCode, 403);
  assert.deepEqual(db.read('social_posts', 'p1'), ACTIVE_POST);
  assert.deepEqual(logs(db), []);
});

test('a bootstrap revocation that commits during a removal attempt removes nothing', async () => {
  const db = seeded();
  db.beforeCommit = () => touchBootstrap(db, { adminEmails: [OPERATOR], staffEmails: [] });
  const res = await removal({ db, now: () => T0 }, 'staff');
  assert.equal(res.statusCode, 403);
  assert.deepEqual(db.read('social_posts', 'p1'), ACTIVE_POST);
  assert.deepEqual(logs(db), []);
});

test('an audit write that fails leaves the active post unchanged and writes no audit row', async () => {
  const db = seeded();
  const collection = db.collection.bind(db);
  const failing = {
    collection(name) {
      if (name !== 'admin_logs') return collection(name);
      return { doc() { throw new Error('admin_logs unavailable'); } };
    },
    runTransaction: (...args) => db.runTransaction(...args),
  };
  const res = await removal({ db: failing, now: () => T0 }, 'staff');
  assert.equal(res.statusCode, 500);
  assert.deepEqual(db.read('social_posts', 'p1'), ACTIVE_POST);
  assert.deepEqual(logs(db), []);
});

test('two removals racing write one tombstone and one audit row', async () => {
  const db = seeded();
  const [a, b] = await Promise.all([removal({ db, now: () => T0 }, 'staff'), removal({ db, now: () => T0 }, 'operator')]);
  assert.deepEqual([a.statusCode, b.statusCode], [200, 200]);
  assert.deepEqual([a.body.alreadyRemoved, b.body.alreadyRemoved].sort(), [false, true]);
  assert.equal(logs(db).length, 1);
});

test('the report and removal requests refuse a wrong method, an oversized body and a bad post id', async () => {
  const db = seeded();
  assert.equal((await call(createReportSocialPostHandler, { db }, 'ada', {}, 'GET')).statusCode, 405);
  assert.equal((await call(createRemoveSocialPostHandler, { db }, 'staff', {}, 'GET')).statusCode, 405);
  const big = { postId: 'p1', pad: 'x'.repeat(MAX_BODY_BYTES) };
  assert.equal((await report({ db }, 'ada', big)).statusCode, 413);
  for (const body of [{}, { postId: '' }, { postId: 'a/b' }, { postId: 7 }, null, ['p1']]) {
    assert.equal((await report({ db }, 'ada', body)).statusCode, 400, JSON.stringify(body));
    assert.equal((await removal({ db }, 'staff', body)).statusCode, 400, JSON.stringify(body));
  }
  assert.deepEqual(db.ids('social_reports'), []);
  assert.deepEqual(logs(db), []);
});
