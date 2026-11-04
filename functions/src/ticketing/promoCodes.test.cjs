'use strict';

// Promo code admin actions on the commerce admin endpoint (ADR 0004
// amendment 2026-11-04): staff and operators list, save and delete codes.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeFakeDb } = require('../cms/firestoreFake.cjs');
const { createTicketingCommerceAdminHandler } = require('./commerceAdmin.cjs');

const NOW = new Date('2026-11-04T15:00:00Z');
const provider = { name: 'stripe', externalEventId: 'synthetic-event', stripeAccountId: 'acct_synthetic', livemode: false };
const auth = { async verifyIdToken(token) { return { uid: token, email: `${token}@example.org`, email_verified: true }; } };
const PROMO = { code: 'early', kind: 'percent', value: 20, ticketTypeIds: ['general'], active: true };

function dbFor(extra = {}) {
  return makeFakeDb({
    'config/bootstrap': { adminEmails: ['operator@example.org'], staffEmails: ['staff@example.org'] },
    'config/event': { historicalDemo: false },
    'ticket_catalog/current': {
      schemaVersion: 1, revision: 1, published: true, salesPaused: false, commercialTermsConfirmed: true,
      currency: 'usd', capacity: 20, maxPerOrder: 20, refundPolicy: 'Contact the organizer.', taxTreatment: 'not_collected',
      ticketTypes: [{ id: 'general', name: 'Full event pass', unitAmount: 5000, capacity: 20, active: true, visibility: 'public' }],
    },
    ...extra,
  });
}
async function call(db, body, user = 'staff') {
  const res = { statusCode: 0, body: null, headers: {}, set(key, value) { this.headers[key] = value; return this; }, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
  const handler = createTicketingCommerceAdminHandler({ db, provider, auth, getConfig: async () => ({}), now: () => NOW, log: { error() {} } });
  await handler({ method: 'POST', body, headers: { authorization: `Bearer ${user}` } }, res);
  return res;
}

test('staff create a code, stored under its capitals with no uses, and audited', async () => {
  const db = dbFor();
  const res = await call(db, { action: 'savePromoCode', create: true, promo: PROMO });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.codes.length, 1);
  assert.equal(res.body.codes[0].code, 'EARLY');
  assert.equal(res.body.codes[0].used, 0);
  const stored = db.read('ticket_promo_codes', 'EARLY');
  assert.equal(stored.used, 0);
  assert.equal(stored.updatedBy, 'staff');
  assert.ok(db.ids('admin_logs').some((id) => db.read('admin_logs', id).action === 'ticketing.promo-saved'));
  // A second create with the same code in any case is refused.
  const again = await call(db, { action: 'savePromoCode', create: true, promo: { ...PROMO, code: 'Early' } });
  assert.equal(again.statusCode, 409);
});

test('a save keeps the use count and needs an existing code', async () => {
  const db = dbFor({ 'ticket_promo_codes/EARLY': { ...PROMO, code: 'EARLY', used: 7, createdAt: NOW } });
  const res = await call(db, { action: 'savePromoCode', create: false, promo: { ...PROMO, value: 30, used: 0 } });
  assert.equal(res.statusCode, 400, 'used is not a field an admin can send');
  const saved = await call(db, { action: 'savePromoCode', create: false, promo: { ...PROMO, value: 30 } });
  assert.equal(saved.statusCode, 200);
  assert.equal(db.read('ticket_promo_codes', 'EARLY').value, 30);
  assert.equal(db.read('ticket_promo_codes', 'EARLY').used, 7);
  const missing = await call(db, { action: 'savePromoCode', create: false, promo: { ...PROMO, code: 'LATER' } });
  assert.equal(missing.statusCode, 404);
});

test('a save names bad fields and ticket types missing from the catalog', async () => {
  const db = dbFor();
  const bad = await call(db, { action: 'savePromoCode', create: true, promo: { ...PROMO, value: 0 } });
  assert.equal(bad.statusCode, 400);
  assert.match(bad.body.error.message, /percent/);
  const unknown = await call(db, { action: 'savePromoCode', create: true, promo: { ...PROMO, ticketTypeIds: ['vip'] } });
  assert.equal(unknown.statusCode, 400);
  assert.match(unknown.body.error.message, /ticket type/);
  assert.equal(db.ids('ticket_promo_codes').length, 0);
});

test('a code with uses cannot be deleted; an unused one can', async () => {
  const db = dbFor({
    'ticket_promo_codes/EARLY': { ...PROMO, code: 'EARLY', used: 1 },
    'ticket_promo_codes/SPARE': { ...PROMO, code: 'SPARE', used: 0 },
  });
  const refused = await call(db, { action: 'deletePromoCode', code: 'early' });
  assert.equal(refused.statusCode, 409);
  assert.ok(db.read('ticket_promo_codes', 'EARLY'));
  const removed = await call(db, { action: 'deletePromoCode', code: 'spare' });
  assert.equal(removed.statusCode, 200);
  assert.deepEqual(removed.body.codes.map((code) => code.code), ['EARLY']);
  assert.equal(db.read('ticket_promo_codes', 'SPARE'), undefined);
});

test('only staff and operators reach the codes', async () => {
  const db = dbFor({ 'ticket_promo_codes/EARLY': { ...PROMO, code: 'EARLY', used: 0 } });
  assert.equal((await call(db, { action: 'promoCodes' }, 'stranger')).statusCode, 403);
  assert.equal((await call(db, { action: 'promoCodes' }, 'operator')).statusCode, 200);
  const listed = await call(db, { action: 'promoCodes' });
  assert.deepEqual(listed.body.codes.map((code) => code.code), ['EARLY']);
});

test('the admin order view shows the code and the list price', async () => {
  const promo = { code: 'EARLY', kind: 'percent', value: 20, discountedSeats: 1, discountAmount: 1000 };
  const db = dbFor({
    'ticket_orders/order-1': {
      id: 'order-1', provider: 'stripe', eventId: provider.externalEventId, stripeAccountId: provider.stripeAccountId, livemode: false,
      purchaserEmail: 'buyer@example.org', currency: 'usd', subtotalAmount: 4000, totalAmount: 4000, discountAmount: 0,
      status: 'paid', paymentStatus: 'succeeded', inventoryState: 'sold', ticketIds: [], seats: [], promo,
      lines: [{ ticketTypeId: 'general', quantity: 1, unitAmount: 4000, lineAmount: 4000, listUnitAmount: 5000 }],
      createdAt: NOW, updatedAt: NOW,
    },
  });
  const res = await call(db, { action: 'order', orderId: 'order-1' });
  assert.equal(res.statusCode, 200);
  const order = res.body.order || res.body;
  assert.deepEqual(order.promo, promo);
  assert.equal(order.lines[0].listUnitAmount, 5000);
});
