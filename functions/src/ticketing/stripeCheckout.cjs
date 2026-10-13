'use strict';

/** Server-authoritative catalog, reservations, Checkout, and purchaser recovery. */
const {
  CURRENCY_EXPONENTS, validateTicketCatalog, validateCheckoutRequest, isCommerceRequestId, isCommerceOrderId, isSalesWindowOpen,
} = require('shared/ticketCommerce');
const { verifyAuthToken } = require('../core/auth.cjs');
const { checkDemoWrites } = require('../core/demoWrites.cjs');
const { sendError, methodNotAllowed } = require('../core/errors.cjs');
const {
  CATALOG, INVENTORY, ORDERS, ATTEMPTS, CURRENT, HOLD_MS, SAFE_RETRY_MS,
  CommerceError, orderIdFor, attemptIdFor, requestFingerprint, providerScope, assertOrderScope,
  normalizeInventory, reserveInventory, priceSelections, makeSeats, ticketsForFreeOrder,
  configuredPublicUrl, checkoutRequestFor, millis, iso,
} = require('./stripeCommerce.cjs');

const ATTEMPT_LEASE_MS = 30 * 1000;
const RETRY_BACKOFF_MS = 5 * 1000;
const PURCHASER_WINDOW_MS = 60 * 60 * 1000;
const MAX_PURCHASER_ORDERS = 5;

function assertWritableEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)
      || (event.historicalDemo !== undefined && typeof event.historicalDemo !== 'boolean')) {
    throw new CommerceError('config-unavailable', 'Event configuration is unavailable. Try again later.', 503);
  }
  if (event.historicalDemo === true) throw new CommerceError('read-only-demo', 'Ticket purchases are disabled in this historical demo.', 403);
}

function catalogValue(snap) {
  const result = validateTicketCatalog(snap?.exists ? snap.data() : null);
  if (!result.ok) throw new CommerceError('ticketing-unavailable', 'Ticket sales are not configured.', 503);
  return result.value;
}

function requirePaymentCredentials(provider) {
  if (provider.hasPaymentCredentials !== true) {
    throw new CommerceError('ticketing-unavailable', 'Paid ticket sales are not configured. Try again later.', 503);
  }
}

async function verifiedPurchaser(auth, req) {
  const decoded = await verifyAuthToken({ auth }, req);
  if (!decoded?.uid) throw new CommerceError('unauthorized', 'Sign in to buy or view your tickets.', 401);
  const email = typeof decoded.email === 'string' ? decoded.email.trim().toLowerCase() : '';
  if (decoded.email_verified !== true || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new CommerceError('email-unverified', 'Verify your email before buying or viewing tickets.', 403);
  }
  return { uid: decoded.uid, email };
}

function handleError(res, err, log = console) {
  if (err instanceof CommerceError) {
    if (err.status === 429 && Number.isInteger(err.retryAfterSeconds)) {
      res.set('Retry-After', String(err.retryAfterSeconds));
      res.status(429).json({ error: { code: err.code, message: err.message, retryAfterSeconds: err.retryAfterSeconds } });
      return;
    }
    if (err.code === 'purchase-in-progress' && isCommerceOrderId(err.existingOrderId)) {
      res.status(err.status).json({ error: { code: err.code, message: err.message, existingOrderId: err.existingOrderId } });
      return;
    }
    sendError(res, err.status, err.code, err.message);
    return;
  }
  // Never serialize Stripe payloads, attendee assignments, or provider error text.
  log.error('Ticket commerce request failed.', { name: err?.name || 'Error' });
  sendError(res, 503, 'ticketing-unavailable', 'Ticketing is temporarily unavailable. Retry your existing order.');
}

function purchaserWindow(pointer, at) {
  let windowStart = millis(pointer?.windowStart);
  let ordersInWindow = pointer?.ordersInWindow;
  // A pointer from before the rate ceiling has no window fields. Start its
  // first window once; malformed partial counters do not reset the budget.
  if (pointer?.windowStart === undefined && ordersInWindow === undefined) {
    windowStart = at.getTime();
    ordersInWindow = 0;
  } else if (!Number.isFinite(windowStart) || !Number.isSafeInteger(ordersInWindow) || ordersInWindow < 0) {
    throw new CommerceError('inventory-invalid', 'This checkout needs organizer review.', 503);
  }
  if (at.getTime() - windowStart >= PURCHASER_WINDOW_MS) {
    windowStart = at.getTime();
    ordersInWindow = 0;
  }
  if (ordersInWindow >= MAX_PURCHASER_ORDERS) {
    const retryAfterSeconds = Math.max(1, Math.ceil((windowStart + PURCHASER_WINDOW_MS - at.getTime()) / 1000));
    const minutes = Math.ceil(retryAfterSeconds / 60);
    const error = new CommerceError('rate-limited', `You have reached the ticket order limit. Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`, 429);
    error.retryAfterSeconds = retryAfterSeconds;
    throw error;
  }
  return { windowStart: new Date(windowStart), ordersInWindow: ordersInWindow + 1 };
}

async function readTicketingCatalog({ db, provider, getConfig, now = () => new Date() }) {
  const config = typeof getConfig === 'function' ? await getConfig() : {};
  const closed = {
    provider: provider?.name || 'none', mode: provider?.livemode === true ? 'live' : 'test',
    salesEnabled: false, currency: null, currencyExponent: 2,
    eventName: typeof config?.event?.name === 'string' ? config.event.name : '',
    refundPolicy: '', taxTreatment: null, taxAmount: 0, feeAmount: 0,
    maxPerOrder: 0, ticketTypes: [], closedReason: 'Ticket sales are not configured.',
  };
  let scope;
  try { scope = providerScope(provider); } catch { return closed; }
  const [catalogSnap, inventorySnap, eventSnap] = await db.getAll(
    db.collection(CATALOG).doc(CURRENT), db.collection(INVENTORY).doc(CURRENT), db.collection('config').doc('event'),
  );
  const result = validateTicketCatalog(catalogSnap.exists ? catalogSnap.data() : null);
  if (!result.ok || !result.value.published) return closed;
  const catalog = result.value;
  const event = eventSnap.exists ? eventSnap.data() : null;
  try { assertWritableEvent(event); } catch (err) { return { ...closed, closedReason: err.message }; }
  const inventory = normalizeInventory(inventorySnap.data(), scope.eventId);
  const eventRemaining = Math.max(0, catalog.capacity - inventory.held - inventory.sold);
  const at = now();
  const windowOpen = isSalesWindowOpen(catalog, at);
  const salesEnabled = !catalog.salesPaused && catalog.commercialTermsConfirmed && windowOpen && eventRemaining > 0;
  const paidConfigured = provider.hasPaymentCredentials === true;
  const ticketTypes = catalog.ticketTypes.filter((type) => type.visibility === 'public' && type.active).map((type) => {
    const counts = inventory.types[type.id] || { held: 0, sold: 0 };
    const remaining = Math.min(eventRemaining, Math.max(0, type.capacity - counts.held - counts.sold));
    return {
      id: type.id, name: type.name, description: type.description, unitAmount: type.unitAmount,
      remaining, available: salesEnabled && (type.unitAmount === 0 || paidConfigured) &&
        isSalesWindowOpen(type, at) && remaining >= type.minPerOrder,
      minPerOrder: type.minPerOrder, maxPerOrder: type.maxPerOrder,
      salesStartAt: type.salesStartAt, salesEndAt: type.salesEndAt,
    };
  });
  const anyAvailable = salesEnabled && ticketTypes.some((type) => type.available);
  return {
    ...closed, salesEnabled: anyAvailable, currency: catalog.currency,
    currencyExponent: CURRENCY_EXPONENTS[catalog.currency],
    eventName: typeof event.name === 'string' ? event.name : closed.eventName,
    refundPolicy: catalog.refundPolicy, taxTreatment: catalog.taxTreatment,
    maxPerOrder: catalog.maxPerOrder, ticketTypes,
    closedReason: anyAvailable ? null : (catalog.salesPaused ? 'Ticket sales are paused.' : eventRemaining === 0 ? 'This event is sold out.' : 'Ticket sales are currently closed.'),
  };
}

/**
 * Reserve first. The original prices, assignments, exact provider request and
 * idempotency key commit together before any network call. A retry never builds
 * another payment request from newer catalog data or a different cart.
 */
async function reserveCommerceOrder({
  db, provider, getConfig, actor, request, source = 'checkout', reason = '', now = () => new Date(), env = process.env,
}) {
  const scope = providerScope(provider);
  const id = request.orderId || orderIdFor(actor.uid, request.requestId);
  const attemptId = attemptIdFor(id);
  const fingerprint = request.resume ? null : requestFingerprint(request, source, reason);
  const config = typeof getConfig === 'function' ? await getConfig() : {};
  const comp = source === 'comp';
  // Free and comp orders have no external redirect; paid configuration is
  // checked before their reservation below, once the catalog establishes price.
  return db.runTransaction(async (tx) => {
    const orderRef = db.collection(ORDERS).doc(id);
    const attemptRef = db.collection(ATTEMPTS).doc(attemptId);
    const eventRef = db.collection('config').doc('event');
    // Reading the profile in this transaction makes account deletion conflict
    // with a new reservation. First sign-in can retry after profile creation.
    const [existing, eventSnap, accountSnap] = await tx.getAll(
      orderRef, eventRef, ...(comp ? [] : [db.collection('users').doc(actor.uid)]),
    );
    assertWritableEvent(eventSnap.exists ? eventSnap.data() : null);
    if (!comp && !accountSnap.exists) {
      throw new CommerceError('account-not-ready', 'Your account is still being set up. Wait a moment and try again.', 503);
    }
    if (existing.exists) {
      const order = existing.data();
      if (order.purchaserUid !== actor.uid || order.source !== source) {
        throw new CommerceError('not-found', 'Order not found.', 404);
      }
      assertOrderScope(order, provider);
      if (fingerprint && order.requestFingerprint !== fingerprint) {
        throw new CommerceError('idempotency-conflict', 'This request ID already belongs to a different order. Resume the original order.');
      }
      return { order, created: false };
    }
    if (request.resume) throw new CommerceError('not-found', 'Order not found.', 404);
    const inventoryRef = db.collection(INVENTORY).doc(CURRENT);
    // One private pointer per purchaser is a transaction lock, not pending
    // work: nobody drains it. Reading the referenced order means a completed
    // or released checkout does not need a second cleanup write to unlock it.
    const purchaserRef = db.collection(INVENTORY).doc(`purchaser_${orderIdFor(actor.uid, 'inventory').slice(4)}`);
    const [catalogSnap, inventorySnap, purchaserSnap] = await Promise.all([
      tx.get(db.collection(CATALOG).doc(CURRENT)),
      tx.get(inventoryRef),
      comp ? Promise.resolve(null) : tx.get(purchaserRef),
    ]);
    if (purchaserSnap?.exists) {
      const previousId = purchaserSnap.data()?.orderId;
      if (!isCommerceOrderId(previousId)) throw new CommerceError('inventory-invalid', 'This checkout needs organizer review.', 503);
      const previous = await tx.get(db.collection(ORDERS).doc(previousId));
      if (previous.exists) {
        const order = previous.data();
        if (order.purchaserUid !== actor.uid) throw new CommerceError('inventory-invalid', 'This checkout needs organizer review.', 503);
        assertOrderScope(order, provider);
        if (order.inventoryState === 'held') {
          const error = new CommerceError('purchase-in-progress', 'Resume your current checkout before starting another order.');
          error.existingOrderId = previousId;
          throw error;
        }
      }
    }
    const catalog = catalogValue(catalogSnap);
    const at = now();
    const rate = comp ? null : purchaserWindow(purchaserSnap?.data(), at);
    const priced = priceSelections({ catalog, request, at, comp });
    const paid = priced.totalAmount > 0;
    if (paid) requirePaymentCredentials(provider);
    const publicUrl = paid ? configuredPublicUrl(config, env) : null;
    const seats = makeSeats(id, priced.lines, request);
    const order = {
      id, orderId: id, provider: 'stripe', ...scope,
      attemptId, source, purchaserUid: actor.uid, purchaserEmail: actor.email,
      requestFingerprint: fingerprint, catalogRevision: catalog.revision,
      currency: catalog.currency, currencyExponent: CURRENCY_EXPONENTS[catalog.currency],
      ...priced, taxAmount: 0, discountAmount: 0, feeAmount: 0,
      taxTreatment: catalog.taxTreatment, refundPolicy: catalog.refundPolicy,
      seats, ticketIds: seats.map((seat) => seat.externalId),
      status: paid ? 'pending' : 'free', paymentStatus: paid ? 'pending' : 'succeeded',
      inventoryState: paid ? 'held' : 'sold',
      stripeSessionId: null, stripePaymentIntentId: null, checkoutUrl: null,
      expiresAt: paid ? new Date(at.getTime() + HOLD_MS).toISOString() : null,
      refundStatus: 'none', refundedAmount: 0,
      createdAt: at, updatedAt: at,
      ...(comp ? { compReason: reason, compedByUid: actor.uid } : {}),
    };
    const inventory = reserveInventory({
      inventory: inventorySnap.data(), catalog, lines: order.lines, eventId: scope.eventId, state: order.inventoryState,
    });
    const attempt = {
      id: attemptId, orderId: id, purchaserUid: actor.uid, ...scope,
      state: paid ? 'prepared' : 'succeeded', idempotencyKey: `eventrunner:${attemptId}`,
      stripeRequest: paid ? checkoutRequestFor(order, publicUrl) : null,
      stripeSessionId: null, requestFingerprint: fingerprint,
      createdAt: at, updatedAt: at, lastTriedAt: null, leaseUntil: null, retryNotBefore: null,
    };
    tx.create(orderRef, order);
    tx.create(attemptRef, attempt);
    tx.set(inventoryRef, { ...inventory, updatedAt: at });
    if (!comp) tx.set(purchaserRef, { orderId: id, ...rate, updatedAt: at });
    if (paid) {
      // This uses the existing provider-consistency queue. If the function
      // dies after Stripe receives creation, the frozen attempt is recoverable.
      tx.create(db.collection('ticket_sync_queue').doc(id), {
        orderId: id, provider: 'stripe', status: 'pending', attempts: 0,
        // Recover a crash before Stripe creation while the frozen Session
        // still meets Stripe's minimum of 30 minutes until expiry.
        readyAt: new Date(at.getTime() + ATTEMPT_LEASE_MS + 5000), createdAt: at, updatedAt: at,
        lastEventType: 'checkout.reserved',
      });
    } else {
      for (const ticket of ticketsForFreeOrder(order, at)) tx.create(db.collection('tickets').doc(ticket.externalId), ticket);
    }
    tx.create(db.collection('admin_logs').doc(`ticketing_order_${id}`), {
      action: comp ? 'ticketing.comp' : paid ? 'ticketing.order_reserved' : 'ticketing.free_order',
      actorUid: actor.uid, uid: actor.uid, orderId: id, ticketIds: order.ticketIds,
      docPath: `${ORDERS}/${id}`, at, ...(comp ? { reason } : {}),
    });
    return { order, created: true };
  });
}

function safeCheckoutUrl(value) {
  try {
    const url = new URL(value);
    // This value comes only from an account-verified Stripe Session. Stripe
    // may return the merchant's custom Checkout domain.
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function verifyCreatedSession(session, order) {
  return typeof session?.id === 'string' && /^cs_[a-zA-Z0-9_]+$/.test(session.id)
    && session.livemode === order.livemode
    && session.mode === 'payment'
    && session.metadata?.eventRunnerOrderId === order.id
    && session.metadata?.eventRunnerEventId === order.eventId
    && session.metadata?.eventRunnerAttemptId === order.attemptId
    && session.currency === order.currency
    && session.amount_total === order.totalAmount
    && session.amount_subtotal === order.subtotalAmount;
}

/**
 * Resume only the exact persisted creation call, within Stripe's retention
 * window. No reconciliation calls here: provider reconciliation can call this
 * recovery without a recursive dependency or trusting a redirect.
 */
async function recoverCheckoutAttempt({ db, provider, orderId, now = () => new Date() }) {
  const orderRef = db.collection(ORDERS).doc(orderId);
  const lease = await db.runTransaction(async (tx) => {
    const orderSnap = await tx.get(orderRef);
    if (!orderSnap.exists) throw new CommerceError('not-found', 'Order not found.', 404);
    const order = orderSnap.data();
    assertOrderScope(order, provider);
    if (order.status !== 'pending' || order.stripeSessionId || order.totalAmount === 0) return { order };
    const attemptRef = db.collection(ATTEMPTS).doc(order.attemptId);
    const [attemptSnap, eventSnap] = await tx.getAll(attemptRef, db.collection('config').doc('event'));
    assertWritableEvent(eventSnap.data());
    const attempt = attemptSnap.data();
    if (!attempt || attempt.orderId !== order.id || !attempt.stripeRequest || !attempt.idempotencyKey) {
      throw new CommerceError('attempt-unavailable', 'This order needs organizer review.', 503);
    }
    const at = now();
    const age = at.getTime() - millis(attempt.createdAt);
    if (!Number.isFinite(age) || age < 0 || age >= SAFE_RETRY_MS) {
      const patch = {
        status: 'exception', paymentStatus: 'pending', updatedAt: at,
        reconciliationException: {
          code: 'checkout-outcome-unknown',
          message: 'Checkout creation is unresolved. Capacity remains reserved until an organizer confirms the outcome.',
        },
      };
      tx.set(orderRef, patch, { merge: true });
      tx.set(attemptRef, { state: 'exception', leaseUntil: null, updatedAt: at }, { merge: true });
      return { order: { ...order, ...patch } };
    }
    requirePaymentCredentials(provider);
    if (millis(attempt.leaseUntil) > at.getTime() || millis(attempt.retryNotBefore) > at.getTime()) return { order };
    const leaseToken = `${at.getTime()}:${require('node:crypto').randomBytes(12).toString('hex')}`;
    tx.set(attemptRef, {
      state: 'creating', leaseToken, leaseUntil: new Date(at.getTime() + ATTEMPT_LEASE_MS),
      lastTriedAt: at, updatedAt: at,
    }, { merge: true });
    return { order, attempt, leaseToken };
  });
  if (!lease.attempt) return lease.order;
  const policy = await checkDemoWrites({ db });
  if (!policy.ok) throw new CommerceError(policy.code, policy.message, policy.status);
  let session = null;
  try {
    session = await provider.createCheckoutSession(lease.attempt.stripeRequest, { idempotencyKey: lease.attempt.idempotencyKey });
  } catch {
    // A lost/failed response cannot establish that Stripe did not create the
    // session. Keep inventory held and keep the same key and request forever.
  }
  return db.runTransaction(async (tx) => {
    const attemptRef = db.collection(ATTEMPTS).doc(lease.order.attemptId);
    const [orderSnap, attemptSnap, eventSnap] = await tx.getAll(orderRef, attemptRef, db.collection('config').doc('event'));
    assertWritableEvent(eventSnap.data());
    const order = orderSnap.data();
    if (!order) throw new CommerceError('not-found', 'Order not found.', 404);
    const at = now();
    const attempt = attemptSnap.data();
    // A webhook may have completed this order while the API response was in
    // flight. Never regress it or allow a stale lease to erase a newer result.
    if (order.status !== 'pending' || order.stripeSessionId || attempt?.leaseToken !== lease.leaseToken) return order;
    if (!session) {
      tx.set(attemptRef, {
        state: 'unknown', leaseUntil: null, retryNotBefore: new Date(at.getTime() + RETRY_BACKOFF_MS), updatedAt: at,
      }, { merge: true });
      return order;
    }
    if (!verifyCreatedSession(session, order)) {
      const patch = {
        status: 'exception', updatedAt: at,
        reconciliationException: { code: 'payment-snapshot-mismatch', message: 'Payment details do not match the saved order. An organizer must review it.' },
      };
      tx.set(orderRef, patch, { merge: true });
      tx.set(attemptRef, { state: 'exception', leaseUntil: null, updatedAt: at }, { merge: true });
      return { ...order, ...patch };
    }
    const patch = {
      stripeSessionId: session.id,
      stripePaymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || null,
      checkoutUrl: session.status === 'open' ? safeCheckoutUrl(session.url) : null,
      updatedAt: at,
    };
    tx.set(orderRef, patch, { merge: true });
    tx.set(attemptRef, { state: 'created', stripeSessionId: session.id, leaseUntil: null, updatedAt: at }, { merge: true });
    return { ...order, ...patch };
  });
}

function checkoutResponse(order) {
  return {
    orderId: order.id, status: order.status, paymentStatus: order.paymentStatus,
    checkoutUrl: order.status === 'pending' ? safeCheckoutUrl(order.checkoutUrl) : null,
    expiresAt: iso(order.expiresAt), ticketIds: order.status === 'free' || order.status === 'paid' ? order.ticketIds : [],
  };
}

async function createCompOrder({ db, provider, getConfig, actorUid, ticketTypeId, attendees, requestId, reason, now, env }) {
  if (typeof actorUid !== 'string' || !actorUid || typeof reason !== 'string' || !reason.trim() || reason.trim().length > 500) {
    throw new CommerceError('invalid-comp', 'An organizer and a reason of at most 500 characters are required.', 400);
  }
  const parsed = validateCheckoutRequest({ requestId, lines: [{ ticketTypeId, quantity: attendees?.length, attendees }] });
  if (!parsed.ok) throw new CommerceError('invalid-comp', parsed.issues[0].message, 400);
  const result = await reserveCommerceOrder({
    db, provider, getConfig, actor: { uid: actorUid, email: null }, request: parsed.value,
    source: 'comp', reason: reason.trim(), now, env,
  });
  return { ...checkoutResponse(result.order), order: result.order, created: result.created };
}

function createTicketingCatalogHandler(deps) {
  return async function ticketingCatalog(req, res) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
    res.set('Cache-Control', 'no-store');
    try { res.status(200).json(await readTicketingCatalog(deps)); } catch (err) { handleError(res, err, deps.log); }
  };
}

function createTicketingCheckoutHandler(deps) {
  return async function ticketingCheckout(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    res.set('Cache-Control', 'no-store');
    try {
      const actor = await verifiedPurchaser(deps.auth, req);
      const parsed = validateCheckoutRequest(req.body);
      if (!parsed.ok) throw new CommerceError('invalid-checkout', parsed.issues[0].message, 400);
      const reserved = await reserveCommerceOrder({ ...deps, actor, request: parsed.value });
      let order = reserved.order;
      if (order.totalAmount > 0 && order.status === 'pending') {
        order = await recoverCheckoutAttempt({ ...deps, orderId: order.id });
      }
      res.status(order.status === 'pending' && !order.checkoutUrl ? 202 : 200).json(checkoutResponse(order));
    } catch (err) { handleError(res, err, deps.log); }
  };
}

async function readPurchaserOrder({ db, provider, actor, orderId, requestId, now = () => new Date() }) {
  const id = orderId || (isCommerceRequestId(requestId) ? orderIdFor(actor.uid, requestId) : null);
  if (!isCommerceOrderId(id)) throw new CommerceError('not-found', 'Order not found.', 404);
  const ref = db.collection(ORDERS).doc(id);
  let snap = await ref.get();
  if (!snap.exists || snap.data()?.purchaserUid !== actor.uid) throw new CommerceError('not-found', 'Order not found.', 404);
  assertOrderScope(snap.data(), provider);
  // Read only after owner authorization; otherwise a guessed order ID could
  // provoke Stripe traffic or expose somebody else's payment state.
  const before = snap.data();
  if (before.stripeSessionId && typeof provider.reconcileOrder === 'function') {
    const policy = await checkDemoWrites({ db });
    if (policy.ok) {
      try { await provider.reconcileOrder(id); } catch { /* Current durable state is still safe to show. */ }
      snap = await ref.get();
    }
  }
  const order = snap.data();
  const ticketSnaps = await db.getAll(...order.ticketIds.map((ticketId) => db.collection('tickets').doc(ticketId)));
  const tickets = ticketSnaps.filter((ticket) => ticket.exists).map((ticket) => {
    const data = ticket.data();
    return {
      externalId: data.externalId, ticketClass: data.ticketClass,
      email: data.email, firstName: data.firstName, lastName: data.lastName,
      status: data.status, claimedByMe: data.claimedByUid === actor.uid,
    };
  });
  return {
    ...checkoutResponse(order), currency: order.currency, currencyExponent: order.currencyExponent,
    subtotalAmount: order.subtotalAmount, totalAmount: order.totalAmount,
    taxAmount: order.taxAmount, feeAmount: order.feeAmount, taxTreatment: order.taxTreatment,
    refundStatus: order.refundStatus, refundedAmount: order.refundedAmount,
    lines: order.lines.map(({ ticketTypeId, name, quantity, unitAmount, lineAmount }) => ({ ticketTypeId, name, quantity, unitAmount, lineAmount })),
    tickets, updatedAt: iso(order.updatedAt), checkedAt: now().toISOString(),
  };
}

function createTicketingOrderStatusHandler(deps) {
  return async function ticketingOrderStatus(req, res) {
    if (!['GET', 'POST'].includes(req.method)) return methodNotAllowed(res, ['GET', 'POST']);
    res.set('Cache-Control', 'no-store');
    try {
      const actor = await verifiedPurchaser(deps.auth, req);
      const input = req.method === 'GET' ? req.query || {} : req.body || {};
      res.status(200).json(await readPurchaserOrder({ ...deps, actor, orderId: input.orderId, requestId: input.requestId }));
    } catch (err) { handleError(res, err, deps.log); }
  };
}

module.exports = {
  readTicketingCatalog, reserveCommerceOrder, recoverCheckoutAttempt, readPurchaserOrder, createCompOrder,
  createTicketingCatalogHandler, createTicketingCheckoutHandler, createTicketingOrderStatusHandler,
  internals: { verifiedPurchaser, checkoutResponse, safeCheckoutUrl, verifyCreatedSession, purchaserWindow,
    ATTEMPT_LEASE_MS, RETRY_BACKOFF_MS, PURCHASER_WINDOW_MS, MAX_PURCHASER_ORDERS },
};
