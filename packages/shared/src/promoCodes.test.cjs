'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizePromoCode, validatePromoCode, applyPromoCode, discountedUnitAmount, PROMO_ERRORS,
} = require('./promoCodes.cjs');

const AT = new Date('2026-11-04T15:00:00.000Z');
const line = (ticketTypeId, unitAmount, quantity = 1) => ({
  ticketTypeId, name: ticketTypeId, quantity, unitAmount, lineAmount: unitAmount * quantity,
});
const promo = (patch = {}) => ({
  code: 'EARLY', kind: 'percent', value: 20, ticketTypeIds: [], maxUses: null, maxPerOrder: null,
  startsAt: null, endsAt: null, active: true, used: 0, ...patch,
});

test('normalizePromoCode trims, capitalizes and rejects other characters', () => {
  assert.equal(normalizePromoCode('  early-bird_2026 '), 'EARLY-BIRD_2026');
  assert.equal(normalizePromoCode('ab'), null);
  assert.equal(normalizePromoCode('a'.repeat(33)), null);
  assert.equal(normalizePromoCode('two words'), null);
  assert.equal(normalizePromoCode('-LEAD'), null);
  assert.equal(normalizePromoCode(42), null);
});

test('validatePromoCode accepts a full record and fills defaults', () => {
  const result = validatePromoCode({ code: 'early', kind: 'percent', value: 25, active: true });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    code: 'EARLY', kind: 'percent', value: 25, ticketTypeIds: [], maxUses: null, maxPerOrder: null,
    startsAt: null, endsAt: null, active: true,
  });
  const amount = validatePromoCode({
    code: 'PRESS', kind: 'amount', value: 500, ticketTypeIds: ['student', 'general', 'general'],
    maxUses: 10, maxPerOrder: 2, startsAt: '2026-11-01T04:00:00.000Z', endsAt: '2026-11-10T05:00:00.000Z', active: false,
  });
  assert.equal(amount.ok, true);
  assert.deepEqual(amount.value.ticketTypeIds, ['general', 'student']);
});

test('validatePromoCode names each bad field', () => {
  const result = validatePromoCode({
    code: 'no', kind: 'free', value: 0, ticketTypeIds: ['Bad Id'], maxUses: 0, maxPerOrder: 99,
    startsAt: 'soon', endsAt: null, active: 'yes', extra: true,
  });
  assert.equal(result.ok, false);
  for (const field of ['code', 'kind', 'ticketTypeIds', 'maxUses', 'maxPerOrder', 'startsAt', 'active', 'extra']) {
    assert.ok(result.errors[field], `expected an error for ${field}`);
  }
  assert.ok(validatePromoCode({ code: 'BIG', kind: 'percent', value: 101, active: true }).errors.value);
  assert.ok(validatePromoCode({ code: 'BIG', kind: 'amount', value: 2.5, active: true }).errors.value);
  const backwards = validatePromoCode({
    code: 'LATE', kind: 'percent', value: 10, active: true,
    startsAt: '2026-11-10T05:00:00.000Z', endsAt: '2026-11-01T04:00:00.000Z',
  });
  assert.ok(backwards.errors.endsAt);
});

test('discountedUnitAmount rounds a percent half up and never goes below zero', () => {
  assert.equal(discountedUnitAmount(promo({ value: 15 }), 2550), 2167); // 382.5 off rounds to 383
  assert.equal(discountedUnitAmount(promo({ value: 100 }), 2500), 0);
  assert.equal(discountedUnitAmount(promo({ kind: 'amount', value: 500 }), 2500), 2000);
  assert.equal(discountedUnitAmount(promo({ kind: 'amount', value: 5000 }), 2500), 0);
});

test('applyPromoCode discounts eligible paid lines and records the list price', () => {
  const result = applyPromoCode({
    promo: promo({ ticketTypeIds: ['general'] }),
    lines: [line('general', 2500, 2), line('student', 1000)], at: AT,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.lines[0], {
    ticketTypeId: 'general', name: 'general', quantity: 2, unitAmount: 2000, lineAmount: 4000, listUnitAmount: 2500,
  });
  assert.deepEqual(result.lines[1], line('student', 1000));
  assert.equal(result.discountedSeats, 2);
  assert.equal(result.discountAmount, 1000);
});

test('applyPromoCode never discounts a free ticket type', () => {
  const result = applyPromoCode({ promo: promo(), lines: [line('free', 0, 2), line('general', 2500)], at: AT });
  assert.equal(result.ok, true);
  assert.equal(result.discountedSeats, 1);
  assert.deepEqual(result.lines[0], line('free', 0, 2));
});

test('applyPromoCode gives one message for unknown, inactive and out-of-window codes', () => {
  const lines = [line('general', 2500)];
  const invalid = PROMO_ERRORS.invalid;
  assert.deepEqual(applyPromoCode({ promo: null, lines, at: AT }), { ok: false, ...invalid });
  assert.deepEqual(applyPromoCode({ promo: promo({ active: false }), lines, at: AT }), { ok: false, ...invalid });
  assert.deepEqual(applyPromoCode({ promo: promo({ startsAt: '2026-11-05T00:00:00.000Z' }), lines, at: AT }), { ok: false, ...invalid });
  assert.deepEqual(applyPromoCode({ promo: promo({ endsAt: AT.toISOString() }), lines, at: AT }), { ok: false, ...invalid });
  assert.equal(applyPromoCode({ promo: promo({ endsAt: '2026-11-04T15:00:00.001Z' }), lines, at: AT }).ok, true);
});

test('applyPromoCode refuses carts the code does not fit', () => {
  assert.equal(applyPromoCode({ promo: promo({ ticketTypeIds: ['student'] }), lines: [line('general', 2500)], at: AT }).code, 'promo-not-applicable');
  assert.equal(applyPromoCode({ promo: promo(), lines: [line('free', 0)], at: AT }).code, 'promo-not-applicable');
  assert.equal(applyPromoCode({ promo: promo({ maxPerOrder: 2 }), lines: [line('general', 2500, 3)], at: AT }).code, 'promo-order-limit');
  assert.equal(applyPromoCode({ promo: promo({ maxPerOrder: 3 }), lines: [line('general', 2500, 3)], at: AT }).ok, true);
});

test('applyPromoCode counts uses in discounted tickets', () => {
  const lines = [line('general', 2500, 2)];
  assert.equal(applyPromoCode({ promo: promo({ maxUses: 5, used: 3 }), lines, at: AT }).ok, true);
  const out = applyPromoCode({ promo: promo({ maxUses: 5, used: 4 }), lines, at: AT });
  assert.equal(out.code, 'promo-exhausted');
  assert.equal(out.status, 409);
});
