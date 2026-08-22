'use strict';

/**
 * End-to-end: a synthetic Eventbrite webhook delivery produces a claimed
 * ticket and a recomputed entitlement (issue #30's "done when"), driving
 * the REAL modules — webhook.cjs, sync.cjs, registration.cjs,
 * entitlement.cjs — against the REAL eventbrite adapter, with only the
 * network (fetch) faked, over the fixtures in
 * `providers/__fixtures__/`. No emulator; the in-memory `firestoreFake`
 * stands in for Firestore the same way every other ticketing test in this
 * directory does.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { makeFakeDb } = require('../cms/firestoreFake.cjs');
const { createTicketingWebhookHandler } = require('./webhook.cjs');
const { drainTicketSyncQueue } = require('./sync.cjs');
const { claimTicketsForUser } = require('./registration.cjs');
const { recomputeEntitlement } = require('./entitlement.cjs');
const { createEventbriteProvider, internals: eventbriteInternals } = require('./providers/eventbrite.cjs');

const FIXTURES = path.join(__dirname, 'providers', '__fixtures__');
const fixture = (name) => require(path.join(FIXTURES, name));

const SECRET = 'fixture-webhook-secret';
const TOKEN = 'fixture-api-token';
const QUIET = { warn() {}, error() {}, info() {} };

function makeRes() {
  const res = {
    statusCode: null,
    body: null,
    set() { return res; },
    status(code) { res.statusCode = code; return res; },
    json(payload) { res.body = payload; return res; },
  };
  return res;
}

function signedWebhookRequest(fixtureName) {
  const rawBody = Buffer.from(JSON.stringify(fixture(fixtureName)), 'utf8');
  const headers = { 'X-Eventbrite-Signature': eventbriteInternals.signBody(SECRET, rawBody) };
  return { method: 'POST', rawBody, headers, body: fixture(fixtureName) };
}

/** Route-table fake fetch, same shape as providers/eventbrite.test.cjs's. */
function fakeFetch(routes) {
  return async (url, opts = {}) => {
    const method = opts.method || 'GET';
    const fullPath = url.replace(eventbriteInternals.API_BASE, '');
    const key = `${method} ${fullPath}`;
    const entry = routes[key] ?? routes[`${method} ${fullPath.split('?')[0]}`];
    if (entry === undefined) throw new Error(`fakeFetch: no route for ${key}`);
    const status = entry.status ?? 200;
    const body = entry.body ?? entry;
    return { status, json: async () => body };
  };
}

test('synthetic Eventbrite webhook run: order.placed → queued → fetched → tickets upserted → claimed → entitled', async () => {
  const db = makeFakeDb({
    // The claimant already has an account, mid-registration (§3.4: pending).
    'users/uid-ada': { registrationStatus: 'pending', approvalSource: null },
  });
  const getConfig = async () => ({ features: { autoApproveTicketHolders: false } });

  const fetchImpl = fakeFetch({
    // First drain: the order is still processing (eventual consistency).
    'GET /orders/ord-2001/': fixture('order-processing.json'),
  });
  const provider = createEventbriteProvider({
    env: { TICKETING_API_TOKEN: TOKEN, TICKETING_WEBHOOK_SECRET: SECRET, EVENT_TICKETING_EVENT_ID: 'evt-1' },
    fetchImpl,
    getConfig,
  });

  // 1. Webhook delivery: order.placed. Claimed + enqueued in one transaction.
  const webhookHandler = createTicketingWebhookHandler({ db, provider, log: QUIET });
  const res1 = makeRes();
  await webhookHandler(signedWebhookRequest('webhook-order-placed.json'), res1);
  assert.equal(res1.statusCode, 200);
  assert.equal(res1.body.enqueued, true);
  assert.ok(db.read('ticket_webhook_deliveries', eventbriteInternals.deliveryIdFor(
    Buffer.from(JSON.stringify(fixture('webhook-order-placed.json')), 'utf8'),
  )));
  const queueRowAfterWebhook = db.read('ticket_sync_queue', 'ord-2001');
  assert.equal(queueRowAfterWebhook.status, 'pending');

  // 2. A retried delivery about the same order (order.updated) collapses
  // onto the SAME queue row, not a second one — §3.3's "not a collision".
  const res2 = makeRes();
  await webhookHandler(signedWebhookRequest('webhook-order-updated.json'), res2);
  assert.equal(res2.statusCode, 200);
  assert.equal(res2.body.enqueued, true, 'a distinct delivery about the same order still enqueues');
  assert.equal(db.read('ticket_sync_queue', 'ord-2001').lastDeliveryId, eventbriteInternals.deliveryIdFor(
    Buffer.from(JSON.stringify(fixture('webhook-order-updated.json')), 'utf8'),
  ));

  // 3. First drain: the provider still reports the order as processing —
  // no tickets yet, row stays pending for a retry (§3.3 step 3).
  const drain1 = await drainTicketSyncQueue({ db, provider, now: () => new Date(), log: QUIET });
  assert.equal(drain1.retried, 1);
  assert.equal(drain1.completed, 0);
  assert.equal(db.read('tickets', 'att-5001'), undefined, 'no ticket yet — order was still processing');

  // 4. The order finishes processing. Second drain fetches the complete
  // order and upserts both attendees into tickets/{externalId}.
  const fetchImpl2 = fakeFetch({ 'GET /orders/ord-2001/': fixture('order-complete.json') });
  const providerReady = createEventbriteProvider({
    env: { TICKETING_API_TOKEN: TOKEN, TICKETING_WEBHOOK_SECRET: SECRET, EVENT_TICKETING_EVENT_ID: 'evt-1' },
    fetchImpl: fetchImpl2,
    getConfig,
  });
  // Bypass the queue's backoff for the test — readyAt was pushed into the
  // future by drain1's lease-first write (spec §3.3's crash-safety design).
  await db.collection('ticket_sync_queue').doc('ord-2001').set({ readyAt: new Date(0) }, { merge: true });
  const drain2 = await drainTicketSyncQueue({ db, provider: providerReady, now: () => new Date(), log: QUIET });
  assert.equal(drain2.completed, 1);
  assert.equal(db.read('ticket_sync_queue', 'ord-2001'), undefined, 'completed rows are deleted');

  const ticket1 = db.read('tickets', 'att-5001');
  assert.ok(ticket1);
  assert.equal(ticket1.email, 'ada.lovelace@example.com');
  assert.equal(ticket1.status, 'valid');
  assert.equal(ticket1.provider, 'eventbrite');
  assert.equal(ticket1.claimedByUid, null, 'upsert never claims — claiming is a separate, deliberate step');

  const ticket2 = db.read('tickets', 'att-5002');
  assert.ok(ticket2);
  assert.equal(ticket2.email, 'grace.hopper@example.com');

  // 5. Self-service (or admin) claim: the account claims its ticket.
  const claimResult = await claimTicketsForUser({
    db, uid: 'uid-ada', email: 'ada.lovelace@example.com', externalIds: ['att-5001'], getConfig,
  });
  assert.deepEqual(claimResult.claimed, ['att-5001']);
  assert.equal(claimResult.registrationStatus, 'ticketed');
  assert.equal(db.read('tickets', 'att-5001').claimedByUid, 'uid-ada');

  // 6. Entitlement recomputes true for a valid claimed ticket (§3.4).
  const entitlement = await recomputeEntitlement({ db, uid: 'uid-ada', getConfig });
  assert.equal(entitlement.registrationStatus, 'ticketed');
  assert.equal(db.read('users', 'uid-ada').registrationStatus, 'ticketed');
});

test('synthetic Eventbrite webhook run: a refund revokes entitlement, no valid ticket remains', async () => {
  const db = makeFakeDb({
    'users/uid-marie': {
      registrationStatus: 'approved', approvalSource: 'ticket',
    },
    'tickets/att-7001': {
      externalId: 'att-7001', orderId: 'ord-3003', email: 'marie.curie@example.com',
      status: 'valid', provider: 'eventbrite', claimedByUid: 'uid-marie', claimedAt: new Date(),
      claimPromptSentAt: null, createdAt: new Date(), updatedAt: new Date(),
    },
  });
  const getConfig = async () => ({ features: { autoApproveTicketHolders: false } });

  const fetchImpl = fakeFetch({ 'GET /orders/ord-3003/': fixture('order-refunded.json') });
  const provider = createEventbriteProvider({
    env: { TICKETING_API_TOKEN: TOKEN, TICKETING_WEBHOOK_SECRET: SECRET, EVENT_TICKETING_EVENT_ID: 'evt-1' },
    fetchImpl,
    getConfig,
  });

  // order.refunded folds into eventType order.updated (judgment call 4) —
  // still actionable, still enqueues.
  const webhookHandler = createTicketingWebhookHandler({ db, provider, log: QUIET });
  const res = makeRes();
  await webhookHandler(signedWebhookRequest('webhook-order-refunded.json'), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.enqueued, true);

  const drain = await drainTicketSyncQueue({ db, provider, now: () => new Date(), log: QUIET });
  assert.equal(drain.completed, 1);
  assert.equal(db.read('tickets', 'att-7001').status, 'refunded');
  // The claim survives the status flip — recompute is what reacts to it.
  assert.equal(db.read('tickets', 'att-7001').claimedByUid, 'uid-marie');

  const entitlement = await recomputeEntitlement({ db, uid: 'uid-marie', getConfig });
  assert.equal(entitlement.registrationStatus, 'revoked');
  assert.equal(entitlement.approvalSource, null, 'a ticket-sourced approval does not survive its own refund (§3.4)');
});

test('a wrong-event delivery is acknowledged and ignored, never enqueued (§3.3 step 1)', async () => {
  const db = makeFakeDb();
  const provider = createEventbriteProvider({
    env: { TICKETING_API_TOKEN: TOKEN, TICKETING_WEBHOOK_SECRET: SECRET, EVENT_TICKETING_EVENT_ID: 'evt-1' },
    fetchImpl: async () => { throw new Error('must not be called'); },
  });
  const webhookHandler = createTicketingWebhookHandler({ db, provider, log: QUIET });
  const res = makeRes();
  await webhookHandler(signedWebhookRequest('webhook-wrong-event.json'), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ignored, 'wrong_event');
  assert.equal(db.read('ticket_sync_queue', 'ord-9001'), undefined);
});

test('an unsigned / tampered delivery never reaches the transaction (webhook signature verification is security-critical)', async () => {
  const db = makeFakeDb();
  const provider = createEventbriteProvider({
    env: { TICKETING_API_TOKEN: TOKEN, TICKETING_WEBHOOK_SECRET: SECRET, EVENT_TICKETING_EVENT_ID: 'evt-1' },
    fetchImpl: async () => { throw new Error('must not be called'); },
  });
  const webhookHandler = createTicketingWebhookHandler({ db, provider, log: QUIET });
  const rawBody = Buffer.from(JSON.stringify(fixture('webhook-order-placed.json')), 'utf8');
  const res = makeRes();
  await webhookHandler({ method: 'POST', rawBody, headers: {}, body: fixture('webhook-order-placed.json') }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(db.read('ticket_sync_queue', 'ord-2001'), undefined);
  assert.equal(db.read('ticket_webhook_deliveries', eventbriteInternals.deliveryIdFor(rawBody)), undefined);
});
