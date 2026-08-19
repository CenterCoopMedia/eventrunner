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
