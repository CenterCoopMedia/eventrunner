'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { applyCors, parseAllowedOrigins } = require('./http.cjs');

function fakeRes() {
  return {
    headers: {},
    statusCode: null,
    sent: null,
    set(k, v) { this.headers[k] = v; return this; },
    status(code) { this.statusCode = code; return this; },
    send(body) { this.sent = body; return this; },
  };
}

test('parseAllowedOrigins splits, trims, drops empties', () => {
  assert.deepEqual(parseAllowedOrigins(' https://a.org ,https://b.org,, '), ['https://a.org', 'https://b.org']);
  assert.deepEqual(parseAllowedOrigins(undefined), []);
});

test('allowed origin gets CORS headers', () => {
  const res = fakeRes();
  const handled = applyCors(
    { method: 'POST', headers: { origin: 'https://a.org' } },
    res,
    { allowedOrigins: ['https://a.org'] },
  );
  assert.equal(handled, false);
  assert.equal(res.headers['Access-Control-Allow-Origin'], 'https://a.org');
});

test('disallowed origin gets no CORS headers', () => {
  const res = fakeRes();
  applyCors(
    { method: 'POST', headers: { origin: 'https://evil.org' } },
    res,
    { allowedOrigins: ['https://a.org'] },
  );
  assert.equal(res.headers['Access-Control-Allow-Origin'], undefined);
});

test('preflight is fully handled', () => {
  const res = fakeRes();
  const handled = applyCors(
    { method: 'OPTIONS', headers: { origin: 'https://a.org' } },
    res,
    { allowedOrigins: ['https://a.org'] },
  );
  assert.equal(handled, true);
  assert.equal(res.statusCode, 204);
});

test('the preflight allows every header the OTP client actually sends', () => {
  const res = fakeRes();
  const handled = applyCors(
    {
      method: 'OPTIONS',
      headers: {
        origin: 'https://a.org',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,x-firebase-appcheck',
      },
    },
    res,
    { allowedOrigins: ['https://a.org'] },
  );
  assert.equal(handled, true);
  assert.equal(res.statusCode, 204);

  const allowed = res.headers['Access-Control-Allow-Headers']
    .split(',')
    .map((h) => h.trim().toLowerCase());
  // X-Firebase-AppCheck is not CORS-safelisted: the attestation the web
  // client attaches (issue #45) preflights, and a missing entry here blocks
  // both OTP POSTs outright as soon as a site key is configured.
  for (const header of ['content-type', 'authorization', 'x-firebase-appcheck']) {
    assert.ok(allowed.includes(header), `preflight must allow ${header}`);
  }
  assert.equal(res.headers['Access-Control-Allow-Methods'], 'POST');
});
