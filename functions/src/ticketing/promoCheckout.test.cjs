'use strict';

// Promo codes at checkout (ADR 0004 amendment 2026-11-04): the server prices
// the code inside the reservation, and a limit holds under racing checkouts.
const test = require('node:test');
const assert = require('node:assert/strict');
const { BOB, PERSON, request, setup, checkout, status } = require('./commerceTestKit.cjs');

const EARLY = {
  code: 'EARLY', kind: 'percent', value: 20, ticketTypeIds: [], maxUses: null, maxPerOrder: null,
  startsAt: null, endsAt: null, active: true, used: 0,
};
const withCode = (patch = {}) => ({ 'ticket_promo_codes/EARLY': { ...EARLY, ...patch } });
const two = { ticketTypeId: 'general', quantity: 2, attendees: [PERSON, { ...PERSON, email: BOB.email }] };

test('a code lowers the unit price sent to Stripe and records the discount on the order', async () => {
  const { deps, db, calls } = setup({ seed: withCode() });
  const res = await checkout(deps, request({ promoCode: 'early', lines: [two] }));
  assert.equal(res.statusCode, 200);
  const order = db.read('ticket_orders', res.body.orderId);
  assert.equal(order.totalAmount, 4000);
  assert.equal(order.subtotalAmount, 4000);
  // Stripe sees a lower price, not a Stripe discount, so this stays 0 for reconciliation.
  assert.equal(order.discountAmount, 0);
  assert.deepEqual(order.promo, { code: 'EARLY', kind: 'percent', value: 20, discountedSeats: 2, discountAmount: 1000 });
  assert.equal(order.lines[0].unitAmount, 2000);
  assert.equal(order.lines[0].listUnitAmount, 2500);
  assert.equal(calls[0].params.line_items[0].price_data.unit_amount, 2000);
  assert.equal(calls[0].params.allow_promotion_codes, false);
  assert.equal(db.read('ticket_promo_codes', 'EARLY').used, 2);
  const shown = await status(deps, { orderId: order.id });
  assert.deepEqual(shown.body.promo, { code: 'EARLY', discountAmount: 1000 });
  assert.equal(shown.body.lines[0].listUnitAmount, 2500);
});

test('a code that cannot be used reserves nothing', async () => {
  const cases = [
    [{}, 'MISSING', 'promo-invalid', 400],
    [{ active: false }, 'EARLY', 'promo-invalid', 400],
    [{ endsAt: '2026-10-12T15:00:00.000Z' }, 'EARLY', 'promo-invalid', 400],
    [{ ticketTypeIds: ['student'] }, 'EARLY', 'promo-not-applicable', 400],
    [{ maxPerOrder: 1 }, 'EARLY', 'promo-order-limit', 400],
    [{ maxUses: 3, used: 2 }, 'EARLY', 'promo-exhausted', 409],
  ];
  for (const [patch, code, expected, statusCode] of cases) {
    const { deps, db, calls } = setup({ seed: withCode(patch) });
    const res = await checkout(deps, request({ promoCode: code, lines: [two] }));
    assert.equal(res.statusCode, statusCode, expected);
    assert.equal(res.body.error.code, expected);
    assert.equal(db.ids('ticket_orders').length, 0);
    assert.equal(db.read('ticket_inventory', 'current'), undefined);
    assert.equal(db.read('ticket_promo_codes', 'EARLY')?.used ?? 0, patch.used ?? 0);
    assert.equal(calls.length, 0);
  }
});

test('two checkouts racing the last use cannot both take it', async () => {
  const { deps, db, calls } = setup({ seed: withCode({ maxUses: 1 }) });
  const results = await Promise.all([
    checkout(deps, request({ promoCode: 'EARLY' })),
    checkout(deps, request({ promoCode: 'EARLY', requestId: 'checkout-request-0002', lines: [{ ticketTypeId: 'general', quantity: 1, attendees: [{ ...PERSON, email: BOB.email }] }] }), 'bob'),
  ]);
  assert.deepEqual(results.map((res) => res.statusCode).sort(), [200, 409]);
  assert.equal(results.find((res) => res.statusCode === 409).body.error.code, 'promo-exhausted');
  assert.equal(db.read('ticket_promo_codes', 'EARLY').used, 1);
  assert.equal(db.ids('ticket_orders').length, 1);
  assert.equal(db.read('ticket_inventory', 'current').held, 1);
  assert.equal(calls.length, 1);
});

test('a retry of the same request does not take a second use; a different code is a different order', async () => {
  const { deps, db } = setup({ seed: withCode() });
  const first = await checkout(deps, request({ promoCode: 'EARLY' }));
  const again = await checkout(deps, request({ promoCode: 'EARLY' }));
  assert.equal(again.body.orderId, first.body.orderId);
  assert.equal(db.read('ticket_promo_codes', 'EARLY').used, 1);
  const other = await checkout(deps, request());
  assert.equal(other.statusCode, 409);
  assert.equal(other.body.error.code, 'idempotency-conflict');
});

test('a code that makes the order free issues tickets under the free-ticket guards', async () => {
  const { deps, db, calls } = setup({ seed: withCode({ value: 100 }) });
  const res = await checkout(deps, request({ promoCode: 'EARLY' }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'free');
  assert.equal(calls.length, 0);
  const order = db.read('ticket_orders', res.body.orderId);
  assert.equal(order.totalAmount, 0);
  assert.equal(order.promo.discountAmount, 2500);
  assert.equal(db.ids('tickets').length, 1);
  assert.equal(db.read('ticket_promo_codes', 'EARLY').used, 1);
  // The same attendee cannot get a second free ticket through the code.
  const second = await checkout(deps, request({ promoCode: 'EARLY', requestId: 'checkout-request-0002' }), 'bob');
  assert.equal(second.body.error.code, 'duplicate-free-recipient');
  assert.equal(db.read('ticket_promo_codes', 'EARLY').used, 1);
});

test('a discount below the card minimum is refused before anything is reserved', async () => {
  const { deps, db } = setup({ seed: withCode({ kind: 'amount', value: 2480 }) });
  const res = await checkout(deps, request({ promoCode: 'EARLY' }));
  assert.equal(res.body.error.code, 'amount-too-small');
  assert.equal(db.read('ticket_promo_codes', 'EARLY').used, 0);
});

test('checkout and the preview share one budget of code checks, failed guesses included', async () => {
  const { MAX_CHECKS } = require('./promoPreview.cjs').internals;
  const { deps, db } = setup({ seed: withCode() });
  for (let i = 0; i < MAX_CHECKS; i += 1) {
    const guess = await checkout(deps, request({ promoCode: `GUESS${i}`, requestId: `checkout-guess-${String(i).padStart(10, '0')}` }));
    assert.equal(guess.body.error.code, 'promo-invalid');
  }
  const limited = await checkout(deps, request({ promoCode: 'EARLY' }));
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.body.error.code, 'rate-limited');
  assert.equal(db.ids('ticket_orders').length, 0);
  // A checkout with no code is not a code check.
  assert.equal((await checkout(deps, request())).statusCode, 200);
});
