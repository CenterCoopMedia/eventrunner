'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { makeFakeStripe } = require('./fakes.cjs');
const { startFeeCheckout } = require('./feeCheckout.cjs');
const { FAKE_FEE, NOW, ana, applicationDoc, ben, ops, quietLog, seededDb, signupTerms, validAnswers } = require('./testData.cjs');

const PUBLIC_URL = 'https://console.example';
const BODY = { orgId: 'o1', appId: 'a1' };

function waiting(overrides = {}) {
  return applicationDoc({
    status: 'awaiting_payment',
    frozen: validAnswers(),
    agreementAcceptance: { id: 'r1', version: 1, sha256: 'x', name: 'Ana Owner', email: 'ana@example.org', at: new Date(NOW) },
    feeCheckout: null,
    ...overrides,
  });
}

function setup({ app = waiting(), terms = signupTerms(), stripe = makeFakeStripe(), publicUrl = PUBLIC_URL } = {}) {
  const db = seededDb({ 'applications/a1': app, ...terms });
  return { db, stripe, deps: { db, stripe, publicUrl, now: () => NOW, log: quietLog() } };
}

const start = (deps, body = BODY, user = ana) => startFeeCheckout(deps, { body, user });

test('a session uses the stored fee, carries the ids and returns to the status page', async () => {
  const { db, stripe, deps } = setup();
  const result = await start(deps);
  assert.equal(result.body.url, 'https://pay.example/cs_test_1');
  const [{ params, options }] = stripe.calls.create;
  assert.equal(params.mode, 'payment');
  assert.equal(params.line_items[0].price_data.unit_amount, FAKE_FEE.amount);
  assert.equal(params.line_items[0].price_data.currency, FAKE_FEE.currency);
  assert.deepEqual(params.metadata, { appId: 'a1', orgId: 'o1' });
  assert.deepEqual(params.payment_intent_data.metadata, { appId: 'a1', orgId: 'o1' });
  assert.equal(params.customer_email, 'ana@example.org');
  assert.equal(params.success_url, `${PUBLIC_URL}/organizations/o1/applications/a1?payment=done`);
  assert.equal(params.cancel_url, `${PUBLIC_URL}/organizations/o1/applications/a1?payment=cancelled`);
  assert.ok(options.idempotencyKey);
  const stored = db.read('applications/a1');
  assert.equal(stored.status, 'awaiting_payment', 'opening a payment page changes no status');
  assert.deepEqual(stored.feeCheckout, { sessionId: 'cs_test_1', amount: FAKE_FEE.amount, currency: FAKE_FEE.currency, attempt: 1, createdAt: new Date(NOW) });
});

test('an amount or currency sent by the browser is ignored', async () => {
  const { stripe, deps } = setup();
  await start(deps, { ...BODY, amount: 1, currency: 'jpy', feeAmount: 1, feeCurrency: 'jpy', unit_amount: 1 });
  const [{ params }] = stripe.calls.create;
  assert.equal(params.line_items[0].price_data.unit_amount, FAKE_FEE.amount);
  assert.equal(params.line_items[0].price_data.currency, FAKE_FEE.currency);
});

test('a second select gets the open session back', async () => {
  const { stripe, deps } = setup();
  const first = await start(deps);
  const second = await start(deps);
  assert.equal(second.body.url, first.body.url);
  assert.equal(stripe.calls.create.length, 1);
});

test('two selects at once send one key and share one session', async () => {
  const { db, stripe, deps } = setup();
  const [a, b] = await Promise.all([start(deps), start(deps)]);
  assert.equal(a.body.url, b.body.url);
  assert.equal(stripe.sessions.size, 1);
  assert.equal(stripe.calls.create[0].options.idempotencyKey, stripe.calls.create[1].options.idempotencyKey);
  assert.equal(db.read('applications/a1').feeCheckout.sessionId, 'cs_test_1');
});

test('an expired session gets a new one under a new key', async () => {
  const { db, stripe, deps } = setup();
  await start(deps);
  stripe.sessions.get('cs_test_1').status = 'expired';
  const result = await start(deps);
  assert.equal(result.body.url, 'https://pay.example/cs_test_2');
  const keys = stripe.calls.create.map((c) => c.options.idempotencyKey);
  assert.notEqual(keys[0], keys[1]);
  assert.equal(db.read('applications/a1').feeCheckout.attempt, 2);
});

test('a session paid and waiting for confirmation opens no second way to pay', async () => {
  const { stripe, deps } = setup();
  await start(deps);
  stripe.sessions.get('cs_test_1').status = 'complete';
  const result = await start(deps);
  assert.deepEqual(result.body, { alreadyPaid: true });
  assert.equal(stripe.calls.create.length, 1);
});

test('when the fee changed, the open session closes before a new one opens', async () => {
  const { db, stripe, deps } = setup();
  await start(deps);
  await db.collection('console_config').doc('settings').update({ feeAmount: FAKE_FEE.amount + 100 });
  const result = await start(deps);
  assert.equal(stripe.sessions.get('cs_test_1').status, 'expired');
  assert.equal(result.body.url, 'https://pay.example/cs_test_2');
  assert.equal(db.read('applications/a1').feeCheckout.amount, FAKE_FEE.amount + 100);
});

test('with no usable fee or no console address, no session opens', async () => {
  const unusable = [
    {},
    { 'console_config/settings': { feeAmount: 0, feeCurrency: 'usd' } },
    { 'console_config/settings': { feeAmount: 10.5, feeCurrency: 'usd' } },
    { 'console_config/settings': { feeAmount: '100', feeCurrency: 'usd' } },
    { 'console_config/settings': { feeAmount: 100, feeCurrency: 'dollars' } },
  ];
  for (const terms of unusable) {
    const { stripe, deps } = setup({ terms });
    await assert.rejects(start(deps), { status: 409, code: 'signups-closed' }, JSON.stringify(terms));
    assert.equal(stripe.calls.create.length, 0);
  }
  const { stripe, deps } = setup({ publicUrl: '' });
  await assert.rejects(start(deps), { status: 409, code: 'signups-closed' });
  assert.equal(stripe.calls.create.length, 0);
});

test('only an Owner pays, and only a request waiting for payment', async () => {
  const { stripe, deps } = setup();
  await assert.rejects(start(deps, BODY, ben), { status: 403, message: 'Only an Owner can pay the event fee.' });
  await assert.rejects(start(deps, BODY, ops), { status: 404 });
  for (const status of ['draft', 'submitted', 'approved', 'withdrawn']) {
    const other = setup({ app: waiting({ status }) });
    await assert.rejects(start(other.deps), { status: 409, code: 'locked' }, status);
  }
  assert.equal(stripe.calls.create.length, 0);
});

test('a payment service failure is a plain refusal that saves nothing', async () => {
  const { db, deps } = setup({ stripe: makeFakeStripe({ down: true }) });
  await assert.rejects(start(deps), (err) => {
    assert.equal(err.status, 502);
    assert.equal(err.code, 'payment-unavailable');
    assert.ok(!/stripe|checkout/i.test(err.message));
    assert.ok(err.cause);
    return true;
  });
  assert.equal(db.read('applications/a1').feeCheckout, null);
});

test('a session opened as the request moves on is closed', async () => {
  const { db, stripe, deps } = setup();
  const create = stripe.checkout.sessions.create;
  stripe.checkout.sessions.create = async (...args) => {
    const session = await create(...args);
    await db.collection('applications').doc('a1').update({ status: 'draft', agreementAcceptance: null });
    return session;
  };
  await assert.rejects(start(deps), { status: 409, code: 'status-changed' });
  assert.equal(stripe.sessions.get('cs_test_1').status, 'expired');
  assert.equal(db.read('applications/a1').feeCheckout, null);
});
