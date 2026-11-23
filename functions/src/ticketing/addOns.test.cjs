'use strict';

// Ticket add-ons (#1412): server prices, free ticket plus paid add-on,
// add-on capacity, the required acknowledgement, fulfillment and refunds.
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateTicketCatalog, validateCheckoutRequest } = require('shared/ticketCommerce');
const { priceSelections, checkoutRequestFor } = require('./stripeCommerce.cjs');
const { reconcileStripeOrder } = require('./stripeReconcile.cjs');
const { createTicketingCommerceAdminHandler, createTicketingCheckInHandler } = require('./commerceAdmin.cjs');
const { sendOrderConfirmations } = require('./commerceEmail.cjs');
const { START, PERSON, setup, checkout, request, response } = require('./commerceTestKit.cjs');

const ACK = 'I am 21 or older.';
const RECEPTION = {
  id: 'reception', name: 'Evening reception', description: 'Two drinks and appetizers. Must be 21+.',
  unitAmount: 1500, capacity: 2, active: true, acknowledgement: ACK, ticketTypeIds: ['general', 'student'],
};
const TYPES = [
  { id: 'general', name: 'Full event pass', unitAmount: 2500, capacity: 100, active: true, visibility: 'public' },
  { id: 'student', name: 'Student pass', unitAmount: 0, capacity: 50, active: true, visibility: 'public' },
];
const BEN = { firstName: 'Ben', lastName: 'Example', email: 'ben@example.com' };
const CARA = { firstName: 'Cara', lastName: 'Example', email: 'cara@example.com' };
const withReception = (person, acknowledged = true) => ({ ...person, addOns: [{ id: 'reception', acknowledged }] });

function addOnSetup(addOnPatch = {}, options = {}) {
  return setup({ ...options, catalogPatch: { ticketTypes: TYPES, addOns: [{ ...RECEPTION, ...addOnPatch }], ...options.catalogPatch } });
}

function validCatalog(patch = {}) {
  const result = validateTicketCatalog({
    published: true, commercialTermsConfirmed: true,
    currency: 'usd', capacity: 100, taxTreatment: 'not_collected', refundPolicy: 'Ask the organizer.',
    ticketTypes: TYPES, addOns: [RECEPTION], ...patch,
  });
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  return result.value;
}

/** The Stripe state a paid Session for this order would return. */
function paidState(order, { lineItems } = {}) {
  const metadata = { eventRunnerOrderId: order.id, eventRunnerEventId: order.eventId, eventRunnerAttemptId: order.attemptId };
  const items = lineItems || checkoutRequestFor(order, 'https://event.example.com').line_items.map((item, index) => ({
    id: `li_${index}`, quantity: item.quantity, currency: 'usd',
    amount_subtotal: item.quantity * item.price_data.unit_amount, amount_total: item.quantity * item.price_data.unit_amount,
    amount_tax: 0, amount_discount: 0,
    price: { unit_amount: item.price_data.unit_amount, currency: 'usd', recurring: null,
      product: { id: `prod_${index}`, metadata: item.price_data.product_data.metadata } },
  }));
  return {
    session: { id: order.stripeSessionId, metadata, livemode: false, mode: 'payment', ui_mode: 'hosted_page',
      payment_method_types: ['card'], payment_intent: 'pi_addon', currency: 'usd', amount_total: order.totalAmount,
      amount_subtotal: order.subtotalAmount, total_details: { amount_discount: 0, amount_tax: 0, amount_shipping: 0 },
      status: 'complete', payment_status: 'paid', expires_at: START.getTime() / 1000 + 3600 },
    lineItems: items,
    paymentIntent: { id: 'pi_addon', metadata, livemode: false, currency: 'usd', amount: order.totalAmount,
      status: 'succeeded', amount_received: order.totalAmount, latest_charge: 'ch_addon' },
    refunds: [], disputes: [],
  };
}

async function paidOrder(env, body) {
  const res = await checkout(env.deps, body);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const order = env.db.read('ticket_orders', res.body.orderId);
  return { orderId: res.body.orderId, order };
}

async function reconcile(env, orderId, financial) {
  const provider = { ...env.provider, readFinancialState: async () => financial };
  return reconcileStripeOrder({ db: env.db, provider, orderId, now: env.deps.now, log: { error() {} } });
}

function adminCall(env, body, user = 'operator') {
  const handler = createTicketingCommerceAdminHandler({
    db: env.db, provider: env.provider, getConfig: async () => ({ event: { historicalDemo: false } }), now: env.deps.now, log: { error() {} },
    auth: { async verifyIdToken(token) { return { uid: token, email: `${token}@example.org`, email_verified: true }; } },
  });
  const res = response();
  return handler({ method: 'POST', body, headers: { authorization: `Bearer ${user}` } }, res).then(() => res);
}

test('the catalog validates add-ons against its ticket types', () => {
  assert.deepEqual(validCatalog().addOns, [RECEPTION]);
  assert.deepEqual(validCatalog({ addOns: undefined }).addOns, []);
  const defaults = validCatalog({ addOns: [{ id: 'lunch', name: 'Lunch', unitAmount: 0, ticketTypeIds: ['general'] }] }).addOns[0];
  assert.deepEqual(defaults, { id: 'lunch', name: 'Lunch', description: '', unitAmount: 0, capacity: null, active: true, acknowledgement: '', ticketTypeIds: ['general'] });
  const bad = (addOn) => validateTicketCatalog({
    currency: 'usd', capacity: 100, taxTreatment: 'not_collected', ticketTypes: TYPES, addOns: [{ ...RECEPTION, ...addOn }],
  }).issues.map((issue) => issue.path);
  assert.deepEqual(bad({ ticketTypeIds: ['vip'] }), ['addOns.0.ticketTypeIds']);
  assert.deepEqual(bad({ ticketTypeIds: [] }), ['addOns.0.ticketTypeIds']);
  assert.deepEqual(bad({ unitAmount: 15.5 }), ['addOns.0.unitAmount']);
  assert.deepEqual(bad({ capacity: 0 }), ['addOns.0.capacity']);
  assert.deepEqual(bad({ acknowledgement: 'x'.repeat(301) }), ['addOns.0.acknowledgement']);
});

test('checkout requests accept add-on choices only, never prices', () => {
  const lines = (person) => ({ requestId: 'checkout-request-0001', lines: [{ ticketTypeId: 'general', quantity: 1, attendees: [person] }] });
  const parsed = validateCheckoutRequest(lines(withReception(PERSON)));
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.value.lines[0].attendees[0].addOns, [{ id: 'reception', acknowledged: true }]);
  assert.equal(Object.hasOwn(validateCheckoutRequest(lines({ ...PERSON, addOns: [] })).value.lines[0].attendees[0], 'addOns'), false);
  for (const addOns of [[{ id: 'reception', unitAmount: 1 }], [{ id: 'reception' }, { id: 'reception' }], ['reception'], { id: 'reception' }]) {
    assert.equal(validateCheckoutRequest(lines({ ...PERSON, addOns })).ok, false, JSON.stringify(addOns));
  }
});

test('add-ons are priced from the catalog, and promo codes discount tickets only', () => {
  const catalog = validCatalog();
  const priced = priceSelections({
    catalog, at: START, request: { lines: [{ ticketTypeId: 'general', quantity: 2, attendees: [withReception(PERSON), withReception(BEN)] }], promoCode: 'HALF' },
    promo: { active: true, kind: 'percent', value: 50 },
  });
  assert.deepEqual(priced.addOnLines, [{ addOnId: 'reception', name: 'Evening reception', quantity: 2, unitAmount: 1500, lineAmount: 3000 }]);
  assert.equal(priced.lines[0].lineAmount, 2500);
  assert.equal(priced.totalAmount, 5500);
  const comp = priceSelections({ catalog, at: START, comp: true, request: { lines: [{ ticketTypeId: 'general', quantity: 1, attendees: [withReception(PERSON)] }] } });
  assert.equal(comp.totalAmount, 0);
  assert.equal(comp.addOnLines[0].unitAmount, 0);
  const plain = priceSelections({ catalog, at: START, request: { lines: [{ ticketTypeId: 'general', quantity: 1, attendees: [PERSON] }] } });
  assert.equal(Object.hasOwn(plain, 'addOnLines'), false);
});

test('a free ticket with a paid add-on goes to Stripe for the add-on amount only', async () => {
  const env = addOnSetup();
  const { order } = await paidOrder(env, request({ lines: [{ ticketTypeId: 'student', quantity: 1, attendees: [withReception(PERSON)] }] }));
  assert.equal(order.status, 'pending');
  assert.equal(order.totalAmount, 1500);
  assert.deepEqual(order.addOnLines, [{ addOnId: 'reception', name: 'Evening reception', quantity: 1, unitAmount: 1500, lineAmount: 1500 }]);
  assert.deepEqual(order.seats[0].addOns, [{ id: 'reception', name: 'Evening reception', unitAmount: 1500, acknowledgement: ACK }]);
  const items = env.calls[0].params.line_items;
  assert.deepEqual(items.map((item) => [item.price_data.unit_amount, item.price_data.product_data.metadata]), [
    [0, { eventRunnerTicketTypeId: 'student' }], [1500, { eventRunnerAddOnId: 'reception' }],
  ]);
  const inventory = env.db.read('ticket_inventory', 'current');
  assert.equal(inventory.held, 1, 'add-ons do not use event capacity');
  assert.deepEqual(inventory.addOns, { reception: { held: 1, sold: 0 } });
  assert.equal(env.db.ids('tickets').length, 0, 'the free seat waits for the add-on payment');
  // The free-ticket guard still applies to the free seat in the paid order.
  assert.equal(env.db.ids('ticket_inventory').filter((id) => id.startsWith('free_recipient_')).length, 1);
});

test('a free ticket with a free add-on is a free order with the add-on on its ticket', async () => {
  const env = addOnSetup({ unitAmount: 0, acknowledgement: '' });
  const res = await checkout(env.deps, request({ lines: [{ ticketTypeId: 'student', quantity: 1, attendees: [{ ...PERSON, addOns: [{ id: 'reception' }] }] }] }));
  assert.equal(res.body.status, 'free');
  assert.equal(env.calls.length, 0);
  const [ticketId] = env.db.ids('tickets');
  assert.deepEqual(env.db.read('tickets', ticketId).addOns, [{ id: 'reception', name: 'Evening reception', status: 'valid' }]);
  assert.deepEqual(env.db.read('ticket_inventory', 'current').addOns, { reception: { held: 0, sold: 1 } });
});

test('the acknowledgement, the offered ticket types and add-on capacity are enforced before any write', async () => {
  const env = addOnSetup({ ticketTypeIds: ['general'] });
  const before = env.db.ids('ticket_orders').length;
  let res = await checkout(env.deps, request({ lines: [{ ticketTypeId: 'general', quantity: 1, attendees: [withReception(PERSON, false)] }] }));
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error.code, 'add-on-acknowledgement-required');
  res = await checkout(env.deps, request({ requestId: 'checkout-request-0002', lines: [{ ticketTypeId: 'student', quantity: 1, attendees: [withReception(PERSON)] }] }));
  assert.equal(res.body.error.code, 'add-on-unavailable');
  res = await checkout(env.deps, request({ requestId: 'checkout-request-0003', lines: [{ ticketTypeId: 'general', quantity: 3, attendees: [withReception(PERSON), withReception(BEN), withReception(CARA)] }] }));
  assert.equal(res.body.error.code, 'sold-out');
  assert.match(res.body.error.message, /Evening reception/);
  assert.equal(env.db.ids('ticket_orders').length, before);
  assert.equal(env.calls.length, 0);
  // The remaining two places still sell, and then the catalog shows none left.
  res = await checkout(env.deps, request({ requestId: 'checkout-request-0004', lines: [{ ticketTypeId: 'general', quantity: 2, attendees: [withReception(PERSON), withReception(BEN)] }] }));
  assert.equal(res.statusCode, 200);
  const { readTicketingCatalog } = require('./stripeCheckout.cjs');
  const catalog = await readTicketingCatalog(env.deps);
  assert.deepEqual(catalog.addOns.map(({ id, remaining, available, ticketTypeIds }) => ({ id, remaining, available, ticketTypeIds })), [
    { id: 'reception', remaining: 0, available: false, ticketTypeIds: ['general'] },
  ]);
});

test('payment fulfils tickets with their add-ons; a changed add-on line in Stripe is an exception', async () => {
  const env = addOnSetup();
  const { orderId, order } = await paidOrder(env, request({ lines: [
    { ticketTypeId: 'general', quantity: 1, attendees: [withReception(PERSON)] },
    { ticketTypeId: 'student', quantity: 1, attendees: [BEN] },
  ] }));
  assert.equal(order.totalAmount, 4000);
  const tampered = paidState(order);
  tampered.lineItems[2].price.product.metadata = { eventRunnerTicketTypeId: 'reception' };
  let result = await reconcile(env, orderId, tampered);
  assert.equal(result.exception.code, 'stripe-order-mismatch');
  assert.equal(env.db.ids('tickets').length, 0);
  await env.db.collection('ticket_orders').doc(orderId).set({ status: 'pending', reconciliationException: null }, { merge: true });
  result = await reconcile(env, orderId, paidState(order));
  assert.equal(result.status, 'paid');
  const tickets = Object.fromEntries(env.db.ids('tickets').map((id) => [env.db.read('tickets', id).email, env.db.read('tickets', id)]));
  assert.deepEqual(tickets['ada@example.com'].addOns, [{ id: 'reception', name: 'Evening reception', status: 'valid' }]);
  assert.equal(Object.hasOwn(tickets['ben@example.com'], 'addOns'), false);
  assert.deepEqual(env.db.read('ticket_inventory', 'current').addOns, { reception: { held: 0, sold: 1 } });
});

test('an expired checkout releases its add-on places', async () => {
  const env = addOnSetup();
  const { orderId, order } = await paidOrder(env, request({ lines: [{ ticketTypeId: 'general', quantity: 1, attendees: [withReception(PERSON)] }] }));
  const expired = paidState(order);
  Object.assign(expired.session, { status: 'expired', payment_status: 'unpaid', payment_intent: null });
  expired.paymentIntent = null;
  await reconcile(env, orderId, expired);
  assert.deepEqual(env.db.read('ticket_inventory', 'current').addOns, { reception: { held: 0, sold: 0 } });
});

test('an add-on refund keeps admission, and cancelling a ticket cancels its add-on', async () => {
  const env = addOnSetup({}, { seed: { 'config/bootstrap': { adminEmails: ['operator@example.org'], staffEmails: ['staff@example.org'] } } });
  const { orderId, order } = await paidOrder(env, request({ lines: [{ ticketTypeId: 'general', quantity: 2, attendees: [withReception(PERSON), withReception(BEN)] }] }));
  await reconcile(env, orderId, paidState(order));
  const [first, second] = order.ticketIds;
  const refunded = paidState(order);
  refunded.refunds = [{ id: 're_addon', amount: 1500, status: 'succeeded', payment_intent: 'pi_addon', currency: 'usd', created: START.getTime() / 1000 }];
  const pending = await reconcile(env, orderId, refunded);
  assert.equal(pending.exception.code, 'refund-allocation-required');

  const allocate = { action: 'allocateRefund', orderId, refundId: 're_addon', ticketIds: [], preserveAdmission: true,
    addOns: [{ ticketId: first, addOnId: 'reception' }], reason: 'Reception refunded on request.', confirmed: true };
  assert.equal((await adminCall(env, { ...allocate, addOns: [{ ticketId: first, addOnId: 'lunch' }] })).statusCode, 404);
  assert.equal((await adminCall(env, { ...allocate, preserveAdmission: false })).statusCode, 400);
  let res = await adminCall(env, allocate);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const view = Object.fromEntries(res.body.tickets.map((ticket) => [ticket.id, ticket]));
  assert.equal(view[first].status, 'valid');
  assert.deepEqual(view[first].addOns, [{ id: 'reception', name: 'Evening reception', status: 'refunded' }]);
  assert.deepEqual(view[second].addOns, [{ id: 'reception', name: 'Evening reception', status: 'valid' }]);
  await reconcile(env, orderId, refunded);
  assert.equal(env.db.read('ticket_orders', orderId).reconciliationException, null);
  assert.equal(env.db.read('tickets', first).addOns[0].status, 'refunded', 'reconciliation keeps the organizer decision');

  res = await adminCall(env, { action: 'cancelTickets', orderId, ticketIds: [second], reason: 'Cannot attend.', confirmed: true }, 'staff');
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.tickets.find((ticket) => ticket.id === second).addOns, [{ id: 'reception', name: 'Evening reception', status: 'cancelled' }]);

  // Check-in shows the remaining ticket's add-ons to staff at the door.
  const checkIn = createTicketingCheckInHandler({
    db: env.db, provider: env.provider, getConfig: async () => ({}), now: env.deps.now, log: { error() {} },
    auth: { async verifyIdToken(token) { return { uid: token, email: `${token}@example.org`, email_verified: true }; } },
  });
  const scan = response();
  await checkIn({ method: 'POST', body: { action: 'checkIn', ticketId: first }, headers: { authorization: 'Bearer staff' } }, scan);
  assert.equal(scan.body.result, 'checked_in');
  assert.deepEqual(scan.body.ticket.addOns, [{ id: 'reception', name: 'Evening reception', status: 'refunded' }]);
});

test('a full refund makes every add-on refunded with its ticket', async () => {
  const env = addOnSetup({}, { seed: { 'config/bootstrap': { adminEmails: ['operator@example.org'] } } });
  const { orderId, order } = await paidOrder(env, request({ lines: [{ ticketTypeId: 'general', quantity: 1, attendees: [withReception(PERSON)] }] }));
  const refunded = paidState(order);
  refunded.refunds = [{ id: 're_full', amount: order.totalAmount, status: 'succeeded', payment_intent: 'pi_addon', currency: 'usd', created: START.getTime() / 1000 }];
  await reconcile(env, orderId, refunded);
  const res = await adminCall(env, { action: 'order', orderId });
  assert.equal(res.body.tickets[0].status, 'refunded');
  assert.deepEqual(res.body.tickets[0].addOns, [{ id: 'reception', name: 'Evening reception', status: 'refunded' }]);
});

test('the catalog keeps sold add-ons and their capacity', async () => {
  const env = addOnSetup({}, { seed: { 'config/bootstrap': { adminEmails: ['operator@example.org'] } } });
  await paidOrder(env, request({ lines: [{ ticketTypeId: 'general', quantity: 2, attendees: [withReception(PERSON), withReception(BEN)] }] }));
  const saved = env.db.read('ticket_catalog', 'current');
  const save = (addOns) => adminCall(env, { action: 'saveCatalog', expectedRevision: saved.revision, catalog: { ...saved, addOns } });
  assert.equal((await save([])).statusCode, 409);
  assert.equal((await save([{ ...RECEPTION, capacity: 1 }])).statusCode, 409);
  assert.equal((await save([{ ...RECEPTION, active: false, capacity: null }])).statusCode, 200);
});

test('confirmation emails list the add-ons for the buyer and each attendee', async () => {
  const env = addOnSetup();
  const { orderId, order } = await paidOrder(env, request({ lines: [{ ticketTypeId: 'general', quantity: 2, attendees: [withReception(PERSON), BEN] }] }));
  await reconcile(env, orderId, paidState(order));
  const sent = [];
  await sendOrderConfirmations({
    db: env.db, orderId, getConfig: async () => ({ event: { name: 'Example event' } }), now: env.deps.now,
    env: { EVENT_PUBLIC_URL: 'https://event.example.com', EVENT_TICKETING_PROVIDER: 'stripe', EVENT_TICKETING_EVENT_ID: 'example-event',
      EVENT_STRIPE_ACCOUNT_ID: 'acct_example', EVENT_STRIPE_MODE: 'test' },
    sendEmail: async (message) => { sent.push(message); return { status: 'sent' }; },
  });
  const text = (tag, to) => sent.find((message) => message.tag === tag && message.to === to).text;
  assert.match(text('ticket.order_confirmation', 'ada@example.com'), /Tickets: 2\nAdd-ons: 1 × Evening reception\nTotal:/);
  assert.match(text('ticket.attendee_confirmation', 'ada@example.com'), /Add-ons: 1 × Evening reception\./);
  assert.doesNotMatch(text('ticket.attendee_confirmation', 'ben@example.com'), /Add-ons/);
});
