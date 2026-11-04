'use strict';

/**
 * Promo code preview for the checkout review step (ADR 0004 amendment
 * 2026-11-04). It prices a cart with a code and writes no order and no use;
 * the reservation checks the code again. Each account has a small budget of
 * checks, taken before the code is read, so failed guesses count too.
 */
const { MAX_ORDER_SEATS, MAX_TICKET_TYPES, isTicketTypeId, normalizePromoCode } = require('shared/ticketCommerce');
const { PROMO_ERRORS } = require('shared/promoCodes');
const { methodNotAllowed } = require('../core/errors.cjs');
const {
  CATALOG, INVENTORY, CURRENT, CommerceError, orderIdFor, providerScope, priceSelections, millis,
} = require('./stripeCommerce.cjs');
const { promoRef } = require('./promoCodes.cjs');
const { internals: { verifiedPurchaser, handleError, catalogValue, assertWritableEvent } } = require('./stripeCheckout.cjs');

const MAX_CHECKS = 20;
const CHECK_WINDOW_MS = 15 * 60 * 1000;

function readCart(body) {
  const bad = () => new CommerceError('invalid-checkout', 'Choose your tickets again.', 400);
  const lines = body?.lines;
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > MAX_TICKET_TYPES) throw bad();
  const seen = new Set();
  for (const line of lines) {
    if (!line || !isTicketTypeId(line.ticketTypeId) || seen.has(line.ticketTypeId)
        || !Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > MAX_ORDER_SEATS) throw bad();
    seen.add(line.ticketTypeId);
  }
  if (!Number.isSafeInteger(body.catalogRevision)) throw bad();
  return lines.map(({ ticketTypeId, quantity }) => ({ ticketTypeId, quantity }));
}

/** Take one check from the account's window, in its own transaction. */
async function takeCheck({ db, uid, at }) {
  const ref = db.collection(INVENTORY).doc(`promo_checks_${orderIdFor(uid, 'promo-checks').slice(4)}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    let windowStart = millis(snap.data()?.windowStart);
    let checks = snap.data()?.checks;
    if (!Number.isFinite(windowStart) || !Number.isSafeInteger(checks) || at.getTime() - windowStart >= CHECK_WINDOW_MS) {
      windowStart = at.getTime();
      checks = 0;
    }
    if (checks >= MAX_CHECKS) {
      const error = new CommerceError('rate-limited', 'You have checked too many codes. Try again later.', 429);
      error.retryAfterSeconds = Math.max(1, Math.ceil((windowStart + CHECK_WINDOW_MS - at.getTime()) / 1000));
      throw error;
    }
    tx.set(ref, { windowStart: new Date(windowStart), checks: checks + 1, updatedAt: at });
  });
}

async function previewPromoCode({ db, provider, actor, body, now = () => new Date() }) {
  providerScope(provider);
  const lines = readCart(body);
  const at = now();
  await takeCheck({ db, uid: actor.uid, at });
  const code = normalizePromoCode(body.code);
  if (!code) throw new CommerceError(PROMO_ERRORS.invalid.code, PROMO_ERRORS.invalid.message, PROMO_ERRORS.invalid.status);
  const [catalogSnap, eventSnap, promoSnap] = await db.getAll(
    db.collection(CATALOG).doc(CURRENT), db.collection('config').doc('event'), promoRef(db, code),
  );
  assertWritableEvent(eventSnap.exists ? eventSnap.data() : null);
  const catalog = catalogValue(catalogSnap);
  if (body.catalogRevision !== catalog.revision) {
    throw new CommerceError('catalog-changed', 'Ticket prices or terms have changed. Review the updated catalog before continuing.');
  }
  const priced = priceSelections({
    catalog, at, request: { lines, promoCode: code }, promo: promoSnap.exists ? promoSnap.data() : null,
  });
  return {
    code,
    lines: priced.lines.map(({ ticketTypeId, name, quantity, unitAmount, lineAmount, listUnitAmount }) => ({
      ticketTypeId, name, quantity, unitAmount, lineAmount, ...(listUnitAmount !== undefined ? { listUnitAmount } : {}),
    })),
    subtotalAmount: priced.subtotalAmount, totalAmount: priced.totalAmount, discountAmount: priced.promo.discountAmount,
  };
}

function createTicketingPromoPreviewHandler(deps) {
  return async function ticketingPromoPreview(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    res.set('Cache-Control', 'no-store');
    try {
      const actor = await verifiedPurchaser(deps.auth, req);
      res.status(200).json(await previewPromoCode({ ...deps, actor, body: req.body }));
    } catch (err) { handleError(res, err, deps.log); }
  };
}

module.exports = { previewPromoCode, createTicketingPromoPreviewHandler, internals: { MAX_CHECKS, CHECK_WINDOW_MS } };
