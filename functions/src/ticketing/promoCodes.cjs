'use strict';

/**
 * Promo code records (ADR 0004 amendment 2026-11-04). Pricing rules live in
 * shared/promoCodes; this file holds the store, the use counter, the admin
 * actions and the checkout preview.
 */
const { randomUUID } = require('node:crypto');
const { normalizePromoCode } = require('shared/ticketCommerce');
const { validatePromoCode } = require('shared/promoCodes');
const { checkDemoWrites } = require('../core/demoWrites.cjs');
const { CATALOG, CURRENT, INVENTORY, CommerceError, orderIdFor, iso, millis } = require('./stripeCommerce.cjs');

const PROMO_CODES = 'ticket_promo_codes';
const MAX_LISTED = 200;
const MAX_CHECKS = 20;
const CHECK_WINDOW_MS = 15 * 60 * 1000;

function promoRef(db, code) {
  return db.collection(PROMO_CODES).doc(code);
}

/**
 * The counter after an unpaid hold ends: the order's discounted tickets go
 * back to the code. Null when there is nothing to give back (no code, or the
 * code was removed). Call only with the transition that releases the hold, so
 * a replay cannot give the uses back twice.
 */
function releasedPromoUse(snap, order, at) {
  if (!order.promo?.code || !snap?.exists) return null;
  const used = Number.isSafeInteger(snap.data().used) ? snap.data().used : 0;
  return { used: Math.max(0, used - (order.promo.discountedSeats || 0)), updatedAt: at };
}

/**
 * Spend one of the account's code checks, in its own transaction, before the
 * code is read: a refused code rolls back every write in the reservation, so
 * only a separate write makes failed guesses count. Checkout and the preview
 * share the budget, so neither answers guesses without a limit.
 */
async function takePromoCheck({ db, uid, at }) {
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

async function requireWrites(db, tx) {
  const policy = await checkDemoWrites({ db, transaction: tx });
  if (!policy.ok) throw new CommerceError(policy.code, policy.message, policy.status);
}

function audit(tx, db, { action, actor, code, at, details = {} }) {
  tx.create(db.collection('admin_logs').doc(randomUUID()), {
    action: `ticketing.${action}`, docPath: `${PROMO_CODES}/${code}`,
    uid: actor.uid, actorUid: actor.uid, at, details,
  });
}

/** Every code, by code. A deployment has a handful; the cap only bounds a read. */
async function listPromoCodes({ db }) {
  const snap = await db.collection(PROMO_CODES).limit(MAX_LISTED).get();
  const codes = snap.docs.map((doc) => {
    const data = doc.data();
    return {
      code: doc.id, kind: data.kind, value: data.value, ticketTypeIds: data.ticketTypeIds || [],
      maxUses: data.maxUses ?? null, maxPerOrder: data.maxPerOrder ?? null,
      startsAt: data.startsAt ?? null, endsAt: data.endsAt ?? null, active: data.active === true,
      used: Number.isSafeInteger(data.used) ? data.used : 0,
      createdAt: iso(data.createdAt), updatedAt: iso(data.updatedAt),
    };
  }).sort((a, b) => a.code.localeCompare(b.code));
  return { codes };
}

/**
 * Create (`create: true`) or change one code. A save never sets `used`: the
 * counter belongs to checkout and reconciliation, and this transaction reads
 * it, so a checkout racing the save retries one or the other.
 */
async function savePromoCode({ db, actor, body, now }) {
  const verdict = validatePromoCode(body.promo);
  if (!verdict.ok) throw new CommerceError('bad-request', Object.values(verdict.errors)[0], 400);
  const next = verdict.value;
  await db.runTransaction(async (tx) => {
    await requireWrites(db, tx);
    const ref = promoRef(db, next.code);
    const [snap, catalogSnap] = await tx.getAll(ref, db.collection(CATALOG).doc(CURRENT));
    const typeIds = new Set((catalogSnap.data()?.ticketTypes || []).map((type) => type.id));
    if (next.ticketTypeIds.some((id) => !typeIds.has(id))) {
      throw new CommerceError('bad-request', 'Choose each ticket type from the current catalog.', 400);
    }
    if (body.create === true && snap.exists) throw new CommerceError('conflict', 'A code with this name already exists.', 409);
    if (body.create !== true && !snap.exists) throw new CommerceError('not-found', 'This code no longer exists. Reload the list.', 404);
    const at = now();
    tx.set(ref, {
      ...next, used: snap.exists && Number.isSafeInteger(snap.data().used) ? snap.data().used : 0,
      createdAt: snap.exists ? snap.data().createdAt || at : at, updatedAt: at, updatedBy: actor.uid,
    });
    audit(tx, db, { action: 'promo-saved', actor, code: next.code, at, details: { created: !snap.exists } });
  });
  return listPromoCodes({ db });
}

/** Remove an unused code. A used code stays for the order records; make it inactive. */
async function deletePromoCode({ db, actor, body, now }) {
  const code = normalizePromoCode(body.code);
  if (!code) throw new CommerceError('bad-request', 'Choose a code.', 400);
  await db.runTransaction(async (tx) => {
    await requireWrites(db, tx);
    const ref = promoRef(db, code);
    const snap = await tx.get(ref);
    if (!snap.exists) throw new CommerceError('not-found', 'This code no longer exists. Reload the list.', 404);
    if ((snap.data().used || 0) > 0) {
      throw new CommerceError('conflict', 'This code has been used. Make it inactive instead.', 409);
    }
    tx.delete(ref);
    audit(tx, db, { action: 'promo-deleted', actor, code, at: now() });
  });
  return listPromoCodes({ db });
}

module.exports = {
  PROMO_CODES, MAX_CHECKS, CHECK_WINDOW_MS,
  promoRef, releasedPromoUse, takePromoCheck, listPromoCodes, savePromoCode, deletePromoCode,
};
