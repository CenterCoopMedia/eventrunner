'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeFakeDb } = require('../cms/firestoreFake.cjs');
const {
  createTicketingCatalogHandler, createTicketingCheckoutHandler, createTicketingOrderStatusHandler,
  reserveCommerceOrder, recoverCheckoutAttempt, createCompOrder, readTicketingCatalog,
} = require('./stripeCheckout.cjs');
const { inventoryTransitionPatch, transitionOrderInventory, SAFE_RETRY_MS } = require('./stripeCommerce.cjs');
const { claimTicketsForUser } = require('./registration.cjs');
const { createStripeProvider } = require('./providers/stripe.cjs');
const { drainTicketSyncQueue } = require('./sync.cjs');

const START = new Date('2026-10-12T16:00:00.000Z');
const ADA = { uid: 'uid-ada', email: 'ada@example.com', email_verified: true };
const BOB = { uid: 'uid-bob', email: 'bob@example.com', email_verified: true };
const PERSON = { firstName: 'Ada', lastName: 'Example', email: 'ada@example.com' };
const QUIET = { error() {}, warn() {} };

function catalog(patch = {}) {
  return {
    schemaVersion: 1, revision: 1, published: true, salesPaused: false,
    commercialTermsConfirmed: true, currency: 'usd', capacity: 100, maxPerOrder: 20,
    taxTreatment: 'not_collected', refundPolicy: 'Contact the organizer before the event for a refund.',
    ticketTypes: [
      { id: 'general', name: 'Full event pass', unitAmount: 2500, capacity: 100, active: true, visibility: 'public' },
      { id: 'student', name: 'Student full event pass', unitAmount: 1000, capacity: 50, active: true, visibility: 'public' },
    ], ...patch,
  };
}

function request(patch = {}) {
  return {
    requestId: 'checkout-request-0001',
    catalogRevision: 1,
    lines: [{ ticketTypeId: 'general', quantity: 1, attendees: [PERSON] }],
    ...patch,
  };
}

function response() {
  return {
    statusCode: null, body: null, headers: {},
    set(key, value) { this.headers[key] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
}

function setup({ catalogPatch = {}, seed = {}, create } = {}) {
  const db = makeFakeDb({
    'config/event': { name: 'Example event', historicalDemo: false },
    'ticket_catalog/current': catalog(catalogPatch),
    'users/uid-ada': { registrationStatus: 'pending', approvalSource: null },
    'users/uid-bob': { registrationStatus: 'pending', approvalSource: null },
    ...seed,
  });
  let clock = new Date(START);
  const calls = [];
  const sessions = new Map();
  const provider = {
    name: 'stripe', externalEventId: 'example-event', stripeAccountId: 'acct_example', livemode: false,
    hasPaymentCredentials: true,
    async createCheckoutSession(params, options) {
      calls.push({ params: structuredClone(params), options: structuredClone(options) });
      if (create) return create({ db, params, options, calls, sessions });
      if (!sessions.has(options.idempotencyKey)) sessions.set(options.idempotencyKey, makeSession(params));
      return sessions.get(options.idempotencyKey);
    },
  };
  const deps = {
    db, provider, log: QUIET, env: { EVENT_PUBLIC_URL: 'https://event.example.com' },
    now: () => new Date(clock),
    getConfig: async () => ({ event: { name: 'Example event' }, features: { autoApproveTicketHolders: true } }),
    auth: {
      async verifyIdToken(token, revoked) {
        assert.equal(revoked, true);
        if (token === 'ada') return ADA;
        if (token === 'bob') return BOB;
        if (token === 'unverified') return { ...ADA, email_verified: false };
        throw new Error('Invalid token');
      },
    },
  };
  return { deps, db, provider, calls, advance(ms) { clock = new Date(clock.getTime() + ms); } };
}

function makeSession(params, patch = {}) {
  const total = params.line_items.reduce((sum, line) => sum + line.quantity * line.price_data.unit_amount, 0);
  return {
    id: `cs_test_${params.metadata.eventRunnerOrderId}`, mode: 'payment', status: 'open', payment_status: 'unpaid',
    livemode: false, metadata: params.metadata, currency: params.line_items[0].price_data.currency,
    amount_total: total, amount_subtotal: total, payment_intent: null,
    url: 'https://checkout.stripe.com/c/pay/example', expires_at: params.expires_at,
    ...patch,
  };
}

async function checkout(deps, body = request(), token = 'ada') {
  const res = response();
  await createTicketingCheckoutHandler(deps)({ method: 'POST', headers: { authorization: `Bearer ${token}` }, body }, res);
  return res;
}

async function status(deps, query, token = 'ada') {
  const res = response();
  await createTicketingOrderStatusHandler(deps)({ method: 'GET', headers: { authorization: `Bearer ${token}` }, query }, res);
  return res;
}

test('paid checkout reserves inventory before external creation and freezes exact card-only prices', async () => {
  const { deps, db, calls } = setup({ create({ db: current, params }) {
    assert.equal(current.read('ticket_inventory', 'current').held, 2);
    assert.equal(current.ids('tickets').length, 0);
    assert.equal(current.ids('ticket_payment_attempts').length, 1);
    return makeSession(params);
  } });
  const res = await checkout(deps, request({ lines: [{ ticketTypeId: 'general', quantity: 2, attendees: [PERSON, { ...PERSON, email: BOB.email }] }] }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'pending');
  assert.equal(res.body.paymentStatus, 'pending');
  assert.equal(res.body.checkoutUrl, 'https://checkout.stripe.com/c/pay/example');
  assert.deepEqual(res.body.ticketIds, []);
  const order = db.read('ticket_orders', res.body.orderId);
  assert.equal(order.totalAmount, 5000);
  assert.equal(order.taxAmount, 0);
  assert.equal(order.feeAmount, 0);
  assert.equal(order.discountAmount, 0);
  assert.deepEqual(order.seats.map((seat) => seat.email), [ADA.email, BOB.email]);
  assert.deepEqual(calls[0].params.allowed_payment_method_types, ['card']);
  assert.equal(calls[0].params.ui_mode, 'hosted_page');
  assert.deepEqual(calls[0].params.adaptive_pricing, { enabled: false });
  assert.deepEqual(calls[0].params.automatic_tax, { enabled: false });
  assert.equal(calls[0].params.allow_promotion_codes, false);
  assert.deepEqual(calls[0].params.payment_intent_data.metadata, calls[0].params.metadata);
  assert.equal(calls[0].params.line_items[0].price_data.product_data.metadata.eventRunnerTicketTypeId, 'general');
  assert.equal(calls[0].params.success_url, `https://event.example.com/tickets/status?orderId=${order.id}`);
  assert.equal(db.read('ticket_sync_queue', order.id).status, 'pending');
  assert.equal(db.ids('admin_logs').length, 1);
});

test('missing or unverified authentication and client-supplied pricing cannot reserve or pay', async () => {
  for (const [body, token, expected] of [[request(), 'invalid', 401], [request(), 'unverified', 403], [request({ totalAmount: 1 }), 'ada', 400]]) {
    const { deps, db, calls } = setup();
    const res = await checkout(deps, body, token);
    assert.equal(res.statusCode, expected);
    assert.equal(db.ids('ticket_orders').length, 0);
    assert.equal(db.ids('ticket_payment_attempts').length, 0);
    assert.equal(calls.length, 0);
  }
});

test('new paid and free purchases require a valid accepted catalog revision before any mutation', async () => {
  for (const unitAmount of [2500, 0]) {
    for (const catalogRevision of [undefined, null, -1, 0.5, '1', Number.MAX_SAFE_INTEGER + 1]) {
      const { deps, db, calls } = setup({ catalogPatch: { ticketTypes: [{ id: 'general', name: 'Pass', capacity: 100, unitAmount }] } });
      const body = request({ catalogRevision });
      if (catalogRevision === undefined) delete body.catalogRevision;
      const res = await checkout(deps, body);
      assert.equal(res.statusCode, 400, `${unitAmount}:${catalogRevision}`);
      assert.equal(res.body.error.code, 'invalid-checkout');
      for (const collection of ['ticket_orders', 'ticket_payment_attempts', 'ticket_inventory', 'tickets', 'ticket_sync_queue', 'admin_logs']) {
        assert.equal(db.ids(collection).length, 0, collection);
      }
      assert.equal(calls.length, 0);
    }
  }
});

test('changed prices or refund terms require renewed acceptance for paid and free purchases', async () => {
  for (const unitAmount of [2500, 0]) {
    for (const change of ['price', 'policy']) {
      const { deps, db, calls } = setup({ catalogPatch: { ticketTypes: [{ id: 'general', name: 'Pass', capacity: 100, unitAmount }] } });
      const shown = await readTicketingCatalog(deps);
      const nextAmount = change === 'price' ? unitAmount + 500 : unitAmount;
      const nextPolicy = change === 'policy' ? 'Refunds require organizer approval.' : catalog().refundPolicy;
      await db.collection('ticket_catalog').doc('current').update({
        revision: 2, refundPolicy: nextPolicy,
        ticketTypes: [{ id: 'general', name: 'Pass', capacity: 100, unitAmount: nextAmount }],
      });
      const refused = await checkout(deps, request({ catalogRevision: shown.catalogRevision }));
      assert.equal(refused.statusCode, 409, `${unitAmount}:${change}`);
      assert.equal(refused.body.error.code, 'catalog-changed');
      for (const collection of ['ticket_orders', 'ticket_payment_attempts', 'ticket_inventory', 'tickets', 'ticket_sync_queue', 'admin_logs']) {
        assert.equal(db.ids(collection).length, 0, collection);
      }
      assert.equal(calls.length, 0);
      const refreshed = await readTicketingCatalog(deps);
      const accepted = await checkout(deps, request({ catalogRevision: refreshed.catalogRevision }));
      assert.equal(accepted.statusCode, 200);
      const order = db.read('ticket_orders', accepted.body.orderId);
      assert.equal(order.catalogRevision, 2);
      assert.equal(order.totalAmount, nextAmount);
      assert.equal(order.refundPolicy, nextPolicy);
      const pointer = db.ids('ticket_inventory').find((id) => id.startsWith('purchaser_'));
      assert.equal(db.read('ticket_inventory', pointer).ordersInWindow, 1, 'the rejected request did not spend quota');
    }
  }
});

test('a catalog price or policy change racing reservation commit aborts paid and free orders', async () => {
  for (const unitAmount of [2500, 0]) {
    for (const patch of [
      { ticketTypes: [{ id: 'general', name: 'Pass', capacity: 100, unitAmount: 9900 }] },
      { refundPolicy: 'Refunds require organizer approval.' },
    ]) {
      const { deps, db, calls } = setup({ catalogPatch: { ticketTypes: [{ id: 'general', name: 'Pass', capacity: 100, unitAmount }] } });
      db.beforeCommit = async () => db.collection('ticket_catalog').doc('current').update({ ...patch, revision: 2 });
      const res = await checkout(deps);
      assert.equal(res.statusCode, 409);
      assert.equal(res.body.error.code, 'catalog-changed');
      for (const collection of ['ticket_orders', 'ticket_payment_attempts', 'ticket_inventory', 'tickets', 'ticket_sync_queue', 'admin_logs']) {
        assert.equal(db.ids(collection).length, 0, collection);
      }
      assert.equal(calls.length, 0);
    }
  }
});

test('reservation cannot bypass revision acceptance by calling the internal public-order helper', async () => {
  const { deps, db, calls } = setup();
  const body = request();
  delete body.catalogRevision;
  await assert.rejects(reserveCommerceOrder({ ...deps, actor: ADA, request: body }), { code: 'invalid-checkout', status: 400 });
  assert.equal(db.ids('ticket_orders').length, 0);
  assert.equal(db.ids('ticket_inventory').length, 0);
  assert.equal(calls.length, 0);
});

test('missing provider identity and a non-HTTPS return origin refuse creation', async () => {
  const a = setup();
  a.provider.stripeAccountId = '';
  assert.equal((await checkout(a.deps)).statusCode, 503);
  assert.equal(a.db.ids('ticket_orders').length, 0);
  const b = setup();
  b.deps.env.EVENT_PUBLIC_URL = 'https://event.example.com@evil.example/path?redirect=anything';
  assert.equal((await checkout(b.deps)).statusCode, 503);
  assert.equal(b.calls.length, 0);
});

test('missing or mismatched Stripe keys close paid sales before reserving any inventory', async () => {
  for (const token of [undefined, 'sk_live_fixture', 'sk_test_']) {
    const { deps, db } = setup();
    const env = {
      ...deps.env, EVENT_TICKETING_EVENT_ID: 'example-event', EVENT_STRIPE_ACCOUNT_ID: 'acct_example',
      EVENT_STRIPE_MODE: 'test', TICKETING_API_TOKEN: token,
    };
    deps.provider = createStripeProvider({ env, db });
    const catalog = await readTicketingCatalog(deps);
    const res = await checkout(deps);
    assert.equal(catalog.salesEnabled, false);
    assert.ok(catalog.ticketTypes.every((type) => !type.available));
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.error.code, 'ticketing-unavailable');
    for (const collection of ['ticket_orders', 'ticket_payment_attempts', 'ticket_inventory', 'ticket_sync_queue', 'admin_logs']) {
      assert.equal(db.ids(collection).length, 0, collection);
    }
  }
});

test('missing payment keys leave free sales and comps usable while paid types remain closed', async () => {
  const { deps, db } = setup({ catalogPatch: { ticketTypes: [
    { id: 'general', name: 'Free event pass', unitAmount: 0, capacity: 100 },
    { id: 'student', name: 'Paid event pass', unitAmount: 1000, capacity: 100 },
  ] } });
  const env = { ...deps.env, EVENT_TICKETING_EVENT_ID: 'example-event', EVENT_STRIPE_ACCOUNT_ID: 'acct_example', EVENT_STRIPE_MODE: 'test' };
  deps.provider = createStripeProvider({ env, db });
  const catalog = await readTicketingCatalog(deps);
  assert.equal(catalog.salesEnabled, true);
  assert.equal(catalog.ticketTypes.find((type) => type.id === 'general').available, true);
  assert.equal(catalog.ticketTypes.find((type) => type.id === 'student').available, false);
  const free = await checkout(deps);
  assert.equal(free.statusCode, 200);
  assert.equal(free.body.status, 'free');
  const comp = await createCompOrder({ ...deps, actorUid: 'organizer', ticketTypeId: 'student', attendees: [PERSON], requestId: 'organizer-comp-0001', reason: 'Approved press access' });
  assert.equal(comp.status, 'free');
  assert.equal(db.read('ticket_inventory', 'current').sold, 2);
});

test('an absent catalog remains closed without requiring a Stripe client or payment key', async () => {
  const { deps, db } = setup();
  await db.collection('ticket_catalog').doc('current').delete();
  const env = { ...deps.env, EVENT_TICKETING_EVENT_ID: 'example-event', EVENT_STRIPE_ACCOUNT_ID: 'acct_example', EVENT_STRIPE_MODE: 'test' };
  deps.provider = createStripeProvider({ env, db });
  const catalog = await readTicketingCatalog(deps);
  assert.equal(catalog.salesEnabled, false);
  assert.deepEqual(catalog.ticketTypes, []);
  assert.equal(db.ids('ticket_orders').length, 0);
});

test('public catalog availability never requests Stripe account or financial data', async () => {
  const { deps, db } = setup();
  const stripeClient = {};
  Object.defineProperty(stripeClient, 'accounts', { get() { throw new Error('Catalog must not call Stripe.'); } });
  const env = { ...deps.env, EVENT_TICKETING_EVENT_ID: 'example-event', EVENT_STRIPE_ACCOUNT_ID: 'acct_example', EVENT_STRIPE_MODE: 'test' };
  deps.provider = createStripeProvider({ env, db, stripeClient });
  const catalog = await readTicketingCatalog(deps);
  assert.equal(catalog.salesEnabled, true);
  assert.ok(catalog.ticketTypes.every((type) => type.available));
});

test('an existing unknown attempt with unavailable credentials remains unchanged until safe retry', async () => {
  const { deps, db, advance } = setup({ create() { throw new Error('Lost creation response'); } });
  const initial = await checkout(deps);
  const attemptId = db.ids('ticket_payment_attempts')[0];
  const attempt = db.read('ticket_payment_attempts', attemptId);
  advance(6000);
  const env = { ...deps.env, EVENT_TICKETING_EVENT_ID: 'example-event', EVENT_STRIPE_ACCOUNT_ID: 'acct_example', EVENT_STRIPE_MODE: 'test' };
  deps.provider = createStripeProvider({ env, db });
  const resumed = await checkout(deps, { orderId: initial.body.orderId, resume: true });
  assert.equal(resumed.statusCode, 503);
  assert.deepEqual(db.read('ticket_payment_attempts', attemptId), attempt);
  assert.equal(db.read('ticket_inventory', 'current').held, 1);
});

test('historical demo policy is read live even when the cached configuration describes a live event', async () => {
  const { deps, db, calls } = setup({ seed: { 'config/event': { historicalDemo: true } } });
  const res = await checkout(deps);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error.code, 'read-only-demo');
  assert.equal(db.ids('ticket_orders').length, 0);
  assert.equal(calls.length, 0);
});

test('a demo freeze racing the Stripe creation response prevents local payment writes', async () => {
  let beforeFreeze;
  const { deps, db, calls } = setup({ create({ db: current, params }) {
    beforeFreeze = {
      order: current.read('ticket_orders', params.metadata.eventRunnerOrderId),
      attempt: current.read('ticket_payment_attempts', params.metadata.eventRunnerAttemptId),
      inventory: current.read('ticket_inventory', 'current'),
    };
    current.beforeCommit = async () => current.collection('config').doc('event').set({ historicalDemo: true });
    return makeSession(params);
  } });
  const res = await checkout(deps);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error.code, 'read-only-demo');
  assert.equal(calls.length, 1);
  assert.deepEqual(db.read('ticket_orders', beforeFreeze.order.id), beforeFreeze.order);
  assert.deepEqual(db.read('ticket_payment_attempts', beforeFreeze.order.attemptId), beforeFreeze.attempt);
  assert.deepEqual(db.read('ticket_inventory', 'current'), beforeFreeze.inventory);
  assert.equal(db.ids('tickets').length, 0);
});

test('a verified account waits for its profile before creating a checkout', async () => {
  const { deps, db, calls } = setup();
  await db.collection('users').doc(ADA.uid).delete();
  const pending = await checkout(deps);
  assert.equal(pending.statusCode, 503);
  assert.equal(pending.body.error.code, 'account-not-ready');
  assert.equal(db.ids('ticket_orders').length, 0);
  assert.equal(db.ids('ticket_payment_attempts').length, 0);
  assert.equal(db.ids('ticket_inventory').length, 0);
  assert.equal(db.ids('admin_logs').length, 0);
  assert.equal(calls.length, 0);
  await db.collection('users').doc(ADA.uid).set({ registrationStatus: 'pending', approvalSource: null });
  assert.equal((await checkout(deps)).statusCode, 200);
  assert.equal(calls.length, 1);
});

test('profile deletion races abort new reservations before any payment or order data can be written', async () => {
  const { deps, db, calls } = setup();
  db.beforeCommit = async () => db.collection('users').doc(ADA.uid).delete();
  const res = await checkout(deps);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error.code, 'account-not-ready');
  assert.equal(db.ids('ticket_orders').length, 0);
  assert.equal(db.ids('ticket_payment_attempts').length, 0);
  assert.equal(db.ids('ticket_inventory').length, 0);
  assert.equal(db.ids('ticket_sync_queue').length, 0);
  assert.equal(db.ids('admin_logs').length, 0);
  assert.equal(calls.length, 0);
});

test('a missing purchaser profile blocks resume while operator comps need no purchaser profile', async () => {
  const { deps, db, calls, advance } = setup({ create() { throw new Error('Unknown provider outcome'); } });
  await checkout(deps);
  await db.collection('users').doc(ADA.uid).delete();
  advance(6000);
  const resume = await checkout(deps, { requestId: request().requestId, resume: true });
  assert.equal(resume.statusCode, 503);
  assert.equal(resume.body.error.code, 'account-not-ready');
  assert.equal(calls.length, 1);
  assert.equal(db.read('ticket_inventory', 'current').held, 1);
  const comp = await createCompOrder({ ...deps, actorUid: 'organizer-with-no-profile', ticketTypeId: 'general', attendees: [PERSON], requestId: 'organizer-comp-0001', reason: 'Approved press access' });
  assert.equal(comp.status, 'free');
  assert.equal(calls.length, 1);
});

test('concurrent purchasers racing the last seat cannot oversell event capacity', async () => {
  const { deps, db, calls } = setup({ catalogPatch: { capacity: 1 } });
  const results = await Promise.all([
    checkout(deps),
    checkout(deps, request({ requestId: 'checkout-request-0002' }), 'bob'),
  ]);
  assert.deepEqual(results.map((res) => res.statusCode).sort(), [200, 409]);
  assert.equal(results.find((res) => res.statusCode === 409).body.error.code, 'sold-out');
  assert.equal(db.read('ticket_inventory', 'current').held, 1);
  assert.equal(db.ids('ticket_orders').length, 1);
  assert.equal(calls.length, 1);
});

test('concurrent retries of one request reserve one order and call Stripe once', async () => {
  const { deps, db, calls } = setup();
  const results = await Promise.all([checkout(deps), checkout(deps), checkout(deps)]);
  assert.equal(new Set(results.map((res) => res.body.orderId)).size, 1);
  assert.equal(db.ids('ticket_orders').length, 1);
  assert.equal(db.ids('ticket_payment_attempts').length, 1);
  assert.equal(db.read('ticket_inventory', 'current').held, 1);
  assert.equal(calls.length, 1);
});

test('a second distinct held checkout is blocked for the same purchaser', async () => {
  const { deps, db } = setup();
  assert.equal((await checkout(deps)).statusCode, 200);
  const second = await checkout(deps, request({ requestId: 'checkout-request-0002' }));
  assert.equal(second.statusCode, 409);
  assert.equal(second.body.error.code, 'purchase-in-progress');
  assert.equal(db.ids('ticket_orders').length, 1);
});

test('a purchaser on another device can locate the held order and resume its existing Session', async () => {
  const { deps, db, calls } = setup();
  const first = await checkout(deps);
  const blocked = await checkout(deps, request({ requestId: 'different-device-0002' }));
  assert.equal(blocked.statusCode, 409);
  assert.equal(blocked.body.error.existingOrderId, first.body.orderId);
  const recovered = await checkout(deps, { orderId: first.body.orderId, resume: true });
  assert.equal(recovered.statusCode, 200);
  assert.equal(recovered.body.checkoutUrl, first.body.checkoutUrl);
  assert.equal(calls.length, 1);
  assert.equal(db.ids('ticket_orders').length, 1);
});

test('cross-device resume replays unknown creation and hides another purchaser’s order', async () => {
  const { deps, db, calls, advance } = setup({ create({ params, options, calls: seen, sessions }) {
    if (!sessions.has(options.idempotencyKey)) sessions.set(options.idempotencyKey, makeSession(params));
    if (seen.length === 1) throw new Error('Connection lost after Session creation.');
    return sessions.get(options.idempotencyKey);
  } });
  const initial = await checkout(deps);
  advance(6000);
  const foreign = await checkout(deps, { orderId: initial.body.orderId, resume: true }, 'bob');
  const missing = await checkout(deps, { orderId: `ord_${'f'.repeat(40)}`, resume: true }, 'bob');
  assert.equal(foreign.statusCode, 404);
  assert.deepEqual(foreign.body, missing.body);
  assert.equal(calls.length, 1);
  const recovered = await checkout(deps, { orderId: initial.body.orderId, resume: true });
  assert.equal(recovered.statusCode, 200);
  assert.equal(recovered.body.orderId, initial.body.orderId);
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(db.ids('ticket_orders').length, 1);
});

test('a corrupt purchaser pointer never discloses the other owner’s order reference', async () => {
  const { deps, db } = setup();
  const first = await checkout(deps);
  await db.collection('ticket_orders').doc(first.body.orderId).set({ purchaserUid: BOB.uid }, { merge: true });
  const response = await checkout(deps, request({ requestId: 'different-device-0002' }));
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.error.existingOrderId, undefined);
  assert.equal(JSON.stringify(response.body).includes(first.body.orderId), false);
});

test('free orders have a per-purchaser hourly ceiling and old retries spend no quota', async () => {
  const { deps, db, advance } = setup({ catalogPatch: { ticketTypes: [{ id: 'general', name: 'Full event pass', unitAmount: 0, capacity: 100 }] } });
  const first = await checkout(deps);
  for (let i = 2; i <= 5; i += 1) {
    assert.equal((await checkout(deps, freeRequest(`checkout-request-000${i}`, 1))).statusCode, 200);
  }
  const retry = await checkout(deps);
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.body.orderId, first.body.orderId);
  const denied = await checkout(deps, freeRequest('checkout-request-0006', 1));
  assert.equal(denied.statusCode, 429);
  assert.equal(denied.body.error.code, 'rate-limited');
  assert.equal(denied.body.error.retryAfterSeconds, 3600);
  assert.equal(denied.headers['Retry-After'], '3600');
  assert.equal(db.ids('ticket_orders').length, 5);
  assert.equal(db.read('ticket_inventory', 'current').sold, 5);
  assert.equal((await checkout(deps, freeRequest('checkout-request-0006', 1, 'bob-other'), 'bob')).statusCode, 200);
  advance(3600000);
  assert.equal((await checkout(deps, freeRequest('checkout-request-0006', 1))).statusCode, 200);
});

test('concurrent last-quota free orders consume one slot and failed selections do not spend it', async () => {
  const { deps, db } = setup({ catalogPatch: { ticketTypes: [{ id: 'general', name: 'Full event pass', unitAmount: 0, capacity: 100 }] } });
  for (let i = 1; i <= 4; i += 1) await checkout(deps, freeRequest(`checkout-request-000${i}`, 1));
  const invalid = await checkout(deps, request({ requestId: 'checkout-request-bad0', lines: [{ ticketTypeId: 'unknown', quantity: 1, attendees: [PERSON] }] }));
  assert.equal(invalid.statusCode, 409);
  const results = await Promise.all([
    checkout(deps, freeRequest('checkout-request-0005', 1)),
    checkout(deps, freeRequest('checkout-request-0006', 1)),
  ]);
  assert.deepEqual(results.map((result) => result.statusCode).sort(), [200, 429]);
  assert.equal(db.ids('ticket_orders').length, 5);
  assert.equal(db.read('ticket_inventory', 'current').sold, 5);
});

test('staff comps are exempt from the public purchaser rate ceiling', async () => {
  const { deps, db } = setup();
  for (let i = 1; i <= 6; i += 1) {
    const result = await createCompOrder({ ...deps, actorUid: 'organizer-uid', ticketTypeId: 'general', attendees: [PERSON], requestId: `organizer-comp-000${i}`, reason: 'Approved press access' });
    assert.equal(result.status, 'free');
  }
  assert.equal(db.ids('ticket_orders').length, 6);
  assert.equal(db.read('ticket_inventory', 'current').sold, 6);
  assert.equal(db.ids('admin_logs').length, 6);
});

test('an unknown create result retains the reservation and replays the exact stored request', async () => {
  const { deps, db, calls, advance } = setup({ create({ params, options, calls: seen, sessions }) {
    if (!sessions.has(options.idempotencyKey)) sessions.set(options.idempotencyKey, makeSession(params));
    if (seen.length === 1) throw new Error('The connection closed after Stripe created the Session.');
    return sessions.get(options.idempotencyKey);
  } });
  const first = await checkout(deps);
  assert.equal(first.statusCode, 202);
  assert.equal(first.body.checkoutUrl, null);
  assert.equal(first.body.status, 'pending');
  await db.collection('ticket_catalog').doc('current').set({ revision: 2, refundPolicy: 'New refund terms.', ticketTypes: [{ id: 'general', name: 'New price', capacity: 100, unitAmount: 9900 }] }, { merge: true });
  advance(6000);
  const retry = await checkout(deps, { requestId: request().requestId, resume: true });
  assert.equal(retry.body.orderId, first.body.orderId);
  assert.equal(retry.statusCode, 200);
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(db.read('ticket_orders', first.body.orderId).totalAmount, 2500);
  assert.equal(db.read('ticket_orders', first.body.orderId).catalogRevision, 1);
  assert.equal(db.read('ticket_orders', first.body.orderId).refundPolicy, catalog().refundPolicy);
  assert.equal(db.read('ticket_inventory', 'current').held, 1);
  const originalBodyRetry = await checkout(deps, request());
  assert.equal(originalBodyRetry.statusCode, 200);
  assert.equal(originalBodyRetry.body.orderId, first.body.orderId);
  assert.equal(calls.length, 2, 'a saved Session does not create another payment');
  const changedAcceptance = await checkout(deps, request({ catalogRevision: 2 }));
  assert.equal(changedAcceptance.statusCode, 409);
  assert.equal(changedAcceptance.body.error.code, 'idempotency-conflict');
  assert.equal(calls.length, 2);
});

test('a process crash after the reservation is recovered without another order or cart', async () => {
  const { deps, db, calls } = setup();
  const reserved = await reserveCommerceOrder({ ...deps, actor: ADA, request: request() });
  assert.equal(calls.length, 0);
  const recovered = await recoverCheckoutAttempt({ ...deps, orderId: reserved.order.id });
  assert.ok(recovered.stripeSessionId);
  assert.equal(calls.length, 1);
  assert.equal(db.ids('ticket_orders').length, 1);
});

test('the existing queue recovers a crash before Stripe creation while the frozen expiry is still valid', async () => {
  const { deps, db, provider, calls, advance } = setup({ create({ params }) {
    if (params.expires_at * 1000 - deps.now().getTime() < 30 * 60_000) throw new Error('Stripe requires at least 30 minutes before expiry.');
    return makeSession(params);
  } });
  const reserved = await reserveCommerceOrder({ ...deps, actor: ADA, request: request() });
  const row = db.read('ticket_sync_queue', reserved.order.id);
  advance(row.readyAt.getTime() - deps.now().getTime());
  provider.fetchOrder = async (id) => {
    const recovered = await recoverCheckoutAttempt({ ...deps, orderId: id });
    return { complete: Boolean(recovered.stripeSessionId), tickets: [], paymentPending: Boolean(recovered.stripeSessionId),
      nextReconciliationAt: new Date(recovered.expiresAt) };
  };
  await drainTicketSyncQueue({ ...deps, log: QUIET });
  assert.equal(calls.length, 1);
  assert.ok(db.read('ticket_orders', reserved.order.id).stripeSessionId);
  assert.deepEqual(db.read('ticket_sync_queue', reserved.order.id).readyAt, new Date(reserved.order.expiresAt));
  assert.equal(db.ids('ticket_orders').length, 1);
});

test('verified Stripe Session URLs may use organizer custom domains but never insecure or credential URLs', async () => {
  for (const [url, accepted] of [
    ['https://payments.event.example/c/pay/session', true],
    ['http://payments.event.example/c/pay/session', false],
    ['https://user:secret@payments.event.example/c/pay/session', false],
    ['javascript:alert(1)', false],
  ]) {
    const { deps } = setup({ create({ params }) { return makeSession(params, { url }); } });
    const result = await checkout(deps);
    assert.equal(result.body.checkoutUrl, accepted ? url : null);
  }
});

test('a changed cart cannot reuse an old payment request ID', async () => {
  const { deps, calls } = setup();
  await checkout(deps);
  const res = await checkout(deps, request({ lines: [{ ticketTypeId: 'student', quantity: 1, attendees: [PERSON] }] }));
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error.code, 'idempotency-conflict');
  assert.equal(calls.length, 1);
});

test('never recreate an ambiguous payment after the idempotency retention safety window', async () => {
  const { deps, db, calls, advance } = setup({ create() { throw new Error('Unknown network outcome.'); } });
  const initial = await checkout(deps);
  advance(SAFE_RETRY_MS);
  const retried = await checkout(deps, { requestId: request().requestId, resume: true });
  assert.equal(retried.body.status, 'exception');
  assert.equal(calls.length, 1);
  assert.equal(db.read('ticket_inventory', 'current').held, 1);
  assert.equal(db.read('ticket_orders', initial.body.orderId).inventoryState, 'held');
  assert.equal(db.ids('tickets').length, 0);
});

test('a mismatched Stripe amount, account mode, or metadata never delivers tickets or a redirect', async () => {
  for (const patch of [{ amount_total: 1 }, { livemode: true }, { metadata: { eventRunnerOrderId: 'another-order' } }]) {
    const { deps, db } = setup({ create({ params }) { return makeSession(params, patch); } });
    const res = await checkout(deps);
    assert.equal(res.body.status, 'exception');
    assert.equal(res.body.checkoutUrl, null);
    assert.equal(db.ids('tickets').length, 0);
    assert.equal(db.read('ticket_inventory', 'current').held, 1);
  }
});

test('free multi-seat orders deliver one stable email-bound ticket per attendee without Stripe', async () => {
  const { deps, db, calls } = setup({ catalogPatch: { ticketTypes: [{ id: 'general', name: 'Full event pass', unitAmount: 0, capacity: 100 }] } });
  const body = request({ lines: [{ ticketTypeId: 'general', quantity: 2, attendees: [PERSON, { ...PERSON, email: BOB.email }] }] });
  const res = await checkout(deps, body);
  assert.equal(res.body.status, 'free');
  assert.equal(res.body.paymentStatus, 'succeeded');
  assert.equal(calls.length, 0);
  assert.equal(db.ids('tickets').length, 2);
  assert.equal(db.read('ticket_inventory', 'current').sold, 2);
  assert.equal(db.read('ticket_inventory', 'current').held, 0);
  const retry = await checkout(deps, body);
  assert.deepEqual(retry.body.ticketIds, res.body.ticketIds);
  assert.equal(db.ids('tickets').length, 2);
  const claim = await claimTicketsForUser({ ...deps, uid: ADA.uid, email: ADA.email, externalIds: res.body.ticketIds });
  assert.equal(claim.claimed.length, 1);
  assert.equal(claim.refused[0].reason, 'email_mismatch');
  assert.equal(db.read('users', ADA.uid).registrationStatus, 'approved');
  assert.equal(db.read('users', BOB.uid).registrationStatus, 'pending');
});

test('comps may use hidden tickets while sales are paused but still consume capacity with an audit reason', async () => {
  const { deps, db, calls } = setup({ catalogPatch: {
    published: false, salesPaused: true,
    ticketTypes: [{ id: 'press', name: 'Press full event pass', unitAmount: 2500, capacity: 2, visibility: 'hidden' }],
  } });
  const result = await createCompOrder({ ...deps, actorUid: 'organizer-uid', ticketTypeId: 'press', attendees: [PERSON], requestId: 'organizer-comp-0001', reason: 'Approved press access' });
  assert.equal(result.status, 'free');
  assert.equal(result.order.source, 'comp');
  assert.equal(result.order.totalAmount, 0);
  assert.equal(result.order.lines[0].originalUnitAmount, 2500);
  assert.equal(db.read('ticket_inventory', 'current').sold, 1);
  assert.equal(calls.length, 0);
  const log = db.read('admin_logs', db.ids('admin_logs')[0]);
  assert.equal(log.action, 'ticketing.comp');
  assert.equal(log.reason, 'Approved press access');
  assert.equal(JSON.stringify(log).includes(PERSON.email), false);
  const same = await createCompOrder({ ...deps, actorUid: 'organizer-uid', ticketTypeId: 'press', attendees: [PERSON], requestId: 'organizer-comp-0001', reason: 'Approved press access' });
  assert.equal(same.orderId, result.orderId);
  assert.equal(db.ids('tickets').length, 1);
});

test('sales windows, unpublished catalogs, hidden types, and per-type quantities are server enforced', async () => {
  const cases = [
    { published: false }, { salesPaused: true },
    { salesStartAt: '2026-10-13T16:00:00Z' }, { salesEndAt: START.toISOString() },
    { ticketTypes: [{ id: 'general', name: 'Pass', capacity: 100, unitAmount: 2500, visibility: 'hidden' }] },
    { ticketTypes: [{ id: 'general', name: 'Pass', capacity: 100, unitAmount: 2500, active: false }] },
    { ticketTypes: [{ id: 'general', name: 'Pass', capacity: 100, unitAmount: 2500, minPerOrder: 2 }] },
    { ticketTypes: [{ id: 'general', name: 'Pass', capacity: 100, unitAmount: 2500, salesEndAt: START.toISOString() }] },
  ];
  for (const catalogPatch of cases) {
    const { deps, db, calls } = setup({ catalogPatch });
    const res = await checkout(deps);
    assert.ok(res.statusCode === 400 || res.statusCode === 409, JSON.stringify(catalogPatch));
    assert.equal(db.ids('ticket_orders').length, 0);
    assert.equal(calls.length, 0);
  }
});

test('two ticket types share the event ceiling while retaining individual type capacities', async () => {
  const { deps, db } = setup({ catalogPatch: { capacity: 3 } });
  const res = await checkout(deps, request({ lines: [
    { ticketTypeId: 'student', quantity: 2, attendees: [PERSON, PERSON] },
    { ticketTypeId: 'general', quantity: 2, attendees: [PERSON, PERSON] },
  ] }));
  assert.equal(res.statusCode, 409);
  assert.equal(db.ids('ticket_orders').length, 0);
  const limited = setup({ catalogPatch: { ticketTypes: [{ id: 'general', name: 'Pass', capacity: 1, unitAmount: 2500 }] } });
  assert.equal((await checkout(limited.deps, request({ lines: [{ ticketTypeId: 'general', quantity: 2, attendees: [PERSON, PERSON] }] }))).body.error.code, 'sold-out');
});

test('integer totals include free and paid types and enforce the supported charge minimum', async () => {
  const tooSmall = setup({ catalogPatch: { ticketTypes: [{ id: 'general', name: 'Pass', capacity: 100, unitAmount: 1 }] } });
  assert.equal((await checkout(tooSmall.deps)).body.error.code, 'amount-too-small');
  assert.equal(tooSmall.calls.length, 0);
  const mixed = setup({ catalogPatch: { ticketTypes: [
    { id: 'general', name: 'Pass', capacity: 100, unitAmount: 333 },
    { id: 'student', name: 'Free pass', capacity: 100, unitAmount: 0 },
  ] } });
  const res = await checkout(mixed.deps, request({ lines: [
    { ticketTypeId: 'general', quantity: 3, attendees: [PERSON, PERSON, PERSON] },
    { ticketTypeId: 'student', quantity: 1, attendees: [PERSON] },
  ] }));
  assert.equal(res.statusCode, 200);
  assert.equal(mixed.db.read('ticket_orders', res.body.orderId).totalAmount, 999);
  assert.equal(mixed.db.ids('tickets').length, 0, 'free seats in a paid order also wait for payment');
});

test('public catalog exposes normalized overall windows without organizer-only data', async () => {
  const { deps } = setup({ catalogPatch: {
    salesStartAt: '2026-10-12T10:00:00-04:00', salesEndAt: '2026-10-13T18:00:00+02:00',
    updatedByUid: 'organizer-uid',
    ticketTypes: [{ id: 'general', name: 'Pass', capacity: 5, unitAmount: 2500,
      salesStartAt: '2026-10-12T15:00:00Z', salesEndAt: '2026-10-13T20:00:00Z' }],
  } });
  const res = response();
  await createTicketingCatalogHandler(deps)({ method: 'GET' }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.salesStartAt, '2026-10-12T14:00:00.000Z');
  assert.equal(res.body.salesEndAt, '2026-10-13T16:00:00.000Z');
  assert.equal(res.body.ticketTypes[0].salesStartAt, '2026-10-12T15:00:00.000Z');
  assert.equal(res.body.ticketTypes[0].salesEndAt, '2026-10-13T20:00:00.000Z');
  assert.equal(res.body.salesEnabled, true);
  for (const field of ['capacity', 'revision', 'updatedByUid', 'commercialTermsConfirmed', 'stripeAccountId']) {
    assert.equal(Object.hasOwn(res.body, field), false, field);
  }
  assert.equal(Object.hasOwn(res.body.ticketTypes[0], 'capacity'), false);
});

test('public catalog uses null overall windows when unset and never exposes unpublished deadlines', async () => {
  for (const catalogPatch of [
    {},
    { published: false, salesStartAt: '2026-10-12T14:00:00Z', salesEndAt: '2026-10-13T16:00:00Z' },
    { salesStartAt: 'not-a-date' },
  ]) {
    const { deps } = setup({ catalogPatch });
    const res = response();
    await createTicketingCatalogHandler(deps)({ method: 'GET' }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.salesStartAt, null);
    assert.equal(res.body.salesEndAt, null);
    if (Object.keys(catalogPatch).length) assert.deepEqual(res.body.ticketTypes, []);
  }
});

test('public catalog omits unpublished, inactive, hidden, and organizer-only data', async () => {
  const { deps } = setup({ catalogPatch: { ticketTypes: [
    { id: 'general', name: 'Pass', capacity: 5, unitAmount: 2500 },
    { id: 'press', name: 'Private comp', capacity: 5, unitAmount: 0, visibility: 'hidden' },
    { id: 'old', name: 'Retired pass', capacity: 5, unitAmount: 2500, active: false },
  ] } });
  const res = response();
  await createTicketingCatalogHandler(deps)({ method: 'GET' }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.mode, 'test');
  assert.equal(res.body.catalogRevision, 1);
  assert.deepEqual(res.body.ticketTypes.map((type) => type.id), ['general']);
  assert.equal(JSON.stringify(res.body).includes('acct_example'), false);
  assert.equal(res.body.ticketTypes[0].remaining, 5);
  assert.equal(res.body.taxAmount, 0);
  const unpublished = setup({ catalogPatch: { published: false } });
  const closed = await readTicketingCatalog(unpublished.deps);
  assert.deepEqual(closed.ticketTypes, []);
  assert.equal(closed.catalogRevision, null);
});

test('order status is owner and verified-email scoped before any provider work', async () => {
  const { deps, provider } = setup();
  const created = await checkout(deps);
  let reconciles = 0;
  provider.reconcileOrder = async () => { reconciles += 1; };
  const denied = await status(deps, { orderId: created.body.orderId }, 'bob');
  assert.equal(denied.statusCode, 404);
  assert.equal(reconciles, 0);
  assert.equal((await status(deps, { orderId: created.body.orderId }, 'unverified')).statusCode, 403);
  const owned = await status(deps, { orderId: created.body.orderId });
  assert.equal(owned.statusCode, 200);
  assert.equal(owned.body.totalAmount, 2500);
  assert.equal(owned.body.status, 'pending');
  assert.equal(owned.body.tickets.length, 0);
  assert.equal(reconciles, 1);
  assert.equal((await status(deps, { orderId: '../config/bootstrap' })).statusCode, 404);
});

test('recover by request ID requires the same purchaser without exposing attempt payloads', async () => {
  const { deps } = setup();
  const created = await checkout(deps);
  const own = await status(deps, { requestId: request().requestId });
  assert.equal(own.body.orderId, created.body.orderId);
  assert.equal(own.body.stripeRequest, undefined);
  assert.equal(own.body.purchaserUid, undefined);
  assert.equal((await status(deps, { requestId: request().requestId }, 'bob')).statusCode, 404);
});

test('only provider-confirmed hold transitions change inventory; paid refunds do not restock', async () => {
  const { deps, db } = setup();
  const created = await checkout(deps);
  const orderId = created.body.orderId;
  await transitionOrderInventory({ ...deps, orderId, to: 'sold', patch: { status: 'paid', paymentStatus: 'succeeded' } });
  await transitionOrderInventory({ ...deps, orderId, to: 'sold' });
  assert.equal(db.read('ticket_inventory', 'current').held, 0);
  assert.equal(db.read('ticket_inventory', 'current').sold, 1);
  assert.throws(() => inventoryTransitionPatch({ order: db.read('ticket_orders', orderId), inventory: db.read('ticket_inventory', 'current'), to: 'released' }), /organizer review/);
  const other = setup();
  const pending = await checkout(other.deps);
  await transitionOrderInventory({ ...other.deps, orderId: pending.body.orderId, to: 'released', patch: { status: 'expired', paymentStatus: 'expired' } });
  await transitionOrderInventory({ ...other.deps, orderId: pending.body.orderId, to: 'released' });
  assert.equal(other.db.read('ticket_inventory', 'current').held, 0);
  assert.equal(other.db.read('ticket_inventory', 'current').sold, 0);
  await assert.rejects(transitionOrderInventory({ ...other.deps, orderId: pending.body.orderId, to: 'sold' }), /organizer review/);
});

test('an in-flight API response cannot regress a webhook-confirmed paid order', async () => {
  const { deps, db } = setup({ async create({ db: current, params }) {
    await transitionOrderInventory({ db: current, orderId: params.metadata.eventRunnerOrderId, to: 'sold', patch: {
      status: 'paid', paymentStatus: 'succeeded', stripeSessionId: 'cs_test_confirmed',
    } });
    return makeSession(params);
  } });
  const result = await checkout(deps);
  assert.equal(result.body.status, 'paid');
  assert.equal(db.read('ticket_orders', result.body.orderId).stripeSessionId, 'cs_test_confirmed');
  assert.equal(db.read('ticket_inventory', 'current').sold, 1);
});

function freeRequest(requestId, quantity, prefix = requestId) {
  return request({ requestId, lines: [{ ticketTypeId: 'general', quantity,
    attendees: Array.from({ length: quantity }, (_, i) => ({ ...PERSON, email: `${prefix}-${i}@example.com` })),
  }] });
}

const FREE_CATALOG = { ticketTypes: [{ id: 'general', name: 'Free pass', unitAmount: 0, capacity: 100 }] };

test('permanent free seat budget stops repeated maximum orders after the hourly window and account recreation', async () => {
  const { deps, db, advance } = setup({ catalogPatch: FREE_CATALOG });
  const body = freeRequest('free-budget-first-0001', 20);
  const first = await checkout(deps, body);
  assert.equal(first.statusCode, 200);
  const writes = db.writes.length;
  const denied = await checkout(deps, freeRequest('free-budget-next-0002', 20));
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.body.error.code, 'free-seat-limit');
  assert.equal(db.writes.length, writes);
  advance(3600001);
  assert.equal((await checkout(deps, freeRequest('free-budget-next-0003', 1))).statusCode, 403);
  assert.equal((await checkout(deps, body)).body.orderId, first.body.orderId);
  await db.collection('users').doc('recreated-user').set({});
  await assert.rejects(reserveCommerceOrder({ ...deps, actor: { uid: 'recreated-user', email: 'ADA@EXAMPLE.COM' },
    request: freeRequest('free-budget-next-0004', 1) }), { code: 'free-seat-limit' });
  assert.equal(db.read('ticket_inventory', 'current').sold, 20);
  assert.equal(db.ids('tickets').length, 20);
});

test('concurrent free orders cannot exceed remaining seat budget and rejected inventory spends no budget', async () => {
  const { deps, db } = setup({ catalogPatch: FREE_CATALOG });
  assert.equal((await checkout(deps, freeRequest('free-budget-initial1', 19))).statusCode, 200);
  const results = await Promise.all([
    checkout(deps, freeRequest('free-budget-racing01', 1)),
    checkout(deps, freeRequest('free-budget-racing02', 1)),
  ]);
  assert.deepEqual(results.map((res) => res.statusCode).sort(), [200, 403]);
  assert.equal(db.read('ticket_inventory', 'current').sold, 20);
  const other = setup({ catalogPatch: { ...FREE_CATALOG, capacity: 1 } });
  assert.equal((await checkout(other.deps, freeRequest('free-budget-too-big', 2))).statusCode, 409);
  assert.equal(other.db.ids('ticket_inventory').length, 0);
  assert.equal((await checkout(other.deps, freeRequest('free-budget-valid01', 1))).statusCode, 200);
});

test('duplicate free recipients are rejected within and across orders and purchasers without disclosing ownership', async () => {
  const { deps, db } = setup({ catalogPatch: FREE_CATALOG });
  const duplicate = request({ lines: [{ ticketTypeId: 'general', quantity: 2,
    attendees: [PERSON, { ...PERSON, email: 'ADA@EXAMPLE.COM' }] }] });
  assert.equal((await checkout(deps, duplicate)).body.error.code, 'duplicate-free-recipient');
  assert.equal(db.ids('tickets').length, 0);
  const first = await checkout(deps);
  const writes = db.writes.length;
  const denied = await checkout(deps, request({ requestId: 'free-duplicate-other' }), 'bob');
  assert.equal(denied.body.error.code, 'duplicate-free-recipient');
  assert.equal(JSON.stringify(denied.body).includes(first.body.orderId), false);
  assert.equal(db.writes.length, writes);
});

test('free seats in mixed paid orders spend the same budget and malformed counters fail closed', async () => {
  const { deps, db } = setup({ catalogPatch: { ticketTypes: [
    ...FREE_CATALOG.ticketTypes,
    { id: 'student', name: 'Paid pass', unitAmount: 1000, capacity: 100 },
  ] } });
  assert.equal((await checkout(deps, freeRequest('mixed-budget-first01', 20))).statusCode, 200);
  const mixed = freeRequest('mixed-budget-second1', 1);
  mixed.lines.push({ ticketTypeId: 'student', quantity: 1, attendees: [PERSON] });
  assert.equal((await checkout(deps, mixed)).body.error.code, 'free-seat-limit');
  const budgetId = db.ids('ticket_inventory').find((id) => id.startsWith('free_budget_'));
  await db.collection('ticket_inventory').doc(budgetId).set({ allocated: -1 });
  assert.equal((await checkout(deps, freeRequest('mixed-budget-corrupt', 1))).statusCode, 503);
});

test('the catalog can lower the cumulative free budget and duplicates cannot hide in another type', async () => {
  const { deps, db } = setup({ catalogPatch: { maxPerOrder: 2, ticketTypes: [
    ...FREE_CATALOG.ticketTypes,
    { id: 'student', name: 'Other free pass', unitAmount: 0, capacity: 100 },
  ] } });
  const duplicate = request({ lines: [
    { ticketTypeId: 'general', quantity: 1, attendees: [PERSON] },
    { ticketTypeId: 'student', quantity: 1, attendees: [PERSON] },
  ] });
  assert.equal((await checkout(deps, duplicate)).body.error.code, 'duplicate-free-recipient');
  assert.equal((await checkout(deps, freeRequest('catalog-budget-first', 2))).statusCode, 200);
  assert.equal((await checkout(deps, freeRequest('catalog-budget-next1', 1))).body.error.code, 'free-seat-limit');
  assert.equal(db.read('ticket_inventory', 'current').sold, 2);
});
