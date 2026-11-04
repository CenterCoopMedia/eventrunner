'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { makeFakeStripe, makeReq, makeRes } = require('./fakes.cjs');
const { feeWebhookEndpoint } = require('./feeWebhook.cjs');
const { FAKE_FEE, NOW, applicationDoc, fakeMailer, quietLog, seededDb, validAnswers } = require('./testData.cjs');

const SECRET = 'whsec_test_fake';
const PUBLIC_URL = 'https://console.example';

function waiting(overrides = {}) {
  return applicationDoc({
    status: 'awaiting_payment',
    frozen: validAnswers(),
    feeCheckout: { sessionId: 'cs_1', amount: FAKE_FEE.amount, currency: FAKE_FEE.currency, attempt: 1 },
    ...overrides,
  });
}

function paidEvent(sessionOverrides = {}, eventOverrides = {}) {
  return {
    id: 'evt_1',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_1',
        payment_status: 'paid',
        amount_total: FAKE_FEE.amount,
        currency: FAKE_FEE.currency,
        payment_intent: 'pi_1',
        metadata: { appId: 'a1', orgId: 'o1' },
        ...sessionOverrides,
      },
    },
    ...eventOverrides,
  };
}

function setup({ app = waiting(), startBuild, mailer = fakeMailer() } = {}) {
  const db = seededDb({ 'applications/a1': app });
  const stripe = makeFakeStripe();
  const log = quietLog();
  const endpoint = feeWebhookEndpoint({
    db, stripe, webhookSecret: SECRET, mailer, log, now: () => NOW, publicUrl: PUBLIC_URL, startBuild,
  });
  /** Send one delivery, signed unless `signature` or `rawBody` says otherwise. */
  const deliver = async (event, options = {}) => {
    const signed = stripe.signed(event, SECRET);
    const res = makeRes();
    await endpoint(makeReq({ rawBody: signed.rawBody, signature: signed.signature, ...options }), res);
    return res;
  };
  return { db, stripe, log, mailer, deliver };
}

test('a paid session approves the request and records the payment', async () => {
  const { db, deliver, mailer } = setup();
  const res = await deliver(paidEvent());
  assert.equal(res.statusCode, 200);
  const stored = db.read('applications/a1');
  assert.equal(stored.status, 'approved');
  assert.equal(stored.updatedBy, 'payment');
  assert.deepEqual(stored.history.at(-1), { status: 'approved', at: new Date(NOW), by: 'payment', note: null });
  assert.deepEqual(stored.payment, {
    sessionId: 'cs_1', paymentIntentId: 'pi_1', amount: FAKE_FEE.amount, currency: FAKE_FEE.currency, paidAt: new Date(NOW), eventId: 'evt_1',
  });
  assert.equal(db.read('console_fee_events/cs_1').outcome, 'approved');
  assert.deepEqual(mailer.sent.filter((m) => m.kind === 'status').map((m) => [m.to, m.status]), [['ana@example.org', 'paid']]);
  assert.deepEqual(mailer.sent.filter((m) => m.kind === 'operator').map((m) => m.noticeKind), ['paid', 'paid']);
});

test('a forged signature is refused, says nothing about why, and changes nothing', async () => {
  const { db, deliver, stripe, mailer } = setup();
  const event = paidEvent();
  const wrongSecret = stripe.signed(event, 'whsec_someone_else');
  const replies = [
    await deliver(event, { signature: wrongSecret.signature }),
    await deliver(event, { signature: 't=1,v1=00' }),
    await deliver(event, { signature: undefined }),
  ];
  for (const res of replies) {
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body, { error: { code: 'bad-request', message: 'The request is not valid.' } });
  }
  assert.equal(db.read('applications/a1').status, 'awaiting_payment');
  assert.deepEqual(db.paths('console_fee_events/'), []);
  assert.equal(mailer.sent.length, 0);
});

test('a body changed after signing is refused', async () => {
  const { db, stripe, deliver } = setup();
  const { signature } = stripe.signed(paidEvent({ amount_total: 1 }), SECRET);
  const res = await deliver(paidEvent(), { signature });
  assert.equal(res.statusCode, 400);
  assert.equal(db.read('applications/a1').status, 'awaiting_payment');
});

test('with no raw body, an oversized body or no secret set, nothing is trusted', async () => {
  const { db, stripe, deliver } = setup();
  const event = paidEvent();
  assert.equal((await deliver(event, { rawBody: undefined, body: event })).statusCode, 400);
  const big = Buffer.alloc(128 * 1024 + 1, 32);
  assert.equal((await deliver(event, { rawBody: big })).statusCode, 400);
  const res = makeRes();
  const signed = stripe.signed(event, '');
  const open = feeWebhookEndpoint({ db, stripe, webhookSecret: '', mailer: fakeMailer(), log: quietLog(), now: () => NOW });
  await open(makeReq(signed), res);
  assert.equal(res.statusCode, 400);
  assert.equal(db.read('applications/a1').status, 'awaiting_payment');
});

test('only POST is answered', async () => {
  const { deliver } = setup();
  assert.equal((await deliver(paidEvent(), { method: 'GET' })).statusCode, 405);
});

test('a repeated event is processed once, even under a new event id', async () => {
  const builds = [];
  const { db, deliver, mailer } = setup({ startBuild: async (args) => { builds.push(args); } });
  await deliver(paidEvent());
  const sent = mailer.sent.length;
  const again = await deliver(paidEvent());
  const newId = await deliver(paidEvent({}, { id: 'evt_2' }));
  assert.equal(again.statusCode, 200);
  assert.equal(again.body.outcome, 'repeat');
  assert.equal(newId.body.outcome, 'repeat');
  assert.equal(db.read('applications/a1').history.length, 2);
  assert.equal(db.read('console_fee_events/cs_1').eventId, 'evt_1');
  assert.equal(mailer.sent.length, sent);
  assert.deepEqual(builds, [{ orgId: 'o1', appId: 'a1' }]);
});

test('an amount or currency that does not match the charge does not approve, and tells operators', async () => {
  const wrong = [{ amount_total: FAKE_FEE.amount - 1 }, { currency: 'eur' }, { amount_total: null }];
  for (const session of wrong) {
    const builds = [];
    const { db, deliver, mailer, log } = setup({ startBuild: async (args) => { builds.push(args); } });
    const res = await deliver(paidEvent(session));
    assert.equal(res.statusCode, 200, 'a retry cannot change the answer');
    const stored = db.read('applications/a1');
    assert.equal(stored.status, 'awaiting_payment');
    assert.equal(stored.payment, undefined);
    assert.equal(stored.feeProblem.code, 'amount-mismatch');
    assert.equal(db.read('console_fee_events/cs_1').outcome, 'amount-mismatch');
    assert.deepEqual(builds, []);
    assert.ok(log.errors.length >= 1);
    const notices = mailer.sent.filter((m) => m.kind === 'operator');
    assert.deepEqual(notices.map((m) => m.problem), ['amount-mismatch', 'amount-mismatch']);
    assert.equal(mailer.sent.filter((m) => m.kind === 'status').length, 0, 'the client gets no paid email');
  }
});

test('a session that is not the current one, or a request that moved on, does not approve', async () => {
  const cases = [
    [waiting({ feeCheckout: { sessionId: 'cs_other', amount: FAKE_FEE.amount, currency: FAKE_FEE.currency } }), 'not-current-session'],
    [waiting({ feeCheckout: null }), 'not-current-session'],
    [waiting({ status: 'draft' }), 'wrong-status'],
    [waiting({ status: 'withdrawn' }), 'wrong-status'],
    [waiting({ orgId: 'o2' }), 'wrong-organization'],
  ];
  for (const [app, code] of cases) {
    const { db, deliver } = setup({ app });
    await deliver(paidEvent());
    assert.equal(db.read('applications/a1').status, app.status, code);
    assert.equal(db.read('console_fee_events/cs_1').outcome, code);
  }
});

test('a payment for a request that is gone is recorded for operators', async () => {
  const { db, deliver, mailer } = setup();
  const res = await deliver(paidEvent({ metadata: { appId: 'gone', orgId: 'o1' } }));
  assert.equal(res.statusCode, 200);
  assert.equal(db.read('console_fee_events/cs_1').outcome, 'request-missing');
  assert.equal(db.read('applications/a1').status, 'awaiting_payment');
  assert.ok(mailer.sent.some((m) => m.problem === 'request-missing'));
});

test('other events, unpaid sessions and sessions from elsewhere are ignored', async () => {
  const events = [
    paidEvent({}, { type: 'checkout.session.expired' }),
    paidEvent({ payment_status: 'unpaid' }),
    paidEvent({ metadata: {} }),
  ];
  for (const event of events) {
    const { db, deliver } = setup();
    const res = await deliver(event);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.outcome, 'ignored');
    assert.equal(db.read('applications/a1').status, 'awaiting_payment');
    assert.deepEqual(db.paths('console_fee_events/'), []);
  }
});

test('a failed build start does not undo the payment; it is logged and visible to operators', async () => {
  const { db, deliver, log, mailer } = setup({ startBuild: async () => { throw new Error('builder down at 10.0.0.1'); } });
  const res = await deliver(paidEvent());
  assert.equal(res.statusCode, 200);
  const stored = db.read('applications/a1');
  assert.equal(stored.status, 'approved');
  assert.ok(stored.payment);
  assert.deepEqual(stored.buildStart, { state: 'failed', at: new Date(NOW) });
  assert.ok(!JSON.stringify(stored).includes('builder down'), 'the browser can read this document');
  assert.ok(log.errors.some((args) => args.join(' ').includes('the build did not start')));
  assert.ok(mailer.sent.some((m) => m.noticeKind === 'build-failed'));
  const audit = db.paths('console_audit/').map((path) => db.read(path));
  assert.deepEqual(audit.map((a) => [a.action, a.appId, a.by]), [['build-start-failed', 'a1', 'payment']]);
});

test('a build start that works is recorded', async () => {
  const { db, deliver } = setup({ startBuild: async () => {} });
  await deliver(paidEvent());
  assert.equal(db.read('applications/a1').buildStart.state, 'started');
});

test('with no build start given, the request is approved and nothing else is promised', async () => {
  const { db, deliver } = setup();
  await deliver(paidEvent());
  assert.equal(db.read('applications/a1').status, 'approved');
  assert.equal(db.read('applications/a1').buildStart, undefined);
});

test('failed email does not undo the payment or stop the build', async () => {
  const builds = [];
  const { db, deliver, log } = setup({ mailer: fakeMailer({ fail: true }), startBuild: async (args) => { builds.push(args); } });
  const res = await deliver(paidEvent());
  assert.equal(res.statusCode, 200);
  assert.equal(db.read('applications/a1').status, 'approved');
  assert.equal(builds.length, 1);
  assert.ok(log.errors.length >= 1);
});

test('when the database fails, Stripe is told to send the event again', async () => {
  const { db, deliver, log } = setup();
  db.runTransaction = async () => { throw new Error('database down'); };
  const res = await deliver(paidEvent());
  assert.equal(res.statusCode, 500);
  assert.ok(log.errors.length >= 1);
});
