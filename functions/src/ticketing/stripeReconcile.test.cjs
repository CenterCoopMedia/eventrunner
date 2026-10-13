'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeFakeDb } = require('../cms/firestoreFake.cjs');
const { reconcileStripeOrder } = require('./stripeReconcile.cjs');
const { recomputeEntitlement } = require('./entitlement.cjs');

const T0 = new Date('2026-10-13T00:00:00.000Z');
const SCOPE = { name: 'stripe', externalEventId: 'conference-1', stripeAccountId: 'acct_fixture', livemode: false };
const ORDER = {
  id: 'ord_fixture', provider: 'stripe', eventId: 'conference-1', stripeAccountId: 'acct_fixture', livemode: false,
  attemptId: 'att_fixture', stripeSessionId: 'cs_test_fixture', stripePaymentIntentId: null,
  currency: 'usd', subtotalAmount: 3000, totalAmount: 3000, discountAmount: 0, taxAmount: 0, feeAmount: 0,
  lines: [{ ticketTypeId: 'general', ticketClass: 'General admission', name: 'General admission', quantity: 2, unitAmount: 1500, lineAmount: 3000 }],
  seats: [
    { externalId: 'ord_fixture_0_0', ticketTypeId: 'general', ticketClass: 'General admission', email: 'attendee@example.org', firstName: 'First', lastName: 'Guest', lineIndex: 0, seatIndex: 0 },
    { externalId: 'ord_fixture_0_1', ticketTypeId: 'general', ticketClass: 'General admission', email: 'other@example.org', firstName: 'Second', lastName: 'Guest', lineIndex: 0, seatIndex: 1 },
  ],
  ticketIds: ['ord_fixture_0_0', 'ord_fixture_0_1'], purchaserUid: 'purchaser', purchaserEmail: 'buyer@example.org',
  status: 'pending', paymentStatus: 'unpaid', inventoryState: 'held', createdAt: T0, source: 'checkout',
};
const METADATA = { eventRunnerOrderId: ORDER.id, eventRunnerEventId: ORDER.eventId, eventRunnerAttemptId: ORDER.attemptId };

function state() {
  return {
    session: { id: ORDER.stripeSessionId, metadata: METADATA, livemode: false, mode: 'payment', ui_mode: 'hosted_page',
      payment_method_types: ['card'], payment_intent: 'pi_fixture', currency: 'usd', amount_total: 3000,
      amount_subtotal: 3000, total_details: { amount_discount: 0, amount_tax: 0, amount_shipping: 0 },
      status: 'complete', payment_status: 'paid', expires_at: T0.getTime() / 1000 + 3600,
      customer_details: { email: 'not-the-identity@example.org' }, client_secret: 'do-not-store' },
    lineItems: [{ id: 'li_fixture', quantity: 2, amount_subtotal: 3000, amount_total: 3000, amount_tax: 0, amount_discount: 0,
      currency: 'usd', price: { unit_amount: 1500, currency: 'usd', recurring: null,
        product: { id: 'prod_fixture', metadata: { eventRunnerTicketTypeId: 'general' } } } }],
    paymentIntent: { id: 'pi_fixture', metadata: METADATA, livemode: false, currency: 'usd', amount: 3000,
      status: 'succeeded', amount_received: 3000, latest_charge: 'ch_fixture' },
    refunds: [], disputes: [],
  };
}

function refund({ id = 're_fixture', amount = 3000, status = 'succeeded' } = {}) {
  return { id, amount, status, payment_intent: 'pi_fixture', currency: 'usd', created: T0.getTime() / 1000,
    metadata: { private: 'never-copy-refund-metadata' } };
}

function fixture({ order = ORDER } = {}) {
  const db = makeFakeDb({ 'config/event': { historicalDemo: false }, 'ticket_orders/ord_fixture': order,
    'ticket_inventory/current': { eventId: ORDER.eventId, held: 2, sold: 0, types: { general: { held: 2, sold: 0 } } } });
  const provider = { ...SCOPE, readFinancialState: async () => state() };
  const reconcile = () => reconcileStripeOrder({ db, provider, orderId: ORDER.id, now: () => T0 });
  return { db, provider, reconcile };
}

test('paid group order atomically converts its hold into individual tickets; replay preserves assignments and counts', async () => {
  const { db, reconcile } = fixture();
  const first = await reconcile();
  assert.equal(first.complete, true);
  assert.equal(first.tickets.length, 2);
  assert.equal(db.read('ticket_orders', ORDER.id).paymentStatus, 'succeeded');
  assert.deepEqual(db.read('ticket_inventory', 'current'), { eventId: ORDER.eventId, held: 0, sold: 2, types: { general: { held: 0, sold: 2 } } });
  assert.equal(first.tickets[0].email, 'attendee@example.org');
  assert.equal(first.tickets[1].email, 'other@example.org');
  assert.ok(first.tickets.every((ticket) => ticket.quantity === 1 && ticket.claimedByUid === null));
  await db.collection('tickets').doc(ORDER.ticketIds[0]).set({ claimedByUid: 'attendee', claimedAt: T0, checkedInAt: T0,
    email: 'corrected@example.org', firstName: 'Corrected' }, { merge: true });
  await reconcile();
  assert.equal(db.ids('tickets').length, 2);
  const ticket = db.read('tickets', ORDER.ticketIds[0]);
  assert.equal(ticket.claimedByUid, 'attendee');
  assert.equal(ticket.email, 'corrected@example.org');
  assert.deepEqual(ticket.checkedInAt, T0);
  assert.equal(db.read('ticket_inventory', 'current').sold, 2);
  const persisted = JSON.stringify({ order: db.read('ticket_orders', ORDER.id), ticket });
  assert.doesNotMatch(persisted, /do-not-store|not-the-identity/);
});

test('successful full refund invalidates every seat, keeps sold capacity, and preserves admin grants', async () => {
  const { db, provider, reconcile } = fixture();
  await reconcile();
  await db.collection('tickets').doc(ORDER.ticketIds[0]).set({ claimedByUid: 'attendee' }, { merge: true });
  await db.collection('tickets').doc(ORDER.ticketIds[1]).set({ claimedByUid: 'press' }, { merge: true });
  await db.collection('users').doc('attendee').set({ registrationStatus: 'approved', approvalSource: 'ticket' });
  await db.collection('users').doc('press').set({ registrationStatus: 'approved', approvalSource: 'admin' });
  provider.readFinancialState = async () => ({ ...state(), refunds: [refund()] });
  const result = await reconcile();
  assert.ok(result.tickets.every((ticket) => ticket.status === 'refunded'));
  assert.equal(db.read('ticket_orders', ORDER.id).refundedAmount, 3000);
  assert.equal(db.read('ticket_orders', ORDER.id).status, 'refunded');
  assert.equal(db.read('ticket_inventory', 'current').sold, 2);
  await recomputeEntitlement({ db, uid: 'attendee' });
  await recomputeEntitlement({ db, uid: 'press' });
  assert.equal(db.read('users', 'attendee').registrationStatus, 'revoked');
  assert.equal(db.read('users', 'press').registrationStatus, 'approved');
});

test('a successful full refund supersedes old failed refund attention but retains history and disputes', async () => {
  const { db, provider, reconcile } = fixture();
  const refunds = [refund({ id: 're_old', status: 'failed' }), refund({ id: 're_retry' })];
  provider.readFinancialState = async () => ({ ...state(), refunds });
  await reconcile();
  const order = db.read('ticket_orders', ORDER.id);
  assert.equal(order.refundStatus, 'full');
  assert.equal(order.refundedAmount, order.totalAmount);
  assert.equal(order.refunds.find((item) => item.id === 're_old').status, 'failed');
  assert.equal(order.reconciliationException, null);
  provider.readFinancialState = async () => ({ ...state(), refunds, disputes: [{ id: 'du_active', status: 'needs_response',
    payment_intent: 'pi_fixture', amount: 3000, currency: 'usd', livemode: false }] });
  assert.equal((await reconcile()).exception.code, 'payment-disputed');
});

test('partial successful refunds retain conservative attention for another failed refund', async () => {
  const { provider, reconcile } = fixture();
  provider.readFinancialState = async () => ({ ...state(), refunds: [
    refund({ id: 're_old', status: 'failed' }), refund({ id: 're_retry', amount: 500 }),
  ] });
  assert.equal((await reconcile()).exception.code, 'refund-needs-attention');
});

test('a known PaymentIntent cannot disappear or change before an expired hold is released', async () => {
  for (const paymentIntent of [null, 'pi_other']) {
    const { db, provider, reconcile } = fixture({ order: { ...ORDER, stripePaymentIntentId: 'pi_fixture', paymentStatus: 'pending',
      refunds: [{ id: 're_known', amount: 500, currency: 'usd', status: 'pending' }] } });
    provider.readFinancialState = async () => {
      const data = state();
      return { ...data, session: { ...data.session, status: 'expired', payment_status: 'unpaid', payment_intent: paymentIntent },
        paymentIntent: paymentIntent ? { ...data.paymentIntent, id: paymentIntent, status: 'canceled', amount_received: 0 } : null };
    };
    const result = await reconcile();
    assert.ok(result.exception);
    const order = db.read('ticket_orders', ORDER.id);
    assert.equal(order.stripePaymentIntentId, 'pi_fixture');
    assert.equal(order.refunds[0].id, 're_known');
    assert.equal(order.inventoryState, 'held');
    assert.equal(db.read('ticket_inventory', 'current').held, 2);
  }
});

test('historical demos refuse reconciliation before Stripe reads or order writes', async () => {
  const { db, provider, reconcile } = fixture();
  await db.collection('config').doc('event').set({ historicalDemo: true });
  let reads = 0;
  provider.readFinancialState = async () => { reads += 1; return state(); };
  const before = db.read('ticket_orders', ORDER.id);
  assert.equal((await reconcile()).writeBlocked, true);
  assert.equal(reads, 0);
  assert.deepEqual(db.read('ticket_orders', ORDER.id), before);
  assert.equal(db.ids('tickets').length, 0);
});

test('a demo freeze during the financial commit aborts ticket and inventory writes', async () => {
  const { db, provider, reconcile } = fixture();
  provider.readFinancialState = async () => {
    db.beforeCommit = async () => db.collection('config').doc('event').set({ historicalDemo: true });
    return state();
  };
  assert.equal((await reconcile()).writeBlocked, true);
  assert.equal(db.ids('tickets').length, 0);
  assert.equal(db.read('ticket_orders', ORDER.id).status, 'pending');
  assert.equal(db.read('ticket_inventory', 'current').held, 2);
});

test('amount-only partial refund requires an allocation and never guesses an attendee', async () => {
  const { db, provider, reconcile } = fixture();
  await reconcile();
  provider.readFinancialState = async () => ({ ...state(), refunds: [refund({ amount: 500 })] });
  const pending = await reconcile();
  assert.equal(pending.exception.code, 'refund-allocation-required');
  assert.ok(pending.tickets.every((ticket) => ticket.status === 'valid'));
  await db.collection('ticket_orders').doc(ORDER.id).set({ refundAllocations: { re_fixture: [ORDER.ticketIds[1]] } }, { merge: true });
  const allocated = await reconcile();
  assert.equal(allocated.tickets[0].status, 'valid');
  assert.equal(allocated.tickets[1].status, 'refunded');
  assert.equal(allocated.exception, undefined);
});

test('explicit preserve-admission allocation is honored only with its recorded decision', async () => {
  const { db, provider, reconcile } = fixture();
  provider.readFinancialState = async () => ({ ...state(), refunds: [refund({ amount: 500 })] });
  await db.collection('ticket_orders').doc(ORDER.id).set({ refundAllocations: { re_fixture: [] } }, { merge: true });
  assert.equal((await reconcile()).exception.code, 'refund-allocation-required');
  await db.collection('ticket_orders').doc(ORDER.id).set({ refundAllocationDecisions: { re_fixture: { preserveAdmission: true } } }, { merge: true });
  const result = await reconcile();
  assert.equal(result.exception, undefined);
  assert.ok(result.tickets.every((ticket) => ticket.status === 'valid'));
});

test('a later failed refund updates financial history without reviving invalidated admission', async () => {
  const { db, provider, reconcile } = fixture();
  provider.readFinancialState = async () => ({ ...state(), refunds: [refund()] });
  await reconcile();
  provider.readFinancialState = async () => ({ ...state(), refunds: [refund({ status: 'failed' })] });
  const result = await reconcile();
  assert.equal(db.read('ticket_orders', ORDER.id).refundedAmount, 0);
  assert.equal(result.exception.code, 'refund-needs-attention');
  assert.ok(result.tickets.every((ticket) => ticket.status === 'refunded'));
  assert.doesNotMatch(JSON.stringify(db.read('ticket_orders', ORDER.id)), /never-copy-refund-metadata/);
});

test('pending and requires-action refunds retain admission and expose their distinct financial states', async () => {
  for (const status of ['pending', 'requires_action', 'canceled']) {
    const { db, provider, reconcile } = fixture();
    provider.readFinancialState = async () => ({ ...state(), refunds: [refund({ status })] });
    const result = await reconcile();
    assert.ok(result.tickets.every((ticket) => ticket.status === 'valid'));
    assert.equal(db.read('ticket_orders', ORDER.id).refunds[0].status, status);
    assert.equal(db.read('ticket_orders', ORDER.id).refundedAmount, 0);
  }
});

test('confirmed unpaid expiration releases a hold exactly once without issuing tickets', async () => {
  const { db, provider, reconcile } = fixture();
  provider.readFinancialState = async () => {
    const data = state();
    return { ...data, session: { ...data.session, payment_status: 'unpaid', payment_intent: null, status: 'expired' }, paymentIntent: null };
  };
  await reconcile();
  await reconcile();
  assert.equal(db.ids('tickets').length, 0);
  assert.equal(db.read('ticket_orders', ORDER.id).inventoryState, 'released');
  assert.equal(db.read('ticket_orders', ORDER.id).status, 'expired');
  assert.equal(db.read('ticket_inventory', 'current').held, 0);
  assert.equal(db.read('ticket_inventory', 'current').sold, 0);
});

test('a processing payment keeps inventory and cannot enter the pending_info entitlement hold', async () => {
  const { db, provider, reconcile } = fixture();
  provider.readFinancialState = async () => {
    const data = state();
    return { ...data, session: { ...data.session, payment_status: 'unpaid' },
      paymentIntent: { ...data.paymentIntent, status: 'processing', amount_received: 0 } };
  };
  const result = await reconcile();
  assert.equal(result.paymentPending, true);
  assert.equal(db.ids('tickets').length, 0);
  assert.equal(db.read('ticket_orders', ORDER.id).paymentStatus, 'pending');
  assert.equal(db.read('ticket_inventory', 'current').held, 2);
});

test('an expired Session with an unresolved or received payment cannot release held capacity', async () => {
  for (const paymentStatus of ['processing', 'succeeded', 'requires_action', 'requires_capture']) {
    const { db, provider, reconcile } = fixture();
    provider.readFinancialState = async () => {
      const data = state();
      return { ...data, session: { ...data.session, payment_status: 'unpaid', status: 'expired' },
        paymentIntent: { ...data.paymentIntent, status: paymentStatus } };
    };
    const result = await reconcile();
    assert.equal(result.exception.code, 'expiration-payment-conflict');
    assert.equal(db.read('ticket_inventory', 'current').held, 2);
    assert.equal(db.read('ticket_orders', ORDER.id).inventoryState, 'held');
    assert.equal(db.ids('tickets').length, 0);
  }
});

test('late payment after a released hold is an operator exception and cannot oversell', async () => {
  const { db, reconcile } = fixture({ order: { ...ORDER, inventoryState: 'released' } });
  const result = await reconcile();
  assert.equal(result.exception.code, 'payment-after-capacity-release');
  assert.equal(db.ids('tickets').length, 0);
  assert.equal(db.read('ticket_orders', ORDER.id).inventoryState, 'released');
});

test('Session association, currency, price, quantity and unsupported methods fail closed', async () => {
  const mutations = [
    (data) => { data.session.currency = 'eur'; },
    (data) => { data.session.metadata = { ...METADATA, eventRunnerAttemptId: 'another' }; },
    (data) => { data.session.id = 'cs_test_other'; },
    (data) => { data.session.amount_total = 1; },
    (data) => { data.session.payment_status = 'no_payment_required'; },
    (data) => { data.lineItems[0].price.unit_amount = 1; },
    (data) => { data.lineItems[0].quantity = 1; },
    (data) => { data.session.payment_method_types = ['us_bank_account']; },
  ];
  for (const mutate of mutations) {
    const { db, provider, reconcile } = fixture();
    provider.readFinancialState = async () => { const data = state(); mutate(data); return data; };
    const result = await reconcile();
    assert.ok(result.exception);
    assert.equal(db.ids('tickets').length, 0);
    assert.equal(db.read('ticket_inventory', 'current').held, 2);
  }
});

test('an expired reconciliation worker cannot overwrite a newer refund result', async () => {
  const { db, provider } = fixture();
  let entered;
  let release;
  const reading = new Promise((resolve) => { entered = resolve; });
  const delayed = new Promise((resolve) => { release = resolve; });
  let n = 0;
  provider.readFinancialState = async () => {
    n += 1;
    if (n === 1) { entered(); return delayed; }
    return { ...state(), refunds: [refund()] };
  };
  const first = reconcileStripeOrder({ db, provider, orderId: ORDER.id, now: () => T0 });
  await reading;
  const busy = await reconcileStripeOrder({ db, provider, orderId: ORDER.id, now: () => T0 });
  assert.equal(busy.complete, false);
  assert.equal(n, 1);
  await reconcileStripeOrder({ db, provider, orderId: ORDER.id, now: () => new Date(T0.getTime() + 6 * 60_000) });
  release(state());
  assert.equal((await first).complete, false);
  assert.equal(db.read('ticket_orders', ORDER.id).refundedAmount, 3000);
  assert.equal(db.read('tickets', ORDER.ticketIds[0]).status, 'refunded');
});

test('a local cancellation racing with provider retrieval remains cancelled', async () => {
  const { db, provider, reconcile } = fixture();
  await reconcile();
  provider.readFinancialState = async () => {
    await db.collection('tickets').doc(ORDER.ticketIds[0]).set({ status: 'cancelled' }, { merge: true });
    return state();
  };
  await reconcile();
  assert.equal(db.read('tickets', ORDER.ticketIds[0]).status, 'cancelled');
});

test('disputes produce an operator exception without silently inventing an admission policy', async () => {
  const { provider, reconcile } = fixture();
  provider.readFinancialState = async () => ({ ...state(), disputes: [{ id: 'du_fixture', status: 'needs_response',
    payment_intent: 'pi_fixture', amount: 3000, currency: 'usd', livemode: false }] });
  const result = await reconcile();
  assert.equal(result.exception.code, 'payment-disputed');
  assert.ok(result.tickets.every((ticket) => ticket.status === 'valid'));
});

test('provider outage clears the lease and returns a redacted retryable error', async () => {
  const { db, provider, reconcile } = fixture();
  provider.readFinancialState = async () => { throw new Error('private provider failure content'); };
  await assert.rejects(reconcile(), (err) => err.message === 'Stripe reconciliation is temporarily unavailable.');
  assert.equal(db.read('ticket_orders', ORDER.id).reconciliationLease, null);
  assert.equal(db.ids('tickets').length, 0);
});
