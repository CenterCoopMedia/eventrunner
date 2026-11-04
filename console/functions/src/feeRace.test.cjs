'use strict';

/**
 * The event fee against the paths that close a request. A path closes the
 * open payment page, then changes the request in a transaction. A teammate
 * can open a new page between the two, and that page must not outlive the
 * request. If a payment still lands on a closed request, it must not move
 * the request and operators must be able to refund it.
 */

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { reopenApplication } = require('./agreementAcceptance.cjs');
const { withdrawApplication } = require('./applicationStatus.cjs');
const { deleteSpamApplication, isExpired, runRetention } = require('./cleanup.cjs');
const { makeFakeSecrets, makeFakeStripe, makeReq, makeRes } = require('./fakes.cjs');
const { startFeeCheckout } = require('./feeCheckout.cjs');
const { feeWebhookEndpoint } = require('./feeWebhook.cjs');
const { declineApplication } = require('./reviewDecisions.cjs');
const {
  FAKE_FEE, NOW, ana, applicationDoc, fakeMailer, ops, quietLog, seededDb, signupTerms, validAnswers,
} = require('./testData.cjs');

const OLD_SESSION = 'cs_old';
const SECRET = 'whsec_test_fake';
const PUBLIC_URL = 'https://console.example';
const IDS = { orgId: 'o1', appId: 'a1' };
const REVISION = applicationDoc().history.length;

const CLOSERS = {
  withdraw: (deps) => withdrawApplication(deps, { body: IDS, user: ana }),
  decline: (deps) => declineApplication(deps, { body: { appId: 'a1', revision: REVISION, note: 'Not an event.' }, user: ops }),
  'delete as spam': (deps) => deleteSpamApplication(deps, { body: { appId: 'a1', confirm: true }, user: ops }),
  'go back to edit': (deps) => reopenApplication(deps, { body: IDS, user: ana }),
};

function waiting(sessionId, overrides = {}) {
  return applicationDoc({
    status: 'awaiting_payment',
    frozen: validAnswers(),
    agreementAcceptance: { id: 'r1', version: 1, sha256: 'x', name: 'Ana Owner', email: 'ana@example.org', at: new Date(NOW) },
    feeCheckout: sessionId ? { sessionId, amount: FAKE_FEE.amount, currency: FAKE_FEE.currency, attempt: 1 } : null,
    ...overrides,
  });
}

function setup(app) {
  const db = seededDb({ 'applications/a1': app, ...signupTerms() });
  const stripe = makeFakeStripe();
  stripe.sessions.set(OLD_SESSION, { id: OLD_SESSION, url: 'https://pay.example/old', status: 'open' });
  const log = quietLog();
  const mailer = fakeMailer();
  return { db, stripe, log, mailer, deps: { db, stripe, log, mailer, secrets: makeFakeSecrets(), now: () => NOW, publicUrl: PUBLIC_URL } };
}

/** Run `step` once, just before the next transaction: after a path's first read and its close. */
function beforeNextTransaction(db, step) {
  const real = db.runTransaction.bind(db);
  db.runTransaction = async (fn) => {
    db.runTransaction = real;
    await step();
    return real(fn);
  };
}

async function deliverPaid({ db, stripe, mailer, log }, session, builds = []) {
  const event = {
    id: 'evt_1',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: session,
        payment_status: 'paid',
        amount_total: FAKE_FEE.amount,
        currency: FAKE_FEE.currency,
        payment_intent: 'pi_1',
        metadata: IDS,
      },
    },
  };
  const signed = stripe.signed(event, SECRET);
  const res = makeRes();
  const endpoint = feeWebhookEndpoint({
    db, stripe, webhookSecret: SECRET, mailer, log, now: () => NOW, publicUrl: PUBLIC_URL, startBuild: async (args) => { builds.push(args); },
  });
  await endpoint(makeReq(signed), res);
  return res;
}

for (const [name, close] of Object.entries(CLOSERS)) {
  for (const [start, first] of [['an open page', OLD_SESSION], ['no page', null]]) {
    test(`${name}, starting with ${start}, is refused when a teammate opens a page in between, and a second try closes it`, async () => {
      const { db, stripe, deps } = setup(waiting(first));
      beforeNextTransaction(db, () => startFeeCheckout(deps, { body: IDS, user: ana }));

      await assert.rejects(close(deps), { status: 409, code: 'status-changed' });

      const held = db.read('applications/a1');
      assert.equal(held.status, 'awaiting_payment', 'the request did not close');
      const live = held.feeCheckout.sessionId;
      assert.notEqual(live, first);
      assert.equal(stripe.sessions.get(live).status, 'open');

      await close(deps);
      assert.equal(stripe.sessions.get(live).status, 'expired', 'no page outlives the request');
      assert.notEqual(db.read('applications/a1')?.status, 'awaiting_payment');
    });
  }

  test(`${name} goes ahead when no page opened in between`, async () => {
    const { db, stripe, deps } = setup(waiting(OLD_SESSION));
    await close(deps);
    assert.equal(stripe.sessions.get(OLD_SESSION).status, 'expired');
    assert.notEqual(db.read('applications/a1')?.status, 'awaiting_payment');
  });
}

test('retention keeps an old request when a page opens just before its delete', async () => {
  const { db, stripe, deps } = setup(waiting(null, { updatedAt: new Date(NOW - 91 * 24 * 60 * 60 * 1000) }));
  beforeNextTransaction(db, () => startFeeCheckout(deps, { body: IDS, user: ana }));
  const { deleted } = await runRetention({ db, secrets: makeFakeSecrets(), now: () => NOW, log: quietLog() });
  assert.deepEqual(deleted, []);
  assert.equal(db.read('applications/a1').status, 'awaiting_payment');
  assert.equal(stripe.sessions.get(db.read('applications/a1').feeCheckout.sessionId).status, 'open');
});

test('a page that could not be closed, then paid, leaves a withdrawn request closed and a record to refund from', async () => {
  const { db, stripe, deps, log, mailer } = setup(waiting(null));
  // The withdraw lands while the page opens, and closing the page fails too.
  const create = stripe.checkout.sessions.create;
  stripe.checkout.sessions.create = async (...args) => {
    const session = await create(...args);
    await CLOSERS.withdraw(deps);
    return session;
  };
  stripe.checkout.sessions.expire = async () => { throw new Error('fake Stripe is down'); };
  await assert.rejects(startFeeCheckout(deps, { body: IDS, user: ana }), { status: 409, code: 'status-changed' });
  assert.equal(db.read('applications/a1').status, 'withdrawn');
  assert.ok(log.errors.some((args) => args[0].includes('could not close a session')));

  const paid = [...stripe.sessions.keys()].at(-1);
  assert.equal(stripe.sessions.get(paid).status, 'open', 'the page outlived the request');
  mailer.sent.length = 0;
  const builds = [];
  const res = await deliverPaid(deps, paid, builds);

  assert.equal(res.statusCode, 200, 'a retry cannot change the answer');
  const stored = db.read('applications/a1');
  assert.equal(stored.status, 'withdrawn');
  assert.equal(stored.payment, undefined);
  assert.deepEqual(builds, []);
  assert.deepEqual(stored.feeProblem, { code: 'wrong-status', sessionId: paid, paymentIntentId: 'pi_1', at: new Date(NOW) });
  const record = db.read(`console_fee_events/${paid}`);
  assert.equal(record.outcome, 'wrong-status');
  assert.equal(record.paymentIntentId, 'pi_1');
  assert.equal(record.amount, FAKE_FEE.amount);
  assert.equal(record.currency, FAKE_FEE.currency);
  assert.deepEqual(
    mailer.sent.filter((m) => m.kind === 'operator').map((m) => [m.problem, m.sessionId, m.paymentIntentId]),
    [['wrong-status', paid, 'pi_1'], ['wrong-status', paid, 'pi_1']],
  );
  assert.equal(mailer.sent.filter((m) => m.kind === 'status').length, 0, 'the client gets no paid email');
  assert.equal(isExpired({ ...stored, updatedAt: new Date(NOW - 200 * 24 * 60 * 60 * 1000) }, NOW), false, 'retention keeps it for the operator');
});

test('a payment on a declined request, or one back in draft, does not move it', async () => {
  for (const status of ['declined', 'draft']) {
    const { db, deps } = setup(waiting('cs_late', { status }));
    await deliverPaid(deps, 'cs_late');
    assert.equal(db.read('applications/a1').status, status);
    assert.equal(db.read('applications/a1').feeProblem.code, 'wrong-status');
  }
});

test('a payment on a deleted request leaves the record and tells operators which payment to refund', async () => {
  const { db, deps, mailer } = setup(waiting(OLD_SESSION));
  await CLOSERS['delete as spam'](deps);
  assert.equal(db.read('applications/a1'), undefined);
  mailer.sent.length = 0;

  const res = await deliverPaid(deps, 'cs_late');

  assert.equal(res.statusCode, 200);
  assert.equal(db.read('applications/a1'), undefined, 'a payment does not bring a request back');
  const record = db.read('console_fee_events/cs_late');
  assert.equal(record.outcome, 'request-missing');
  assert.equal(record.paymentIntentId, 'pi_1');
  assert.deepEqual(
    mailer.sent.filter((m) => m.kind === 'operator').map((m) => [m.problem, m.sessionId, m.paymentIntentId]),
    [['request-missing', 'cs_late', 'pi_1'], ['request-missing', 'cs_late', 'pi_1']],
  );
});
