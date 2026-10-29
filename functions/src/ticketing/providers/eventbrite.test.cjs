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

test('construction requires the API token, and reads externalEventId once (§3.3)', () => {
  assert.throws(
    () => createEventbriteProvider({ env: { TICKETING_WEBHOOK_SECRET: SECRET } }),
    /TICKETING_API_TOKEN/,
  );
  const p = provider();
  assert.equal(p.name, 'eventbrite');
  assert.equal(p.externalEventId, 'evt-1');
  assert.equal(typeof p.registerWebhook, 'function');
});

// Review fix 1: every ticketing function builds this provider. A short or
// missing webhook secret must cost webhooks only, never claim, verify,
// sync, or status.
for (const [label, secret] of [['missing', undefined], ['short', 'short-secret-value']]) {
  test(`a ${label} URL secret: construction succeeds and the order reads still work (issue 356)`, async () => {
    const fetchImpl = fakeFetch({ 'GET /orders/ord-2001/': fixture('order-complete.json') });
    const p = provider({ env: { TICKETING_WEBHOOK_SECRET: secret }, fetchImpl });
    assert.equal(p.name, 'eventbrite');
    assert.equal((await p.fetchOrder('ord-2001')).tickets.length, 2);
    assert.equal((await p.lookupByOrderNumber('ord-2001', 'ada.lovelace@example.com')).length, 2);
  });

  test(`a ${label} URL secret: verifyWebhook refuses, even a delivery that carries that same value (issue 356)`, async () => {
    const p = provider({ env: { TICKETING_WEBHOOK_SECRET: secret } });
    const rawBody = rawBodyFor('webhook-order-placed.json');
    for (const context of [withSecret(secret ?? ''), withSecret(SECRET), {}]) {
      const result = await p.verifyWebhook(rawBody, {}, context);
      assert.equal(result.valid, false);
      assert.equal(result.reason, 'invalid_secret');
    }
  });

  test(`a ${label} URL secret: registerWebhook throws before any API call and never prints it (issue 356)`, async () => {
    let called = false;
    const p = provider({ env: { TICKETING_WEBHOOK_SECRET: secret }, fetchImpl: async () => { called = true; } });
    await assert.rejects(
      () => p.registerWebhook({ callbackUrl: CALLBACK }),
      (err) => /TICKETING_WEBHOOK_SECRET of at least 32 characters/.test(err.message) &&
        (secret === undefined || !err.message.includes(secret)),
    );
    assert.equal(called, false);
  });
}

test('the minimum URL secret length is 32 characters', () => {
  assert.equal(internals.MIN_WEBHOOK_SECRET_LENGTH, 32);
});

test('every webhook fixture body holds the placeholder token, never a real one (review fix 2)', () => {
  const fs = require('node:fs');
  const names = fs.readdirSync(FIXTURES).filter((n) => /^webhook.*\.json$/.test(n));
  assert.ok(names.length >= 8);
  for (const name of names) {
    const url = fixture(name)?.config?.endpoint_url ?? fixture(name)?.endpoint_url;
    if (url === undefined) continue;
    assert.equal(new URL(url).searchParams.get(internals.URL_SECRET_PARAM), 'fixture-placeholder', name);
  }
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
  assert.match(result.deliveryId, /^[0-9a-f-]{36}$/);
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

test('verifyWebhook: the query parser Functions uses (Express 4) — repeated, bracketed, and encoded tokens (review fix 7)', async () => {
  const express = require('express');
  const parse = express().get('query parser fn');
  const p = provider();
  const rawBody = rawBodyFor('webhook-order-placed.json');
  const check = (qs) => p.verifyWebhook(rawBody, {}, { query: parse(qs) });
  const param = internals.URL_SECRET_PARAM;

  assert.equal((await check(`${param}=${SECRET}`)).valid, true, 'plain');
  assert.equal((await check(`${param}=${SECRET}&${param}=${SECRET}`)).reason, 'invalid_secret', 'repeated');
  assert.equal((await check(`${param}[]=${SECRET}`)).reason, 'invalid_secret', 'bracketed array');
  assert.equal((await check(`${param}[0]=${SECRET}`)).reason, 'invalid_secret', 'indexed array');
  assert.equal((await check(`${param}[a]=${SECRET}`)).reason, 'invalid_secret', 'object');
  assert.equal((await check(`${param}=${SECRET}%00`)).reason, 'invalid_secret', 'trailing encoded byte');
  assert.equal((await check(`${param}=`)).reason, 'invalid_secret', 'empty');

  // A secret with characters that need encoding round-trips through the
  // URL registerWebhook builds and the parser the handler sees.
  const odd = 'a+b/c=d&e%f g?h#i-0123456789abcdef0123456789';
  const q = new URL(internals.endpointUrlFor(CALLBACK, odd)).search.slice(1);
  const oddProvider = provider({ env: { TICKETING_WEBHOOK_SECRET: odd } });
  assert.equal((await oddProvider.verifyWebhook(rawBody, {}, { query: parse(q) })).valid, true, 'encoded round trip');
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
  assert.notEqual(ra.deliveryId, rb.deliveryId, 'separate receipts -> different delivery id');
});

test('verifyWebhook: byte-identical notifications get separate receipt IDs', async () => {
  const p = provider();
  const r1 = await verify(p, 'webhook-order-placed.json');
  const r2 = await verify(p, 'webhook-order-placed.json');
  assert.notEqual(r1.deliveryId, r2.deliveryId);
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

/** An authenticated delivery the adapter cannot act on: 200 + ignored, so Eventbrite stops retrying. */
function assertIgnored(result, label) {
  assert.equal(result.valid, true, `${label}: authenticated`);
  assert.equal(result.resourceId, null, `${label}: no order to fetch`);
  assert.equal(result.deliveryId.length, 36);
}

test('verifyWebhook: malformed JSON with the right secret is acknowledged and ignored, not refused (review fix 6)', async () => {
  const p = provider();
  assertIgnored(await p.verifyWebhook(Buffer.from('not json{{{', 'utf8'), {}, withSecret()), 'malformed JSON');
});

test('verifyWebhook: an unknown api_url shape with the right secret is ignored, not refused (review fix 6)', async () => {
  const p = provider();
  assertIgnored(await verifyBody(p, { config: { action: 'order.placed' }, api_url: 'nope' }), 'nope');
  assertIgnored(await verifyBody(p, { config: { action: 'order.placed' } }), 'no api_url');
  assertIgnored(await verifyBody(p, { api_url: 'https://www.eventbriteapi.com/v3/orders/ord-1/' }), 'no action');
  assertIgnored(await verifyBody(p, {
    config: { action: 'order.placed' }, api_url: 'https://www.eventbriteapi.com/v3/events/evt-1/',
  }), 'event resource');
});

test('verifyWebhook: the documented /v3/orders/{id}/ form resolves the order (review fix 6)', async () => {
  let called = false;
  const p = provider({ fetchImpl: async () => { called = true; } });
  const result = await verify(p, 'webhook-order-placed-order-path.json');
  assert.equal(result.valid, true);
  assert.equal(result.eventType, 'order.placed');
  assert.equal(result.resourceId, 'ord-2001');
  assert.equal(called, false, 'no fetch: the event is checked when sync re-fetches the order');
});

test('verifyWebhook: the attendee form maps to its order through the API host, never the delivered URL (review fix 6)', async () => {
  const calls = [];
  const fetchImpl = fakeFetch({ 'GET /events/evt-1/attendees/att-5001/': fixture('attendee.json') }, { calls });
  const p = provider({ fetchImpl });
  const result = await verify(p, 'webhook-attendee-updated-attendee-path.json');
  assert.equal(result.valid, true);
  assert.equal(result.eventType, 'attendee.updated');
  assert.equal(result.resourceId, 'ord-2001');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${internals.API_BASE}/events/evt-1/attendees/att-5001/`);
});

test('verifyWebhook: an attendee not readable yet (404 or no order_id) throws, so Eventbrite retries (Codex 5)', async () => {
  for (const entry of [{ status: 404, body: {} }, { id: 'att-5001', event_id: 'evt-1' }]) {
    const fetchImpl = fakeFetch({ 'GET /events/evt-1/attendees/att-5001/': entry });
    const p = provider({ fetchImpl });
    await assert.rejects(() => verify(p, 'webhook-attendee-updated-attendee-path.json'), /not readable yet/);
  }
});

test('verifyWebhook: an unhandled action is ignored before any attendee read (Codex 4)', async () => {
  let called = false;
  const p = provider({ fetchImpl: async () => { called = true; throw new Error('no fetch'); } });
  const result = await verifyBody(p, {
    config: { action: 'attendee.checked_in' },
    api_url: 'https://www.eventbriteapi.com/v3/events/evt-1/attendees/att-5001/',
  });
  assertIgnored(result, 'unhandled action');
  assert.equal(result.eventType, 'unknown');
  assert.equal(called, false);
});

test('verifyWebhook: an attendee for another event is wrong_event, with no API call', async () => {
  let called = false;
  const p = provider({ fetchImpl: async () => { called = true; } });
  const result = await verifyBody(p, {
    config: { action: 'attendee.updated' },
    api_url: 'https://www.eventbriteapi.com/v3/events/evt-OTHER/attendees/att-1/',
  });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'wrong_event');
  assert.equal(called, false);
});

test('verifyWebhook: api_url must name Eventbrite\'s own API host over https (no SSRF, issue 356)', async () => {
  let called = false;
  const p = provider({ fetchImpl: async () => { called = true; } });
  const order = '/v3/events/evt-1/orders/ord-1/';
  for (const apiUrl of [
    `https://attacker.example${order}`,
    `https://www.eventbriteapi.com.attacker.example${order}`,
    `https://attacker.example/?u=https://www.eventbriteapi.com${order}`,
    `http://www.eventbriteapi.com${order}`,
    `https://www.eventbriteapi.com:8443${order}`,
    `https://user:pass@www.eventbriteapi.com${order}`,
    `https://169.254.169.254${order}`,
    'https://attacker.example/v3/orders/ord-1/',
    'https://attacker.example/v3/events/evt-1/attendees/att-1/',
    `https://www.eventbriteapi.com/v3/events/evt-1/orders/ord-1/extra/`,
    `https://www.eventbriteapi.com/v2/events/evt-1/orders/ord-1/`,
  ]) {
    // Authenticated, so acknowledged; but no order id and no fetch.
    assertIgnored(await verifyBody(p, { config: { action: 'order.placed' }, api_url: apiUrl }), apiUrl);
  }
  assert.equal(called, false);
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

test('registerWebhook: a secret with ~, ! and a space never leaks through an echoed endpoint URL (Codex 1)', async () => {
  const odd = 'abc~def!ghi jkl-0123456789abcdef0123';
  assert.ok(odd.length >= internals.MIN_WEBHOOK_SECRET_LENGTH);
  const fetchImpl = async (url, opts = {}) => {
    if (opts.method === 'POST') {
      const sent = JSON.parse(opts.body).endpoint_url;
      // Echo the URL as sent (URLSearchParams form: %7E, %21, +), decoded,
      // and re-encoded, the way an API error message might.
      const description = [
        `rejected ${sent}`,
        `decoded ${decodeURIComponent(sent)}`,
        `as ${encodeURI(decodeURIComponent(sent))}.`,
        `field token=${new URL(sent).searchParams.get('token')}`,
      ].join(' | ');
      return { status: 400, json: async () => ({ error: 'BAD', error_description: description }) };
    }
    const path_ = url.replace(internals.API_BASE, '');
    return { status: 200, json: async () => (path_.startsWith('/users') ? fixture('organizations.json') : { webhooks: [] }) };
  };
  const p = provider({ env: { TICKETING_WEBHOOK_SECRET: odd }, fetchImpl });
  let message = '';
  await assert.rejects(() => p.registerWebhook({ callbackUrl: CALLBACK }), (err) => { message = err.message; return true; });
  const serialized = new URLSearchParams({ token: odd }).toString().slice('token='.length);
  for (const form of [odd, encodeURIComponent(odd), serialized, encodeURI(odd), 'ghi jkl', 'ghi+jkl', 'ghi%20jkl']) {
    assert.equal(message.includes(form), false, `message must not contain ${form}`);
  }
  assert.match(message, /redacted/);
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

test('registerWebhook: staleWebhookIds lists every other same-endpoint id, even when one is reused (review fix 3)', async () => {
  const keep = { id: 'hook-keep', endpoint_url: `${CALLBACK}?token=${SECRET}`, actions: internals.WEBHOOK_ACTIONS.join(','), event_id: 'evt-1' };
  const fetchImpl = fakeFetch({
    'GET /users/me/organizations/': fixture('organizations.json'),
    'GET /organizations/org-8001/webhooks/': {
      webhooks: [
        { id: 'hook-bare', endpoint_url: CALLBACK, actions: 'order.placed' },
        keep,
        { id: 'hook-dup', endpoint_url: `${CALLBACK}?token=${SECRET}`, actions: internals.WEBHOOK_ACTIONS.join(','), event_id: 'evt-1' },
        { id: 'hook-elsewhere', endpoint_url: 'https://other.example.org/hooks', actions: 'order.placed' },
      ],
    },
  });
  const p = provider({ fetchImpl });
  const result = await p.registerWebhook({ callbackUrl: CALLBACK });
  assert.equal(result.webhookId, 'hook-keep');
  assert.deepEqual(result.staleWebhookIds, ['hook-bare', 'hook-dup']);
});

test('registerWebhook: a stored URL Eventbrite normalized (host case, param order, encoding) is still reused (review fix 4)', async () => {
  const calls = [];
  const fetchImpl = fakeFetch({
    'GET /users/me/organizations/': fixture('organizations.json'),
    'GET /organizations/org-8001/webhooks/': {
      webhooks: [{
        id: 'hook-norm',
        endpoint_url: `https://US-Central1-Demo-Event.cloudfunctions.net/ticketingWebhook?${internals.URL_SECRET_PARAM}=${encodeURIComponent(SECRET)}&tenant=a%20b`,
        actions: internals.WEBHOOK_ACTIONS.join(','),
        event_id: 'evt-1',
      }],
    },
  }, { calls });
  const p = provider({ fetchImpl });
  const result = await p.registerWebhook({ callbackUrl: `${CALLBACK}?tenant=a+b` });
  assert.equal(result.webhookId, 'hook-norm');
  assert.deepEqual(result.staleWebhookIds, []);
  assert.equal(calls.filter((c) => c.method === 'POST').length, 0);
});

test('registerWebhook: a changed non-secret query parameter is a different endpoint, not a reuse (Codex 3)', async () => {
  const calls = [];
  const fetchImpl = fakeFetch({
    'GET /users/me/organizations/': fixture('organizations.json'),
    'GET /organizations/org-8001/webhooks/': {
      webhooks: [{
        id: 'hook-tenant-old',
        endpoint_url: `${CALLBACK}?tenant=old&${internals.URL_SECRET_PARAM}=${SECRET}`,
        actions: internals.WEBHOOK_ACTIONS.join(','),
        event_id: 'evt-1',
      }],
    },
    'POST /organizations/org-8001/webhooks/': fixture('webhook-create-response.json'),
  }, { calls });
  const p = provider({ fetchImpl });
  const result = await p.registerWebhook({ callbackUrl: `${CALLBACK}?tenant=new` });
  assert.equal(result.webhookId, 'hook-6666');
  assert.deepEqual(result.staleWebhookIds, [], 'another endpoint is not ours to call stale');
  const post = calls.find((c) => c.method === 'POST');
  assert.equal(new URL(post.body.endpoint_url).searchParams.get('tenant'), 'new');
});

test('internals.endpointKey ignores the token and param order, and keeps every other param', () => {
  const key = internals.endpointKey;
  assert.equal(key(`${CALLBACK}?a=1&b=2&token=x`), key(`${CALLBACK.toUpperCase().replace('TICKETINGWEBHOOK', 'ticketingWebhook')}?b=2&a=1`));
  assert.notEqual(key(`${CALLBACK}?a=1`), key(`${CALLBACK}?a=2`));
  assert.notEqual(key(`${CALLBACK}?a=1`), key(CALLBACK));
  assert.equal(key('not a url'), '');
});

test('registerWebhook: a same-endpoint subscription with another secret is stale', async () => {
  const fetchImpl = fakeFetch({
    'GET /users/me/organizations/': fixture('organizations.json'),
    'GET /organizations/org-8001/webhooks/': {
      webhooks: [{ id: 'hook-old-secret', endpoint_url: `${CALLBACK}?token=an-older-secret-0123456789abcdef0123`, actions: internals.WEBHOOK_ACTIONS.join(','), event_id: 'evt-1' }],
    },
    'POST /organizations/org-8001/webhooks/': fixture('webhook-create-response.json'),
  });
  const p = provider({ fetchImpl });
  const result = await p.registerWebhook({ callbackUrl: CALLBACK });
  assert.equal(result.webhookId, 'hook-6666');
  assert.deepEqual(result.staleWebhookIds, ['hook-old-secret']);
});

test('registerWebhook: follows pagination.continuation through the webhook list (review fix 5)', async () => {
  const calls = [];
  const fetchImpl = fakeFetch({
    'GET /users/me/organizations/': fixture('organizations.json'),
    'GET /organizations/org-8001/webhooks/?continuation=hooks-cont-2': {
      webhooks: fixture('webhooks-list-current.json').webhooks.map((w) => ({
        ...w,
        endpoint_url: w.endpoint_url.replace(`${internals.URL_SECRET_PARAM}=fixture-placeholder`, `${internals.URL_SECRET_PARAM}=${SECRET}`),
      })),
      pagination: { has_more_items: false },
    },
    'GET /organizations/org-8001/webhooks/': fixture('webhooks-list-page-1.json'),
  }, { calls });
  const p = provider({ fetchImpl });
  const result = await p.registerWebhook({ callbackUrl: CALLBACK });
  assert.equal(result.webhookId, 'hook-7777');
  assert.equal(calls.filter((c) => c.method === 'POST').length, 0);
  assert.equal(calls.filter((c) => c.path.startsWith('/organizations/org-8001/webhooks/')).length, 2);
});

test('registerWebhook: an org-wide subscription (no event_id) is stale when the deployment is scoped to an event (Codex 2)', async () => {
  const calls = [];
  const fetchImpl = fakeFetch({
    'GET /users/me/organizations/': fixture('organizations.json'),
    'GET /organizations/org-8001/webhooks/': {
      webhooks: [
        { id: 'hook-unscoped', endpoint_url: `${CALLBACK}?token=${SECRET}`, actions: internals.WEBHOOK_ACTIONS.join(',') },
        { id: 'hook-empty-event', endpoint_url: `${CALLBACK}?token=${SECRET}`, actions: internals.WEBHOOK_ACTIONS.join(','), event_id: '' },
      ],
    },
    'POST /organizations/org-8001/webhooks/': fixture('webhook-create-response.json'),
  }, { calls });
  const p = provider({ fetchImpl });
  const result = await p.registerWebhook({ callbackUrl: CALLBACK });
  assert.equal(result.webhookId, 'hook-6666');
  assert.deepEqual(result.staleWebhookIds, ['hook-unscoped', 'hook-empty-event']);
  assert.equal(calls.find((c) => c.method === 'POST').body.event_id, 'evt-1');
});

test('registerWebhook: an unscoped deployment reuses only an unscoped subscription (Codex 2)', async () => {
  const fetchImpl = fakeFetch({
    'GET /users/me/organizations/': fixture('organizations.json'),
    'GET /organizations/org-8001/webhooks/': {
      webhooks: [
        { id: 'hook-scoped', endpoint_url: `${CALLBACK}?token=${SECRET}`, actions: internals.WEBHOOK_ACTIONS.join(','), event_id: 'evt-1' },
        { id: 'hook-unscoped', endpoint_url: `${CALLBACK}?token=${SECRET}`, actions: internals.WEBHOOK_ACTIONS.join(',') },
      ],
    },
  });
  const p = provider({ env: { EVENT_TICKETING_EVENT_ID: '' }, fetchImpl });
  const result = await p.registerWebhook({ callbackUrl: CALLBACK });
  assert.equal(result.webhookId, 'hook-unscoped');
  assert.deepEqual(result.staleWebhookIds, ['hook-scoped']);
});

test('registerWebhook: a subscription bound to another event is not reused (review note 8)', async () => {
  const fetchImpl = fakeFetch({
    'GET /users/me/organizations/': fixture('organizations.json'),
    'GET /organizations/org-8001/webhooks/': {
      webhooks: [{ id: 'hook-old-event', endpoint_url: `${CALLBACK}?token=${SECRET}`, actions: internals.WEBHOOK_ACTIONS.join(','), event_id: 'evt-OLD' }],
    },
    'POST /organizations/org-8001/webhooks/': fixture('webhook-create-response.json'),
  });
  const p = provider({ fetchImpl });
  const result = await p.registerWebhook({ callbackUrl: CALLBACK });
  assert.equal(result.webhookId, 'hook-6666');
  assert.deepEqual(result.staleWebhookIds, ['hook-old-event']);
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
