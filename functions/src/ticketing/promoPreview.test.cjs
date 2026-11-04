'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { response, setup } = require('./commerceTestKit.cjs');
const { createTicketingPromoPreviewHandler, internals: { MAX_CHECKS, CHECK_WINDOW_MS } } = require('./promoPreview.cjs');

const EARLY = {
  code: 'EARLY', kind: 'amount', value: 500, ticketTypeIds: ['general'], maxUses: null, maxPerOrder: null,
  startsAt: null, endsAt: null, active: true, used: 0,
};
const body = (patch = {}) => ({
  code: 'early', catalogRevision: 1,
  lines: [{ ticketTypeId: 'general', quantity: 2 }, { ticketTypeId: 'student', quantity: 1 }], ...patch,
});

async function preview(deps, input = body(), token = 'ada') {
  const res = response();
  await createTicketingPromoPreviewHandler(deps)({ method: 'POST', headers: { authorization: `Bearer ${token}` }, body: input }, res);
  return res;
}

test('the preview prices the cart with the code and writes no order or use', async () => {
  const { deps, db } = setup({ seed: { 'ticket_promo_codes/EARLY': EARLY } });
  const res = await preview(deps);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.deepEqual(res.body, {
    code: 'EARLY', subtotalAmount: 5000, totalAmount: 5000, discountAmount: 1000,
    lines: [
      { ticketTypeId: 'general', name: 'Full event pass', quantity: 2, unitAmount: 2000, lineAmount: 4000, listUnitAmount: 2500 },
      { ticketTypeId: 'student', name: 'Student full event pass', quantity: 1, unitAmount: 1000, lineAmount: 1000 },
    ],
  });
  assert.equal(db.ids('ticket_orders').length, 0);
  assert.equal(db.read('ticket_promo_codes', 'EARLY').used, 0);
});

test('the preview needs a verified account and POST', async () => {
  const { deps } = setup({ seed: { 'ticket_promo_codes/EARLY': EARLY } });
  assert.equal((await preview(deps, body(), 'nobody')).statusCode, 401);
  assert.equal((await preview(deps, body(), 'unverified')).statusCode, 403);
  const res = response();
  await createTicketingPromoPreviewHandler(deps)({ method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 405);
});

test('the preview gives the same answer for unknown and inactive codes and checks the cart shape', async () => {
  const { deps } = setup({ seed: { 'ticket_promo_codes/OFF': { ...EARLY, code: 'OFF', active: false } } });
  for (const code of ['MISSING', 'off', 'x']) {
    const res = await preview(deps, body({ code }));
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body.error, { code: 'promo-invalid', message: 'This code is not valid.' });
  }
  for (const lines of [[], [{ ticketTypeId: 'general', quantity: 0 }], [{ ticketTypeId: 'general', quantity: 1 }, { ticketTypeId: 'general', quantity: 1 }], 'general']) {
    assert.equal((await preview(deps, body({ lines }))).body.error.code, 'invalid-checkout');
  }
  assert.equal((await preview(deps, body({ catalogRevision: 9 }))).body.error.code, 'catalog-changed');
});

test('the preview allows a fixed number of checks per account, failed ones included', async () => {
  const { deps, advance } = setup({ seed: { 'ticket_promo_codes/EARLY': EARLY } });
  for (let i = 0; i < MAX_CHECKS; i += 1) await preview(deps, body({ code: `GUESS${i}` }));
  const limited = await preview(deps);
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.body.error.code, 'rate-limited');
  assert.ok(Number(limited.headers['Retry-After']) > 0);
  // Another account has its own budget.
  assert.equal((await preview(deps, body(), 'bob')).statusCode, 200);
  advance(CHECK_WINDOW_MS);
  assert.equal((await preview(deps)).statusCode, 200);
});
