'use strict';

// The Stripe pay link of an issued invoice (issue #519). No network: the
// official SDK signs each webhook body with a fixture secret, and a fake
// Stripe client answers the account, event, and Checkout Session calls the
// provider makes. Each test drives the real invoiceAdmin handler and the
// real ticketing webhook handler over one in-memory database.
const test = require('node:test');
const assert = require('node:assert/strict');
const Stripe = require('stripe');
const { makeFakeDb } = require('../cms/firestoreFake.cjs');
const { createInvoiceAdminHandler } = require('./invoices.cjs');
const { createStripeProvider } = require('../ticketing/providers/stripe.cjs');
const { createTicketingWebhookHandler } = require('../ticketing/webhook.cjs');
const { currentPayLink, payLinkExpiryText, internals: { LINK_LIFETIME_MS } } = require('./invoicePayLink.cjs');

const NOW = new Date('2026-10-20T12:00:00Z');
const ID = 'inv_0123456789abcdef0123';
const ENV = {
  EVENT_TICKETING_PROVIDER: 'stripe', EVENT_TICKETING_EVENT_ID: 'conference-1',
  EVENT_STRIPE_ACCOUNT_ID: 'acct_fixture', EVENT_STRIPE_MODE: 'test',
  TICKETING_WEBHOOK_SECRET: 'whsec_fixture', EVENT_PUBLIC_URL: 'https://event.example',
};
const sdk = new Stripe('sk_test_fixture');
const auth = { async verifyIdToken(token) { return { uid: token, email: `${token}@example.org`, email_verified: true }; } };
const getConfig = async () => ({ event: { historicalDemo: false } });

function issued(patch = {}) {
  return {
    status: 'issued', number: 'INV-0007', sequence: 7, currency: 'usd',
    billTo: { organizationId: 'example-press', name: 'Example Press', contactName: 'Ada Example', email: 'billing@example.org', address: '1 Main Street' },
    reference: 'PO-77', notes: '', dueDate: '2026-11-30', issueDate: '2026-10-20',
    lines: [{ description: 'Presenting package', quantity: 1, unitAmount: 450000, amount: 450000 }],
    adjustments: [],
    totals: { subtotal: 450000, discountTotal: 0, taxTotal: 0, total: 450000 },
    issuer: { name: 'Example Events', address: '', email: 'billing@events.example', taxId: '', paymentInstructions: 'Bank transfer.' },
    issuedAt: NOW, issuedBy: 'staff', revision: 4, createdAt: NOW, updatedAt: NOW, listKey: `${NOW.toISOString()}|${ID}`,
    ...patch,
  };
}

/** A Stripe test-mode account in memory: sessions by id and by idempotency key. */
function fakeStripe() {
  const sessions = new Map();
  const byKey = new Map();
  const events = new Map();
  const calls = { create: [], expire: [], retrieve: [] };
  const faults = { create: null, expire: null };
  let count = 0;
  const client = {
    webhooks: sdk.webhooks,
    accounts: { retrieve: async () => ({ id: 'acct_fixture' }) },
    events: { retrieve: async (id) => structuredClone(events.get(id)) },
    paymentIntents: { retrieve: async (id) => ({ id, metadata: {} }) },
    checkout: {
      sessions: {
        async create(params, options) {
          calls.create.push({ params: structuredClone(params), options: { ...options } });
          if (faults.create) { const fault = faults.create; faults.create = null; throw fault; }
          if (byKey.has(options.idempotencyKey)) return structuredClone(byKey.get(options.idempotencyKey));
          count += 1;
          const id = `cs_test_${String(count).padStart(4, '0')}`;
          const line = params.line_items[0];
          const session = {
            id, object: 'checkout.session', livemode: false, mode: 'payment', status: 'open', payment_status: 'unpaid',
            url: `https://checkout.stripe.com/c/pay/${id}#fragment`, currency: line.price_data.currency,
            amount_total: line.price_data.unit_amount * line.quantity, metadata: { ...params.metadata },
            expires_at: params.expires_at, payment_intent: null, created: Math.floor(NOW.getTime() / 1000),
          };
          sessions.set(id, session);
          byKey.set(options.idempotencyKey, session);
          return structuredClone(session);
        },
        async retrieve(id) { calls.retrieve.push(id); return structuredClone(sessions.get(id)); },
        async expire(id) {
          calls.expire.push(id);
          if (faults.expire) { const fault = faults.expire; faults.expire = null; throw fault; }
          const session = sessions.get(id);
          if (session.status !== 'open') throw Object.assign(new Error('Only open sessions can be expired.'), { type: 'StripeInvalidRequestError', statusCode: 400 });
          session.status = 'expired';
          return structuredClone(session);
        },
      },
    },
  };
  return {
    client, sessions, calls, faults,
    /** The payer completes the hosted page; `patch` changes what Stripe reports. */
    pay(id, patch = {}) {
      const session = sessions.get(id);
      Object.assign(session, { status: 'complete', payment_status: 'paid', payment_intent: `pi_${id.slice(3)}` }, patch);
      return session;
    },
    /** A signed delivery for one event about a session, as Stripe would POST it. */
    delivery(eventId, type, sessionId, { secret = ENV.TICKETING_WEBHOOK_SECRET, account } = {}) {
      const event = { id: eventId, object: 'event', type, livemode: false, ...(account ? { account } : {}), data: { object: structuredClone(sessions.get(sessionId)) } };
      events.set(eventId, event);
      const rawBody = Buffer.from(JSON.stringify(event));
      return { method: 'POST', rawBody, body: event, headers: { 'stripe-signature': sdk.webhooks.generateTestHeaderString({ payload: rawBody, secret }) }, query: {} };
    },
  };
}

function resOf() {
  return {
    statusCode: 0, body: null, headers: {},
    set(key, value) { this.headers[key] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function setup({ invoice = issued(), stripe = true, extra = {} } = {}) {
  const db = makeFakeDb({
    'config/bootstrap': { adminEmails: ['operator@example.org'], staffEmails: ['staff@example.org'] },
    'config/event': { historicalDemo: false, timezone: 'America/New_York' },
    [`invoices/${ID}`]: invoice,
    ...extra,
  });
  const fake = fakeStripe();
  let clock = 0;
  const now = () => new Date(NOW.getTime() + (clock += 1000));
  const logs = [];
  const log = { error: (...args) => logs.push(args), warn: (...args) => logs.push(args), info: (...args) => logs.push(args) };
  const provider = createStripeProvider({ env: ENV, db, stripeClient: fake.client, now });
  const getPayments = stripe
    ? () => ({ available: true, provider, publicUrl: 'https://event.example', testMode: true })
    : () => ({ available: false, reason: 'Card payment links need Stripe. This site does not take card payments through Stripe.' });
  const admin = createInvoiceAdminHandler({ db, auth, getConfig, now, log, getPayments });
  const webhook = createTicketingWebhookHandler({ db, provider, now, log });
  return {
    db, fake, logs, provider,
    advance(ms) { clock += ms; },
    async call(body, user = 'staff') {
      const res = resOf();
      await admin({ method: 'POST', body, headers: { authorization: `Bearer ${user}` } }, res);
      return res;
    },
    async deliver(request) {
      const res = resOf();
      await webhook(request, res);
      return res;
    },
    stored: () => db.read('invoices', ID),
    audits: () => db.ids('admin_logs').map((id) => db.read('admin_logs', id)),
    alerts: () => db.ids('system_errors').map((id) => db.read('system_errors', id)),
  };
}

test('without Stripe the invoice says so, and no link is made', async () => {
  const env = setup({ stripe: false });
  const got = await env.call({ action: 'get', invoiceId: ID });
  assert.equal(got.statusCode, 200);
  assert.deepEqual(got.body.cardPayments, {
    available: false, testMode: false, reason: 'Card payment links need Stripe. This site does not take card payments through Stripe.',
  });
  assert.deepEqual(got.body.invoice.payLinks, []);
  const refused = await env.call({ action: 'createPayLink', invoiceId: ID });
  assert.equal(refused.statusCode, 409);
  assert.equal(refused.body.error.code, 'pay-links-unavailable');
  assert.equal(env.stored().payLinks, undefined);
  // Void still works with no Stripe at all.
  const voided = await env.call({ action: 'void', invoiceId: ID, expectedRevision: 4, reason: 'Wrong amount' }, 'operator');
  assert.equal(voided.statusCode, 200);
});

test('the server builds the Checkout Session from the frozen invoice, never from the request', async () => {
  const env = setup();
  const res = await env.call({
    action: 'createPayLink', invoiceId: ID, amount: 1, currency: 'eur', unitAmount: 1, payLinks: [{ status: 'paid' }],
  });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(env.fake.calls.create.length, 1);
  const { params, options } = env.fake.calls.create[0];
  assert.equal(params.mode, 'payment');
  assert.equal(params.ui_mode, 'hosted_page');
  assert.deepEqual(params.allowed_payment_method_types, ['card']);
  assert.deepEqual(params.adaptive_pricing, { enabled: false });
  assert.deepEqual(params.automatic_tax, { enabled: false });
  assert.equal(params.allow_promotion_codes, false);
  assert.equal(params.line_items.length, 1);
  assert.equal(params.line_items[0].quantity, 1);
  assert.equal(params.line_items[0].price_data.currency, 'usd');
  assert.equal(params.line_items[0].price_data.unit_amount, 450000);
  assert.equal(params.line_items[0].price_data.product_data.name, 'Invoice INV-0007');
  assert.equal(params.payment_intent_data.description, 'Invoice INV-0007 from Example Events');
  assert.equal(params.client_reference_id, ID);
  assert.equal(params.customer_email, 'billing@example.org');
  assert.equal(params.metadata.eventRunnerInvoiceId, ID);
  assert.equal(params.metadata.eventRunnerEventId, 'conference-1');
  assert.match(params.metadata.eventRunnerPayLinkId, /^pl_[a-f0-9]{24}$/);
  assert.equal(params.metadata.eventRunnerOrderId, undefined);
  assert.deepEqual(params.payment_intent_data.metadata, params.metadata);
  assert.equal(params.success_url, 'https://event.example/');
  assert.equal(params.cancel_url, 'https://event.example/');
  assert.equal(params.expires_at * 1000 - (NOW.getTime() + 1000), LINK_LIFETIME_MS);
  assert.equal(options.idempotencyKey, `invoice-pay-link:${ID}:${params.metadata.eventRunnerPayLinkId}`);

  const link = res.body.invoice.payLinks[0];
  assert.equal(link.status, 'open');
  assert.equal(link.url, 'https://checkout.stripe.com/c/pay/cs_test_0001#fragment');
  assert.equal(link.sessionId, 'cs_test_0001');
  assert.equal(link.amount, 450000);
  assert.equal(link.currency, 'usd');
  assert.equal(link.livemode, false);
  assert.equal(link.createdBy, 'staff');
  assert.equal(res.body.cardPayments.available, true);
  assert.equal(res.body.cardPayments.testMode, true);
  // The frozen request and its key are not kept once the link is open, and never answered.
  assert.equal(env.stored().payLinks[0].request, undefined);
  assert.equal(JSON.stringify(res.body).includes('idempotencyKey'), false);
  // Making a link does not change the invoice itself.
  assert.equal(env.stored().revision, 4);
  assert.deepEqual(env.audits().map((row) => row.action), ['invoices.pay-link-created']);
  assert.equal(env.audits()[0].details.sessionId, 'cs_test_0001');
});

test('a second press answers the same open link and asks Stripe for nothing', async () => {
  const env = setup();
  const first = await env.call({ action: 'createPayLink', invoiceId: ID });
  const again = await env.call({ action: 'createPayLink', invoiceId: ID });
  assert.equal(again.statusCode, 200);
  assert.equal(again.body.repeated, true);
  assert.equal(again.body.invoice.payLinks.length, 1);
  assert.equal(again.body.invoice.payLinks[0].url, first.body.invoice.payLinks[0].url);
  assert.equal(env.fake.calls.create.length, 1);
  // Once the link has run out, a press makes a new one, and the old one reads Expired.
  env.advance(LINK_LIFETIME_MS);
  const fresh = await env.call({ action: 'createPayLink', invoiceId: ID });
  assert.equal(fresh.statusCode, 200);
  assert.deepEqual(fresh.body.invoice.payLinks.map((link) => link.status), ['expired', 'open']);
  assert.equal(fresh.body.invoice.payLinks[0].url, null);
  assert.equal(env.fake.calls.create.length, 2);
});

test('only an issued invoice with a payable total gets a link, and a read-only demo refuses', async () => {
  for (const [invoice, code] of [
    [issued({ status: 'draft', number: null }), 'conflict'],
    [issued({ status: 'void', voided: { reason: 'x', from: 'issued', at: NOW, by: 'operator' } }), 'conflict'],
    [issued({ status: 'paid', payment: { paidOn: '2026-10-20', method: 'check', note: '' } }), 'conflict'],
    [issued({ totals: { subtotal: 40, discountTotal: 0, taxTotal: 0, total: 40 } }), 'amount-out-of-range'],
    [issued({ totals: { subtotal: 100000000, discountTotal: 0, taxTotal: 0, total: 100000000 } }), 'amount-out-of-range'],
    [issued({ currency: 'jpy' }), 'conflict'],
  ]) {
    const env = setup({ invoice });
    const res = await env.call({ action: 'createPayLink', invoiceId: ID });
    assert.equal(res.statusCode, 409, `${invoice.status} ${invoice.totals.total} ${invoice.currency}`);
    assert.equal(res.body.error.code, code);
    assert.equal(env.fake.calls.create.length, 0);
  }
  const demo = setup({ extra: { 'config/event': { historicalDemo: true } } });
  const res = await demo.call({ action: 'createPayLink', invoiceId: ID });
  assert.equal(res.statusCode, 403);
  assert.equal(demo.fake.calls.create.length, 0);
});

test('a lost Stripe answer is retried with the same frozen request and key, so no second session exists', async () => {
  const env = setup();
  env.fake.faults.create = Object.assign(new Error('socket hang up'), { type: 'StripeConnectionError' });
  const lost = await env.call({ action: 'createPayLink', invoiceId: ID });
  assert.equal(lost.statusCode, 503);
  assert.equal(lost.body.error.code, 'stripe-unavailable');
  assert.equal(env.stored().payLinks[0].status, 'creating');
  const retried = await env.call({ action: 'createPayLink', invoiceId: ID });
  assert.equal(retried.statusCode, 200, JSON.stringify(retried.body));
  const [first, second] = env.fake.calls.create;
  assert.deepEqual(second.params, first.params);
  assert.equal(second.options.idempotencyKey, first.options.idempotencyKey);
  assert.equal(retried.body.invoice.payLinks.length, 1);
  assert.equal(retried.body.invoice.payLinks[0].status, 'open');
  // Stripe refusing the request is final: the attempt is closed, and the next press starts a new one.
  const refusedEnv = setup();
  refusedEnv.fake.faults.create = Object.assign(new Error('Invalid currency for account'), { type: 'StripeInvalidRequestError', statusCode: 400 });
  const refused = await refusedEnv.call({ action: 'createPayLink', invoiceId: ID });
  assert.equal(refused.statusCode, 502);
  assert.equal(refused.body.error.code, 'stripe-refused');
  assert.equal(refused.body.error.message.includes('Invalid currency'), false);
  assert.equal(refusedEnv.stored().payLinks[0].status, 'failed');
  const next = await refusedEnv.call({ action: 'createPayLink', invoiceId: ID });
  assert.equal(next.statusCode, 200);
  assert.notEqual(refusedEnv.fake.calls.create[1].options.idempotencyKey, refusedEnv.fake.calls.create[0].options.idempotencyKey);
});

test('a Stripe answer that does not match the invoice is never shown, and the session is expired', async () => {
  const env = setup();
  const create = env.fake.client.checkout.sessions.create;
  env.fake.client.checkout.sessions.create = async (params, options) => ({ ...(await create(params, options)), amount_total: 1 });
  const res = await env.call({ action: 'createPayLink', invoiceId: ID });
  assert.equal(res.statusCode, 502);
  assert.equal(env.stored().payLinks[0].status, 'failed');
  assert.equal(env.stored().payLinks[0].url, undefined);
  assert.deepEqual(env.fake.calls.expire, ['cs_test_0001']);
});

test('a signed payment marks the invoice paid by card through Stripe, with the ids and an audit row, once', async () => {
  const env = setup();
  const made = await env.call({ action: 'createPayLink', invoiceId: ID });
  const sessionId = made.body.invoice.payLinks[0].sessionId;
  env.fake.pay(sessionId);
  const delivery = env.fake.delivery('evt_paid_1', 'checkout.session.completed', sessionId);
  const res = await env.deliver(delivery);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.invoice, 'paid');

  const stored = env.stored();
  assert.equal(stored.status, 'paid');
  assert.equal(stored.revision, 5);
  assert.equal(stored.payment.method, 'card');
  assert.equal(stored.payment.via, 'stripe');
  assert.equal(stored.payment.paidOn, '2026-10-20');
  assert.deepEqual(stored.payment.stripe, { sessionId, paymentIntentId: 'pi_test_0001' });
  assert.equal(stored.payLinks[0].status, 'paid');
  const paid = env.audits().filter((row) => row.action === 'invoices.paid');
  assert.equal(paid.length, 1);
  assert.equal(paid[0].uid, null);
  assert.equal(paid[0].actor, 'stripe');
  assert.equal(paid[0].details.via, 'stripe');
  assert.equal(paid[0].details.paymentIntentId, 'pi_test_0001');
  assert.equal(paid[0].details.amount, 450000);
  // The delivery claim is part of the same commit.
  assert.equal(env.db.ids('ticket_webhook_deliveries').length, 1);
  assert.equal(env.db.ids('ticket_sync_queue').length, 0);

  // Stripe retries the same event: nothing changes.
  const replay = await env.deliver(env.fake.delivery('evt_paid_1', 'checkout.session.completed', sessionId));
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.body.duplicate, true);
  // A second event about the same payment: still one payment, one audit row.
  const second = await env.deliver(env.fake.delivery('evt_paid_2', 'checkout.session.async_payment_succeeded', sessionId));
  assert.equal(second.statusCode, 200);
  assert.equal(second.body.invoice, 'already-recorded');
  assert.equal(env.stored().revision, 5);
  assert.equal(env.audits().filter((row) => row.action === 'invoices.paid').length, 1);
  assert.equal(env.alerts().length, 0);

  const got = await env.call({ action: 'get', invoiceId: ID });
  assert.deepEqual(got.body.invoice.payment.stripe, { sessionId, paymentIntentId: 'pi_test_0001' });
  assert.equal(got.body.invoice.payment.via, 'stripe');
  assert.equal(got.body.invoice.payment.recordedBy, null);
  // A paid invoice refuses a new link.
  assert.equal((await env.call({ action: 'createPayLink', invoiceId: ID })).statusCode, 409);
});

test('a payment after a void is recorded and flagged for the operator, never applied', async () => {
  const env = setup();
  const made = await env.call({ action: 'createPayLink', invoiceId: ID });
  const sessionId = made.body.invoice.payLinks[0].sessionId;
  // The payer is on the hosted page when the operator voids; Stripe cannot close a page that is completing.
  env.fake.pay(sessionId);
  const voided = await env.call({ action: 'void', invoiceId: ID, expectedRevision: 4, reason: 'Wrong amount' }, 'operator');
  assert.equal(voided.statusCode, 200, JSON.stringify(voided.body));
  assert.equal(voided.body.invoice.payLinks[0].status, 'cancelled');
  assert.equal(voided.body.invoice.payLinks[0].closedReason, 'void');
  assert.equal(voided.body.invoice.payLinks[0].stripeClosed, false);
  assert.deepEqual(env.fake.calls.expire, [sessionId]);

  const res = await env.deliver(env.fake.delivery('evt_late', 'checkout.session.completed', sessionId));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.invoice, 'flagged');
  const stored = env.stored();
  assert.equal(stored.status, 'void');
  assert.equal(stored.payment, undefined);
  assert.equal(stored.paymentReviews.length, 1);
  assert.equal(stored.paymentReviews[0].code, 'invoice-void');
  assert.equal(stored.paymentReviews[0].amount, 450000);
  assert.equal(stored.paymentReviews[0].paymentIntentId, 'pi_test_0001');
  assert.equal(stored.paymentReviews[0].resolved, false);
  const flagged = env.audits().filter((row) => row.action === 'invoices.stripe-payment-flagged');
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].details.code, 'invoice-void');
  const alerts = env.alerts();
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].kind, 'invoice-payment-review');
  assert.match(alerts[0].message, /INV-0007/);
  assert.equal(alerts[0].message.includes('billing@example.org'), false);
  // The list says the invoice needs review.
  const list = await env.call({ action: 'list' });
  assert.equal(list.body.invoices[0].needsReview, true);
  // A replay flags nothing new.
  await env.deliver(env.fake.delivery('evt_late_2', 'checkout.session.async_payment_succeeded', sessionId));
  assert.equal(env.stored().paymentReviews.length, 1);
  assert.equal(env.alerts().length, 1);

  // Only an operator closes the review, with a note.
  const review = env.stored().paymentReviews[0];
  const staff = await env.call({ action: 'resolvePaymentReview', invoiceId: ID, reviewId: review.reviewId, note: 'Refunded' });
  assert.equal(staff.statusCode, 403);
  const empty = await env.call({ action: 'resolvePaymentReview', invoiceId: ID, reviewId: review.reviewId, note: '' }, 'operator');
  assert.equal(empty.statusCode, 400);
  const resolved = await env.call({ action: 'resolvePaymentReview', invoiceId: ID, reviewId: review.reviewId, note: 'Refunded in the Stripe Dashboard' }, 'operator');
  assert.equal(resolved.statusCode, 200, JSON.stringify(resolved.body));
  assert.equal(resolved.body.invoice.paymentReviews[0].resolved, true);
  assert.equal(resolved.body.invoice.paymentReviews[0].note, 'Refunded in the Stripe Dashboard');
  assert.equal(resolved.body.invoice.needsReview, false);
  assert.ok(env.audits().some((row) => row.action === 'invoices.payment-review-resolved'));
});

test('void and a payment recorded by hand close an open link, and Stripe expires it', async () => {
  const env = setup();
  const made = await env.call({ action: 'createPayLink', invoiceId: ID });
  const sessionId = made.body.invoice.payLinks[0].sessionId;
  const paid = await env.call({ action: 'markPaid', invoiceId: ID, expectedRevision: 4, payment: { paidOn: '2026-10-20', method: 'bank-transfer', note: '' } });
  assert.equal(paid.statusCode, 200);
  assert.equal(paid.body.invoice.payLinks[0].status, 'cancelled');
  assert.equal(paid.body.invoice.payLinks[0].closedReason, 'paid');
  assert.equal(paid.body.invoice.payLinks[0].stripeClosed, true);
  assert.equal(paid.body.invoice.payLinks[0].url, null);
  assert.deepEqual(env.fake.calls.expire, [sessionId]);
  assert.equal(env.fake.sessions.get(sessionId).status, 'expired');
  assert.equal(currentPayLink(paid.body.invoice, new Date(NOW.getTime() + 60000)), null);

  // Stripe cannot be reached: the void still happens, and the record says the link may still work.
  const other = setup();
  const link = await other.call({ action: 'createPayLink', invoiceId: ID });
  other.fake.faults.expire = Object.assign(new Error('timeout'), { type: 'StripeConnectionError' });
  const voided = await other.call({ action: 'void', invoiceId: ID, expectedRevision: 4, reason: 'Duplicate' }, 'operator');
  assert.equal(voided.statusCode, 200);
  assert.equal(voided.body.invoice.status, 'void');
  assert.equal(voided.body.invoice.payLinks[0].status, 'cancelled');
  assert.equal(voided.body.invoice.payLinks[0].stripeClosed, false);
  assert.equal(voided.body.invoice.payLinks[0].expiresAt, link.body.invoice.payLinks[0].expiresAt);
  // The error text is not logged; only a code.
  assert.equal(JSON.stringify(other.logs).includes('timeout'), false);
});

test('a currency or amount that does not match the invoice is flagged, not applied', async () => {
  for (const [patch, code] of [[{ currency: 'cad' }, 'currency-mismatch'], [{ amount_total: 1 }, 'amount-mismatch']]) {
    const env = setup();
    const made = await env.call({ action: 'createPayLink', invoiceId: ID });
    const sessionId = made.body.invoice.payLinks[0].sessionId;
    env.fake.pay(sessionId, patch);
    const res = await env.deliver(env.fake.delivery(`evt_${code}`, 'checkout.session.completed', sessionId));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.invoice, 'flagged');
    assert.equal(env.stored().status, 'issued');
    assert.equal(env.stored().paymentReviews[0].code, code);
    assert.equal(env.alerts().length, 1);
  }
});

test('a payment through a session the invoice never stored is flagged', async () => {
  const env = setup();
  await env.call({ action: 'createPayLink', invoiceId: ID });
  // A second session made outside Event Runner with copied metadata.
  const params = structuredClone(env.fake.calls.create[0].params);
  params.metadata.eventRunnerPayLinkId = 'pl_000000000000000000000000';
  const stray = await env.fake.client.checkout.sessions.create(params, { idempotencyKey: 'outside' });
  env.fake.pay(stray.id);
  const res = await env.deliver(env.fake.delivery('evt_stray', 'checkout.session.completed', stray.id));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.invoice, 'flagged');
  assert.equal(env.stored().status, 'issued');
  assert.equal(env.stored().paymentReviews[0].code, 'unknown-session');
});

test('a completion that beats the create answer is matched by its pay link id', async () => {
  const env = setup();
  const create = env.fake.client.checkout.sessions.create;
  let made = null;
  env.fake.client.checkout.sessions.create = async (params, options) => {
    made = await create(params, options);
    throw Object.assign(new Error('socket hang up'), { type: 'StripeConnectionError' });
  };
  assert.equal((await env.call({ action: 'createPayLink', invoiceId: ID })).statusCode, 503);
  assert.equal(env.stored().payLinks[0].sessionId, undefined);
  env.fake.pay(made.id);
  const res = await env.deliver(env.fake.delivery('evt_early', 'checkout.session.completed', made.id));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.invoice, 'paid');
  assert.equal(env.stored().payLinks[0].sessionId, made.id);
  assert.equal(env.stored().payLinks[0].status, 'paid');
});

test('an expired session closes its link', async () => {
  const env = setup();
  const made = await env.call({ action: 'createPayLink', invoiceId: ID });
  const sessionId = made.body.invoice.payLinks[0].sessionId;
  env.fake.sessions.get(sessionId).status = 'expired';
  const res = await env.deliver(env.fake.delivery('evt_expired', 'checkout.session.expired', sessionId));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.invoice, 'expired');
  assert.equal(env.stored().payLinks[0].status, 'expired');
  assert.equal(env.stored().status, 'issued');
});

test('a spoofed or foreign delivery changes nothing', async () => {
  const env = setup();
  const made = await env.call({ action: 'createPayLink', invoiceId: ID });
  const sessionId = made.body.invoice.payLinks[0].sessionId;
  env.fake.pay(sessionId);
  const forged = await env.deliver(env.fake.delivery('evt_forged', 'checkout.session.completed', sessionId, { secret: 'whsec_attacker' }));
  assert.equal(forged.statusCode, 401);
  const foreign = await env.deliver(env.fake.delivery('evt_foreign', 'checkout.session.completed', sessionId, { account: 'acct_other' }));
  assert.equal(foreign.statusCode, 200);
  assert.equal(foreign.body.ignored, 'wrong_event');
  // The body says paid, but Stripe's own copy of the session does not: the fresh read wins.
  env.fake.sessions.get(sessionId).status = 'open';
  env.fake.sessions.get(sessionId).payment_status = 'unpaid';
  const event = env.fake.delivery('evt_claims_paid', 'checkout.session.completed', sessionId);
  const unpaid = await env.deliver(event);
  assert.equal(unpaid.statusCode, 200);
  assert.equal(unpaid.body.invoice, 'not-paid');
  // Another event's metadata is refused.
  env.fake.pay(sessionId);
  env.fake.sessions.get(sessionId).metadata.eventRunnerEventId = 'other-event';
  const other = await env.deliver(env.fake.delivery('evt_other_event', 'checkout.session.completed', sessionId));
  assert.equal(other.statusCode, 200);
  assert.equal(other.body.ignored, 'wrong_event');
  assert.equal(env.stored().status, 'issued');
  assert.equal(env.audits().filter((row) => row.action === 'invoices.paid').length, 0);
});

test('a read-only demo acknowledges a payment delivery and writes nothing', async () => {
  const env = setup();
  const made = await env.call({ action: 'createPayLink', invoiceId: ID });
  const sessionId = made.body.invoice.payLinks[0].sessionId;
  env.fake.pay(sessionId);
  await env.db.collection('config').doc('event').set({ historicalDemo: true });
  const res = await env.deliver(env.fake.delivery('evt_demo', 'checkout.session.completed', sessionId));
  assert.equal(res.statusCode, 200);
  assert.equal(env.stored().status, 'issued');
  assert.equal(env.db.ids('ticket_webhook_deliveries').length, 0);
});

test('reopening a card payment keeps it in the history, and a new link can be made', async () => {
  const env = setup();
  const made = await env.call({ action: 'createPayLink', invoiceId: ID });
  const sessionId = made.body.invoice.payLinks[0].sessionId;
  env.fake.pay(sessionId);
  await env.deliver(env.fake.delivery('evt_paid', 'checkout.session.completed', sessionId));
  const reopened = await env.call({ action: 'reopen', invoiceId: ID, expectedRevision: 5, reason: 'Disputed in Stripe' }, 'operator');
  assert.equal(reopened.statusCode, 200);
  assert.equal(reopened.body.invoice.status, 'issued');
  assert.equal(reopened.body.invoice.paymentHistory[0].via, 'stripe');
  assert.deepEqual(reopened.body.invoice.paymentHistory[0].stripe, { sessionId, paymentIntentId: 'pi_test_0001' });
  assert.equal(reopened.body.invoice.payLinks[0].status, 'paid');
  const fresh = await env.call({ action: 'createPayLink', invoiceId: ID });
  assert.equal(fresh.statusCode, 200);
  assert.deepEqual(fresh.body.invoice.payLinks.map((link) => link.status), ['paid', 'open']);
  // A replay of the first payment does not mark the reopened invoice paid again.
  const replay = await env.deliver(env.fake.delivery('evt_paid_again', 'checkout.session.completed', sessionId));
  assert.equal(replay.body.invoice, 'already-recorded');
  assert.equal(env.stored().status, 'issued');
});

test('the current link and its end time are read on the event clock', () => {
  const invoice = { status: 'issued', payLinks: [
    { linkId: 'pl_a', status: 'expired', url: null, expiresAt: '2026-10-20T10:00:00.000Z' },
    { linkId: 'pl_b', status: 'open', url: 'https://checkout.stripe.com/c/pay/cs_test_b', expiresAt: '2026-10-21T15:30:00.000Z', livemode: false },
  ] };
  assert.equal(currentPayLink(invoice, NOW).linkId, 'pl_b');
  assert.equal(currentPayLink(invoice, new Date('2026-10-21T15:30:00Z')), null);
  assert.equal(currentPayLink({ ...invoice, status: 'paid' }, NOW), null);
  assert.equal(payLinkExpiryText('2026-10-21T15:30:00.000Z', 'America/New_York'), 'October 21, 2026, 11:30 AM EDT');
  assert.equal(payLinkExpiryText('2026-10-21T15:30:00.000Z', 'Not/AZone'), 'October 21, 2026, 3:30 PM UTC');
});

test('the deployed handler offers card links only with the Stripe provider and a key for its mode', () => {
  const { internals: { stripePayments } } = require('./invoices.cjs');
  const db = makeFakeDb({});
  assert.deepEqual(stripePayments({ db, env: { EVENT_TICKETING_PROVIDER: 'manual' } }), {
    available: false, reason: 'Card payment links need Stripe. This site does not take card payments through Stripe.',
  });
  const noKey = stripePayments({ db, env: ENV });
  assert.equal(noKey.available, false);
  assert.match(noKey.reason, /not fully set up/);
  assert.equal(stripePayments({ db, env: { ...ENV, TICKETING_API_TOKEN: 'sk_live_fixture' } }).available, false);
  assert.equal(stripePayments({ db, env: { ...ENV, EVENT_STRIPE_ACCOUNT_ID: '', TICKETING_API_TOKEN: 'sk_test_fixture' } }).available, false);
  const ready = stripePayments({ db, env: { ...ENV, TICKETING_API_TOKEN: 'sk_test_fixture' } });
  assert.equal(ready.available, true);
  assert.equal(ready.testMode, true);
  assert.equal(ready.publicUrl, 'https://event.example');
});

test('two presses at once share one session, and neither closes the link the other opened', async () => {
  const env = setup();
  const [first, second] = await Promise.all([
    env.call({ action: 'createPayLink', invoiceId: ID }),
    env.call({ action: 'createPayLink', invoiceId: ID }),
  ]);
  assert.deepEqual([first.statusCode, second.statusCode], [200, 200], JSON.stringify([first.body, second.body]));
  const stored = env.stored();
  assert.equal(stored.payLinks.length, 1);
  assert.equal(stored.payLinks[0].status, 'open');
  assert.equal(env.fake.sessions.size, 1);
  assert.deepEqual(env.fake.calls.expire, []);
  assert.equal(env.audits().filter((row) => row.action === 'invoices.pay-link-created').length, 1);
});
