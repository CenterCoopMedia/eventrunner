'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createPostmarkProvider, internals } = require('./postmark.cjs');

// --- Fakes -----------------------------------------------------------------

/** @param {{ status?: number, jsonBody?: any, headers?: Record<string,string> }} spec */
function fakeResponse({ status = 200, jsonBody, headers = {} } = {}) {
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
      return jsonBody !== undefined ? JSON.stringify(jsonBody) : '';
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
  EMAIL_PROVIDER_API_KEY: 'server-token',
  EMAIL_WEBHOOK_BASIC_AUTH: 'hookuser:hookpass',
};

function basic(userPass) {
  return `Basic ${Buffer.from(userPass, 'utf8').toString('base64')}`;
}

// --- Factory ---------------------------------------------------------------

test('factory requires EMAIL_PROVIDER_API_KEY', () => {
  assert.throws(() => createPostmarkProvider({ env: {} }), /EMAIL_PROVIDER_API_KEY/);
});

// --- send ------------------------------------------------------------------

test('send maps the EmailMessage onto the Postmark payload', async () => {
  const fetchImpl = fakeFetch([
    fakeResponse({ status: 200, jsonBody: { MessageID: 'pm-123', ErrorCode: 0 } }),
  ]);
  const provider = createPostmarkProvider({ env: ENV, fetchImpl });

  const result = await provider.send({
    to: 'a@example.com',
    from: { email: 'sender@example.com', name: 'The Event' },
    replyTo: 'reply@example.com',
    subject: 'Hi',
    html: '<p>Hello</p>',
    text: 'Hello',
    tag: 'account.welcome',
    headers: { 'X-Custom': 'yes' },
    messageStream: 'outbound',
  });

  assert.equal(fetchImpl.calls.length, 1);
  const { url, init } = fetchImpl.calls[0];
  assert.equal(url, 'https://api.postmarkapp.com/email');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['X-Postmark-Server-Token'], 'server-token');
  assert.equal(init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(init.body), {
    From: 'The Event <sender@example.com>',
    To: 'a@example.com',
    Subject: 'Hi',
    HtmlBody: '<p>Hello</p>',
    TextBody: 'Hello',
    ReplyTo: 'reply@example.com',
    Tag: 'account.welcome',
    Headers: [{ Name: 'X-Custom', Value: 'yes' }],
    MessageStream: 'outbound',
  });
  assert.deepEqual(result, { providerMessageId: 'pm-123', status: 'sent', providerStatus: 200 });
});

test('send omits MessageStream, Headers, ReplyTo, Tag when absent and uses bare From', async () => {
  const fetchImpl = fakeFetch([fakeResponse({ status: 200, jsonBody: { MessageID: 'pm-1' } })]);
  const provider = createPostmarkProvider({ env: ENV, fetchImpl });
  await provider.send({
    to: 'a@example.com',
    from: { email: 'sender@example.com' },
    subject: 'Hi',
    text: 'Hello',
  });
  const payload = JSON.parse(fetchImpl.calls[0].init.body);
  assert.deepEqual(payload, {
    From: 'sender@example.com',
    To: 'a@example.com',
    Subject: 'Hi',
    TextBody: 'Hello',
  });
});

test('send maps 422 to failed with ErrorCode and Message', async () => {
  const fetchImpl = fakeFetch([
    fakeResponse({ status: 422, jsonBody: { ErrorCode: 300, Message: 'Invalid email request' } }),
  ]);
  const provider = createPostmarkProvider({ env: ENV, fetchImpl });
  const result = await provider.send({ to: 'bad', subject: 's' });
  assert.equal(result.status, 'failed');
  assert.equal(result.providerStatus, 422);
  assert.equal(result.providerMessageId, null);
  assert.equal(result.error, '300: Invalid email request');
  assert.equal(result.retryAfterMs, undefined);
});

test('send maps 429 to failed with retryAfterMs from Retry-After', async () => {
  const fetchImpl = fakeFetch([
    fakeResponse({
      status: 429,
      jsonBody: { ErrorCode: 429, Message: 'Rate limit exceeded' },
      headers: { 'Retry-After': '12' },
    }),
  ]);
  const provider = createPostmarkProvider({ env: ENV, fetchImpl });
  const result = await provider.send({ to: 'a@example.com', subject: 's' });
  assert.equal(result.status, 'failed');
  assert.equal(result.providerStatus, 429);
  assert.equal(result.retryAfterMs, 12000);
});

test('send maps 5xx (even non-JSON) to failed so the core can retry', async () => {
  const fetchImpl = fakeFetch([fakeResponse({ status: 503 })]);
  const provider = createPostmarkProvider({ env: ENV, fetchImpl });
  const result = await provider.send({ to: 'a@example.com', subject: 's' });
  assert.equal(result.status, 'failed');
  assert.equal(result.providerStatus, 503);
  assert.match(result.error, /503/);
});

test('a thrown fetch error propagates (core treats throws as non-retryable)', async () => {
  const fetchImpl = fakeFetch([new Error('ETIMEDOUT')]);
  const provider = createPostmarkProvider({ env: ENV, fetchImpl });
  await assert.rejects(() => provider.send({ to: 'a@example.com', subject: 's' }), /ETIMEDOUT/);
});

test('formatAddress quotes display names with mailbox-special characters', () => {
  const { formatAddress } = internals;
  assert.equal(formatAddress({ email: 'j@example.org', name: 'Jane Doe' }), 'Jane Doe <j@example.org>');
  assert.equal(formatAddress({ email: 'j@example.org', name: 'Doe, Jane' }), '"Doe, Jane" <j@example.org>');
  assert.equal(
    formatAddress({ email: 'j@example.org', name: 'Jane "JD" D\\backslash' }),
    '"Jane \\"JD\\" D\\\\backslash" <j@example.org>',
  );
});

// --- verifyDeliveryWebhook ---------------------------------------------------

test('verifyDeliveryWebhook accepts matching Basic credentials', () => {
  const provider = createPostmarkProvider({ env: ENV, fetchImpl: fakeFetch([]) });
  assert.equal(
    provider.verifyDeliveryWebhook(Buffer.from('{}'), {
      authorization: basic('hookuser:hookpass'),
    }),
    true,
  );
  // Header lookup is case-insensitive.
  assert.equal(
    provider.verifyDeliveryWebhook(Buffer.from('{}'), {
      Authorization: basic('hookuser:hookpass'),
    }),
    true,
  );
});

test('verifyDeliveryWebhook rejects wrong, malformed, or absent credentials', () => {
  const provider = createPostmarkProvider({ env: ENV, fetchImpl: fakeFetch([]) });
  const raw = Buffer.from('{}');
  assert.equal(provider.verifyDeliveryWebhook(raw, { authorization: basic('hookuser:wrong') }), false);
  // Different-length credential must return false, not throw.
  assert.equal(provider.verifyDeliveryWebhook(raw, { authorization: basic('x') }), false);
  assert.equal(provider.verifyDeliveryWebhook(raw, { authorization: 'Bearer token' }), false);
  assert.equal(provider.verifyDeliveryWebhook(raw, {}), false);
});

test('verifyDeliveryWebhook is false when EMAIL_WEBHOOK_BASIC_AUTH is absent', () => {
  const provider = createPostmarkProvider({
    env: { EMAIL_PROVIDER_API_KEY: 'server-token' },
    fetchImpl: fakeFetch([]),
  });
  assert.equal(
    provider.verifyDeliveryWebhook(Buffer.from('{}'), {
      authorization: basic('hookuser:hookpass'),
    }),
    false,
  );
});

// --- parseDeliveryEvent ------------------------------------------------------

test('parseDeliveryEvent maps Delivery', () => {
  const provider = createPostmarkProvider({ env: ENV, fetchImpl: fakeFetch([]) });
  assert.deepEqual(
    provider.parseDeliveryEvent({
      RecordType: 'Delivery',
      MessageID: 'pm-1',
      Recipient: 'a@example.com',
      DeliveredAt: '2026-08-19T00:00:00Z',
    }),
    [{
      providerMessageId: 'pm-1',
      type: 'delivered',
      recipient: 'a@example.com',
      occurredAt: '2026-08-19T00:00:00Z',
    }],
  );
});

test('parseDeliveryEvent maps Bounce with reason from Description then Name', () => {
  const provider = createPostmarkProvider({ env: ENV, fetchImpl: fakeFetch([]) });
  assert.deepEqual(
    provider.parseDeliveryEvent({
      RecordType: 'Bounce',
      MessageID: 'pm-2',
      Email: 'a@example.com',
      BouncedAt: '2026-08-19T01:00:00Z',
      Name: 'Hard bounce',
      Description: 'The server was unable to deliver your message',
    }),
    [{
      providerMessageId: 'pm-2',
      type: 'bounced',
      recipient: 'a@example.com',
      occurredAt: '2026-08-19T01:00:00Z',
      reason: 'The server was unable to deliver your message',
    }],
  );
  const nameOnly = provider.parseDeliveryEvent({
    RecordType: 'Bounce',
    MessageID: 'pm-2',
    Email: 'a@example.com',
    BouncedAt: '2026-08-19T01:00:00Z',
    Name: 'Hard bounce',
  });
  assert.equal(nameOnly[0].reason, 'Hard bounce');
});

test('parseDeliveryEvent maps SpamComplaint to complained', () => {
  const provider = createPostmarkProvider({ env: ENV, fetchImpl: fakeFetch([]) });
  const events = provider.parseDeliveryEvent({
    RecordType: 'SpamComplaint',
    MessageID: 'pm-3',
    Email: 'a@example.com',
    BouncedAt: '2026-08-19T02:00:00Z',
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'complained');
  assert.equal(events[0].recipient, 'a@example.com');
});

test('parseDeliveryEvent maps SubscriptionChange only when SuppressSending is true', () => {
  const provider = createPostmarkProvider({ env: ENV, fetchImpl: fakeFetch([]) });
  const suppressed = provider.parseDeliveryEvent({
    RecordType: 'SubscriptionChange',
    MessageID: 'pm-4',
    Recipient: 'a@example.com',
    ChangedAt: '2026-08-19T03:00:00Z',
    SuppressSending: true,
    SuppressionReason: 'ManualSuppression',
  });
  assert.deepEqual(suppressed, [{
    providerMessageId: 'pm-4',
    type: 'suppressed',
    recipient: 'a@example.com',
    occurredAt: '2026-08-19T03:00:00Z',
    reason: 'ManualSuppression',
  }]);
  assert.equal(
    provider.parseDeliveryEvent({
      RecordType: 'SubscriptionChange',
      MessageID: 'pm-4',
      Recipient: 'a@example.com',
      ChangedAt: '2026-08-19T03:00:00Z',
      SuppressSending: false,
    }),
    null,
  );
});

test('parseDeliveryEvent returns null for unrecognized payloads', () => {
  const provider = createPostmarkProvider({ env: ENV, fetchImpl: fakeFetch([]) });
  assert.equal(provider.parseDeliveryEvent(null), null);
  assert.equal(provider.parseDeliveryEvent([]), null);
  assert.equal(provider.parseDeliveryEvent({ RecordType: 'Open', MessageID: 'pm-5' }), null);
  assert.equal(
    provider.parseDeliveryEvent({ RecordType: 'Delivery', Recipient: 'a@example.com' }),
    null,
  );
  assert.equal(
    provider.parseDeliveryEvent({ RecordType: 'Delivery', MessageID: 'pm-6' }),
    null,
  );
});

// --- verifySenderDomain --------------------------------------------------------

test('verifySenderDomain reports unknown when EMAIL_ACCOUNT_API_KEY is absent', async () => {
  const fetchImpl = fakeFetch([]);
  const provider = createPostmarkProvider({
    env: { EMAIL_PROVIDER_API_KEY: 'server-token' },
    fetchImpl,
  });
  assert.deepEqual(await provider.verifySenderDomain('mail.example.com'), {
    domain: 'mail.example.com',
    verified: false,
    spf: 'unknown',
    dkim: 'unknown',
    returnPath: 'unknown',
    detail: 'EMAIL_ACCOUNT_API_KEY not configured',
  });
  assert.equal(fetchImpl.calls.length, 0);
});

test('verifySenderDomain lists domains, matches case-insensitively, maps flags', async () => {
  const fetchImpl = fakeFetch([
    fakeResponse({
      status: 200,
      jsonBody: { Domains: [{ ID: 7, Name: 'Mail.Example.COM' }, { ID: 8, Name: 'other.io' }] },
    }),
    fakeResponse({
      status: 200,
      jsonBody: { ID: 7, SPFVerified: true, DKIMVerified: true, ReturnPathDomainVerified: false },
    }),
  ]);
  const provider = createPostmarkProvider({
    env: { ...ENV, EMAIL_ACCOUNT_API_KEY: 'account-token' },
    fetchImpl,
  });

  const status = await provider.verifySenderDomain('mail.example.com');
  assert.equal(fetchImpl.calls[0].url, 'https://api.postmarkapp.com/domains?count=500&offset=0');
  assert.equal(fetchImpl.calls[0].init.headers['X-Postmark-Account-Token'], 'account-token');
  assert.equal(fetchImpl.calls[1].url, 'https://api.postmarkapp.com/domains/7');
  assert.deepEqual(status, {
    domain: 'mail.example.com',
    verified: false,
    spf: 'pass',
    dkim: 'pass',
    returnPath: 'fail',
  });
});

test('verifySenderDomain is verified only when all three checks pass', async () => {
  const fetchImpl = fakeFetch([
    fakeResponse({ status: 200, jsonBody: { Domains: [{ ID: 7, Name: 'mail.example.com' }] } }),
    fakeResponse({
      status: 200,
      jsonBody: { ID: 7, SPFVerified: true, DKIMVerified: true, ReturnPathDomainVerified: true },
    }),
  ]);
  const provider = createPostmarkProvider({
    env: { ...ENV, EMAIL_ACCOUNT_API_KEY: 'account-token' },
    fetchImpl,
  });
  const status = await provider.verifySenderDomain('mail.example.com');
  assert.equal(status.verified, true);
});

test('verifySenderDomain reports unknown when the domain is not in the account', async () => {
  const fetchImpl = fakeFetch([
    fakeResponse({ status: 200, jsonBody: { Domains: [{ ID: 8, Name: 'other.io' }] } }),
  ]);
  const provider = createPostmarkProvider({
    env: { ...ENV, EMAIL_ACCOUNT_API_KEY: 'account-token' },
    fetchImpl,
  });
  const status = await provider.verifySenderDomain('mail.example.com');
  assert.equal(status.verified, false);
  assert.equal(status.spf, 'unknown');
  assert.match(status.detail, /not found/);
});

// --- internals ----------------------------------------------------------------

test('internals.formatAddress and passFail', () => {
  assert.equal(internals.formatAddress('a@example.com'), 'a@example.com');
  assert.equal(
    internals.formatAddress({ email: 'a@example.com', name: 'A' }),
    'A <a@example.com>',
  );
  assert.equal(internals.formatAddress(undefined), undefined);
  assert.equal(internals.passFail(true), 'pass');
  assert.equal(internals.passFail(false), 'fail');
  assert.equal(internals.passFail(undefined), 'unknown');
});
