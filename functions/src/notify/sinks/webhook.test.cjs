'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { createWebhookSink, internals } = require('./webhook.cjs');

// --- Fakes -----------------------------------------------------------------

/** @param {{ status?: number, textBody?: string }} spec */
function fakeResponse({ status = 200, textBody = '' } = {}) {
  return {
    status,
    async text() {
      return textBody;
    },
  };
}

/** Scripted fetch: returns responses in order, captures every request. */
function fakeFetch(responses) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error('fakeFetch: no scripted response left');
    if (next instanceof Error) throw next;
    return next;
  };
  impl.calls = calls;
  return impl;
}

const ENV = {
  OPERATOR_WEBHOOK_URL: 'https://ops.example/notify',
  OPERATOR_WEBHOOK_SECRET: 'op-secret',
};

const PAYLOAD = {
  kind: 'error',
  title: '[EX27] db down',
  summary: 'primary unreachable',
  deployment: 'ex27',
  projectId: 'proj-1',
  timestamp: '2026-08-19T12:00:00.000Z',
};

// --- Factory ---------------------------------------------------------------

test('factory requires OPERATOR_WEBHOOK_URL and OPERATOR_WEBHOOK_SECRET', () => {
  assert.throws(
    () => createWebhookSink({ env: { OPERATOR_WEBHOOK_SECRET: 's' } }),
    /OPERATOR_WEBHOOK_URL/,
  );
  assert.throws(
    () => createWebhookSink({ env: { OPERATOR_WEBHOOK_URL: 'https://x' } }),
    /OPERATOR_WEBHOOK_SECRET/,
  );
});

// --- deliver ---------------------------------------------------------------

test('deliver POSTs the payload as signed JSON with a deterministic hmac', async () => {
  const fetchImpl = fakeFetch([fakeResponse({ status: 200 })]);
  const sink = createWebhookSink({ env: ENV, fetchImpl });

  const result = await sink.deliver(PAYLOAD);

  assert.equal(fetchImpl.calls.length, 1);
  const { url, init } = fetchImpl.calls[0];
  assert.equal(url, 'https://ops.example/notify');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['Content-Type'], 'application/json');
  assert.equal(init.headers['Authorization'], 'Bearer op-secret');
  assert.equal(init.body, JSON.stringify(PAYLOAD));
  // Signature determinism: exact hmac-sha256 hex of the raw body keyed by
  // the secret, precomputed independently.
  assert.equal(
    init.headers['X-Signature'],
    'sha256=f998414128cf54baabef8386285a68a220083658b6c0b7830a61eb42cee97c24',
  );
  assert.deepEqual(result, { delivered: true, sink: 'webhook' });
});

test('signature matches an independent hmac over the exact raw body', async () => {
  const fetchImpl = fakeFetch([fakeResponse({ status: 204 })]);
  const sink = createWebhookSink({ env: ENV, fetchImpl });
  await sink.deliver({ kind: 'info', title: 't', summary: 's' });

  const { init } = fetchImpl.calls[0];
  const expected = crypto
    .createHmac('sha256', ENV.OPERATOR_WEBHOOK_SECRET)
    .update(init.body)
    .digest('hex');
  assert.equal(init.headers['X-Signature'], `sha256=${expected}`);
  assert.equal(internals.signBody(ENV.OPERATOR_WEBHOOK_SECRET, init.body), expected);
});

test('deliver maps any non-2xx to delivered:false with an error', async () => {
  const fetchImpl = fakeFetch([fakeResponse({ status: 503, textBody: 'down' })]);
  const sink = createWebhookSink({ env: ENV, fetchImpl });
  const result = await sink.deliver(PAYLOAD);
  assert.equal(result.delivered, false);
  assert.equal(result.sink, 'webhook');
  assert.match(result.error, /503/);
  assert.match(result.error, /down/);
});

test('deliver maps a thrown fetch to delivered:false without throwing', async () => {
  const fetchImpl = fakeFetch([new Error('ECONNREFUSED')]);
  const sink = createWebhookSink({ env: ENV, fetchImpl });
  const result = await sink.deliver(PAYLOAD);
  assert.deepEqual(result, { delivered: false, sink: 'webhook', error: 'ECONNREFUSED' });
});

test('deliver keeps the status-only error when the body is unreadable', async () => {
  const fetchImpl = fakeFetch([
    { status: 500, text: async () => { throw new Error('stream gone'); } },
  ]);
  const sink = createWebhookSink({ env: ENV, fetchImpl });
  const result = await sink.deliver(PAYLOAD);
  assert.deepEqual(result, {
    delivered: false,
    sink: 'webhook',
    error: 'operator webhook responded 500',
  });
});
