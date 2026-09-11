'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { makeFakeDb } = require('../cms/firestoreFake.cjs');
const { createRemoveUserCustomBadgeHandler } = require('./customBadges.cjs');

const QUIET = { warn() {}, error() {}, info() {} };
const T0 = new Date('2026-08-20T10:00:00.000Z');
const ADMIN = 'admin@example.com';

function makeRes() {
  const res = {
    statusCode: null, body: null, headers: {},
    set(n, v) { res.headers[n] = v; return res; },
    status(c) { res.statusCode = c; return res; },
    json(p) { res.body = p; return res; },
  };
  return res;
}

const auth = {
  async verifyIdToken(token) {
    const table = {
      admin: { uid: 'admin-1', email: ADMIN, email_verified: true },
      ada: { uid: 'uid-ada', email: 'attendee@example.com', email_verified: true },
    };
    if (!table[token]) throw new Error('invalid token');
    return table[token];
  },
};

const getConfig = async () => ({ bootstrap: { adminEmails: [ADMIN] } });

const req = (token, body, method = 'POST') => ({
  method,
  headers: token ? { authorization: `Bearer ${token}` } : {},
  body,
});

function seeded(customBadges) {
  return makeFakeDb({
    'users/uid-ada': {
      uid: 'uid-ada',
      registrationStatus: 'approved',
      customBadges,
    },
  });
}

const remove = (db) =>
  createRemoveUserCustomBadgeHandler({ db, auth, getConfig, now: () => T0, log: QUIET });

function adminLogs(db) {
  return db.ids('admin_logs').map((id) => db.read('admin_logs', id));
}

test('removes one custom badge, matching case-insensitively, and reports what went', async () => {
  const db = seeded(['First Timers', 'Scholarship']);
  const res = makeRes();
  await remove(db)(req('admin', { uid: 'uid-ada', badge: 'first timers' }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.removed, 'First Timers');
  assert.deepEqual(res.body.customBadges, ['Scholarship']);
  assert.deepEqual(db.read('users', 'uid-ada').customBadges, ['Scholarship']);
});

test('records the removal in admin_logs with the actor on it', async () => {
  const db = seeded(['First Timers']);
  const res = makeRes();
  await remove(db)(req('admin', { uid: 'uid-ada', badge: 'First Timers' }), res);
  assert.equal(res.statusCode, 200);
  const logs = adminLogs(db);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].action, 'removeUserCustomBadge');
  assert.equal(logs[0].docPath, 'users/uid-ada');
  assert.equal(logs[0].uid, 'admin-1');
  assert.equal(logs[0].email, ADMIN);
});

test('an account with no such badge answers 404 and writes no log', async () => {
  const db = seeded(['First Timers']);
  const res = makeRes();
  await remove(db)(req('admin', { uid: 'uid-ada', badge: 'missing' }), res);
  assert.equal(res.statusCode, 404);
  assert.deepEqual(adminLogs(db), []);
  assert.deepEqual(db.read('users', 'uid-ada').customBadges, ['First Timers']);
});

test('refuses anyone who is not an admin, and never touches the account', async () => {
  const db = seeded(['First Timers']);
  const res = makeRes();
  await remove(db)(req('ada', { uid: 'uid-ada', badge: 'First Timers' }), res);
  assert.equal(res.statusCode, 403);
  assert.deepEqual(db.read('users', 'uid-ada').customBadges, ['First Timers']);
  assert.deepEqual(adminLogs(db), []);
});

test('is POST-only and requires both a uid and a badge', async () => {
  const db = seeded(['First Timers']);
  const wrongMethod = makeRes();
  await remove(db)(req('admin', { uid: 'uid-ada', badge: 'First Timers' }, 'GET'), wrongMethod);
  assert.equal(wrongMethod.statusCode, 405);

  const noUid = makeRes();
  await remove(db)(req('admin', { badge: 'First Timers' }), noUid);
  assert.equal(noUid.statusCode, 400);

  const noBadge = makeRes();
  await remove(db)(req('admin', { uid: 'uid-ada' }), noBadge);
  assert.equal(noBadge.statusCode, 400);
});

test('an account with no customBadges field at all answers 404, not a crash', async () => {
  const db = makeFakeDb({
    'users/uid-ada': { uid: 'uid-ada', registrationStatus: 'approved' },
  });
  const res = makeRes();
  await remove(db)(req('admin', { uid: 'uid-ada', badge: 'First Timers' }), res);
  assert.equal(res.statusCode, 404);
});
