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
  const db = makeFakeDb({ 'config/event': { historicalDemo: false }, [`ticket_orders/${ORDER.id}`]: order,
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

test('registration prompts suppress entitled users for every trigger before reading configuration', async () => {
  const provider = createStripeProvider({
    env: ENV,
    getConfig: async () => assert.fail('An entitled user must not require configuration or Stripe credentials.'),
  });
  for (const context of [{ isSpeaker: true }, { hasClaimedTicket: true }]) {
    for (const trigger of ['account_created', 'ticket_unclaimed', 'admin_resend']) {
      const prompt = await provider.getRegistrationPrompt({ ...context, trigger });
      assert.equal(prompt.send, false);
      assert.equal(prompt.templateId, null);
      assert.equal(prompt.ctaUrl, null);
      assert.equal(prompt.action, null);
    }
  }
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

test('a frozen archive cannot read Stripe or recover a Session from a signed webhook', async () => {
  const { db, provider, calls } = fixture({ order: { ...ORDER, stripeSessionId: null } });
  await db.collection('config').doc('event').set({ historicalDemo: true });
  const delivery = signed();
  assert.equal((await provider.verifyWebhook(delivery.rawBody, delivery.headers)).eventType, 'ignored');
  assert.deepEqual(calls.events, []);
  assert.equal(db.read('ticket_orders', ORDER.id).stripeSessionId, null);
});

test('a freeze racing webhook Session recovery leaves the saved attempt unchanged', async () => {
  const { db, provider } = fixture({ order: { ...ORDER, stripeSessionId: null } });
  const attempt = db.read('ticket_payment_attempts', ORDER.attemptId);
  db.beforeCommit = async () => db.collection('config').doc('event').set({ historicalDemo: true });
  const delivery = signed();
  await provider.verifyWebhook(delivery.rawBody, delivery.headers);
  assert.equal(db.read('ticket_orders', ORDER.id).stripeSessionId, null);
  assert.deepEqual(db.read('ticket_payment_attempts', ORDER.attemptId), attempt);
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

// ------------------------------------------------------- invoice pay links (#519)

const INVOICE_ID = 'inv_0123456789abcdef0123';
const INVOICE_METADATA = { eventRunnerInvoiceId: INVOICE_ID, eventRunnerEventId: 'conference-1', eventRunnerPayLinkId: 'pl_000000000000000000000001' };
function invoiceParams(patch = {}) {
  return {
    mode: 'payment', ui_mode: 'hosted_page', allowed_payment_method_types: ['card'],
    adaptive_pricing: { enabled: false }, automatic_tax: { enabled: false }, allow_promotion_codes: false,
    client_reference_id: INVOICE_ID,
    line_items: [{ price_data: { currency: 'usd', unit_amount: 450000, product_data: { name: 'Invoice INV-0007' } }, quantity: 1 }],
    metadata: INVOICE_METADATA,
    payment_intent_data: { metadata: INVOICE_METADATA, description: 'Invoice INV-0007' },
    expires_at: 1761000000, success_url: 'https://event.example/', cancel_url: 'https://event.example/',
    ...patch,
  };
}

test('an invoice Checkout Session is one fixed card amount for one invoice of this event, and nothing else', async () => {
  const { provider, calls } = fixture();
  await provider.createInvoiceCheckoutSession(invoiceParams(), { idempotencyKey: 'invoice-pay-link:key' });
  assert.equal(calls.create.length, 1);
  assert.deepEqual(calls.create[0][1], { idempotencyKey: 'invoice-pay-link:key' });
  for (const change of [
    { ui_mode: 'embedded_page' }, { mode: 'subscription' },
    { allowed_payment_method_types: ['card', 'us_bank_account'] }, { adaptive_pricing: { enabled: true } },
    { automatic_tax: { enabled: true } }, { allow_promotion_codes: true },
    { line_items: [{ price_data: { currency: 'usd', unit_amount: 450000, product_data: { name: 'x' } }, quantity: 2 }] },
    { line_items: [{ price: 'price_123', quantity: 1 }] },
    { line_items: [...invoiceParams().line_items, ...invoiceParams().line_items] },
    { metadata: { ...INVOICE_METADATA, eventRunnerEventId: 'other' } },
    { metadata: { ...INVOICE_METADATA, eventRunnerOrderId: ORDER.id } },
    { metadata: { ...INVOICE_METADATA, eventRunnerInvoiceId: '../x' } },
    { payment_intent_data: { metadata: { ...INVOICE_METADATA, eventRunnerPayLinkId: 'pl_other' } } },
    { payment_intent_data: { metadata: INVOICE_METADATA, transfer_data: { destination: 'acct_other' } } },
    { payment_intent_data: { metadata: INVOICE_METADATA, application_fee_amount: 100 } },
  ]) {
    await assert.rejects(provider.createInvoiceCheckoutSession(invoiceParams(change), { idempotencyKey: 'same' }), JSON.stringify(change));
  }
  await assert.rejects(provider.createInvoiceCheckoutSession(invoiceParams(), {}));
  // The ticket policy refuses an invoice request, and the invoice policy refuses a ticket request.
  await assert.rejects(provider.createCheckoutSession(invoiceParams(), { idempotencyKey: 'same' }));
  assert.equal(calls.create.length, 1);
});

test('a Session event for an invoice routes to the invoice, and its PaymentIntent events are acknowledged only', async () => {
  const session = { id: 'cs_test_invoice', object: 'checkout.session', metadata: INVOICE_METADATA };
  const event = { ...EVENT, id: 'evt_invoice', data: { object: session } };
  const { provider } = fixture({ event });
  const delivery = signed(event);
  const result = await provider.verifyWebhook(delivery.rawBody, delivery.headers);
  assert.equal(result.valid, true);
  assert.equal(result.eventType, 'invoice.checkout');
  assert.equal(result.resourceId, INVOICE_ID);
  assert.equal(result.sessionId, 'cs_test_invoice');
  assert.match(result.deliveryId, /^stripe_[a-f0-9]{64}$/);

  const otherEvent = { ...event, id: 'evt_invoice_other', data: { object: { ...session, metadata: { ...INVOICE_METADATA, eventRunnerEventId: 'other' } } } };
  const other = fixture({ event: otherEvent });
  const refused = signed(otherEvent);
  assert.deepEqual(await other.provider.verifyWebhook(refused.rawBody, refused.headers), { valid: false, reason: 'wrong_event' });

  const intent = { ...EVENT, id: 'evt_pi', type: 'payment_intent.succeeded', data: { object: { id: 'pi_invoice', metadata: INVOICE_METADATA } } };
  const pi = fixture({ event: intent });
  const piDelivery = signed(intent);
  const acknowledged = await pi.provider.verifyWebhook(piDelivery.rawBody, piDelivery.headers);
  assert.equal(acknowledged.valid, true);
  assert.equal(acknowledged.eventType, 'ignored');
});
