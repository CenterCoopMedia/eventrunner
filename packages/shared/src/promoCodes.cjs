'use strict';

/**
 * Event Runner promo codes (ADR 0004 amendment 2026-11-04, ADR 0008 §6).
 * Pure rules shared by the admin editor and server pricing. The server is the
 * only place a discount is applied; the web uses these to check a form.
 */
const {
  MAX_AMOUNT, MAX_ORDER_SEATS, isTicketTypeId, isSalesWindowOpen, normalizePromoCode,
} = require('./ticketCommerce.cjs');

const MAX_USES = 100000;
const KINDS = Object.freeze(['percent', 'amount']);
const FIELDS = Object.freeze(['code', 'kind', 'value', 'ticketTypeIds', 'maxUses', 'maxPerOrder', 'startsAt', 'endsAt', 'active']);

// An unknown, inactive or out-of-window code gets one answer, so a guess
// learns nothing about which codes exist.
const PROMO_ERRORS = Object.freeze({
  invalid: Object.freeze({ code: 'promo-invalid', message: 'This code is not valid.', status: 400 }),
  notApplicable: Object.freeze({ code: 'promo-not-applicable', message: 'This code does not apply to the selected tickets.', status: 400 }),
  exhausted: Object.freeze({ code: 'promo-exhausted', message: 'This code has no uses left.', status: 409 }),
});

const wholeNumber = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;

function instant(value) {
  if (value === null || value === undefined || value === '') return { ok: true, value: null };
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return { ok: false };
  return { ok: true, value: new Date(value).toISOString() };
}

/** Check an admin save. Returns { ok, value, errors } with one message per field. */
function validatePromoCode(input) {
  const errors = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, value: null, errors: { code: 'Enter the promo code details.' } };
  }
  for (const key of Object.keys(input)) if (!FIELDS.includes(key)) errors[key] = 'This field is not supported.';
  const code = normalizePromoCode(input.code);
  if (!code) errors.code = 'Use 3 to 32 letters, digits, hyphens or underscores, starting with a letter or digit.';
  const kind = KINDS.includes(input.kind) ? input.kind : null;
  if (!kind) errors.kind = 'Choose a percent or an amount off.';
  if (kind === 'percent' && !wholeNumber(input.value, 1, 100)) errors.value = 'Enter a whole percent from 1 to 100.';
  if (kind === 'amount' && !wholeNumber(input.value, 1, MAX_AMOUNT)) errors.value = 'Enter an amount off greater than zero.';
  const ids = input.ticketTypeIds === undefined ? [] : input.ticketTypeIds;
  if (!Array.isArray(ids) || !ids.every(isTicketTypeId)) errors.ticketTypeIds = 'Choose ticket types from the catalog.';
  const optional = (field, max, message) => {
    const value = input[field] ?? null;
    if (value !== null && !wholeNumber(value, 1, max)) errors[field] = message;
    return value;
  };
  const maxUses = optional('maxUses', MAX_USES, `Enter a whole number from 1 to ${MAX_USES}, or leave it empty.`);
  const maxPerOrder = optional('maxPerOrder', MAX_ORDER_SEATS, `Enter a whole number from 1 to ${MAX_ORDER_SEATS}, or leave it empty.`);
  const startsAt = instant(input.startsAt);
  const endsAt = instant(input.endsAt);
  if (!startsAt.ok) errors.startsAt = 'Enter a valid start time.';
  if (!endsAt.ok) errors.endsAt = 'Enter a valid end time.';
  if (startsAt.value && endsAt.value && Date.parse(endsAt.value) <= Date.parse(startsAt.value)) {
    errors.endsAt = 'The end must be after the start.';
  }
  if (typeof input.active !== 'boolean') errors.active = 'Choose active or inactive.';
  if (Object.keys(errors).length) return { ok: false, value: null, errors };
  return {
    ok: true,
    value: {
      code, kind, value: input.value, ticketTypeIds: [...new Set(ids)].sort(), maxUses, maxPerOrder,
      startsAt: startsAt.value, endsAt: endsAt.value, active: input.active,
    },
    errors: {},
  };
}

/** One ticket's price after the code. A percent rounds half up; nothing goes below zero. */
function discountedUnitAmount(promo, unitAmount) {
  const off = promo.kind === 'percent' ? Math.round((unitAmount * promo.value) / 100) : promo.value;
  return Math.max(0, unitAmount - off);
}

/**
 * Apply a stored code to priced lines ({ ticketTypeId, quantity, unitAmount,
 * lineAmount, ... }). Free types are never discounted. Limits count
 * discounted tickets, and `used` holds the ones already held or sold.
 */
function applyPromoCode({ promo, lines, at }) {
  if (!promo || promo.active !== true
      || !isSalesWindowOpen({ salesStartAt: promo.startsAt, salesEndAt: promo.endsAt }, at)) {
    return { ok: false, ...PROMO_ERRORS.invalid };
  }
  const eligible = (item) => item.unitAmount > 0
    && (!promo.ticketTypeIds?.length || promo.ticketTypeIds.includes(item.ticketTypeId));
  const discountedSeats = lines.filter(eligible).reduce((sum, item) => sum + item.quantity, 0);
  if (!discountedSeats) return { ok: false, ...PROMO_ERRORS.notApplicable };
  if (promo.maxPerOrder && discountedSeats > promo.maxPerOrder) {
    return {
      ok: false, code: 'promo-order-limit', status: 400,
      message: `This code applies to at most ${promo.maxPerOrder} ${promo.maxPerOrder === 1 ? 'ticket' : 'tickets'} in one order.`,
    };
  }
  if (promo.maxUses && (promo.used || 0) + discountedSeats > promo.maxUses) return { ok: false, ...PROMO_ERRORS.exhausted };
  let discountAmount = 0;
  const priced = lines.map((item) => {
    if (!eligible(item)) return item;
    const unitAmount = discountedUnitAmount(promo, item.unitAmount);
    discountAmount += (item.unitAmount - unitAmount) * item.quantity;
    return { ...item, unitAmount, lineAmount: unitAmount * item.quantity, listUnitAmount: item.unitAmount };
  });
  return { ok: true, lines: priced, discountedSeats, discountAmount };
}

module.exports = {
  PROMO_ERRORS, PROMO_KINDS: KINDS, MAX_PROMO_USES: MAX_USES,
  normalizePromoCode, validatePromoCode, discountedUnitAmount, applyPromoCode,
};
