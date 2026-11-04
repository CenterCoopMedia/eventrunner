'use strict';

/**
 * Promo code preview for the checkout review step (ADR 0004 amendment
 * 2026-11-04). It prices a cart with a code and writes no order and no use;
 * the reservation checks the code again. Each check spends one of the
 * account's code checks (promoCodes.cjs), which checkout shares.
 */
const { MAX_ORDER_SEATS, MAX_TICKET_TYPES, isTicketTypeId, normalizePromoCode } = require('shared/ticketCommerce');
const { PROMO_ERRORS } = require('shared/promoCodes');
const { methodNotAllowed } = require('../core/errors.cjs');
const { CATALOG, CURRENT, CommerceError, providerScope, priceSelections } = require('./stripeCommerce.cjs');
const { promoRef, takePromoCheck, MAX_CHECKS, CHECK_WINDOW_MS } = require('./promoCodes.cjs');
const { internals: { verifiedPurchaser, handleError, catalogValue, assertWritableEvent } } = require('./stripeCheckout.cjs');


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

async function previewPromoCode({ db, provider, actor, body, now = () => new Date() }) {
  providerScope(provider);
  const lines = readCart(body);
  const at = now();
  await takePromoCheck({ db, uid: actor.uid, at });
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
