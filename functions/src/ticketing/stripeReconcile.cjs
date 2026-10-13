'use strict';

/**
 * Stripe notifications are wake-ups. Read current financial state, then
 * commit order, inventory, and stable admission records together. A lease
 * fences concurrent provider reads; its token is checked again on commit.
 */
const { randomUUID } = require('node:crypto');
const { checkDemoWrites, throwIfDemoPolicyUnavailable } = require('../core/demoWrites.cjs');
const { internals: { scopeMatches, metadataMatches, objectId, safeId } } = require('./providers/stripe.cjs');

const LEASE_MS = 5 * 60_000;
const REFUND_STATES = new Set(['pending', 'requires_action', 'succeeded', 'failed', 'canceled']);
const TERMINAL_TICKET_STATES = new Set(['cancelled', 'refunded']);

class ReconciliationMismatch extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function millis(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value?.toMillis === 'function') return value.toMillis();
  return Date.parse(value);
}

function requireMatch(condition, code = 'stripe-order-mismatch', message = 'Payment details do not match the saved order.') {
  if (!condition) throw new ReconciliationMismatch(code, message);
}

async function writesAllowed(db, transaction) {
  const policy = await checkDemoWrites({ db, transaction });
  throwIfDemoPolicyUnavailable(policy);
  return policy.ok;
}

function validateFinancialState(order, state, provider) {
  const { session, lineItems, paymentIntent, refunds, disputes } = state;
  requireMatch(scopeMatches(order, provider) && session?.id === order.stripeSessionId &&
    session.livemode === provider.livemode && session.mode === 'payment' &&
    session.ui_mode === 'hosted_page' && metadataMatches(session.metadata, order));
  requireMatch(session.currency === order.currency && Number.isSafeInteger(order.totalAmount) &&
    order.totalAmount >= 0 && session.amount_total === order.totalAmount &&
    session.amount_subtotal === order.subtotalAmount &&
    (session.total_details?.amount_discount || 0) === (order.discountAmount || 0) &&
    (session.total_details?.amount_tax || 0) === (order.taxAmount || 0) &&
    (session.total_details?.amount_shipping || 0) === 0);
  requireMatch(Array.isArray(session.payment_method_types) && session.payment_method_types.length === 1 &&
    session.payment_method_types[0] === 'card', 'unsupported-payment-method',
  'This order used a payment method outside the configured card-only policy.');
  requireMatch(Array.isArray(order.lines) && order.lines.length > 0 &&
    Array.isArray(lineItems) && lineItems.length === order.lines.length);
  const remaining = [...order.lines];
  for (const item of lineItems) {
    const typeId = item.price?.product?.metadata?.eventRunnerTicketTypeId;
    const index = remaining.findIndex((line) => line.ticketTypeId === typeId &&
      line.quantity === item.quantity && line.unitAmount === item.price?.unit_amount &&
      line.lineAmount === item.amount_subtotal && line.lineAmount === item.amount_total &&
      item.currency === order.currency && item.price?.currency === order.currency && !item.price?.recurring &&
      (item.amount_discount || 0) === 0 && (item.amount_tax || 0) === 0);
    requireMatch(index >= 0);
    remaining.splice(index, 1);
  }
  requireMatch(Array.isArray(order.seats) && Array.isArray(order.ticketIds) &&
    order.seats.length === order.lines.reduce((sum, line) => sum + line.quantity, 0) &&
    order.seats.length === order.ticketIds.length && new Set(order.ticketIds).size === order.ticketIds.length &&
    order.seats.every((seat) => safeId(seat.externalId) && order.ticketIds.includes(seat.externalId)));
  const paymentIntentId = objectId(session.payment_intent);
  requireMatch(!order.stripePaymentIntentId || order.stripePaymentIntentId === paymentIntentId,
    'stripe-payment-identity-mismatch', 'The saved payment identity changed. Capacity and financial history remain unchanged for organizer review.');
  if (paymentIntentId) {
    requireMatch(paymentIntent?.id === paymentIntentId && metadataMatches(paymentIntent.metadata, order) &&
      paymentIntent.livemode === provider.livemode && paymentIntent.currency === order.currency &&
      paymentIntent.amount === order.totalAmount &&
      (!order.stripePaymentIntentId || order.stripePaymentIntentId === paymentIntentId) &&
      !paymentIntent.transfer_data && !paymentIntent.on_behalf_of && !paymentIntent.application_fee_amount);
  }
  if (session.payment_status === 'paid') {
    requireMatch(order.totalAmount > 0 && session.status === 'complete' &&
      paymentIntent?.status === 'succeeded' && paymentIntent.amount_received === order.totalAmount);
  } else if (session.payment_status === 'no_payment_required') {
    requireMatch(order.totalAmount === 0 && session.status === 'complete');
  } else {
    requireMatch(session.payment_status === 'unpaid');
  }
  requireMatch(['open', 'complete', 'expired'].includes(session.status));
  if (session.status === 'expired') {
    requireMatch(!paymentIntent || (['canceled', 'requires_payment_method'].includes(paymentIntent.status) &&
      paymentIntent.amount_received === 0), 'expiration-payment-conflict',
    'The expired Checkout Session still has an unresolved payment. Capacity remains reserved for organizer review.');
  }
  for (const refund of refunds || []) {
    requireMatch(safeId(refund.id) && REFUND_STATES.has(refund.status) &&
      refund.currency === order.currency && objectId(refund.payment_intent) === paymentIntentId &&
      Number.isSafeInteger(refund.amount) && refund.amount > 0 && refund.amount <= order.totalAmount);
  }
  for (const dispute of disputes || []) {
    requireMatch(safeId(dispute.id) && dispute.currency === order.currency &&
      objectId(dispute.payment_intent) === paymentIntentId && dispute.livemode === provider.livemode);
  }
  requireMatch(new Set((refunds || []).map((refund) => refund.id)).size === (refunds || []).length);
  return state;
}

function financialPatch(order, state, at) {
  const refunds = (state.refunds || []).map((refund) => ({
    id: refund.id, amount: refund.amount, currency: refund.currency, status: refund.status,
    createdAt: Number.isFinite(refund.created) ? new Date(refund.created * 1000).toISOString() : null,
    failureReason: typeof refund.failure_reason === 'string' ? refund.failure_reason.slice(0, 100) : null,
  }));
  const disputes = (state.disputes || []).map((dispute) => ({
    id: dispute.id, amount: dispute.amount, currency: dispute.currency, status: String(dispute.status || 'unknown').slice(0, 80),
  }));
  const refundedAmount = refunds.filter((refund) => refund.status === 'succeeded').reduce((sum, refund) => sum + refund.amount, 0);
  requireMatch(refundedAmount <= order.totalAmount);
  let refundStatus = 'none';
  if (refundedAmount > 0) refundStatus = refundedAmount === order.totalAmount ? 'full' : 'partial';
  let reconciliationException = null;
  const fullRefund = order.totalAmount > 0 && refundedAmount === order.totalAmount;
  if (!fullRefund) {
    if (refunds.some((refund) => refund.status === 'pending')) refundStatus = 'pending';
    if (refunds.some((refund) => refund.status === 'requires_action')) refundStatus = 'requires_action';
    if (refunds.some((refund) => refund.status === 'failed')) refundStatus = 'failed';
  }
  if (!fullRefund && refunds.some((refund) => refund.status === 'succeeded' &&
      (!Array.isArray(order.refundAllocations?.[refund.id]) ||
       !order.refundAllocations[refund.id].every((id) => order.ticketIds.includes(id)) ||
       (order.refundAllocations[refund.id].length === 0 &&
        order.refundAllocationDecisions?.[refund.id]?.preserveAdmission !== true)))) {
    reconciliationException = { code: 'refund-allocation-required', message: 'A partial refund needs ticket allocation.' };
  }
  if (!fullRefund && refunds.some((refund) => refund.status === 'failed' || refund.status === 'requires_action')) {
    reconciliationException = { code: 'refund-needs-attention', message: 'A refund needs an organizer to review its current Stripe status.' };
  }
  if (disputes.some((dispute) => !['won', 'warning_closed'].includes(dispute.status))) {
    reconciliationException = { code: 'payment-disputed', message: 'A payment dispute needs an organizer decision; admission has not changed automatically.' };
  }
  const session = state.session;
  const paid = session.payment_status === 'paid' || (order.totalAmount === 0 && session.payment_status === 'no_payment_required');
  let status = paid ? (order.totalAmount === 0 ? 'free' : 'paid') : 'pending';
  let paymentStatus = paid ? 'succeeded' : 'unpaid';
  if (!paid && state.paymentIntent?.status === 'processing') paymentStatus = 'pending';
  if (!paid && ['canceled', 'requires_payment_method'].includes(state.paymentIntent?.status)) paymentStatus = 'failed';
  if (!paid && session.status === 'expired') { status = 'expired'; paymentStatus = 'expired'; }
  if (fullRefund || order.status === 'refunded') status = 'refunded';
  if (order.status === 'cancelled') status = 'cancelled';
  // A failed refund does not silently restore a credential invalidated by
  // a previous successful refund; that correction is an organizer action.
  return {
    stripeSessionId: session.id, stripePaymentIntentId: objectId(session.payment_intent),
    stripeChargeId: objectId(state.paymentIntent?.latest_charge),
    status, paymentStatus, refunds, disputes, refundedAmount, refundStatus, reconciliationException,
    ...(paid && !order.paidAt ? { paidAt: at } : {}),
    reconciledAt: at, updatedAt: at,
  };
}

function admissionStatus(order, patch, ticketId, existing) {
  if (TERMINAL_TICKET_STATES.has(existing?.status)) return existing.status;
  if (order.status === 'cancelled') return 'cancelled';
  if (patch.refundedAmount === order.totalAmount && order.totalAmount > 0) return 'refunded';
  const allocated = patch.refunds.some((refund) => refund.status === 'succeeded' &&
    order.refundAllocations?.[refund.id]?.includes(ticketId));
  return allocated ? 'refunded' : 'valid';
}

async function readTickets(db, order) {
  const records = [];
  for (const id of order.ticketIds || []) {
    const snap = await db.collection('tickets').doc(id).get();
    if (snap.exists) records.push(snap.data());
  }
  return records;
}

async function finishException({ db, orderId, leaseId, exception, now }) {
  const ref = db.collection('ticket_orders').doc(orderId);
  await db.runTransaction(async (tx) => {
    if (!await writesAllowed(db, tx)) return;
    const snap = await tx.get(ref);
    if (!snap.exists || snap.data().reconciliationLease?.id !== leaseId) return;
    tx.set(ref, {
      reconciliationException: exception, reconciliationLease: null,
      ...(exception && snap.data().paymentStatus !== 'succeeded' ? { status: 'exception' } : {}),
      updatedAt: now(),
    }, { merge: true });
  });
}

async function reconcileStripeOrder({ db, provider, orderId, now = () => new Date() }) {
  if (!db || !safeId(orderId)) throw new Error('An internal order identifier and database are required.');
  const ref = db.collection('ticket_orders').doc(orderId);
  const leaseId = randomUUID();
  const blocked = { orderId, externalEventId: provider.externalEventId, complete: false,
    retryWithoutAttempt: true, writeBlocked: true, tickets: [], ticketsPersisted: true };
  const acquired = await db.runTransaction(async (tx) => {
    if (!await writesAllowed(db, tx)) return { blocked: true };
    const snap = await tx.get(ref);
    if (!snap.exists || !scopeMatches(snap.data(), provider)) return { missing: true };
    const order = snap.data();
    if (millis(order.reconciliationLease?.expiresAt) > now().getTime()) return { busy: true };
    tx.set(ref, { reconciliationLease: { id: leaseId, expiresAt: new Date(now().getTime() + LEASE_MS) } }, { merge: true });
    return { order };
  });
  if (acquired.blocked) return blocked;
  if (acquired.missing) return { orderId, externalEventId: provider.externalEventId, complete: true, tickets: [], ticketsPersisted: true };
  if (acquired.busy) return { orderId, externalEventId: provider.externalEventId, complete: false, retryWithoutAttempt: true, tickets: [], ticketsPersisted: true };
  let order = acquired.order;
  try {
    // Zero-payment orders are fulfilled atomically by commerce itself.
    if (order.totalAmount === 0 && order.paymentStatus === 'succeeded' && order.inventoryState === 'sold') {
      const tickets = await readTickets(db, order);
      await finishException({ db, orderId, leaseId, exception: order.reconciliationException || null, now });
      return { orderId, externalEventId: provider.externalEventId, complete: true, tickets, ticketsPersisted: true, status: order.status };
    }
    if (!order.stripeSessionId) {
      const { recoverCheckoutAttempt } = require('./stripeCheckout.cjs');
      await recoverCheckoutAttempt({ db, provider, orderId, now });
      order = (await ref.get()).data();
      if (!order.stripeSessionId) {
        const exception = order.status === 'exception'
          ? { code: 'checkout-outcome-unknown', message: 'Checkout creation is unresolved. Capacity remains reserved until an organizer confirms the outcome.' }
          : null;
        await finishException({ db, orderId, leaseId, exception, now });
        return { orderId, externalEventId: provider.externalEventId, complete: Boolean(exception), tickets: [], ticketsPersisted: true, exception };
      }
    }
    if (!await writesAllowed(db)) return blocked;
    const state = validateFinancialState(order, await provider.readFinancialState(order), provider);
    const at = now();
    const result = await db.runTransaction(async (tx) => {
      if (!await writesAllowed(db, tx)) return blocked;
      const snap = await tx.get(ref);
      const current = snap.data();
      if (!scopeMatches(current, provider) || current.reconciliationLease?.id !== leaseId ||
          current.stripeSessionId !== state.session.id || current.attemptId !== order.attemptId) {
        return { complete: false, retryWithoutAttempt: true, tickets: [], ticketsPersisted: true };
      }
      // Re-read local cancellation and refund allocations after the API
      // calls; these are human decisions, not provider-owned fields.
      validateFinancialState(current, state, provider);
      const patch = financialPatch(current, state, at);
      const inventoryRef = db.collection('ticket_inventory').doc('current');
      const inventorySnap = await tx.get(inventoryRef);
      const ticketSnapshots = [];
      for (const seat of current.seats) ticketSnapshots.push(await tx.get(db.collection('tickets').doc(seat.externalId)));
      let inventory = inventorySnap.data();
      let inventoryPatch = {};
      const paid = patch.paymentStatus === 'succeeded';
      if ((paid && current.inventoryState === 'held') ||
          (state.session.status === 'expired' && current.inventoryState === 'held')) {
        const { inventoryTransitionPatch } = require('./stripeCommerce.cjs');
        const transition = inventoryTransitionPatch({ order: current, inventory, to: paid ? 'sold' : 'released' });
        inventory = transition.inventory;
        inventoryPatch = transition.orderPatch;
      }
      if (paid && current.inventoryState === 'released') {
        patch.status = 'exception';
        patch.reconciliationException = { code: 'payment-after-capacity-release', message: 'Payment completed after capacity was released. An organizer must resolve the order.' };
      }
      const tickets = [];
      for (let i = 0; i < current.seats.length; i += 1) {
        const seat = current.seats[i];
        const existing = ticketSnapshots[i].exists ? ticketSnapshots[i].data() : null;
        requireMatch(!existing || (existing.orderId === orderId && existing.provider === 'stripe'),
          'ticket-identity-conflict', 'An admission identifier conflicts with another ticket. An organizer must review this order.');
        if (!paid || patch.reconciliationException?.code === 'payment-after-capacity-release') {
          if (existing) tickets.push(existing);
          continue;
        }
        const ticket = {
          ...(existing || {}), externalId: seat.externalId, orderId, provider: 'stripe', eventId: current.eventId,
          source: current.source || 'checkout',
          ticketTypeId: seat.ticketTypeId, ticketClass: seat.ticketClass, quantity: 1,
          email: existing?.email ?? seat.email, firstName: existing?.firstName ?? seat.firstName ?? null,
          lastName: existing?.lastName ?? seat.lastName ?? null,
          status: admissionStatus(current, patch, seat.externalId, existing),
          claimedByUid: existing?.claimedByUid ?? null, claimedAt: existing?.claimedAt ?? null,
          claimPromptSentAt: existing?.claimPromptSentAt ?? null,
          purchasedAt: existing?.purchasedAt || new Date(millis(current.createdAt) || at.getTime()).toISOString(),
          createdAt: existing?.createdAt || at, updatedAt: at,
        };
        tx.set(db.collection('tickets').doc(seat.externalId), ticket);
        tickets.push(ticket);
      }
      if (Object.keys(inventoryPatch).length) tx.set(inventoryRef, inventory);
      tx.set(ref, { ...patch, ...inventoryPatch, reconciliationLease: null }, { merge: true });
      return { complete: true, tickets, ticketsPersisted: true, status: patch.status,
        ...(patch.reconciliationException ? { exception: patch.reconciliationException } : {}),
        paymentPending: !paid && state.session.status !== 'expired',
        nextReconciliationAt: !paid && state.session.status === 'open'
          ? new Date(Math.max(at.getTime() + 60_000, state.session.expires_at * 1000))
          : new Date(at.getTime() + 15 * 60_000),
      };
    });
    return { orderId, externalEventId: provider.externalEventId, ...result };
  } catch (err) {
    if (err instanceof ReconciliationMismatch) {
      const exception = { code: err.code, message: err.message };
      await finishException({ db, orderId, leaseId, exception, now });
      return { orderId, externalEventId: provider.externalEventId, complete: true,
        tickets: await readTickets(db, order), ticketsPersisted: true, exception };
    }
    await db.runTransaction(async (tx) => {
      if (!await writesAllowed(db, tx)) return;
      const snap = await tx.get(ref);
      if (snap.data()?.reconciliationLease?.id === leaseId) tx.set(ref, { reconciliationLease: null }, { merge: true });
    });
    throw new Error('Stripe reconciliation is temporarily unavailable.');
  }
}

module.exports = {
  reconcileStripeOrder,
  internals: { validateFinancialState, financialPatch, admissionStatus, LEASE_MS, ReconciliationMismatch },
};
