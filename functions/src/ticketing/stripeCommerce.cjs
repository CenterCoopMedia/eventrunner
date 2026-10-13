'use strict';

/** Durable commerce records. None is a work queue; ticket_sync_queue remains the only queue. */
const crypto = require('node:crypto');
const { MAX_AMOUNT, CURRENCY_MINIMUMS, isSalesWindowOpen } = require('shared/ticketCommerce');

const CATALOG = 'ticket_catalog';
const INVENTORY = 'ticket_inventory';
const ORDERS = 'ticket_orders';
const ATTEMPTS = 'ticket_payment_attempts';
const CURRENT = 'current';
const HOLD_MS = 60 * 60 * 1000;
// Stripe can evict idempotency results after 24 hours. Never send a possibly
// executed creation request near/after that boundary, even with the same key.
const SAFE_RETRY_MS = 23 * 60 * 60 * 1000;

class CommerceError extends Error {
  constructor(code, message, status = 409) {
    super(message);
    this.name = 'CommerceError';
    this.code = code;
    this.status = status;
  }
}

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function orderIdFor(uid, requestId) {
  return `ord_${digest(JSON.stringify([uid, requestId])).slice(0, 40)}`;
}

function attemptIdFor(orderId) {
  return `att_${digest(orderId).slice(0, 40)}`;
}

function requestFingerprint(request, source = 'checkout', reason = '') {
  return digest(JSON.stringify({ lines: request.lines, source, reason, catalogRevision: request.catalogRevision }));
}

function providerScope(provider) {
  if (provider?.name !== 'stripe' || typeof provider.externalEventId !== 'string'
      || !provider.externalEventId.trim() || typeof provider.stripeAccountId !== 'string'
      || !/^acct_[a-zA-Z0-9]+$/.test(provider.stripeAccountId)
      || typeof provider.livemode !== 'boolean') {
    throw new CommerceError('ticketing-unavailable', 'Ticket sales are not configured.', 503);
  }
  return {
    eventId: provider.externalEventId,
    stripeAccountId: provider.stripeAccountId,
    livemode: provider.livemode,
  };
}

function assertOrderScope(order, provider) {
  const scope = providerScope(provider);
  if (order.provider !== 'stripe' || order.eventId !== scope.eventId
      || order.stripeAccountId !== scope.stripeAccountId || order.livemode !== scope.livemode) {
    throw new CommerceError('order-scope-mismatch', 'This order is unavailable in this event.', 409);
  }
}

function count(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new CommerceError('inventory-invalid', 'Ticket inventory needs organizer review.', 503);
  }
  return value;
}

function normalizeInventory(input, eventId) {
  if (!input) return { eventId, held: 0, sold: 0, types: {} };
  if (input.eventId && input.eventId !== eventId) {
    throw new CommerceError('inventory-event-mismatch', 'Ticket inventory needs organizer review.', 503);
  }
  const types = {};
  for (const [id, value] of Object.entries(input.types || {})) {
    if (!value || typeof value !== 'object' || ['constructor', 'prototype', '__proto__'].includes(id)) {
      throw new CommerceError('inventory-invalid', 'Ticket inventory needs organizer review.', 503);
    }
    types[id] = { held: count(value.held), sold: count(value.sold) };
  }
  return { eventId, held: count(input.held), sold: count(input.sold), types };
}

/** Reservations and completed sales share one event counter, so types cannot oversell it. */
function reserveInventory({ inventory, catalog, lines, eventId, state = 'held' }) {
  const next = normalizeInventory(inventory, eventId);
  const quantity = lines.reduce((sum, line) => sum + line.quantity, 0);
  if (next.held + next.sold + quantity > catalog.capacity) {
    throw new CommerceError('sold-out', 'There are not enough tickets remaining for this order.');
  }
  for (const line of lines) {
    const type = catalog.ticketTypes.find((entry) => entry.id === line.ticketTypeId);
    const current = Object.hasOwn(next.types, type.id) ? next.types[type.id] : { held: 0, sold: 0 };
    if (current.held + current.sold + line.quantity > type.capacity) {
      throw new CommerceError('sold-out', `There are not enough ${type.name} tickets remaining.`);
    }
    next.types[type.id] = { ...current, [state]: current[state] + line.quantity };
  }
  next[state] += quantity;
  return next;
}

/**
 * Pure counter transition, usable inside the reconciliation transaction that
 * also writes tickets. Paid/refunded/cancelled sales keep their capacity in the
 * MVP; only a provider-confirmed unpaid hold may be released.
 */
function inventoryTransitionPatch({ order, inventory, to }) {
  const next = normalizeInventory(inventory, order.eventId);
  if (!['sold', 'released'].includes(to)) throw new TypeError('Unsupported inventory transition.');
  if (order.inventoryState === to) return { orderPatch: {}, inventory: next };
  if (order.inventoryState !== 'held') {
    throw new CommerceError('inventory-released', 'This order’s inventory requires organizer review.');
  }
  const quantity = order.lines.reduce((sum, line) => sum + line.quantity, 0);
  next.held = count(next.held - quantity);
  if (to === 'sold') next.sold += quantity;
  for (const line of order.lines) {
    const type = next.types[line.ticketTypeId];
    if (!type) throw new CommerceError('inventory-invalid', 'Ticket inventory needs organizer review.', 503);
    type.held = count(type.held - line.quantity);
    if (to === 'sold') type.sold += line.quantity;
  }
  return { orderPatch: { inventoryState: to }, inventory: next };
}

async function transitionOrderInventory({ db, orderId, to, patch = {}, now = () => new Date() }) {
  return db.runTransaction(async (tx) => {
    const orderRef = db.collection(ORDERS).doc(orderId);
    const inventoryRef = db.collection(INVENTORY).doc(CURRENT);
    const [orderSnap, inventorySnap] = await tx.getAll(orderRef, inventoryRef);
    if (!orderSnap.exists) throw new CommerceError('not-found', 'Order not found.', 404);
    const order = orderSnap.data();
    const transition = inventoryTransitionPatch({ order, inventory: inventorySnap.data(), to });
    const at = now();
    const updated = { ...order, ...patch, ...transition.orderPatch, updatedAt: at };
    tx.set(orderRef, updated);
    tx.set(inventoryRef, { ...transition.inventory, updatedAt: at });
    return updated;
  });
}

function priceSelections({ catalog, request, at, comp = false }) {
  if (!comp && (!catalog.published || catalog.salesPaused || !catalog.commercialTermsConfirmed
      || !isSalesWindowOpen(catalog, at))) {
    throw new CommerceError('sales-closed', 'Ticket sales are currently closed.');
  }
  const lines = request.lines.map((selection) => {
    const type = catalog.ticketTypes.find((entry) => entry.id === selection.ticketTypeId);
    if (!type || !type.active || (!comp && (type.visibility !== 'public' || !isSalesWindowOpen(type, at)))) {
      throw new CommerceError('ticket-unavailable', 'A selected ticket type is unavailable.');
    }
    if (!comp && (selection.quantity < type.minPerOrder || selection.quantity > type.maxPerOrder)) {
      throw new CommerceError('quantity-out-of-range', `Choose between ${type.minPerOrder} and ${type.maxPerOrder} ${type.name} tickets.`, 400);
    }
    const unitAmount = comp ? 0 : type.unitAmount;
    return {
      ticketTypeId: type.id,
      ticketClass: type.name,
      name: type.name,
      quantity: selection.quantity,
      unitAmount,
      lineAmount: unitAmount * selection.quantity,
      ...(comp ? { originalUnitAmount: type.unitAmount } : {}),
    };
  });
  const seats = lines.reduce((sum, line) => sum + line.quantity, 0);
  if (seats > catalog.maxPerOrder) throw new CommerceError('quantity-out-of-range', 'This order exceeds the ticket quantity limit.', 400);
  const totalAmount = lines.reduce((sum, line) => sum + line.lineAmount, 0);
  if (!Number.isSafeInteger(totalAmount) || totalAmount > MAX_AMOUNT) {
    throw new CommerceError('amount-out-of-range', 'This order exceeds the payment amount limit.', 400);
  }
  if (totalAmount > 0 && totalAmount < CURRENCY_MINIMUMS[catalog.currency]) {
    throw new CommerceError('amount-too-small', 'This order is below the minimum card payment amount.', 400);
  }
  return { lines, subtotalAmount: totalAmount, totalAmount };
}

function makeSeats(orderId, lines, request) {
  return lines.flatMap((line, lineIndex) => request.lines[lineIndex].attendees.map((person, seatIndex) => ({
    externalId: `${orderId}_${lineIndex}_${seatIndex}`,
    ticketTypeId: line.ticketTypeId,
    ticketClass: line.name,
    lineIndex,
    seatIndex,
    ...person,
  })));
}

function ticketsForFreeOrder(order, at = new Date()) {
  return order.seats.map((seat) => ({
    externalId: seat.externalId,
    orderId: order.id,
    provider: 'stripe',
    eventId: order.eventId,
    ticketTypeId: seat.ticketTypeId,
    ticketClass: seat.ticketClass,
    email: seat.email,
    firstName: seat.firstName,
    lastName: seat.lastName || null,
    quantity: 1,
    purchasedAt: order.createdAt instanceof Date ? order.createdAt.toISOString() : order.createdAt,
    status: 'valid',
    source: order.source,
    claimedByUid: null,
    claimedAt: null,
    claimPromptSentAt: null,
    createdAt: at,
    updatedAt: at,
  }));
}

function configuredPublicUrl(config, env = process.env) {
  const candidate = env.EVENT_PUBLIC_URL || config?.tierA?.publicUrl;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Invalid public URL.');
    return url.origin;
  } catch {
    throw new CommerceError('ticketing-unavailable', 'Ticket sales are not configured.', 503);
  }
}

function checkoutRequestFor(order, publicUrl) {
  const metadata = {
    eventRunnerOrderId: order.id,
    eventRunnerEventId: order.eventId,
    eventRunnerAttemptId: order.attemptId,
  };
  const returnUrl = `${publicUrl}/tickets/status?orderId=${encodeURIComponent(order.id)}`;
  return {
    mode: 'payment',
    ui_mode: 'hosted_page',
    allowed_payment_method_types: ['card'],
    adaptive_pricing: { enabled: false },
    automatic_tax: { enabled: false },
    allow_promotion_codes: false,
    client_reference_id: order.id,
    customer_email: order.purchaserEmail,
    line_items: order.lines.map((line) => ({
      price_data: {
        currency: order.currency,
        product_data: { name: line.name, metadata: { eventRunnerTicketTypeId: line.ticketTypeId } },
        unit_amount: line.unitAmount,
        ...(order.taxTreatment === 'inclusive' ? { tax_behavior: 'inclusive' } : {}),
      },
      quantity: line.quantity,
    })),
    metadata,
    payment_intent_data: { metadata: { ...metadata } },
    expires_at: Math.floor(Date.parse(order.expiresAt) / 1000),
    success_url: returnUrl,
    cancel_url: `${returnUrl}&cancelled=1`,
  };
}

function millis(value) {
  if (value instanceof Date) return value.getTime();
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  return typeof value === 'number' ? value : Date.parse(value);
}

function iso(value) {
  const ms = millis(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

module.exports = {
  CATALOG, INVENTORY, ORDERS, ATTEMPTS, CURRENT, HOLD_MS, SAFE_RETRY_MS,
  CommerceError, orderIdFor, attemptIdFor, requestFingerprint, providerScope, assertOrderScope,
  normalizeInventory, reserveInventory, inventoryTransitionPatch, transitionOrderInventory,
  priceSelections, makeSeats, ticketsForFreeOrder, configuredPublicUrl, checkoutRequestFor, millis, iso,
};
