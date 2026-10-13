'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeFakeDb } = require('../cms/firestoreFake.cjs');
const { createTicketingCommerceAdminHandler, createTicketingCheckInHandler, createTicketingMyTicketsHandler } = require('./commerceAdmin.cjs');

const NOW = new Date('2026-10-13T12:00:00Z');
const provider = { name: 'stripe', externalEventId: 'synthetic-event', stripeAccountId: 'acct_synthetic', livemode: false };
const order = {
  id: 'order-1', provider: 'stripe', eventId: provider.externalEventId, stripeAccountId: provider.stripeAccountId, livemode: false,
  purchaserUid: 'buyer', purchaserEmail: 'buyer@example.org', currency: 'usd', totalAmount: 10000, subtotalAmount: 10000,
  paymentStatus: 'succeeded', status: 'paid', inventoryState: 'sold', refundStatus: 'none',
  stripePaymentIntentId: 'pi_synthetic', ticketIds: ['ticket-1', 'ticket-2'],
  seats: [{ externalId: 'ticket-1', email: 'first@example.org' }, { externalId: 'ticket-2', email: 'second@example.org' }],
  lines: [{ ticketTypeId: 'general', quantity: 2, unitAmount: 5000 }], createdAt: NOW, updatedAt: NOW,
};
const ticket = { externalId: 'ticket-1', provider: 'stripe', orderId: 'order-1', ticketTypeId: 'general', ticketClass: 'General', email: 'first@example.org', firstName: 'First', lastName: 'Guest', status: 'valid', claimedByUid: null, createdAt: NOW };
const getConfig = async () => ({ event: { historicalDemo: false } });
const auth = { async verifyIdToken(token) {
  if (token === 'missing') throw new Error('unauthorized');
  return { uid: token, email: `${token}@example.org`, email_verified: token !== 'unverified' };
} };
function dbFor(extra = {}) {
  return makeFakeDb({
    'config/bootstrap': { adminEmails: ['operator@example.org'], staffEmails: ['staff@example.org'] },
    'config/event': { historicalDemo: false }, 'ticket_orders/order-1': order,
    'tickets/ticket-1': ticket,
    'tickets/ticket-2': { ...ticket, externalId: 'ticket-2', email: 'second@example.org', firstName: 'Second' },
    'ticket_inventory/current': { eventId: provider.externalEventId, held: 0, sold: 2, types: { general: { held: 0, sold: 2 } } },
    ...extra,
  });
}
function resOf() {
  return { statusCode: 0, body: null, headers: {}, set(key, value) { this.headers[key] = value; return this; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}
async function call(handler, body, user = 'staff', method = 'POST') {
  const res = resOf();
  await handler({ method, body, headers: { authorization: `Bearer ${user}` } }, res);
  return res;
}
function admin(db, extra = {}) { return createTicketingCommerceAdminHandler({ db, provider, auth, getConfig, now: () => NOW, log: { error() {} }, ...extra }); }
function checkIn(db) { return createTicketingCheckInHandler({ db, provider, auth, getConfig, now: () => NOW, log: { error() {} } }); }
function catalog(patch = {}) {
  return {
    schemaVersion: 1, revision: 1, published: false, salesPaused: false,
    commercialTermsConfirmed: true, currency: 'usd', capacity: 20, maxPerOrder: 20,
    refundPolicy: 'Contact the organizer before the event.', taxTreatment: 'not_collected',
    ticketTypes: [{ id: 'general', name: 'Full event pass', unitAmount: 5000, capacity: 20, active: true, visibility: 'public' }],
    ...patch,
  };
}

test('commerce roles are live, verified, and financial/catalog operations require an operator', async () => {
  const db = dbFor();
  for (const user of ['stranger', 'unverified']) {
    assert.equal((await call(admin(db), { action: 'orders' }, user)).statusCode, 403);
  }
  assert.equal((await call(admin(db), { action: 'orders' }, 'missing')).statusCode, 401);
  assert.equal((await call(admin(db), { action: 'issueComp' })).statusCode, 403);
  assert.equal((await call(admin(db), { action: 'pauseSales' })).statusCode, 403);
  assert.equal((await call(admin(db), { action: 'allocateRefund' })).statusCode, 403);
  await db.collection('config').doc('bootstrap').set({ adminEmails: [], staffEmails: [] });
  assert.equal((await call(admin(db), { action: 'orders' }, 'operator')).statusCode, 403);
});

test('order reads redact attempt/session credentials and isolate account/event/mode', async () => {
  const db = dbFor({ 'ticket_orders/order-1': { ...order, checkoutUrl: 'private-checkout', clientSecret: 'private-value', requestId: 'private-id' } });
  const own = await call(admin(db), { action: 'order', orderId: 'order-1' });
  assert.equal(own.statusCode, 200);
  assert.equal(own.body.tickets.length, 2);
  assert.equal(own.body.stripeDashboardUrl, 'https://dashboard.stripe.com/acct_synthetic/test/payments/pi_synthetic');
  assert.doesNotMatch(JSON.stringify(own.body), /private-value|private-checkout|private-id/);
  assert.equal(own.headers['Cache-Control'], 'private, no-store');
  for (const mismatch of [{ eventId: 'another-event' }, { stripeAccountId: 'acct_other' }, { livemode: true }]) {
    await db.collection('ticket_orders').doc('order-1').set({ ...order, ...mismatch });
    assert.equal((await call(admin(db), { action: 'order', orderId: 'order-1' })).statusCode, 404);
  }
});

test('cancellation requires confirmation, preserves money and capacity, and records an atomic audit', async () => {
  const db = dbFor();
  const body = { action: 'cancelTickets', orderId: 'order-1', ticketIds: ['ticket-1'], reason: 'Attendee requested cancellation.' };
  assert.equal((await call(admin(db), body)).statusCode, 400);
  assert.equal((await call(admin(db), { ...body, confirmed: true })).statusCode, 200);
  assert.equal((await db.collection('tickets').doc('ticket-1').get()).data().status, 'cancelled');
  assert.equal((await db.collection('tickets').doc('ticket-2').get()).data().status, 'valid');
  const updated = (await db.collection('ticket_orders').doc('order-1').get()).data();
  assert.equal(updated.totalAmount, 10000);
  assert.equal(updated.paymentStatus, 'succeeded');
  assert.equal((await db.collection('ticket_inventory').doc('current').get()).data().sold, 2);
  const audit = await db.collection('admin_logs').get();
  assert.equal(audit.size, 1);
  assert.equal(audit.docs[0].data().action, 'ticketing.tickets-cancelled');
});

test('a failed ticket transaction cannot leave an audit or partial cancellation', async () => {
  const db = dbFor();
  const response = await call(admin(db), { action: 'cancelTickets', orderId: 'order-1', ticketIds: ['ticket-1', 'foreign-ticket'], reason: 'Correction', confirmed: true });
  assert.equal(response.statusCode, 404);
  assert.equal((await db.collection('tickets').doc('ticket-1').get()).data().status, 'valid');
  assert.equal((await db.collection('admin_logs').get()).size, 0);
});

test('claimed identity cannot be transferred through the attendee correction form', async () => {
  const db = dbFor({ 'tickets/ticket-1': { ...ticket, claimedByUid: 'first' } });
  const body = { action: 'updateAttendee', ticketId: 'ticket-1', firstName: 'Corrected', lastName: 'Guest', email: 'other@example.org', reason: 'Name correction' };
  assert.equal((await call(admin(db), body)).statusCode, 409);
  const allowed = await call(admin(db), { ...body, email: 'first@example.org' });
  assert.equal(allowed.statusCode, 200);
  assert.equal((await db.collection('tickets').doc('ticket-1').get()).data().firstName, 'Corrected');
  assert.equal((await db.collection('ticket_orders').doc('order-1').get()).data().seats[0].firstName, 'Corrected');
});

test('check-in is atomic under concurrent scans and only writes one admission audit', async () => {
  const db = dbFor();
  const handler = checkIn(db);
  const results = await Promise.all([call(handler, { action: 'checkIn', ticketId: 'ticket-1' }), call(handler, { action: 'checkIn', ticketId: 'ticket-1' })]);
  assert.deepEqual(results.map((result) => result.body.result).sort(), ['already_checked_in', 'checked_in']);
  assert.equal((await db.collection('admin_logs').get()).size, 1);
});

test('invalid, unpaid, refunded, and explicitly revoked admission is refused', async () => {
  for (const extra of [
    { 'tickets/ticket-1': { ...ticket, status: 'cancelled' } },
    { 'tickets/ticket-1': { ...ticket, status: 'refunded' } },
    { 'ticket_orders/order-1': { ...order, paymentStatus: 'unpaid' } },
    { 'tickets/ticket-1': { ...ticket, claimedByUid: 'revoked' }, 'users/revoked': { registrationStatus: 'revoked' } },
  ]) {
    const db = dbFor(extra);
    assert.equal((await call(checkIn(db), { action: 'checkIn', ticketId: 'ticket-1' })).body.result, 'invalid');
    assert.equal((await db.collection('admin_logs').get()).size, 0);
  }
});

test('check-in correction is operator-only, explicit, and audited', async () => {
  const db = dbFor({ 'tickets/ticket-1': { ...ticket, checkedInAt: NOW } });
  const body = { action: 'undo', ticketId: 'ticket-1', reason: 'Scanned the wrong ticket.', confirmed: true };
  assert.equal((await call(checkIn(db), body)).statusCode, 403);
  assert.equal((await call(checkIn(db), { ...body, confirmed: false }, 'operator')).statusCode, 400);
  assert.equal((await call(checkIn(db), body, 'operator')).body.result, 'corrected');
  assert.equal((await db.collection('tickets').doc('ticket-1').get()).data().checkedInAt, null);
  assert.equal((await db.collection('admin_logs').get()).docs[0].data().action, 'ticketing.check-in-corrected');
});

test('staff cannot cancel a used ticket and demos cannot mutate admission', async () => {
  const body = { action: 'cancelTickets', orderId: 'order-1', ticketIds: ['ticket-1'], reason: 'Requested', confirmed: true };
  const used = dbFor({ 'tickets/ticket-1': { ...ticket, checkedInAt: NOW } });
  assert.equal((await call(admin(used), body)).statusCode, 403);
  const demo = dbFor({ 'config/event': { historicalDemo: true } });
  assert.equal((await call(admin(demo), body, 'operator')).statusCode, 403);
  assert.equal((await call(checkIn(demo), { action: 'checkIn', ticketId: 'ticket-1' })).statusCode, 403);
});

test('partial refunds require a successful provider record and explicit admission allocation', async () => {
  const db = dbFor({ 'ticket_orders/order-1': { ...order, refundStatus: 'partial', refundedAmount: 1000, refunds: [{ id: 're_synthetic', amount: 1000, currency: 'usd', status: 'succeeded' }], reconciliationException: { code: 'refund-allocation-required' } } });
  const body = { action: 'allocateRefund', orderId: 'order-1', refundId: 're_synthetic', ticketIds: [], preserveAdmission: true, reason: 'Price adjustment; attendee keeps access.', confirmed: true };
  const response = await call(admin(db), body, 'operator');
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.tickets[0].status, 'valid');
  assert.deepEqual(response.body.order.refundAllocations.re_synthetic, []);
  assert.equal(response.body.order.reconciliationException, null);
  assert.equal((await call(admin(db), body, 'operator')).statusCode, 409);
  const pending = dbFor({ 'ticket_orders/order-1': { ...order, refunds: [{ id: 're_synthetic', amount: 1000, currency: 'usd', status: 'pending' }] } });
  assert.equal((await call(admin(pending), { ...body, ticketIds: ['ticket-1'], preserveAdmission: false }, 'operator')).statusCode, 409);
});

test('filtered pagination advances through examined rows without leaking another account', async () => {
  const db = dbFor({
    'ticket_orders/order-2': { ...order, id: 'order-2', paymentStatus: 'unpaid' },
    'ticket_orders/order-3': { ...order, id: 'order-3' },
    'ticket_orders/order-4': { ...order, id: 'order-4', stripeAccountId: 'acct_other' },
  });
  const first = await call(admin(db), { action: 'orders', limit: 1, paymentStatus: 'succeeded' });
  assert.equal(first.body.orders[0].id, 'order-1');
  const second = await call(admin(db), { action: 'orders', limit: 1, paymentStatus: 'succeeded', cursor: first.body.nextCursor });
  assert.equal(second.body.orders[0].id, 'order-3');
  const third = await call(admin(db), { action: 'orders', limit: 1, paymentStatus: 'succeeded', cursor: second.body.nextCursor });
  assert.deepEqual(third.body.orders, []);
  assert.equal(third.body.nextCursor, null);
});

test('My tickets requires verified identity and returns only that identity without purchaser data', async () => {
  const db = dbFor({ 'tickets/ticket-1': { ...ticket, claimedByUid: 'first' }, 'tickets/ticket-2': { ...ticket, externalId: 'ticket-2', claimedByUid: 'second' } });
  const handler = createTicketingMyTicketsHandler({ db, provider, auth });
  assert.equal((await call(handler, {}, 'unverified')).statusCode, 403);
  const result = await call(handler, {}, 'first');
  assert.equal(result.body.tickets.length, 1);
  assert.equal(result.body.tickets[0].externalId, 'ticket-1');
  assert.doesNotMatch(JSON.stringify(result.body), /buyer@example|10000|stripeAccountId|second@example/);
});

test('My tickets preserves manual and Eventbrite claimed-ticket access', async () => {
  for (const name of ['manual', 'eventbrite']) {
    const db = dbFor({ 'tickets/ticket-1': { ...ticket, provider: name, claimedByUid: 'first' } });
    const handler = createTicketingMyTicketsHandler({ db, provider: { name }, auth });
    assert.equal((await call(handler, {}, 'first')).body.tickets.length, 1);
  }
});

test('a concurrent demo switch prevents every transactional organizer mutation', async () => {
  const operations = [
    { action: 'saveCatalog', catalog: catalog(), expectedRevision: 1 },
    { action: 'pauseSales', paused: true, reason: 'Pausing intake.' },
    { action: 'updateAttendee', ticketId: 'ticket-1', firstName: 'Edited', email: ticket.email, reason: 'Correction.' },
    { action: 'cancelTickets', orderId: 'order-1', ticketIds: ['ticket-1'], reason: 'Requested.', confirmed: true },
    { action: 'allocateRefund', orderId: 'order-1', refundId: 're_synthetic', ticketIds: ['ticket-1'], reason: 'Requested.', confirmed: true },
    { action: 'reconcile', orderId: 'order-1' },
    { action: 'checkIn', ticketId: 'ticket-1' },
    { action: 'undo', ticketId: 'ticket-1', reason: 'Wrong ticket.', confirmed: true },
  ];
  for (const body of operations) {
    let reconciliations = 0;
    const db = dbFor({
      'ticket_catalog/current': catalog(),
      'ticket_orders/order-1': { ...order, refunds: [{ id: 're_synthetic', amount: 5000, currency: 'usd', status: 'succeeded' }] },
      'tickets/ticket-1': { ...ticket, checkedInAt: body.action === 'undo' ? NOW : null },
    });
    db.beforeCommit = async () => db.collection('config').doc('event').set({ historicalDemo: true });
    const handler = ['checkIn', 'undo'].includes(body.action) ? checkIn(db) : admin(db, {
      provider: { ...provider, async reconcileOrder() { reconciliations += 1; } },
    });
    const result = await call(handler, body, 'operator');
    assert.equal(result.statusCode, 403, body.action);
    assert.equal(result.body.error.code, 'read-only-demo', body.action);
    assert.equal((await db.collection('admin_logs').get()).size, 0, body.action);
    assert.equal((await db.collection('tickets').doc('ticket-1').get()).data().status, 'valid', body.action);
    assert.equal((await db.collection('ticket_catalog').doc('current').get()).data().revision, 1, body.action);
    assert.equal(reconciliations, 0);
  }
});

test('catalog updates preserve sold capacity, original currency, revision, and inventory scope', async () => {
  const db = dbFor({ 'ticket_catalog/current': catalog() });
  for (const patch of [{ currency: 'eur' }, { capacity: 1 }, { ticketTypes: [{ ...catalog().ticketTypes[0], capacity: 1 }] }]) {
    assert.equal((await call(admin(db), { action: 'saveCatalog', catalog: catalog(patch), expectedRevision: 1 }, 'operator')).statusCode, 409);
  }
  assert.equal((await call(admin(db), { action: 'saveCatalog', catalog: catalog(), expectedRevision: 0 }, 'operator')).statusCode, 409);
  const saved = await call(admin(db), { action: 'saveCatalog', catalog: catalog({ capacity: 30 }), expectedRevision: 1 }, 'operator');
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.body.catalog.revision, 2);
  await db.collection('ticket_inventory').doc('current').set({ eventId: 'other-event', held: 0, sold: 0, types: {} });
  assert.equal((await call(admin(db), { action: 'saveCatalog', catalog: catalog(), expectedRevision: 2 }, 'operator')).statusCode, 503);
  assert.equal((await db.collection('ticket_catalog').doc('current').get()).data().revision, 2);
});

test('an operator comp uses the shared reservation and one ticket per assigned attendee', async () => {
  const db = dbFor({ 'ticket_catalog/current': catalog() });
  const body = {
    action: 'issueComp', ticketTypeId: 'general', requestId: 'synthetic-comp-request-1',
    attendees: [{ firstName: 'Guest', lastName: 'One', email: 'guest@example.org' }],
    reason: 'Speaker invitation.', confirmed: true,
  };
  const handler = admin(db, { env: { EVENT_PUBLIC_URL: 'https://event.example.org' } });
  const first = await call(handler, body, 'operator');
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.order.totalAmount, 0);
  assert.equal(first.body.order.source, 'comp');
  assert.equal(first.body.order.inventoryState, 'sold');
  assert.equal(first.body.tickets[0].email, 'guest@example.org');
  const repeat = await call(handler, body, 'operator');
  assert.equal(repeat.body.order.id, first.body.order.id);
  assert.equal((await db.collection('ticket_inventory').doc('current').get()).data().sold, 3);
  assert.equal((await db.collection('admin_logs').get()).size, 1);
});
