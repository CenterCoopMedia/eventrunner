'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { makeFakeAuth, makeReq, makeRes } = require('./fakes.cjs');
const { ConsoleError, applyCors, parseAllowedOrigins, postEndpoint, requireVerifiedUser } = require('./http.cjs');

const QUIET = { error() {}, warn() {}, info() {} };
const auth = makeFakeAuth({
  good: { uid: 'u1', email: 'Ana@Example.org', email_verified: true },
  unverified: { uid: 'u2', email: 'ben@example.org', email_verified: false },
  noemail: { uid: 'u3', email_verified: true },
});

test('requireVerifiedUser lowercases the email and checks revocation', async () => {
  const gate = await requireVerifiedUser({ auth }, makeReq({ token: 'good' }));
  assert.deepEqual(gate, { ok: true, uid: 'u1', email: 'ana@example.org' });
  assert.equal(auth.calls.at(-1).checkRevoked, true);
});

test('requireVerifiedUser refuses a missing or bad token with 401', async () => {
  for (const token of [undefined, 'nope']) {
    const gate = await requireVerifiedUser({ auth }, makeReq({ token }));
    assert.equal(gate.ok, false);
    assert.equal(gate.status, 401);
  }
});

test('requireVerifiedUser refuses an unverified or missing email with 403', async () => {
  for (const token of ['unverified', 'noemail']) {
    const gate = await requireVerifiedUser({ auth }, makeReq({ token }));
    assert.equal(gate.status, 403);
    assert.equal(gate.code, 'email-not-verified');
  }
});

test('postEndpoint passes the body and the user to the action and sends its result', async () => {
  let seen;
  const handler = postEndpoint({ auth, log: QUIET }, async ({ body, user }) => {
    seen = { body, user };
    return { status: 201, body: { ok: true } };
  });
  const res = makeRes();
  await handler(makeReq({ token: 'good', body: { name: 'X' } }), res);
  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.body, { ok: true });
  assert.deepEqual(seen, { body: { name: 'X' }, user: { ok: true, uid: 'u1', email: 'ana@example.org' } });
});

test('postEndpoint refuses other methods, signed-out callers and non-object bodies', async () => {
  const handler = postEndpoint({ auth, log: QUIET }, async () => ({ body: {} }));
  let res = makeRes();
  await handler(makeReq({ method: 'GET', token: 'good' }), res);
  assert.equal(res.statusCode, 405);
  res = makeRes();
  await handler(makeReq({ token: 'nope' }), res);
  assert.equal(res.statusCode, 401);
  res = makeRes();
  await handler(makeReq({ token: 'good', body: 'text' }), res);
  assert.equal(res.statusCode, 400);
});

test('postEndpoint sends a ConsoleError as is and hides any other error', async () => {
  let res = makeRes();
  await postEndpoint({ auth, log: QUIET }, async () => {
    throw new ConsoleError(409, 'conflict', 'Already done.');
  })(makeReq({ token: 'good' }), res);
  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.body, { error: { code: 'conflict', message: 'Already done.' } });

  const logged = [];
  res = makeRes();
  await postEndpoint({ auth, log: { ...QUIET, error: (...a) => logged.push(a) } }, async () => {
    throw new Error('secret detail');
  })(makeReq({ token: 'good' }), res);
  assert.equal(res.statusCode, 500);
  assert.ok(!JSON.stringify(res.body).includes('secret detail'));
  assert.equal(logged.length, 1);
});

test('postEndpoint logs the cause of a refusal and sends Retry-After when it has one', async () => {
  const logged = [];
  const res = makeRes();
  await postEndpoint({ auth, log: { ...QUIET, error: (...a) => logged.push(a) } }, async () => {
    const err = new ConsoleError(429, 'rate-limited', 'Try again later.');
    err.retryAfterSeconds = 60;
    err.cause = new Error('provider said no');
    throw err;
  })(makeReq({ token: 'good' }), res);
  assert.equal(res.statusCode, 429);
  assert.equal(res.headers['Retry-After'], '60');
  assert.equal(logged.length, 1);
  assert.ok(!JSON.stringify(res.body).includes('provider said no'));
});

test('postEndpoint sends the field errors of a refusal, for a form', async () => {
  const res = makeRes();
  await postEndpoint({ auth, log: QUIET }, async () => {
    const err = new ConsoleError(400, 'incomplete', 'Some answers need attention.');
    err.fields = { 'event.name': 'Enter the event name.' };
    throw err;
  })(makeReq({ token: 'good' }), res);
  assert.deepEqual(res.body, {
    error: { code: 'incomplete', message: 'Some answers need attention.', fields: { 'event.name': 'Enter the event name.' } },
  });
});

test('postEndpoint names the field a refusal is about, when it has one', async () => {
  const res = makeRes();
  await postEndpoint({ auth, log: QUIET }, async () => {
    const err = new ConsoleError(400, 'invalid-setting', 'Enter a region.');
    err.field = 'region';
    throw err;
  })(makeReq({ token: 'good' }), res);
  assert.deepEqual(res.body, { error: { code: 'invalid-setting', message: 'Enter a region.', field: 'region' } });
});

test('applyCors answers a preflight and allows only listed origins', () => {
  const allowed = parseAllowedOrigins(' https://console.eventrunner.org , http://localhost:5173 ');
  assert.deepEqual(allowed, ['https://console.eventrunner.org', 'http://localhost:5173']);
  let res = makeRes();
  assert.equal(applyCors(makeReq({ method: 'OPTIONS', origin: 'http://localhost:5173' }), res, allowed), true);
  assert.equal(res.statusCode, 204);
  assert.equal(res.headers['Access-Control-Allow-Origin'], 'http://localhost:5173');
  res = makeRes();
  assert.equal(applyCors(makeReq({ origin: 'https://evil.example' }), res, allowed), false);
  assert.equal(res.headers['Access-Control-Allow-Origin'], undefined);
  assert.deepEqual(parseAllowedOrigins(undefined), []);
});
