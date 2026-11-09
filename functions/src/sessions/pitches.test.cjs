'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createSubmitSessionPitchHandler } = require('./pitches.cjs');

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    set(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

function handlerWith(auth) {
  // The sign-in check runs before any read, so these tests need no store.
  return createSubmitSessionPitchHandler({ db: {}, auth, getConfig: async () => ({}), sendEmail: async () => ({}) });
}

test('a pitch with no bearer token is refused before any token check', async () => {
  const calls = [];
  const res = fakeRes();
  await handlerWith({ verifyIdToken: async (...args) => { calls.push(args); } })(
    { method: 'POST', headers: {}, body: {} },
    res,
  );
  assert.equal(res.statusCode, 401);
  assert.deepEqual(calls, []);
});

test('pitch intake checks revocation and refuses a token that fails it', async () => {
  const calls = [];
  const res = fakeRes();
  const auth = {
    verifyIdToken: async (...args) => {
      calls.push(args);
      throw new Error('auth/id-token-revoked');
    },
  };
  await handlerWith(auth)({ method: 'POST', headers: { authorization: 'Bearer t-1' }, body: {} }, res);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(calls, [['t-1', true]]);
});

test('a verified sign-in without a verified email is refused', async () => {
  const res = fakeRes();
  const auth = { verifyIdToken: async () => ({ uid: 'u1', email: 'a@example.org', email_verified: false }) };
  await handlerWith(auth)({ method: 'POST', headers: { authorization: 'Bearer t-1' }, body: {} }, res);
  assert.equal(res.statusCode, 403);
});
