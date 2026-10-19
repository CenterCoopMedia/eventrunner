'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { createEventbriteProvider, internals } = require('./eventbrite.cjs');

const FIXTURES = path.join(__dirname, '__fixtures__');
const fixture = (name) => require(path.join(FIXTURES, name));

// At least MIN_WEBHOOK_SECRET_LENGTH characters, as an operator generates it.
const SECRET = 'fixture-url-secret-0123456789abcdef0123';
const TOKEN = 'fixture-api-token';
const CALLBACK = 'https://us-central1-demo-event.cloudfunctions.net/ticketingWebhook';

function rawBodyFor(name) {
  return Buffer.from(JSON.stringify(fixture(name)), 'utf8');
}

/** The request context the webhook handler passes: the parsed query string of the delivery URL. */
function withSecret(secret = SECRET) {
  return { query: { [internals.URL_SECRET_PARAM]: secret } };
}

/** A delivery as Eventbrite sends it: no signature header, the secret in the registered URL. */
function delivery(name, secret = SECRET) {
  return { rawBody: rawBodyFor(name), headers: { 'content-type': 'application/json' }, context: withSecret(secret) };
}

function verify(p, name, secret) {
  const d = delivery(name, secret);
  return p.verifyWebhook(d.rawBody, d.headers, d.context);
}

function verifyBody(p, body, context = withSecret()) {
  return p.verifyWebhook(Buffer.from(JSON.stringify(body), 'utf8'), {}, context);
}

/**
 * A route-table fake fetch: `routes` maps "METHOD path" (path relative to
 * API_BASE, query string included when the test cares) to either a JSON
 * fixture object or a `{ status, body }` pair.
 */
function fakeFetch(routes, { calls = [] } = {}) {
  return async (url, opts = {}) => {
    const method = opts.method || 'GET';
    const path_ = url.replace(internals.API_BASE, '');
    calls.push({ method, path: path_, url, body: opts.body ? JSON.parse(opts.body) : undefined });
    const key = `${method} ${path_}`;
    let entry = routes[key];
    if (entry === undefined) {
      // Fall back to a path-only match (ignoring query string) for callers
      // that do not care about exact params.
      const pathOnly = path_.split('?')[0];
      entry = routes[`${method} ${pathOnly}`];
    }
    if (entry === undefined) {
      throw new Error(`fakeFetch: no route for ${key}`);
    }
    const status = entry.status ?? 200;
    const body = entry.body ?? entry;
    return {
      status,
      json: async () => body,
    };
  };
}

function provider(overrides = {}) {
  return createEventbriteProvider({
    env: {
      TICKETING_API_TOKEN: TOKEN,
      TICKETING_WEBHOOK_SECRET: SECRET,
      EVENT_TICKETING_EVENT_ID: 'evt-1',
      ...overrides.env,
    },
    fetchImpl: overrides.fetchImpl,
    getConfig: overrides.getConfig,
  });
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

test('construction requires both secrets, and reads externalEventId once (§3.3)', () => {
  assert.throws(
    () => createEventbriteProvider({ env: { TICKETING_WEBHOOK_SECRET: SECRET } }),
    /TICKETING_API_TOKEN/,
  );
  assert.throws(
    () => createEventbriteProvider({ env: { TICKETING_API_TOKEN: TOKEN } }),
    /TICKETING_WEBHOOK_SECRET/,
  );
  const p = provider();
  assert.equal(p.name, 'eventbrite');
  assert.equal(p.externalEventId, 'evt-1');
  assert.equal(typeof p.registerWebhook, 'function');
});

test('construction refuses a short URL secret, and the error never prints it (issue 356)', () => {
  const short = 'short-secret-value';
  assert.throws(
    () => provider({ env: { TICKETING_WEBHOOK_SECRET: short } }),
    (err) => /at least 32 characters/.test(err.message) && !err.message.includes(short),
  );
  assert.equal(internals.MIN_WEBHOOK_SECRET_LENGTH, 32);
});

// ---------------------------------------------------------------------------
// verifyWebhook — the URL secret is the security-critical check (issue 356)
// ---------------------------------------------------------------------------

test('verifyWebhook: a delivery with no signature header and the URL secret is valid (issue 356)', async () => {
  const p = provider();
  const d = delivery('webhook-order-placed.json');
  assert.equal(Object.keys(d.headers).some((h) => /signature/i.test(h)), false, 'Eventbrite sends no signature');
  const result = await p.verifyWebhook(d.rawBody, d.headers, d.context);
  assert.equal(result.valid, true);
  assert.equal(result.eventType, 'order.placed');
  assert.equal(result.resourceId, 'ord-2001');
  assert.equal(result.deliveryId, internals.deliveryIdFor(d.rawBody));
  assert.equal(result.deliveryId.length, 64); // sha256 hex
});

test('verifyWebhook: missing URL secret → invalid, never an oracle (issue 356)', async () => {
  const p = provider();
  const rawBody = rawBodyFor('webhook-order-placed.json');
  for (const context of [undefined, {}, { query: {} }, { query: { [internals.URL_SECRET_PARAM]: '' } }]) {
    const result = await p.verifyWebhook(rawBody, {}, context);
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'invalid_secret');
    assert.equal(result.resourceId, null, 'nothing from the body is read before the secret passes');
  }
});

test('verifyWebhook: wrong URL secret → invalid_secret (issue 356)', async () => {
  const p = provider();
  const result = await verify(p, 'webhook-order-placed.json', 'not-the-real-secret-0123456789abcdef');
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'invalid_secret');
});

test('verifyWebhook: a secret of the right length but wrong bytes refuses (constant-time path)', async () => {
  const p = provider();
  const flipped = SECRET.slice(0, -1) + (SECRET.at(-1) === '0' ? '1' : '0');
  assert.equal(flipped.length, SECRET.length);
  const result = await verify(p, 'webhook-order-placed.json', flipped);
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'invalid_secret');
});

test('verifyWebhook: the comparison is constant-time — it goes through safeEqual (SHA-256 + timingSafeEqual)', async () => {
  const crypto = require('node:crypto');
  const original = crypto.timingSafeEqual;
  let calls = 0;
  crypto.timingSafeEqual = (a, b) => { calls += 1; return original(a, b); };
  try {
    const p = provider();
    await verify(p, 'webhook-order-placed.json', 'x');
    await verify(p, 'webhook-order-placed.json');
  } finally {
    crypto.timingSafeEqual = original;
  }
  assert.equal(calls, 2, 'a short and a correct secret both reach timingSafeEqual');
});

test('verifyWebhook: a repeated secret parameter (array) refuses', async () => {
  const p = provider();
  const rawBody = rawBodyFor('webhook-order-placed.json');
  const result = await p.verifyWebhook(rawBody, {}, { query: { [internals.URL_SECRET_PARAM]: [SECRET, SECRET] } });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'invalid_secret');
});

test('verifyWebhook: an HMAC header alone no longer authenticates (issue 356)', async () => {
  const p = provider();
  const rawBody = rawBodyFor('webhook-order-placed.json');
  const crypto = require('node:crypto');
  const sig = crypto.createHmac('sha256', SECRET).update(rawBody).digest('hex');
  const result = await p.verifyWebhook(rawBody, { 'X-Eventbrite-Signature': sig });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'invalid_secret');
});

test('verifyWebhook: two distinct deliveries about the same order get different deliveryIds (judgment call 2)', async () => {
  const p = provider();
  const ra = await verify(p, 'webhook-order-updated.json');
  const rb = await verify(p, 'webhook-order-updated-2.json');
  assert.equal(ra.valid, true);
  assert.equal(rb.valid, true);
  assert.equal(ra.resourceId, rb.resourceId, 'same order');
  assert.notEqual(ra.deliveryId, rb.deliveryId, 'different bytes -> different delivery id');
});

test('verifyWebhook: a byte-identical retry produces the SAME deliveryId (dedup collapses it)', async () => {
  const p = provider();
  const r1 = await verify(p, 'webhook-order-placed.json');
  const r2 = await verify(p, 'webhook-order-placed.json');
  assert.equal(r1.deliveryId, r2.deliveryId);
});

test('verifyWebhook: order.refunded folds into eventType order.updated (judgment call 4)', async () => {
  const p = provider();
  const result = await verify(p, 'webhook-order-refunded.json');
  assert.equal(result.valid, true);
  assert.equal(result.eventType, 'order.updated');
  assert.equal(result.resourceId, 'ord-3003');
});

test('verifyWebhook: attendee.updated is actionable and resolves the order id (judgment call 3)', async () => {
  const p = provider();
  const result = await verify(p, 'webhook-attendee-updated.json');
  assert.equal(result.valid, true);
  assert.equal(result.eventType, 'attendee.updated');
  assert.equal(result.resourceId, 'ord-2001');
});

test('verifyWebhook: wrong-event delivery → valid: false, reason: wrong_event (§3.3 step 1)', async () => {
  const p = provider();
  const result = await verify(p, 'webhook-wrong-event.json');
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'wrong_event');
  // Still keyable — the webhook handler needs eventType/resourceId even on
  // a refusal ONLY for the wrong_event branch's own bookkeeping; the field
  // presence itself must not throw.
  assert.equal(result.eventType, 'order.placed');
});

test('verifyWebhook: malformed JSON body → reason malformed, even with the right secret', async () => {
  const p = provider();
  const result = await p.verifyWebhook(Buffer.from('not json{{{', 'utf8'), {}, withSecret());
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'malformed');
});

test('verifyWebhook: valid JSON but unrecognized shape (no api_url match) → malformed', async () => {
  const p = provider();
  const result = await verifyBody(p, { config: { action: 'order.placed' }, api_url: 'nope' });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'malformed');
});

test('verifyWebhook: api_url must name Eventbrite\'s own API host over https (no SSRF, issue 356)', async () => {
  const p = provider();
  const order = '/v3/events/evt-1/orders/ord-1/';
  for (const apiUrl of [
    `https://attacker.example${order}`,
    `https://www.eventbriteapi.com.attacker.example${order}`,
    `https://attacker.example/?u=https://www.eventbriteapi.com${order}`,
    `http://www.eventbriteapi.com${order}`,
    `https://www.eventbriteapi.com:8443${order}`,
    `https://user:pass@www.eventbriteapi.com${order}`,
    `https://169.254.169.254${order}`,
    `https://www.eventbriteapi.com/v3/events/evt-1/orders/ord-1/extra/`,
    `https://www.eventbriteapi.com/v2/events/evt-1/orders/ord-1/`,
  ]) {
    const result = await verifyBody(p, { config: { action: 'order.placed' }, api_url: apiUrl });
    assert.equal(result.valid, false, `${apiUrl} must be refused`);
    assert.equal(result.reason, 'malformed');
  }
  const ok = await verifyBody(p, { config: { action: 'order.placed' }, api_url: `https://www.eventbriteapi.com${order}` });
  assert.equal(ok.valid, true);
  assert.equal(ok.resourceId, 'ord-1');
});

test('verifyWebhook: makes no network call; the order is re-fetched later from API_BASE only', async () => {
  let called = false;
  const p = provider({ fetchImpl: async () => { called = true; throw new Error('no fetch in verify'); } });
  const result = await verify(p, 'webhook-order-placed.json');
  assert.equal(result.valid, true);
  assert.equal(called, false);
});

test('verifyWebhook: an unrecognized action still verifies (secret+shape ok) but maps to eventType unknown', async () => {
  const p = provider();
  const result = await verifyBody(p, {
    config: { action: 'venue.updated' },
    api_url: 'https://www.eventbriteapi.com/v3/events/evt-1/orders/ord-1/',
  });
  assert.equal(result.valid, true);
  assert.equal(result.eventType, 'unknown');
});

// ---------------------------------------------------------------------------
// fetchOrder — mapping + complete-flag eventual-consistency semantics
// ---------------------------------------------------------------------------

test('fetchOrder: complete order maps attendees to TicketRecord[] (§3.3)', async () => {
  const fetchImpl = fakeFetch({
    'GET /orders/ord-2001/': fixture('order-complete.json'),
  });
  const p = provider({ fetchImpl });
  const order = await p.fetchOrder('ord-2001');
  assert.equal(order.complete, true);
  assert.equal(order.externalEventId, 'evt-1');
  assert.equal(order.tickets.length, 2);
  const [t1, t2] = order.tickets;
  assert.equal(t1.externalId, 'att-5001');
  assert.equal(t1.orderId, 'ord-2001');
  assert.equal(t1.email, 'ada.lovelace@example.com');
  assert.equal(t1.status, 'valid');
  assert.equal(t1.quantity, 1);
  assert.equal(t1.purchasedAt, '2026-08-01T12:00:00Z');
  assert.equal(t2.email, 'grace.hopper@example.com');
});

test('fetchOrder: attendees key absent (processing) → complete: false, empty tickets, drives sync retry', async () => {
  const fetchImpl = fakeFetch({
    'GET /orders/ord-2001/': fixture('order-processing.json'),
  });
  const p = provider({ fetchImpl });
  const order = await p.fetchOrder('ord-2001');
  assert.equal(order.complete, false);
  assert.deepEqual(order.tickets, []);
});

test('fetchOrder: refunded order → complete: true, ticket status refunded (judgment call 5)', async () => {
  const fetchImpl = fakeFetch({
    'GET /orders/ord-3003/': fixture('order-refunded.json'),
  });
  const p = provider({ fetchImpl });
  const order = await p.fetchOrder('ord-3003');
  assert.equal(order.complete, true);
  assert.equal(order.tickets.length, 1);
  assert.equal(order.tickets[0].status, 'refunded');
});

test('fetchOrder: 404 → empty, complete result (terminal, not a retry target)', async () => {
  const fetchImpl = fakeFetch({
    'GET /orders/ord-missing/': { status: 404, body: fixture('order-not-found.json') },
  });
  const p = provider({ fetchImpl });
  const order = await p.fetchOrder('ord-missing');
  assert.deepEqual(order, { orderId: 'ord-missing', externalEventId: 'evt-1', tickets: [], complete: true });
});

test('fetchOrder: 5xx / API error THROWS — sync.cjs treats a throw as retryable', async () => {
  const fetchImpl = fakeFetch({
    'GET /orders/ord-2001/': { status: 500, body: { error: 'SERVER_ERROR', error_description: 'try again' } },
  });
  const p = provider({ fetchImpl });
  await assert.rejects(() => p.fetchOrder('ord-2001'), /try again/);
});

test('fetchOrder: empty orderId short-circuits with no network call', async () => {
  let called = false;
  const p = provider({ fetchImpl: async () => { called = true; } });
  const order = await p.fetchOrder('');
  assert.equal(called, false);
  assert.equal(order.complete, true);
  assert.deepEqual(order.tickets, []);
});

test('fetchOrder sends Bearer auth', async () => {
  const seen = [];
  const fetchImpl = async (url, opts) => {
    seen.push(opts.headers.Authorization);
    return { status: 200, json: async () => fixture('order-complete.json') };
  };
  const p = provider({ fetchImpl });
  await p.fetchOrder('ord-2001');
  assert.equal(seen[0], `Bearer ${TOKEN}`);
});

// ---------------------------------------------------------------------------
// listTickets — pagination
// ---------------------------------------------------------------------------

test('listTickets: walks continuation-token pages, flattens every order into TicketRecord[]', async () => {
  const calls = [];
  const fetchImpl = fakeFetch({
    'GET /events/evt-1/orders/': fixture('orders-page-1.json'),
    'GET /events/evt-1/orders/?expand=attendees&continuation=cont-token-2': fixture('orders-page-2.json'),
  }, { calls });

  const p = provider({ fetchImpl });
  const page1 = await p.listTickets();
  assert.equal(page1.tickets.length, 2);
  assert.equal(page1.nextPageToken, 'cont-token-2');

  const page2 = await p.listTickets({ pageToken: page1.nextPageToken });
  assert.equal(page2.tickets.length, 1);
  assert.equal(page2.nextPageToken, null);

  assert.equal(calls.length, 2);
});

test('listTickets: since maps to changed_since query param', async () => {
  const calls = [];
  const fetchImpl = fakeFetch({
    'GET /events/evt-1/orders/': { orders: [], pagination: { has_more_items: false } },
  }, { calls });
  const p = provider({ fetchImpl });
  await p.listTickets({ since: '2026-08-01T00:00:00Z' });
  assert.match(calls[0].path, /changed_since=2026-08-01T00%3A00%3A00Z/);
});

test('listTickets: no externalEventId configured → empty, no network call', async () => {
  let called = false;
  const p = provider({ env: { EVENT_TICKETING_EVENT_ID: '' }, fetchImpl: async () => { called = true; } });
  const result = await p.listTickets();
  assert.equal(called, false);
  assert.deepEqual(result, { tickets: [], nextPageToken: null });
});

// ---------------------------------------------------------------------------
// lookupByOrderNumber — self-service claim
// ---------------------------------------------------------------------------

test('lookupByOrderNumber: matching order + email → tickets', async () => {
  const fetchImpl = fakeFetch({ 'GET /orders/ord-2001/': fixture('order-complete.json') });
  const p = provider({ fetchImpl });
  const found = await p.lookupByOrderNumber('ord-2001', 'ADA.LOVELACE@example.com');
  assert.ok(found);
  assert.equal(found.length, 2);
});

test('lookupByOrderNumber: email mismatch → null (self-service safety check)', async () => {
  const fetchImpl = fakeFetch({ 'GET /orders/ord-2001/': fixture('order-complete.json') });
  const p = provider({ fetchImpl });
  assert.equal(await p.lookupByOrderNumber('ord-2001', 'someone-else@example.com'), null);
});

test('lookupByOrderNumber: rejects an order for a different event (§3.3: "rejects any order.event_id other than the hardcoded one")', async () => {
  const otherEventOrder = { ...fixture('order-complete.json'), event_id: 'evt-OTHER' };
  const fetchImpl = fakeFetch({ 'GET /orders/ord-2001/': otherEventOrder });
  const p = provider({ fetchImpl });
  assert.equal(await p.lookupByOrderNumber('ord-2001', 'ada.lovelace@example.com'), null);
});

test('lookupByOrderNumber: not found / empty input → null', async () => {
  const fetchImpl = fakeFetch({ 'GET /orders/nope/': { status: 404, body: {} } });
  const p = provider({ fetchImpl });
  assert.equal(await p.lookupByOrderNumber('nope', 'x@example.com'), null);
  assert.equal(await p.lookupByOrderNumber('', 'x@example.com'), null);
});

// ---------------------------------------------------------------------------
// registerWebhook — idempotence
// ---------------------------------------------------------------------------

test('registerWebhook: no existing subscription → creates one whose endpoint carries the URL secret (issue 356)', async () => {
  const calls = [];
  const fetchImpl = fakeFetch({
    'GET /users/me/organizations/': fixture('organizations.json'),
    'GET /organizations/org-8001/webhooks/': fixture('webhooks-list-empty.json'),
    'POST /organizations/org-8001/webhooks/': fixture('webhook-create-response.json'),
  }, { calls });
  const p = provider({ fetchImpl });
  const result = await p.registerWebhook({ callbackUrl: CALLBACK, events: p.webhookEventTypes });
  assert.equal(result.webhookId, 'hook-6666');
  const post = calls.find((c) => c.method === 'POST');
  const endpoint = new URL(post.body.endpoint_url);
  assert.equal(`${endpoint.origin}${endpoint.pathname}`, CALLBACK);
  assert.equal(endpoint.searchParams.get(internals.URL_SECRET_PARAM), SECRET);
  assert.equal(post.body.event_id, 'evt-1');
  // The registered URL round-trips through the verifier: what Eventbrite
  // will call is what the handler accepts.
  const query = Object.fromEntries(endpoint.searchParams);
  const d = delivery('webhook-order-placed.json');
  assert.equal((await p.verifyWebhook(d.rawBody, {}, { query })).valid, true);
});

test('registerWebhook: refuses a non-https callback URL', async () => {
  const p = provider({ fetchImpl: async () => { throw new Error('should not be called'); } });
  await assert.rejects(() => p.registerWebhook({ callbackUrl: 'http://example.org/hook' }), /https/);
  await assert.rejects(() => p.registerWebhook({ callbackUrl: 'not a url' }), /https/);
});

test('registerWebhook: an API error that echoes the endpoint never carries the secret (issue 356)', async () => {
  const fetchImpl = async (url, opts = {}) => {
    if (opts.method === 'POST') {
      const echoed = JSON.parse(opts.body).endpoint_url;
      return { status: 400, json: async () => ({ error: 'BAD', error_description: `rejected ${echoed} and ${encodeURIComponent(echoed)}` }) };
    }
    const path_ = url.replace(internals.API_BASE, '');
    return { status: 200, json: async () => (path_.startsWith('/users') ? fixture('organizations.json') : { webhooks: [] }) };
  };
  const p = provider({ fetchImpl });
  await assert.rejects(
    () => p.registerWebhook({ callbackUrl: CALLBACK }),
    (err) => err.message.includes('[redacted]') && !err.message.includes(SECRET) &&
      !err.message.includes(encodeURIComponent(SECRET)),
  );
});

test('registerWebhook: a subscription at the bare endpoint (no URL secret) is stale, not reused (issue 356)', async () => {
  const calls = [];
  const fetchImpl = fakeFetch({
    'GET /users/me/organizations/': fixture('organizations.json'),
    'GET /organizations/org-8001/webhooks/': {
      webhooks: [{ id: 'hook-bare', endpoint_url: CALLBACK, actions: internals.WEBHOOK_ACTIONS.join(',') }],
    },
    'POST /organizations/org-8001/webhooks/': fixture('webhook-create-response.json'),
  }, { calls });
  const p = provider({ fetchImpl });
  const result = await p.registerWebhook({ callbackUrl: CALLBACK });
  assert.equal(result.webhookId, 'hook-6666');
  assert.deepEqual(result.staleWebhookIds, ['hook-bare']);
});

test('webhookEventTypes: every action the adapter handles is registered, order.refunded included (issue 357)', () => {
  const p = provider();
  assert.ok(Array.isArray(p.webhookEventTypes));
  assert.deepEqual([...p.webhookEventTypes].sort(), Object.keys(internals.ACTION_TO_EVENT_TYPE).sort());
  assert.ok(p.webhookEventTypes.includes('order.refunded'));
});

test('registerWebhook: registers every handled action even when the caller passes a narrower list (issue 357)', async () => {
  const calls = [];
  const fetchImpl = fakeFetch({
    'GET /users/me/organizations/': fixture('organizations.json'),
    'GET /organizations/org-8001/webhooks/': fixture('webhooks-list-empty.json'),
    'POST /organizations/org-8001/webhooks/': fixture('webhook-create-response.json'),
  }, { calls });
  const p = provider({ fetchImpl });
  await p.registerWebhook({
    callbackUrl: 'https://us-central1-demo-event.cloudfunctions.net/ticketingWebhook',
    events: ['order.placed', 'order.updated', 'attendee.updated'],
  });
  const post = calls.find((c) => c.method === 'POST');
  const registered = post.body.actions.split(',');
  for (const action of Object.keys(internals.ACTION_TO_EVENT_TYPE)) {
    assert.ok(registered.includes(action), `${action} is registered`);
  }
});

test('registerWebhook: an existing subscription that lacks order.refunded is not reused (issue 357)', async () => {
  const calls = [];
  const fetchImpl = fakeFetch({
    'GET /users/me/organizations/': fixture('organizations.json'),
    // The pre-#357 registration: order.placed, order.updated, attendee.updated only.
    'GET /organizations/org-8001/webhooks/': fixture('webhooks-list-existing.json'),
    'POST /organizations/org-8001/webhooks/': fixture('webhook-create-response.json'),
  }, { calls });
  const p = provider({ fetchImpl });
  const result = await p.registerWebhook({ callbackUrl: CALLBACK, events: p.webhookEventTypes });
  assert.equal(result.webhookId, 'hook-6666');
  assert.deepEqual(result.staleWebhookIds, ['hook-5555']);
  const post = calls.find((c) => c.method === 'POST');
  assert.ok(post.body.actions.split(',').includes('order.refunded'));
});

test('registerWebhook: idempotent — an existing subscription at the same callback URL is reused, no dup POST', async () => {
  const calls = [];
  const fetchImpl = fakeFetch({
    'GET /users/me/organizations/': fixture('organizations.json'),
    'GET /organizations/org-8001/webhooks/': {
      webhooks: fixture('webhooks-list-current.json').webhooks.map((w) => ({
        ...w,
        // The fixture holds a placeholder; the stored endpoint carries this deployment's secret.
        endpoint_url: w.endpoint_url.replace(`${internals.URL_SECRET_PARAM}=fixture-placeholder`, `${internals.URL_SECRET_PARAM}=${SECRET}`),
      })),
    },
  }, { calls });
  const p = provider({ fetchImpl });
  const result = await p.registerWebhook({ callbackUrl: CALLBACK, events: ['order.placed'] });
  assert.equal(result.webhookId, 'hook-7777');
  assert.equal(calls.filter((c) => c.method === 'POST').length, 0);
});

test('registerWebhook: no organization found → throws rather than silently no-op', async () => {
  const fetchImpl = fakeFetch({
    'GET /users/me/organizations/': { organizations: [] },
  });
  const p = provider({ fetchImpl });
  await assert.rejects(
    () => p.registerWebhook({ callbackUrl: 'https://example.org/y', events: [] }),
    /no organization found/,
  );
});

test('registerWebhook: rejects an empty callbackUrl', async () => {
  const p = provider({ fetchImpl: async () => { throw new Error('should not be called'); } });
  await assert.rejects(() => p.registerWebhook({ callbackUrl: '' }), /callbackUrl/);
});

// ---------------------------------------------------------------------------
// getRegistrationPrompt — §3.5 eventbrite row
// ---------------------------------------------------------------------------

test('getRegistrationPrompt: suppressed for a speaker or already-claimed ticket', async () => {
  const p = provider();
  for (const ctx of [{ isSpeaker: true }, { hasClaimedTicket: true }]) {
    const prompt = await p.getRegistrationPrompt({ ...ctx, trigger: 'account_created' });
    assert.equal(prompt.send, false);
  }
});

test('getRegistrationPrompt: account_created, no ticket → purchase, ctaUrl from config/event.registration.externalUrl', async () => {
  const p = provider({ getConfig: async () => ({ event: { registration: { externalUrl: 'https://eventbrite.com/e/demo' } } }) });
  const prompt = await p.getRegistrationPrompt({ trigger: 'account_created' });
  assert.equal(prompt.send, true);
  assert.equal(prompt.action, 'purchase');
  assert.equal(prompt.templateId, 'ticket.get_ticket');
  assert.equal(prompt.ctaUrl, 'https://eventbrite.com/e/demo');
});

test('getRegistrationPrompt: ticket_unclaimed → claim, ctaUrl points at /ticket/claim (issue #33)', async () => {
  const p = provider({ getConfig: async () => ({ tierA: { publicUrl: 'https://summit.example.org' } }) });
  const prompt = await p.getRegistrationPrompt({ trigger: 'ticket_unclaimed' });
  assert.equal(prompt.send, true);
  assert.equal(prompt.action, 'claim');
  assert.equal(prompt.templateId, 'ticket.claim_prompt');
  assert.equal(prompt.ctaUrl, 'https://summit.example.org/ticket/claim');
});

test('getRegistrationPrompt: ticket_unclaimed with no configured public URL degrades to no CTA', async () => {
  const p = provider();
  const prompt = await p.getRegistrationPrompt({ trigger: 'ticket_unclaimed' });
  assert.equal(prompt.ctaUrl, null);
});

test('getRegistrationPrompt: no externalUrl configured → still sends, ctaUrl null', async () => {
  const p = provider({ getConfig: async () => ({}) });
  const prompt = await p.getRegistrationPrompt({ trigger: 'account_created' });
  assert.equal(prompt.send, true);
  assert.equal(prompt.ctaUrl, null);
});

// M7 issue 8: this row and the site's own register control read one field,
// through one reader (shared/registration). A config/event written before
// the https rule existed reaches here unvalidated, so a destination the
// page refuses is refused here too — in an email, nobody sees the address
// before they click it.
test('getRegistrationPrompt: a non-https destination is refused, the same as on the page', async () => {
  for (const externalUrl of [
    'http://eventbrite.com/e/demo',
    'javascript:alert(1)',
    'eventbrite.com/e/demo',
    '   ',
    42,
  ]) {
    const p = provider({ getConfig: async () => ({ event: { registration: { externalUrl } } }) });
    const prompt = await p.getRegistrationPrompt({ trigger: 'account_created' });
    assert.equal(prompt.send, true);
    assert.equal(prompt.ctaUrl, null, `expected ${JSON.stringify(externalUrl)} to be refused`);
  }
});

test('getRegistrationPrompt: the label stays this provider’s own, not the client’s form wording', async () => {
  // `actionLabel` is what a client calls their OWN registration form. This
  // row sends a reader to an Eventbrite checkout instead, so the provider
  // states its own words for it.
  const p = provider({
    getConfig: async () => ({
      event: {
        registration: {
          externalUrl: 'https://eventbrite.com/e/demo',
          actionLabel: 'Register on our site',
        },
      },
    }),
  });
  const prompt = await p.getRegistrationPrompt({ trigger: 'account_created' });
  assert.equal(prompt.ctaLabel, 'Get your ticket');
  assert.equal(prompt.ctaUrl, 'https://eventbrite.com/e/demo');
});
