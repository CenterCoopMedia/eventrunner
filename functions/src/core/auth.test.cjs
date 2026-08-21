'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { verifyAuthToken, requireAdmin, requireAttendeeAccess, internals } = require('./auth.cjs');

/** Minimal request fake: headers only, no Express methods. */
function reqWithAuth(value) {
  return value === undefined ? { headers: {} } : { headers: { authorization: value } };
}

/**
 * Fake Firebase Auth: resolves tokens present in the map, rejects (like the
 * Admin SDK on an expired/garbage token) for everything else.
 */
function fakeAuth(tokens) {
  return {
    async verifyIdToken(t) {
      if (t in tokens) return tokens[t];
      throw new Error('auth/argument-error');
    },
  };
}

function fakeGetConfig(adminEmails) {
  return async () => ({ bootstrap: adminEmails === null ? null : { adminEmails } });
}

const ADMIN_TOKEN = {
  uid: 'u1',
  email: 'Admin@Example.org',
  email_verified: true,
};

test('extractBearerToken parses the header, case-insensitive scheme', () => {
  const { extractBearerToken } = internals;
  assert.equal(extractBearerToken(reqWithAuth('Bearer abc.def')), 'abc.def');
  assert.equal(extractBearerToken(reqWithAuth('bearer xyz')), 'xyz');
  assert.equal(extractBearerToken(reqWithAuth('Basic dXNlcg==')), null);
  assert.equal(extractBearerToken(reqWithAuth('Bearer ')), null);
  assert.equal(extractBearerToken(reqWithAuth(undefined)), null);
  assert.equal(extractBearerToken({}), null);
});

test('extractBearerToken prefers Express req.get when present', () => {
  const req = { get: (name) => (name === 'Authorization' ? 'Bearer viaget' : undefined) };
  assert.equal(internals.extractBearerToken(req), 'viaget');
});

test('verifyAuthToken returns the decoded token for a valid Bearer header', async () => {
  const auth = fakeAuth({ good: ADMIN_TOKEN });
  const decoded = await verifyAuthToken({ auth }, reqWithAuth('Bearer good'));
  assert.equal(decoded.uid, 'u1');
});

test('verifyAuthToken returns null (never throws) on missing or bad tokens', async () => {
  const auth = fakeAuth({ good: ADMIN_TOKEN });
  assert.equal(await verifyAuthToken({ auth }, reqWithAuth(undefined)), null);
  assert.equal(await verifyAuthToken({ auth }, reqWithAuth('Bearer expired')), null);
  assert.equal(await verifyAuthToken({ auth }, reqWithAuth('good')), null);
});

test('requireAdmin: no token → 401', async () => {
  const verdict = await requireAdmin(
    { auth: fakeAuth({}), getConfig: fakeGetConfig(['admin@example.org']) },
    reqWithAuth(undefined),
  );
  assert.deepEqual(
    { ok: verdict.ok, status: verdict.status, code: verdict.code },
    { ok: false, status: 401, code: 'unauthorized' },
  );
});

test('requireAdmin: unverifiable token → 401', async () => {
  const verdict = await requireAdmin(
    { auth: fakeAuth({}), getConfig: fakeGetConfig(['admin@example.org']) },
    reqWithAuth('Bearer forged'),
  );
  assert.equal(verdict.status, 401);
});

test('requireAdmin: verified token, email on the list (case-insensitive) → ok', async () => {
  const verdict = await requireAdmin(
    { auth: fakeAuth({ good: ADMIN_TOKEN }), getConfig: fakeGetConfig(['  ADMIN@example.ORG ']) },
    reqWithAuth('Bearer good'),
  );
  assert.deepEqual(verdict, { ok: true, uid: 'u1', email: 'admin@example.org' });
});

test('requireAdmin: email_verified false → 403 even when listed', async () => {
  const token = { ...ADMIN_TOKEN, email_verified: false };
  const verdict = await requireAdmin(
    { auth: fakeAuth({ good: token }), getConfig: fakeGetConfig(['admin@example.org']) },
    reqWithAuth('Bearer good'),
  );
  assert.deepEqual(
    { ok: verdict.ok, status: verdict.status, code: verdict.code },
    { ok: false, status: 403, code: 'forbidden' },
  );
});

test('requireAdmin: token without an email → 403', async () => {
  const token = { uid: 'u2', email_verified: true };
  const verdict = await requireAdmin(
    { auth: fakeAuth({ good: token }), getConfig: fakeGetConfig(['admin@example.org']) },
    reqWithAuth('Bearer good'),
  );
  assert.equal(verdict.status, 403);
});

test('requireAdmin: verified email not on the list → 403', async () => {
  const verdict = await requireAdmin(
    { auth: fakeAuth({ good: ADMIN_TOKEN }), getConfig: fakeGetConfig(['other@example.org']) },
    reqWithAuth('Bearer good'),
  );
  assert.equal(verdict.status, 403);
});

test('requireAdmin: missing bootstrap doc or malformed adminEmails → 403, no throw', async () => {
  for (const getConfig of [
    fakeGetConfig(null), // config/bootstrap absent
    fakeGetConfig(undefined), // bootstrap present, adminEmails missing
    async () => ({ bootstrap: { adminEmails: 'admin@example.org' } }), // wrong type
    async () => ({ bootstrap: { adminEmails: [42, null] } }), // non-string entries
  ]) {
    const verdict = await requireAdmin(
      { auth: fakeAuth({ good: ADMIN_TOKEN }), getConfig },
      reqWithAuth('Bearer good'),
    );
    assert.equal(verdict.ok, false);
    assert.equal(verdict.status, 403);
  }
});

// -------------------------------------------------------- requireAttendeeAccess

/** Fake `users` collection reader: db.collection('users').doc(uid).get(). */
function fakeUsersDb(profiles) {
  return {
    collection(name) {
      assert.equal(name, 'users');
      return {
        doc(uid) {
          return {
            async get() {
              const data = profiles[uid];
              return { exists: data !== undefined, data: () => data };
            },
          };
        },
      };
    },
  };
}

const ATTENDEE_TOKEN = { uid: 'u9', email: 'attendee@example.org', email_verified: true };

test('requireAttendeeAccess: no token → 401', async () => {
  const verdict = await requireAttendeeAccess(
    { auth: fakeAuth({}), db: fakeUsersDb({}) },
    reqWithAuth(undefined),
  );
  assert.deepEqual(
    { ok: verdict.ok, status: verdict.status, code: verdict.code },
    { ok: false, status: 401, code: 'unauthorized' },
  );
});

test('requireAttendeeAccess: a missing users/{uid} doc fails closed (retried trigger, brand-new signup) → 403, no throw', async () => {
  const verdict = await requireAttendeeAccess(
    { auth: fakeAuth({ good: ATTENDEE_TOKEN }), db: fakeUsersDb({}) },
    reqWithAuth('Bearer good'),
  );
  assert.deepEqual(
    { ok: verdict.ok, status: verdict.status, code: verdict.code },
    { ok: false, status: 403, code: 'forbidden' },
  );
});

test('requireAttendeeAccess: registrationStatus pending → 403', async () => {
  const verdict = await requireAttendeeAccess(
    {
      auth: fakeAuth({ good: ATTENDEE_TOKEN }),
      db: fakeUsersDb({ u9: { registrationStatus: 'pending' } }),
    },
    reqWithAuth('Bearer good'),
  );
  assert.equal(verdict.ok, false);
  assert.equal(verdict.status, 403);
});

test('requireAttendeeAccess: registrationStatus approved → ok', async () => {
  const verdict = await requireAttendeeAccess(
    {
      auth: fakeAuth({ good: ATTENDEE_TOKEN }),
      db: fakeUsersDb({ u9: { registrationStatus: 'approved' } }),
    },
    reqWithAuth('Bearer good'),
  );
  assert.deepEqual(verdict, { ok: true, uid: 'u9', email: 'attendee@example.org' });
});

test('requireAttendeeAccess: a linked speaker profile grants access even when pending', async () => {
  const verdict = await requireAttendeeAccess(
    {
      auth: fakeAuth({ good: ATTENDEE_TOKEN }),
      db: fakeUsersDb({ u9: { registrationStatus: 'pending', speakerId: 'spk-1' } }),
    },
    reqWithAuth('Bearer good'),
  );
  assert.equal(verdict.ok, true);
});

test('requireAttendeeAccess: revoked attendee is denied', async () => {
  const verdict = await requireAttendeeAccess(
    {
      auth: fakeAuth({ good: ATTENDEE_TOKEN }),
      db: fakeUsersDb({ u9: { registrationStatus: 'revoked' } }),
    },
    reqWithAuth('Bearer good'),
  );
  assert.equal(verdict.ok, false);
  assert.equal(verdict.status, 403);
});
