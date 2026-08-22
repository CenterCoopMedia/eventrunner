'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { createEventbriteProvider, internals } = require('./eventbrite.cjs');

const FIXTURES = path.join(__dirname, '__fixtures__');
const fixture = (name) => require(path.join(FIXTURES, name));

const SECRET = 'fixture-webhook-secret';
const TOKEN = 'fixture-api-token';

function rawBodyFor(name) {
  return Buffer.from(JSON.stringify(fixture(name)), 'utf8');
}

function signedHeaders(name, secret = SECRET) {
  const rawBody = rawBodyFor(name);
  return { rawBody, headers: { 'X-Eventbrite-Signature': internals.signBody(secret, rawBody) } };
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
    calls.push({ method, path: path_ });
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

// ---------------------------------------------------------------------------
// verifyWebhook — signature verification is security-critical
// ---------------------------------------------------------------------------

test('verifyWebhook: valid signature, order.placed → valid with derived deliveryId/resourceId', async () => {
  const p = provider();
  const { rawBody, headers } = signedHeaders('webhook-order-placed.json');
  const result = await p.verifyWebhook(rawBody, headers);
  assert.equal(result.valid, true);
  assert.equal(result.eventType, 'order.placed');
  assert.equal(result.resourceId, 'ord-2001');
  assert.equal(result.deliveryId, internals.deliveryIdFor(rawBody));
  assert.equal(result.deliveryId.length, 64); // sha256 hex
});

test('verifyWebhook: header lookup is case-insensitive (HTTP headers are)', async () => {
  const p = provider();
  const { rawBody, headers } = signedHeaders('webhook-order-placed.json');
  const lower = { 'x-eventbrite-signature': headers['X-Eventbrite-Signature'] };
  const result = await p.verifyWebhook(rawBody, lower);
  assert.equal(result.valid, true);
});

test('verifyWebhook: two distinct deliveries about the same order get different deliveryIds (judgment call 2)', async () => {
  const p = provider();
  const a = signedHeaders('webhook-order-updated.json');
  const b = signedHeaders('webhook-order-updated-2.json');
  const ra = await p.verifyWebhook(a.rawBody, a.headers);
  const rb = await p.verifyWebhook(b.rawBody, b.headers);
  assert.equal(ra.valid, true);
  assert.equal(rb.valid, true);
  assert.equal(ra.resourceId, rb.resourceId, 'same order');
  assert.notEqual(ra.deliveryId, rb.deliveryId, 'different bytes -> different delivery id');
});

test('verifyWebhook: a byte-identical retry produces the SAME deliveryId (dedup collapses it)', async () => {
  const p = provider();
  const first = signedHeaders('webhook-order-placed.json');
  const retry = signedHeaders('webhook-order-placed.json');
  const r1 = await p.verifyWebhook(first.rawBody, first.headers);
  const r2 = await p.verifyWebhook(retry.rawBody, retry.headers);
  assert.equal(r1.deliveryId, r2.deliveryId);
});

test('verifyWebhook: order.refunded folds into eventType order.updated (judgment call 4)', async () => {
  const p = provider();
  const { rawBody, headers } = signedHeaders('webhook-order-refunded.json');
  const result = await p.verifyWebhook(rawBody, headers);
  assert.equal(result.valid, true);
  assert.equal(result.eventType, 'order.updated');
  assert.equal(result.resourceId, 'ord-3003');
});

test('verifyWebhook: attendee.updated is actionable and resolves the order id (judgment call 3)', async () => {
  const p = provider();
  const { rawBody, headers } = signedHeaders('webhook-attendee-updated.json');
  const result = await p.verifyWebhook(rawBody, headers);
  assert.equal(result.valid, true);
  assert.equal(result.eventType, 'attendee.updated');
  assert.equal(result.resourceId, 'ord-2001');
});

test('verifyWebhook: wrong-event delivery → valid: false, reason: wrong_event (§3.3 step 1)', async () => {
  const p = provider();
  const { rawBody, headers } = signedHeaders('webhook-wrong-event.json');
  const result = await p.verifyWebhook(rawBody, headers);
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'wrong_event');
  // Still keyable — the webhook handler needs eventType/resourceId even on
  // a refusal ONLY for the wrong_event branch's own bookkeeping; the field
  // presence itself must not throw.
  assert.equal(result.eventType, 'order.placed');
});

test('verifyWebhook: missing signature header → invalid, never a signature oracle', async () => {
  const p = provider();
  const rawBody = rawBodyFor('webhook-order-placed.json');
  const result = await p.verifyWebhook(rawBody, {});
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'invalid_signature');
});

test('verifyWebhook: wrong secret / tampered body → invalid_signature', async () => {
  const p = provider();
  const rawBody = rawBodyFor('webhook-order-placed.json');
  const badSig = internals.signBody('not-the-real-secret', rawBody);
  const result = await p.verifyWebhook(rawBody, { 'X-Eventbrite-Signature': badSig });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'invalid_signature');

  const tamperedBody = Buffer.from(rawBody.toString('utf8').replace('ord-2001', 'ord-9999'), 'utf8');
  const goodSigOverOriginal = internals.signBody(SECRET, rawBody);
  const result2 = await p.verifyWebhook(tamperedBody, { 'X-Eventbrite-Signature': goodSigOverOriginal });
  assert.equal(result2.valid, false);
  assert.equal(result2.reason, 'invalid_signature');
});

test('verifyWebhook: constant-time compare path — a signature of the right length but wrong bytes still refuses', async () => {
  const p = provider();
  const rawBody = rawBodyFor('webhook-order-placed.json');
  const real = internals.signBody(SECRET, rawBody);
  // Flip the last hex character: same length, wrong value. This exercises
  // the timingSafeEqual branch rather than the length-guard branch.
  const flipped = real.slice(0, -1) + (real.at(-1) === '0' ? '1' : '0');
  const result = await p.verifyWebhook(rawBody, { 'X-Eventbrite-Signature': flipped });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'invalid_signature');
});

test('verifyWebhook: malformed JSON body → reason malformed, even with a valid signature over those bytes', async () => {
  const p = provider();
  const rawBody = Buffer.from('not json{{{', 'utf8');
  const sig = internals.signBody(SECRET, rawBody);
  const result = await p.verifyWebhook(rawBody, { 'X-Eventbrite-Signature': sig });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'malformed');
});

test('verifyWebhook: valid JSON but unrecognized shape (no api_url match) → malformed', async () => {
  const p = provider();
  const rawBody = Buffer.from(JSON.stringify({ config: { action: 'order.placed' }, api_url: 'nope' }), 'utf8');
  const sig = internals.signBody(SECRET, rawBody);
  const result = await p.verifyWebhook(rawBody, { 'X-Eventbrite-Signature': sig });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'malformed');
});

test('verifyWebhook: an unrecognized action still verifies (signature+shape ok) but maps to eventType unknown', async () => {
  const p = provider();
  const body = { config: { action: 'venue.updated' }, api_url: 'https://www.eventbriteapi.com/v3/events/evt-1/orders/ord-1/' };
  const rawBody = Buffer.from(JSON.stringify(body), 'utf8');
  const sig = internals.signBody(SECRET, rawBody);
  const result = await p.verifyWebhook(rawBody, { 'X-Eventbrite-Signature': sig });
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

test('registerWebhook: no existing subscription → creates one', async () => {
  const calls = [];
  const fetchImpl = fakeFetch({
    'GET /users/me/organizations/': fixture('organizations.json'),
    'GET /organizations/org-8001/webhooks/': fixture('webhooks-list-empty.json'),
    'POST /organizations/org-8001/webhooks/': fixture('webhook-create-response.json'),
  }, { calls });
  const p = provider({ fetchImpl });
  const result = await p.registerWebhook({
    callbackUrl: 'https://us-central1-demo-event.cloudfunctions.net/ticketingWebhook',
    events: ['order.placed', 'order.updated', 'attendee.updated'],
  });
  assert.equal(result.webhookId, 'hook-6666');
  assert.ok(calls.some((c) => c.method === 'POST'));
});

test('registerWebhook: idempotent — an existing subscription at the same callback URL is reused, no dup POST', async () => {
  const calls = [];
  const fetchImpl = fakeFetch({
    'GET /users/me/organizations/': fixture('organizations.json'),
    'GET /organizations/org-8001/webhooks/': fixture('webhooks-list-existing.json'),
  }, { calls });
  const p = provider({ fetchImpl });
  const result = await p.registerWebhook({
    callbackUrl: 'https://us-central1-demo-event.cloudfunctions.net/ticketingWebhook',
    events: ['order.placed'],
  });
  assert.equal(result.webhookId, 'hook-5555');
  assert.equal(calls.filter((c) => c.method === 'POST').length, 0);
});

test('registerWebhook: no organization found → throws rather than silently no-op', async () => {
  const fetchImpl = fakeFetch({
    'GET /users/me/organizations/': { organizations: [] },
  });
  const p = provider({ fetchImpl });
  await assert.rejects(
    () => p.registerWebhook({ callbackUrl: 'https://x/y', events: [] }),
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

test('getRegistrationPrompt: ticket_unclaimed → claim, no CTA url yet (issue #33 builds the page)', async () => {
  const p = provider();
  const prompt = await p.getRegistrationPrompt({ trigger: 'ticket_unclaimed' });
  assert.equal(prompt.send, true);
  assert.equal(prompt.action, 'claim');
  assert.equal(prompt.templateId, 'ticket.claim_prompt');
  assert.equal(prompt.ctaUrl, null);
});

test('getRegistrationPrompt: no externalUrl configured → still sends, ctaUrl null', async () => {
  const p = provider({ getConfig: async () => ({}) });
  const prompt = await p.getRegistrationPrompt({ trigger: 'account_created' });
  assert.equal(prompt.send, true);
  assert.equal(prompt.ctaUrl, null);
});
