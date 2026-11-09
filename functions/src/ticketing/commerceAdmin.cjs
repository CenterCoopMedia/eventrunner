'use strict';

// Organizer operations use live role checks and transactions. Financial facts
// belong to reconciliation; cancelling admission never issues a money refund.
const { randomUUID } = require('node:crypto');
const { requireAdmin, verifyAuthToken } = require('../core/auth.cjs');
const { checkDemoWrites } = require('../core/demoWrites.cjs');
const { sendError } = require('../core/errors.cjs');
const { internals: { safeDocId, TICKETS } } = require('./index.cjs');
const { listPromoCodes, savePromoCode, deletePromoCode, promoRef, releasedPromoUse } = require('./promoCodes.cjs');
const { ORDERS, CATALOG, INVENTORY, CommerceError, normalizeInventory, inventoryTransitionPatch } = require('./stripeCommerce.cjs');
const { internals: { scopeMatches } } = require('./providers/stripe.cjs');

const AUDIT = 'admin_logs';
const MAX_PAGE = 50;
const MAX_SCAN = 250;
const OPERATOR_ACTIONS = new Set(['saveCatalog', 'pauseSales', 'issueComp', 'allocateRefund', 'releaseHold']);
const READ_ACTIONS = new Set(['catalog', 'orders', 'order', 'tickets', 'promoCodes']);
// Promo codes are staff-editable (ADR 0008 §6); they live in promoCodes.cjs.
const ACTIONS = new Set([...READ_ACTIONS, ...OPERATOR_ACTIONS, 'updateAttendee', 'cancelTickets', 'resend', 'reconcile', 'savePromoCode', 'deletePromoCode']);
const { EMAIL_ADDRESS_RE: EMAIL_RE } = require('shared/email');
const { isOrderFulfilled } = require('shared/ticketCommerce');

// An organizer check answers with its own status, 5xx included. A 5xx
// CommerceError from the checkout or inventory code gets the generic answer.
const ORGANIZER_ERRORS = new WeakSet();
function fail(status, code, message) {
  const error = new CommerceError(code, message, status);
  ORGANIZER_ERRORS.add(error);
  throw error;
}
async function requireWrites(db, transaction) {
  const policy = await checkDemoWrites({ db, transaction });
  if (!policy.ok) fail(policy.status, policy.code, policy.message);
}
function idOf(value, label = 'Reference') {
  const id = safeDocId(value);
  if (!id) fail(400, 'bad-request', `${label} is required.`);
  return id;
}
function textOf(value, max = 200) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function reasonOf(body) {
  const reason = textOf(body.reason, 500);
  if (!reason) fail(400, 'bad-request', 'Describe the reason for this change.');
  return reason;
}
function confirm(body) {
  if (body.confirmed !== true) fail(400, 'confirmation-required', 'Confirm the selected tickets and their access consequences.');
}
function iso(value) {
  if (typeof value?.toDate === 'function') return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'string' ? value : null;
}
function requireOrder(snap, provider) {
  const order = snap.exists ? snap.data() : null;
  if (!order || !scopeMatches(order, provider)) fail(404, 'not-found', 'Order not found.');
  return { ...order, id: snap.id };
}
function auditRef(db) { return db.collection(AUDIT).doc(randomUUID()); }
function audit(tx, ref, { action, actor, now, orderId = null, ticketIds = [], reason = null, details = {} }) {
  tx.create(ref, {
    action: `ticketing.${action}`, docPath: orderId ? `${ORDERS}/${orderId}` : `${CATALOG}/current`,
    uid: actor.uid, actorUid: actor.uid, at: now(), orderId, ticketIds, reason, details,
  });
}
function publicTicket(ticket, id) {
  return {
    id, externalId: id, orderId: ticket.orderId, ticketTypeId: ticket.ticketTypeId || null,
    ticketClass: ticket.ticketClass || '', email: ticket.email || '',
    firstName: ticket.firstName || '', lastName: ticket.lastName || '', status: ticket.status,
    claimedByUid: ticket.claimedByUid || null, checkedInAt: iso(ticket.checkedInAt),
    createdAt: iso(ticket.createdAt), updatedAt: iso(ticket.updatedAt),
  };
}
function publicOrder(order) {
  return {
    id: order.id, orderId: order.id, eventId: order.eventId,
    purchaserEmail: order.purchaserEmail || '', purchaser: { email: order.purchaserEmail || '' },
    status: order.status, paymentStatus: order.paymentStatus, currency: order.currency,
    subtotalAmount: order.subtotalAmount, totalAmount: order.totalAmount,
    discountAmount: order.discountAmount || 0, taxAmount: order.taxAmount || 0, feeAmount: order.feeAmount || 0,
    promo: order.promo || null,
    refundStatus: order.refundStatus || 'none', refundedAmount: order.refundedAmount || 0,
    refunds: (order.refunds || []).map((refund) => ({
      id: refund.id, amount: refund.amount, currency: refund.currency, status: refund.status,
      createdAt: iso(refund.createdAt), failureReason: refund.failureReason || null,
    })),
    refundAllocations: order.refundAllocations || {}, refundAllocationDecisions: order.refundAllocationDecisions || {},
    lines: order.lines || [], source: order.source || 'checkout', inventoryState: order.inventoryState,
    stripeAccountId: order.stripeAccountId, livemode: order.livemode,
    createdAt: iso(order.createdAt), updatedAt: iso(order.updatedAt),
    reconciliationException: order.reconciliationException ? {
      code: order.reconciliationException.code, message: order.reconciliationException.message,
    } : null,
    disputes: (order.disputes || []).map(({ id, status, amount, currency }) => ({ id, status, amount, currency })),
  };
}
function dashboardUrl(order) {
  if (!/^acct_[A-Za-z0-9]+$/.test(order.stripeAccountId || '')) return null;
  const base = `https://dashboard.stripe.com/${order.stripeAccountId}/${order.livemode ? '' : 'test/'}`;
  if (/^pi_[A-Za-z0-9]+$/.test(order.stripePaymentIntentId || '')) return `${base}payments/${order.stripePaymentIntentId}`;
  if (/^cs_[A-Za-z0-9_]+$/.test(order.stripeSessionId || '')) return `${base}checkout/sessions/${order.stripeSessionId}`;
  return null;
}

async function readOrderDetail({ db, provider, orderId }) {
  const order = requireOrder(await db.collection(ORDERS).doc(idOf(orderId, 'Order')).get(), provider);
  const ids = Array.isArray(order.ticketIds) ? order.ticketIds.slice(0, 20) : [];
  const ticketSnaps = await Promise.all(ids.map((id) => db.collection(TICKETS).doc(id).get()));
  const logs = await db.collection(AUDIT).where('orderId', '==', order.id).orderBy('at', 'desc').limit(50).get();
  return {
    order: publicOrder(order),
    tickets: ticketSnaps.filter((snap) => snap.exists && snap.data().orderId === order.id)
      .map((snap) => publicTicket(snap.data(), snap.id)),
    audit: logs.docs.map((snap) => {
      const row = snap.data();
      return { id: snap.id, action: row.action, actorUid: row.actorUid || row.uid, at: iso(row.at), reason: row.reason || null, ticketIds: row.ticketIds || [] };
    }),
    stripeDashboardUrl: dashboardUrl(order),
  };
}

async function readCatalog({ db, provider }) {
  const [catalogSnap, inventorySnap] = await Promise.all([
    db.collection(CATALOG).doc('current').get(), db.collection(INVENTORY).doc('current').get(),
  ]);
  return {
    provider: provider.name, mode: provider.livemode ? 'live' : 'test',
    catalog: catalogSnap.exists ? catalogSnap.data() : null,
    inventory: inventorySnap.exists ? inventorySnap.data() : { eventId: provider.externalEventId, held: 0, sold: 0, types: {} },
  };
}

async function saveCatalog({ db, provider, actor, body, now }) {
  const { validateTicketCatalog } = require('shared/ticketCommerce');
  const verdict = validateTicketCatalog(body.catalog);
  if (!verdict.ok) fail(400, 'bad-request', 'Check ticket prices, capacities, sales dates, currency, and commercial terms.');
  if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0) fail(400, 'bad-request', 'A catalog revision is required.');
  const logRef = auditRef(db);
  await db.runTransaction(async (tx) => {
    await requireWrites(db, tx);
    const ref = db.collection(CATALOG).doc('current');
    const [oldSnap, invSnap] = await Promise.all([tx.get(ref), tx.get(db.collection(INVENTORY).doc('current'))]);
    const old = oldSnap.exists ? oldSnap.data() : null;
    const inventory = normalizeInventory(invSnap.data(), provider.externalEventId);
    if ((old?.revision || 0) !== body.expectedRevision) fail(409, 'conflict', 'The catalog changed. Reload it before saving.');
    const next = verdict.value;
    if (old && old.currency !== next.currency) fail(409, 'conflict', 'Keep the event currency unchanged. Use a separate deployment for another currency.');
    if (next.capacity < inventory.held + inventory.sold) fail(409, 'conflict', 'Event capacity cannot be lower than held and sold seats.');
    for (const [id, used] of Object.entries(inventory.types || {})) {
      const type = next.ticketTypes.find((candidate) => candidate.id === id);
      if ((used.held || 0) + (used.sold || 0) > 0 && (!type || type.capacity < used.held + used.sold)) {
        fail(409, 'conflict', 'Keep ticket types and enough capacity for every held and sold seat.');
      }
    }
    tx.set(ref, { ...next, revision: body.expectedRevision + 1, updatedAt: now(), updatedBy: actor.uid });
    audit(tx, logRef, { action: 'catalog-saved', actor, now, details: { revision: body.expectedRevision + 1 } });
  });
  return readCatalog({ db, provider });
}

async function pauseSales({ db, provider, actor, body, now }) {
  if (typeof body.paused !== 'boolean') fail(400, 'bad-request', 'Choose whether ticket sales are paused.');
  const reason = reasonOf(body);
  const logRef = auditRef(db);
  await db.runTransaction(async (tx) => {
    await requireWrites(db, tx);
    const ref = db.collection(CATALOG).doc('current');
    const snap = await tx.get(ref);
    if (!snap.exists) fail(404, 'not-found', 'Set up the ticket catalog first.');
    const catalog = snap.data();
    tx.update(ref, { salesPaused: body.paused, revision: (catalog.revision || 0) + 1, updatedAt: now(), updatedBy: actor.uid });
    audit(tx, logRef, { action: body.paused ? 'sales-paused' : 'sales-resumed', actor, now, reason });
  });
  return readCatalog({ db, provider });
}

function matchesFilters(row, body, kind) {
  if (kind === 'orders') {
    if (body.paymentStatus && body.paymentStatus !== row.paymentStatus) return false;
    if (body.refundStatus && body.refundStatus !== (row.refundStatus || 'none')) return false;
    if (body.status && body.status !== row.status) return false;
  } else {
    if (body.ticketTypeId && body.ticketTypeId !== row.ticketTypeId) return false;
    if (body.status && body.status !== row.status) return false;
    if (body.claimState === 'claimed' && !row.claimedByUid) return false;
    if (body.claimState === 'unclaimed' && row.claimedByUid) return false;
    if (body.checkInState === 'checked_in' && !row.checkedInAt) return false;
    if (body.checkInState === 'not_checked_in' && row.checkedInAt) return false;
  }
  const search = textOf(body.search, 150).toLowerCase();
  return !search || [row.id, row.externalId, row.orderId, row.purchaserEmail, row.email, row.firstName, row.lastName]
    .some((value) => typeof value === 'string' && value.toLowerCase().includes(search));
}

// The cursor identifies the last examined row, including when filters skip a
// page. Bounded scans keep admin searches predictable without creating an index
// for every combination of optional filters. No page claims to count all hits.
async function listCommerce({ db, provider, body, kind }) {
  const limit = body.limit === undefined ? 25 : Number(body.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE) fail(400, 'bad-request', `Choose a page size from 1 to ${MAX_PAGE}.`);
  const isOrders = kind === 'orders';
  const field = isOrders ? 'id' : 'externalId';
  let query = db.collection(isOrders ? ORDERS : TICKETS).where('provider', '==', 'stripe').orderBy(field);
  if (body.cursor) query = query.startAfter(idOf(body.cursor, 'Page reference'));
  const snap = await query.limit(MAX_SCAN + 1).get();
  const rows = [];
  let examined = 0;
  let last = null;
  const orderCache = new Map();
  for (const doc of snap.docs.slice(0, MAX_SCAN)) {
    const row = { ...doc.data(), id: doc.id };
    examined += 1;
    last = row[field] || doc.id;
    let inScope = false;
    if (isOrders) inScope = scopeMatches(row, provider);
    else if (safeDocId(row.orderId)) {
      if (!orderCache.has(row.orderId)) {
        const parent = await db.collection(ORDERS).doc(row.orderId).get();
        orderCache.set(row.orderId, parent.exists && scopeMatches(parent.data(), provider));
      }
      inScope = orderCache.get(row.orderId);
    }
    if (inScope && matchesFilters(row, body, kind)) rows.push(isOrders ? publicOrder(row) : publicTicket(row, doc.id));
    if (rows.length >= limit) break;
  }
  return { [kind]: rows, nextCursor: snap.docs.length > examined ? last : null };
}

async function correctAttendee({ db, provider, actor, body, now }) {
  const ticketId = idOf(body.ticketId, 'Ticket');
  const reason = reasonOf(body);
  const email = textOf(body.email, 254).toLowerCase();
  if (!EMAIL_RE.test(email)) fail(400, 'bad-request', 'Enter a valid attendee email.');
  const firstName = textOf(body.firstName, 100);
  const lastName = textOf(body.lastName, 100);
  if (!firstName) fail(400, 'bad-request', 'Enter the attendee first name.');
  const logRef = auditRef(db);
  let orderId;
  await db.runTransaction(async (tx) => {
    await requireWrites(db, tx);
    const ref = db.collection(TICKETS).doc(ticketId);
    const snap = await tx.get(ref);
    if (!snap.exists || snap.data().provider !== 'stripe') fail(404, 'not-found', 'Ticket not found.');
    const ticket = snap.data();
    orderId = idOf(ticket.orderId, 'Order');
    const orderRef = db.collection(ORDERS).doc(orderId);
    const order = requireOrder(await tx.get(orderRef), provider);
    if (!order.ticketIds?.includes(ticketId)) fail(404, 'not-found', 'Ticket not found.');
    if (email !== ticket.email && (ticket.claimedByUid || ticket.checkedInAt)) {
      fail(409, 'conflict', 'A claimed or checked-in ticket cannot change owners. Correct the name or use the organizer support process.');
    }
    const changes = { email, firstName, lastName };
    tx.update(ref, { ...changes, updatedAt: now() });
    // A new email is a new person: registration answers given for the first
    // one (ADR 0008 §5) never pass to them. A name fix keeps the answers.
    const newHolder = email !== ticket.email;
    tx.update(orderRef, {
      seats: (order.seats || []).map((seat) => {
        if (seat.externalId !== ticketId) return seat;
        const { answers, ...rest } = seat;
        return newHolder || answers === undefined ? { ...rest, ...changes } : { ...rest, answers, ...changes };
      }),
      updatedAt: now(),
    });
    audit(tx, logRef, { action: 'attendee-corrected', actor, now, orderId, ticketIds: [ticketId], reason });
  });
  return readOrderDetail({ db, provider, orderId });
}

function selectedTickets(body, allowEmpty = false) {
  if (!Array.isArray(body.ticketIds) || body.ticketIds.length > 20 || (!allowEmpty && body.ticketIds.length === 0)) {
    fail(400, 'bad-request', 'Select between 1 and 20 tickets.');
  }
  const ids = body.ticketIds.map((id) => idOf(id, 'Ticket'));
  if (new Set(ids).size !== ids.length) fail(400, 'bad-request', 'Select each ticket only once.');
  return ids;
}

async function changeAdmission({ db, provider, actor, body, now, allocate = false }) {
  confirm(body);
  const orderId = idOf(body.orderId, 'Order');
  const reason = reasonOf(body);
  const preserve = allocate && body.preserveAdmission === true;
  const ids = selectedTickets(body, preserve);
  if (preserve && ids.length !== 0) fail(400, 'bad-request', 'Choose either keeping admission or selecting tickets to remove.');
  const refundId = allocate ? idOf(body.refundId, 'Refund') : null;
  const logRef = auditRef(db);
  await db.runTransaction(async (tx) => {
    await requireWrites(db, tx);
    const orderRef = db.collection(ORDERS).doc(orderId);
    const order = requireOrder(await tx.get(orderRef), provider);
    if (order.inventoryState !== 'sold') fail(409, 'conflict', 'Only completed orders have admission tickets to change.');
    if (ids.some((id) => !order.ticketIds?.includes(id))) fail(404, 'not-found', 'A selected ticket does not belong to this order.');
    const refs = ids.map((id) => db.collection(TICKETS).doc(id));
    const snaps = await Promise.all(refs.map((ref) => tx.get(ref)));
    if (snaps.some((snap) => !snap.exists || snap.data().orderId !== orderId)) fail(404, 'not-found', 'A selected ticket could not be found.');
    if (snaps.some((snap) => snap.data().checkedInAt) && actor.tier !== 'operator') fail(403, 'forbidden', 'An operator must change admission for a checked-in ticket.');
    let patch = { updatedAt: now() };
    if (allocate) {
      const refund = (order.refunds || []).find((candidate) => candidate.id === refundId);
      if (!refund || refund.status !== 'succeeded' || refund.currency !== order.currency) {
        fail(409, 'conflict', 'Reconcile a successful refund in this currency before allocating tickets.');
      }
      if (order.refundStatus === 'full' && preserve) fail(409, 'conflict', 'A fully refunded order cannot keep valid admission.');
      if (Object.prototype.hasOwnProperty.call(order.refundAllocations || {}, refundId)) {
        fail(409, 'conflict', 'This refund already has an admission decision. Review the audit trail.');
      }
      patch = {
        ...patch,
        refundAllocations: { ...order.refundAllocations, [refundId]: ids },
        refundAllocationDecisions: { ...order.refundAllocationDecisions, [refundId]: { preserveAdmission: preserve, actorUid: actor.uid, at: now(), reason } },
      };
      const stillUnallocated = (order.refunds || []).some((refund) => refund.status === 'succeeded' &&
        !Object.prototype.hasOwnProperty.call(patch.refundAllocations, refund.id));
      if (!stillUnallocated && order.reconciliationException?.code === 'refund-allocation-required') patch.reconciliationException = null;
    }
    snaps.forEach((snap, index) => {
      const ticket = snap.data();
      if (ticket.status === 'refunded' || (ticket.status === 'cancelled' && !allocate)) return;
      tx.update(refs[index], {
        status: allocate ? 'refunded' : 'cancelled', cancelledAt: ticket.cancelledAt || now(),
        cancelledByUid: actor.uid, cancellationReason: reason, updatedAt: now(),
      });
    });
    tx.update(orderRef, patch);
    audit(tx, logRef, { action: allocate ? 'refund-allocated' : 'tickets-cancelled', actor, now, orderId, ticketIds: ids, reason, details: allocate ? { refundId, preserveAdmission: preserve } : {} });
  });
  return readOrderDetail({ db, provider, orderId });
}

/**
 * Give back the seats an unpaid order under review still holds (operator
 * only). An order whose checkout outcome is unknown stays in 'exception'
 * with its seats held, and nothing else releases it: it kept the seats, its
 * promo code uses, and the buyer's lock on new orders. This is the release
 * an expired checkout gets, done by hand with a reason. If the buyer did pay
 * after all, reconciliation flags 'payment-after-capacity-release' for review.
 */
async function releaseHold({ db, provider, actor, body, now }) {
  if (body.confirmed !== true) fail(400, 'confirmation-required', 'Confirm that the buyer has not paid for this order.');
  const orderId = idOf(body.orderId, 'Order');
  const reason = reasonOf(body);
  const logRef = auditRef(db);
  await db.runTransaction(async (tx) => {
    await requireWrites(db, tx);
    const orderRef = db.collection(ORDERS).doc(orderId);
    const order = requireOrder(await tx.get(orderRef), provider);
    if (order.inventoryState !== 'held') fail(409, 'conflict', 'This order holds no seats.');
    if (order.paymentStatus === 'succeeded') fail(409, 'conflict', 'This order is paid. Reconcile it instead.');
    if (order.status !== 'exception') fail(409, 'conflict', 'Only an order that needs review is released by hand. Checkout releases other holds when they expire.');
    const inventoryRef = db.collection(INVENTORY).doc('current');
    const inventorySnap = await tx.get(inventoryRef);
    const promoSnap = order.promo?.code ? await tx.get(promoRef(db, order.promo.code)) : null;
    const transition = inventoryTransitionPatch({ order, inventory: inventorySnap.data(), to: 'released' });
    const at = now();
    const promoUse = releasedPromoUse(promoSnap, order, at);
    tx.set(inventoryRef, transition.inventory);
    if (promoUse) tx.set(promoRef(db, order.promo.code), promoUse, { merge: true });
    tx.update(orderRef, { ...transition.orderPatch, holdReleased: { at, byUid: actor.uid, reason }, updatedAt: at });
    audit(tx, logRef, { action: 'hold-released', actor, now, orderId, reason });
  });
  return readOrderDetail({ db, provider, orderId });
}

function createTicketingCommerceAdminHandler({ db, provider, auth, getConfig, now = () => new Date(), sendConfirmations, env = process.env, log = console }) {
  return async function ticketingCommerceAdmin(req, res) {
    res.set('Cache-Control', 'private, no-store');
    if (req.method !== 'POST') { res.set('Allow', 'POST'); return sendError(res, 405, 'method-not-allowed', 'Use POST.'); }
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const action = body.action || 'catalog';
    const actor = await requireAdmin({ db, auth, getConfig }, req, { tier: OPERATOR_ACTIONS.has(action) ? 'operator' : 'staff' });
    if (!actor.ok) return sendError(res, actor.status, actor.code, actor.message);
    if (provider?.name !== 'stripe') return sendError(res, 409, 'provider-unavailable', 'Native ticket sales are not configured for this event.');
    if (!ACTIONS.has(action)) return sendError(res, 400, 'bad-request', 'Choose a supported ticketing action.');
    try {
      if (!READ_ACTIONS.has(action)) {
        const policy = await checkDemoWrites({ db });
        if (!policy.ok) return sendError(res, policy.status, policy.code, policy.message);
      }
      const deps = { db, provider, actor, body, now, getConfig, env };
      let result;
      if (action === 'catalog') result = await readCatalog(deps);
      else if (action === 'saveCatalog') result = await saveCatalog(deps);
      else if (action === 'pauseSales') result = await pauseSales(deps);
      else if (action === 'promoCodes') result = await listPromoCodes(deps);
      else if (action === 'savePromoCode') result = await savePromoCode(deps);
      else if (action === 'deletePromoCode') result = await deletePromoCode(deps);
      else if (action === 'orders' || action === 'tickets') result = await listCommerce({ ...deps, kind: action });
      else if (action === 'order') result = await readOrderDetail({ ...deps, orderId: body.orderId });
      else if (action === 'updateAttendee') result = await correctAttendee(deps);
      else if (action === 'releaseHold') result = await releaseHold(deps);
      else if (action === 'cancelTickets' || action === 'allocateRefund') result = await changeAdmission({ ...deps, allocate: action === 'allocateRefund' });
      else if (action === 'issueComp') {
        confirm(body);
        const { createCompOrder } = require('./stripeCheckout.cjs');
        const created = await createCompOrder({ ...deps, actorUid: actor.uid, ticketTypeId: body.ticketTypeId, attendees: body.attendees, requestId: body.requestId, reason: reasonOf(body) });
        const orderId = created.orderId || created.id || created.order?.id;
        result = await readOrderDetail({ ...deps, orderId });
      } else if (action === 'reconcile') {
        const orderId = idOf(body.orderId, 'Order');
        const logRef = auditRef(db);
        await db.runTransaction(async (tx) => {
          await requireWrites(db, tx);
          requireOrder(await tx.get(db.collection(ORDERS).doc(orderId)), provider);
          audit(tx, logRef, { action: 'reconciliation-requested', actor, now, orderId });
        });
        await provider.reconcileOrder(orderId);
        result = await readOrderDetail({ ...deps, orderId });
      } else if (action === 'resend') {
        const orderId = idOf(body.orderId, 'Order');
        const requestId = idOf(body.requestId, 'Send request');
        const order = requireOrder(await db.collection(ORDERS).doc(orderId).get(), provider);
        if (order.inventoryState !== 'sold') fail(409, 'conflict', 'Confirm payment before sending ticket information.');
        const send = sendConfirmations || require('./commerceEmail.cjs').sendOrderConfirmations;
        result = await send({ db, getConfig, orderId, resendKey: `${actor.uid}:${requestId}`, actorUid: actor.uid, now, env });
      }
      return res.status(200).json(result);
    } catch (error) {
      if (ORGANIZER_ERRORS.has(error) || (Number.isInteger(error.status) && error.status >= 400 && error.status < 500)) {
        return sendError(res, error.status, error.code || 'bad-request', error.message);
      }
      log.error('ticketing organizer operation failed', { action, code: error?.code || 'internal' });
      return sendError(res, 503, 'unavailable', 'Ticketing could not complete this action. Reload its current status before trying again.');
    }
  };
}

function createTicketingCheckInHandler({ db, provider, auth, getConfig, now = () => new Date(), log = console }) {
  return async function ticketingCheckIn(req, res) {
    res.set('Cache-Control', 'private, no-store');
    if (req.method !== 'POST') { res.set('Allow', 'POST'); return sendError(res, 405, 'method-not-allowed', 'Use POST.'); }
    const body = req.body || {};
    const undo = body.action === 'undo';
    const actor = await requireAdmin({ db, auth, getConfig }, req, { tier: undo ? 'operator' : 'staff' });
    if (!actor.ok) return sendError(res, actor.status, actor.code, actor.message);
    if (provider?.name !== 'stripe') return sendError(res, 409, 'provider-unavailable', 'Native check-in is not configured for this event.');
    const policy = await checkDemoWrites({ db });
    if (!policy.ok) return sendError(res, policy.status, policy.code, policy.message);
    try {
      if (body.action !== 'checkIn' && !undo) fail(400, 'bad-request', 'Choose check-in or correction.');
      const ticketId = idOf(body.ticketId, 'Ticket');
      const reason = undo ? reasonOf(body) : null;
      if (undo) confirm(body);
      const logRef = auditRef(db);
      const result = await db.runTransaction(async (tx) => {
        await requireWrites(db, tx);
        const ref = db.collection(TICKETS).doc(ticketId);
        const snap = await tx.get(ref);
        if (!snap.exists || snap.data().provider !== 'stripe') return { result: 'invalid', ticket: null };
        const ticket = snap.data();
        if (!safeDocId(ticket.orderId)) return { result: 'invalid', ticket: null };
        const parent = await tx.get(db.collection(ORDERS).doc(ticket.orderId));
        const order = parent.exists ? parent.data() : null;
        if (!scopeMatches(order, provider) || !order.ticketIds?.includes(ticketId)) return { result: 'invalid', ticket: null };
        const account = ticket.claimedByUid ? await tx.get(db.collection('users').doc(ticket.claimedByUid)) : null;
        const dto = publicTicket(ticket, ticketId);
        if (undo) {
          if (!ticket.checkedInAt) return { result: 'corrected', unchanged: true, ticket: dto };
          tx.update(ref, { checkedInAt: null, checkedInByUid: null, updatedAt: now() });
          audit(tx, logRef, { action: 'check-in-corrected', actor, now, orderId: ticket.orderId, ticketIds: [ticketId], reason });
          return { result: 'corrected', ticket: { ...dto, checkedInAt: null } };
        }
        if (ticket.status !== 'valid' || !isOrderFulfilled(order) ||
            (account?.exists && account.data().registrationStatus === 'revoked')) return { result: 'invalid', ticket: dto };
        if (ticket.checkedInAt) return { result: 'already_checked_in', ticket: dto };
        const checkedInAt = now();
        tx.update(ref, { checkedInAt, checkedInByUid: actor.uid, updatedAt: checkedInAt });
        audit(tx, logRef, { action: 'checked-in', actor, now, orderId: ticket.orderId, ticketIds: [ticketId] });
        return { result: 'checked_in', ticket: { ...dto, checkedInAt: iso(checkedInAt) } };
      });
      return res.status(200).json(result);
    } catch (error) {
      if (ORGANIZER_ERRORS.has(error)) return sendError(res, error.status, error.code, error.message);
      log.error('ticket check-in failed', { code: error?.code || 'internal' });
      return sendError(res, 503, 'unavailable', 'Check-in could not be confirmed. Check the ticket again.');
    }
  };
}

function createTicketingMyTicketsHandler({ db, provider, auth }) {
  return async function ticketingMyTickets(req, res) {
    res.set('Cache-Control', 'private, no-store');
    if (req.method !== 'POST') { res.set('Allow', 'POST'); return sendError(res, 405, 'method-not-allowed', 'Use POST.'); }
    const user = await verifyAuthToken({ auth }, req);
    if (!user) return sendError(res, 401, 'unauthorized', 'Sign in to see your tickets.');
    if (user.email_verified !== true || !user.email) return sendError(res, 403, 'forbidden', 'Verify your email before viewing tickets.');
    if (!provider?.name || provider.name === 'none') return res.status(200).json({ tickets: [], nextCursor: null });
    let query = db.collection(TICKETS).where('claimedByUid', '==', user.uid).orderBy('externalId');
    const cursor = req.body?.cursor;
    if (cursor) {
      const id = safeDocId(cursor);
      if (!id) return sendError(res, 400, 'bad-request', 'The page reference is invalid.');
      query = query.startAfter(id);
    }
    const snap = await query.limit(MAX_PAGE + 1).get();
    const tickets = [];
    const orderCache = new Map();
    for (const row of snap.docs.slice(0, MAX_PAGE)) {
      const ticket = row.data();
      if (ticket.provider !== provider.name) continue;
      if (provider.name === 'stripe') {
        if (!safeDocId(ticket.orderId)) continue;
        if (!orderCache.has(ticket.orderId)) {
          const parent = await db.collection(ORDERS).doc(ticket.orderId).get();
          orderCache.set(ticket.orderId, parent.exists && scopeMatches(parent.data(), provider));
        }
        if (!orderCache.get(ticket.orderId)) continue;
      }
      const dto = publicTicket(ticket, row.id);
      delete dto.claimedByUid;
      tickets.push({ ...dto, claimedByMe: true });
    }
    return res.status(200).json({ tickets, nextCursor: snap.size > MAX_PAGE ? snap.docs[MAX_PAGE - 1].id : null });
  };
}

function buildHandlers() {
  const { onRequest } = require('firebase-functions/v2/https');
  const { defineSecret } = require('firebase-functions/params');
  const { ticketingSecretNames } = require('./providers/index.cjs');
  const { applyCors, parseAllowedOrigins } = require('../core/http.cjs');
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';
  const options = { region, secrets: ticketingSecretNames(process.env).map(defineSecret) };
  const { internals: { SEND_SECRETS_BY_PROVIDER } } = require('../email/send.cjs');
  const emailSecrets = SEND_SECRETS_BY_PROVIDER[(process.env.EVENT_EMAIL_PROVIDER || '').trim()] || [];
  const wrap = (factory, sendsEmail = false) => onRequest({ ...options, secrets: sendsEmail ? [...options.secrets, ...emailSecrets.map(defineSecret)] : options.secrets }, async (req, res) => {
    if (applyCors(req, res, { allowedOrigins: parseAllowedOrigins(process.env.EVENT_ALLOWED_ORIGINS), methods: ['POST'] })) return;
    const { invokeCommerceHandler } = require('./commerceHttp.cjs');
    await invokeCommerceHandler(factory, req, res);
  });
  return {
    ticketingCommerceAdmin: wrap(createTicketingCommerceAdminHandler, true),
    ticketingCheckIn: wrap(createTicketingCheckInHandler),
    ticketingMyTickets: wrap(createTicketingMyTicketsHandler),
  };
}

module.exports = {
  createTicketingCommerceAdminHandler, createTicketingCheckInHandler, createTicketingMyTicketsHandler,
  get handlers() { return buildHandlers(); },
  internals: { dashboardUrl, saveCatalog, changeAdmission, listCommerce, MAX_SCAN },
};
