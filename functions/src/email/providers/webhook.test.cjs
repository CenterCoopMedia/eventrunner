'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { createWebhookProvider, internals } = require('./webhook.cjs');

// --- Fakes -----------------------------------------------------------------

/** @param {{ status?: number, jsonBody?: any, textBody?: string, headers?: Record<string,string> }} spec */
function fakeResponse({ status = 200, jsonBody, textBody, headers = {} } = {}) {
  const lower = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return {
    status,
    ok: status >= 200 && status <= 299,
    headers: { get: (name) => lower[name.toLowerCase()] ?? null },
    async json() {
      if (jsonBody === undefined) throw new SyntaxError('not json');
      return jsonBody;
    },
    async text() {
      return textBody ?? (jsonBody !== undefined ? JSON.stringify(jsonBody) : '');
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
  EMAIL_WEBHOOK_URL: 'https://relay.example/send',
  EMAIL_WEBHOOK_SECRET: 'test-secret',
};

// --- Factory ---------------------------------------------------------------

test('factory requires EMAIL_WEBHOOK_URL and EMAIL_WEBHOOK_SECRET', () => {
  assert.throws(
    () => createWebhookProvider({ env: { EMAIL_WEBHOOK_SECRET: 's' } }),
    /EMAIL_WEBHOOK_URL/,
  );
  assert.throws(
    () => createWebhookProvider({ env: { EMAIL_WEBHOOK_URL: 'https://x' } }),
    /EMAIL_WEBHOOK_SECRET/,
  );
});

// --- send ------------------------------------------------------------------

test('send POSTs the EmailMessage as signed JSON with the exact hmac', async () => {
  const fetchImpl = fakeFetch([fakeResponse({ status: 200, jsonBody: { id: 'relay-1' } })]);
  const provider = createWebhookProvider({ env: ENV, fetchImpl });

  const message = { to: 'a@example.com', subject: 'Hi', text: 'Hello' };
  const result = await provider.send(message);

  assert.equal(fetchImpl.calls.length, 1);
  const { url, init } = fetchImpl.calls[0];
  assert.equal(url, 'https://relay.example/send');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['Content-Type'], 'application/json');
  assert.equal(init.headers['Authorization'], 'Bearer test-secret');
  assert.equal(init.body, '{"to":"a@example.com","subject":"Hi","text":"Hello"}');
  // Signature determinism: exact hmac-sha256 hex of the raw body keyed by
  // the secret, precomputed independently.
  assert.equal(
    init.headers['X-Signature'],
    'sha256=b8a587c0b4c8c952e8556cbf98d8d343a2a5f69cd90c980132ee0a1ca4867ab5',
  );
  assert.deepEqual(result, { providerMessageId: 'relay-1', status: 'sent', providerStatus: 200 });
});

test('send maps a 2xx without a usable id to sent with null id', async () => {
  const fetchImpl = fakeFetch([fakeResponse({ status: 202, textBody: 'accepted' })]);
  const provider = createWebhookProvider({ env: ENV, fetchImpl });
  const result = await provider.send({ to: 'a@example.com', subject: 's' });
  assert.deepEqual(result, { providerMessageId: null, status: 'sent', providerStatus: 202 });
});

test('send maps a non-2xx to failed with providerStatus and error', async () => {
  const fetchImpl = fakeFetch([fakeResponse({ status: 500, textBody: 'relay down' })]);
  const provider = createWebhookProvider({ env: ENV, fetchImpl });
  const result = await provider.send({ to: 'a@example.com', subject: 's' });
  assert.equal(result.status, 'failed');
  assert.equal(result.providerStatus, 500);
  assert.match(result.error, /500/);
  assert.match(result.error, /relay down/);
  assert.equal(result.retryAfterMs, undefined);
});

test('send parses Retry-After seconds into retryAfterMs on 429 only', async () => {
  const fetchImpl = fakeFetch([
    fakeResponse({ status: 429, textBody: 'slow down', headers: { 'Retry-After': '7' } }),
    fakeResponse({ status: 503, textBody: 'later', headers: { 'Retry-After': '9' } }),
    fakeResponse({ status: 429, textBody: 'no hint' }),
  ]);
  const provider = createWebhookProvider({ env: ENV, fetchImpl });

  const throttled = await provider.send({ to: 'a@example.com', subject: 's' });
  assert.equal(throttled.status, 'failed');
  assert.equal(throttled.providerStatus, 429);
  assert.equal(throttled.retryAfterMs, 7000);

  const unavailable = await provider.send({ to: 'a@example.com', subject: 's' });
  assert.equal(unavailable.retryAfterMs, undefined);

  const noHint = await provider.send({ to: 'a@example.com', subject: 's' });
  assert.equal(noHint.providerStatus, 429);
  assert.equal(noHint.retryAfterMs, undefined);
});

test('a thrown fetch error propagates (core treats throws as non-retryable)', async () => {
  const fetchImpl = fakeFetch([new Error('ECONNRESET')]);
  const provider = createWebhookProvider({ env: ENV, fetchImpl });
  await assert.rejects(() => provider.send({ to: 'a@example.com', subject: 's' }), /ECONNRESET/);
});

// --- verifyDeliveryWebhook ---------------------------------------------------

function sign(rawBody, secret = ENV.EMAIL_WEBHOOK_SECRET) {
  return `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
}

test('verifyDeliveryWebhook accepts a valid signature over the raw body', () => {
  const provider = createWebhookProvider({ env: ENV, fetchImpl: fakeFetch([]) });
  const rawBody = Buffer.from('{"providerMessageId":"m1"}');
  assert.equal(
    provider.verifyDeliveryWebhook(rawBody, { 'x-signature': sign(rawBody) }),
    true,
  );
  // Header lookup is case-insensitive.
  assert.equal(
    provider.verifyDeliveryWebhook(rawBody, { 'X-Signature': sign(rawBody) }),
    true,
  );
});

test('verifyDeliveryWebhook rejects wrong secret, tampered body, bad or missing header', () => {
  const provider = createWebhookProvider({ env: ENV, fetchImpl: fakeFetch([]) });
  const rawBody = Buffer.from('{"providerMessageId":"m1"}');
  assert.equal(
    provider.verifyDeliveryWebhook(rawBody, { 'x-signature': sign(rawBody, 'other-secret') }),
    false,
  );
  assert.equal(
    provider.verifyDeliveryWebhook(Buffer.from('{"tampered":1}'), {
      'x-signature': sign(rawBody),
    }),
    false,
  );
  // Length mismatch must return false, not throw (timingSafeEqual guard).
  assert.equal(provider.verifyDeliveryWebhook(rawBody, { 'x-signature': 'sha256=abc' }), false);
  assert.equal(provider.verifyDeliveryWebhook(rawBody, {}), false);
  assert.equal(provider.verifyDeliveryWebhook(rawBody, { 'x-signature': '' }), false);
});

// --- parseDeliveryEvent ------------------------------------------------------

const VALID_EVENT = {
  providerMessageId: 'm1',
  type: 'delivered',
  recipient: 'a@example.com',
  occurredAt: '2026-08-19T00:00:00Z',
};

test('parseDeliveryEvent accepts an array and filters invalid entries', () => {
  const provider = createWebhookProvider({ env: ENV, fetchImpl: fakeFetch([]) });
  const events = provider.parseDeliveryEvent([
    VALID_EVENT,
    { ...VALID_EVENT, type: 'exploded' },
    { ...VALID_EVENT, providerMessageId: '' },
    'garbage',
    { ...VALID_EVENT, type: 'bounced', reason: 'mailbox full' },
  ]);
  assert.equal(events.length, 2);
  assert.deepEqual(events[0], VALID_EVENT);
  assert.deepEqual(events[1], { ...VALID_EVENT, type: 'bounced', reason: 'mailbox full' });
});

test('parseDeliveryEvent accepts a single object as a one-element array', () => {
  const provider = createWebhookProvider({ env: ENV, fetchImpl: fakeFetch([]) });
  assert.deepEqual(provider.parseDeliveryEvent(VALID_EVENT), [VALID_EVENT]);
});

test('parseDeliveryEvent returns null for unrecognized payloads', () => {
  const provider = createWebhookProvider({ env: ENV, fetchImpl: fakeFetch([]) });
  assert.equal(provider.parseDeliveryEvent(null), null);
  assert.equal(provider.parseDeliveryEvent('nope'), null);
  assert.equal(provider.parseDeliveryEvent({ hello: 'world' }), null);
  assert.equal(provider.parseDeliveryEvent(42), null);
});

test('parseDeliveryEvent drops unknown extra fields from valid entries', () => {
  const provider = createWebhookProvider({ env: ENV, fetchImpl: fakeFetch([]) });
  const events = provider.parseDeliveryEvent({ ...VALID_EVENT, secretRelayField: 'x' });
  assert.deepEqual(events, [VALID_EVENT]);
});

// --- internals ----------------------------------------------------------------

test('internals.retryAfterMsFrom parses seconds and rejects junk', () => {
  assert.equal(internals.retryAfterMsFrom('30'), 30000);
  assert.equal(internals.retryAfterMsFrom('0'), 0);
  assert.equal(internals.retryAfterMsFrom('soon'), undefined);
  assert.equal(internals.retryAfterMsFrom(null), undefined);
  assert.equal(internals.retryAfterMsFrom('-5'), undefined);
});

test('internals.safeEqual compares without length throw', () => {
  assert.equal(internals.safeEqual('abc', 'abc'), true);
  assert.equal(internals.safeEqual('abc', 'abcd'), false);
  assert.equal(internals.safeEqual('', 'x'), false);
});
