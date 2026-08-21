'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { verifyAuthToken, requireAdmin, requireAppCheck, internals } = require('./auth.cjs');

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

// --- App Check (issue #45) ---------------------------------------------------

/** Fake admin App Check: resolves listed tokens, rejects everything else. */
function fakeAppCheck(validTokens) {
  return {
    async verifyToken(t) {
      if (validTokens.includes(t)) return { appId: 'app-1' };
      throw new Error('app-check/invalid-argument');
    },
  };
}

const reqWithAppCheck = (value) =>
  (value === undefined ? { headers: {} } : { headers: { 'x-firebase-appcheck': value } });

test('requireAppCheck: unenforced deployments pass everything through untouched', async () => {
  for (const req of [reqWithAppCheck(undefined), reqWithAppCheck('garbage')]) {
    const verdict = await requireAppCheck({ appCheck: null, enforced: false }, req);
    assert.deepEqual(verdict, { ok: true, enforced: false });
  }
});

test('requireAppCheck: a valid token passes, from either request shape', async () => {
  const appCheck = fakeAppCheck(['good']);
  assert.deepEqual(
    await requireAppCheck({ appCheck, enforced: true }, reqWithAppCheck('good')),
    { ok: true, enforced: true },
  );
  // Express-style req.get, with the canonical header casing.
  assert.deepEqual(
    await requireAppCheck(
      { appCheck, enforced: true },
      { get: (name) => (name === 'X-Firebase-AppCheck' ? 'good' : undefined) },
    ),
    { ok: true, enforced: true },
  );
});

test('requireAppCheck: missing, blank, and invalid tokens are all refused', async () => {
  const appCheck = fakeAppCheck(['good']);
  for (const value of [undefined, '', '   ', 'bad']) {
    const verdict = await requireAppCheck({ appCheck, enforced: true }, reqWithAppCheck(value));
    assert.equal(verdict.ok, false);
  }
});

test('requireAppCheck: fails CLOSED when the App Check service is unavailable', async () => {
  // An enforcement flag that stops enforcing because the SDK would not load
  // is worse than no flag at all.
  for (const appCheck of [null, undefined, {}]) {
    const verdict = await requireAppCheck({ appCheck, enforced: true }, reqWithAppCheck('good'));
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, 'app-check-unavailable');
  }
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
