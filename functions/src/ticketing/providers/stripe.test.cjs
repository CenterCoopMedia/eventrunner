'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Stripe = require('stripe');
const { makeFakeDb } = require('../../cms/firestoreFake.cjs');
const { createStripeProvider, stripeScope, internals } = require('./stripe.cjs');
const { getTicketingProvider, ticketingSecretNames, providerNameSupportsWebhooks } = require('./index.cjs');
const { createTicketingWebhookHandler } = require('../webhook.cjs');

const ENV = {
  EVENT_TICKETING_PROVIDER: 'stripe', EVENT_TICKETING_EVENT_ID: 'conference-1',
  EVENT_STRIPE_ACCOUNT_ID: 'acct_fixture', EVENT_STRIPE_MODE: 'test',
  TICKETING_WEBHOOK_SECRET: 'whsec_fixture', EVENT_PUBLIC_URL: 'https://event.example',
};
const ORDER = {
  id: 'ord_fixture', attemptId: 'att_fixture', eventId: 'conference-1', provider: 'stripe',
  stripeAccountId: 'acct_fixture', livemode: false, stripeSessionId: 'cs_test_fixture',
};
const METADATA = { eventRunnerOrderId: ORDER.id, eventRunnerEventId: ORDER.eventId, eventRunnerAttemptId: ORDER.attemptId };
const EVENT = { id: 'evt_fixture', object: 'event', type: 'checkout.session.completed', livemode: false,
  data: { object: { id: 'cs_test_fixture', object: 'checkout.session', metadata: METADATA } } };
const sdk = new Stripe('sk_test_fixture');

function signed(event = EVENT) {
  const rawBody = Buffer.from(JSON.stringify(event, null, 2));
  return { rawBody, body: event,
    headers: { 'stripe-signature': sdk.webhooks.generateTestHeaderString({ payload: rawBody, secret: ENV.TICKETING_WEBHOOK_SECRET }) } };
}

function fixture({ order = ORDER, event = EVENT, accountId = ENV.EVENT_STRIPE_ACCOUNT_ID, env = ENV } = {}) {
  const db = makeFakeDb({ [`ticket_orders/${ORDER.id}`]: order,
    [`ticket_payment_attempts/${ORDER.attemptId}`]: { id: ORDER.attemptId, orderId: ORDER.id } });
  const calls = { events: [], create: [] };
  const stripeClient = {
    webhooks: sdk.webhooks,
    accounts: { retrieve: async () => ({ id: accountId }) },
    events: { retrieve: async (id) => { calls.events.push(id); return event; } },
    paymentIntents: { retrieve: async () => ({ id: 'pi_fixture', metadata: METADATA }) },
    checkout: { sessions: { create: async (...args) => { calls.create.push(args); return { id: 'cs_test_fixture' }; } } },
    webhookEndpoints: { list: async () => ({ data: [], has_more: false }) },
  };
  return { db, stripeClient, calls, provider: createStripeProvider({ env, db, stripeClient }) };
}

test('Stripe registry and deploy secret capability preserve legacy providers', () => {
  const provider = getTicketingProvider({ env: ENV });
  assert.equal(provider.name, 'stripe');
  assert.equal(provider.stripeAccountId, ENV.EVENT_STRIPE_ACCOUNT_ID);
  assert.equal(provider.livemode, false);
  assert.equal(provider.requiresRawBody, true);
  assert.equal(providerNameSupportsWebhooks('stripe'), true);
  assert.deepEqual(ticketingSecretNames(ENV), ['TICKETING_API_TOKEN', 'TICKETING_WEBHOOK_SECRET']);
  assert.deepEqual(ticketingSecretNames({ EVENT_TICKETING_PROVIDER: 'none' }), []);
});

test('local payment readiness requires a nonempty secret key in the configured mode', () => {
  for (const [mode, token, expected] of [
    ['test', undefined, false], ['test', 'sk_test_', false],
    ['test', 'pk_test_fixture', false], ['test', 'sk_live_fixture', false],
    ['test', 'sk_test_fixture', true], ['test', 'rk_test_fixture', true],
    ['live', 'sk_test_fixture', false], ['live', 'sk_live_fixture', true],
    ['live', 'rk_live_fixture', true],
  ]) {
    const provider = createStripeProvider({ env: { ...ENV, EVENT_STRIPE_MODE: mode, TICKETING_API_TOKEN: token } });
    assert.equal(provider.hasPaymentCredentials, expected);
  }
});

test('Stripe account, event and explicit test/live mode are required; live is barred from demo/emulators', () => {
  for (const field of ['EVENT_STRIPE_ACCOUNT_ID', 'EVENT_TICKETING_EVENT_ID', 'EVENT_STRIPE_MODE']) {
    assert.throws(() => stripeScope({ ...ENV, [field]: '' }));
  }
  assert.throws(() => stripeScope({ ...ENV, EVENT_STRIPE_MODE: 'live', FUNCTIONS_EMULATOR: 'true' }), /live mode/);
  assert.throws(() => stripeScope({ ...ENV, EVENT_STRIPE_MODE: 'live', EVENT_FIREBASE_PROJECT_ID: 'demo-stripe' }), /live mode/);
});

test('official SDK verifies exact bytes, and independent account-scoped retrieval binds the order', async () => {
  const { provider, calls } = fixture();
  const delivery = signed();
  const result = await provider.verifyWebhook(delivery.rawBody, delivery.headers);
  assert.equal(result.valid, true);
  assert.equal(result.resourceId, ORDER.id);
  assert.match(result.deliveryId, /^stripe_[a-f0-9]{64}$/);
  assert.deepEqual(calls.events, [EVENT.id]);
  assert.equal((await provider.verifyWebhook(Buffer.from(JSON.stringify(EVENT)), delivery.headers)).valid, false);
  assert.equal((await provider.verifyWebhook(null, delivery.headers)).valid, false);
});

test('missing rawBody fails closed before provider verification even if reserialized body matches signature', async () => {
  const { db, provider } = fixture();
  const delivery = signed();
  let status;
  const res = { set() {}, status(value) { status = value; return res; }, json() { return res; } };
  await createTicketingWebhookHandler({ db, provider })({ method: 'POST', headers: delivery.headers, body: EVENT }, res);
  assert.equal(status, 401);
  assert.equal(db.ids('ticket_sync_queue').length, 0);
});

test('signed deliveries for another account, mode, conference or payment attempt cannot enqueue', async () => {
  const variants = [
    { ...EVENT, account: 'acct_other' },
    { ...EVENT, livemode: true },
    { ...EVENT, data: { object: { ...EVENT.data.object, metadata: { ...METADATA, eventRunnerEventId: 'other' } } } },
    { ...EVENT, data: { object: { ...EVENT.data.object, metadata: { ...METADATA, eventRunnerAttemptId: 'att_other' } } } },
    { ...EVENT, data: { object: { ...EVENT.data.object, id: 'cs_test_other' } } },
  ];
  for (const event of variants) {
    const { provider } = fixture({ event });
    const delivery = signed(event);
    assert.equal((await provider.verifyWebhook(delivery.rawBody, delivery.headers)).valid, false);
  }
  const { provider } = fixture({ accountId: 'acct_other' });
  const delivery = signed();
  await assert.rejects(provider.verifyWebhook(delivery.rawBody, delivery.headers), /account/);
});

test('verified Session delivery recovers a lost creation response only for the durable attempt', async () => {
  const { db, provider } = fixture({ order: { ...ORDER, stripeSessionId: null } });
  const delivery = signed();
  assert.equal((await provider.verifyWebhook(delivery.rawBody, delivery.headers)).valid, true);
  assert.equal(db.read('ticket_orders', ORDER.id).stripeSessionId, EVENT.data.object.id);
  assert.equal(db.read('ticket_payment_attempts', ORDER.attemptId).stripeSessionId, EVENT.data.object.id);
});

test('refund deliveries follow their PaymentIntent metadata, not an arbitrary caller address', async () => {
  const event = { ...EVENT, type: 'refund.updated', data: { object: { id: 're_fixture', payment_intent: 'pi_fixture', metadata: {} } } };
  const { provider } = fixture({ event });
  const delivery = signed(event);
  assert.equal((await provider.verifyWebhook(delivery.rawBody, delivery.headers)).resourceId, ORDER.id);
});

test('hosted card-only creation uses current SDK v23 parameters and persisted idempotency key', async () => {
  const { provider, calls } = fixture();
  const params = { mode: 'payment', ui_mode: 'hosted_page', allowed_payment_method_types: ['card'],
    adaptive_pricing: { enabled: false }, metadata: METADATA, payment_intent_data: { metadata: METADATA } };
  await provider.createCheckoutSession(params, { idempotencyKey: 'order-attempt-key' });
  assert.deepEqual(calls.create, [[params, { idempotencyKey: 'order-attempt-key' }]]);
  for (const change of [
    { ui_mode: 'embedded_page' }, { ui_mode: 'hosted' },
    { allowed_payment_method_types: ['card', 'us_bank_account'] }, { adaptive_pricing: { enabled: true } },
    { payment_intent_data: { metadata: METADATA, transfer_data: { destination: 'acct_other' } } },
  ]) await assert.rejects(provider.createCheckoutSession({ ...params, ...change }, { idempotencyKey: 'same' }));
  assert.equal(calls.create.length, 1);
});

test('webhook verification requires a precreated endpoint and never discards a generated secret', async () => {
  const { provider, stripeClient } = fixture();
  await assert.rejects(provider.registerWebhook({ callbackUrl: 'https://event.example/ticketingWebhook' }), /generated signing secret/);
  stripeClient.webhookEndpoints.list = async () => ({ data: [{ id: 'we_fixture', url: 'https://event.example/ticketingWebhook',
    status: 'enabled', livemode: false, enabled_events: internals.WEBHOOK_EVENTS }], has_more: false });
  assert.deepEqual(await provider.registerWebhook({ callbackUrl: 'https://event.example/ticketingWebhook' }), { webhookId: 'we_fixture' });
});

test('provider pagination is bounded and cannot silently omit refunds', async () => {
  let n = 0;
  await assert.rejects(internals.allProviderPages(async () => ({ data: [{ id: `re_${n++}` }], has_more: true }), {}), /bounded page limit/);
  assert.equal(n, 10);
});
