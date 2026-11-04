'use strict';

/** Shared fixtures for the Stripe checkout tests (stripeCheckout, promoCheckout). */
const assert = require('node:assert/strict');
const { makeFakeDb } = require('../cms/firestoreFake.cjs');
const { createTicketingCheckoutHandler, createTicketingOrderStatusHandler } = require('./stripeCheckout.cjs');

const START = new Date('2026-10-12T16:00:00.000Z');
const ADA = { uid: 'uid-ada', email: 'ada@example.com', email_verified: true };
const BOB = { uid: 'uid-bob', email: 'bob@example.com', email_verified: true };
const PERSON = { firstName: 'Ada', lastName: 'Example', email: 'ada@example.com' };
const QUIET = { error() {}, warn() {} };

function catalog(patch = {}) {
  return {
    schemaVersion: 1, revision: 1, published: true, salesPaused: false,
    commercialTermsConfirmed: true, currency: 'usd', capacity: 100, maxPerOrder: 20,
    taxTreatment: 'not_collected', refundPolicy: 'Contact the organizer before the event for a refund.',
    ticketTypes: [
      { id: 'general', name: 'Full event pass', unitAmount: 2500, capacity: 100, active: true, visibility: 'public' },
      { id: 'student', name: 'Student full event pass', unitAmount: 1000, capacity: 50, active: true, visibility: 'public' },
    ], ...patch,
  };
}

function request(patch = {}) {
  return {
    requestId: 'checkout-request-0001',
    catalogRevision: 1,
    lines: [{ ticketTypeId: 'general', quantity: 1, attendees: [PERSON] }],
    ...patch,
  };
}

function response() {
  return {
    statusCode: null, body: null, headers: {},
    set(key, value) { this.headers[key] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
}

function setup({ catalogPatch = {}, seed = {}, create } = {}) {
  const db = makeFakeDb({
    'config/features': { autoApproveTicketHolders: true },
    'config/event': { name: 'Example event', historicalDemo: false },
    'ticket_catalog/current': catalog(catalogPatch),
    'users/uid-ada': { registrationStatus: 'pending', approvalSource: null },
    'users/uid-bob': { registrationStatus: 'pending', approvalSource: null },
    ...seed,
  });
  let clock = new Date(START);
  const calls = [];
  const sessions = new Map();
  const provider = {
    name: 'stripe', externalEventId: 'example-event', stripeAccountId: 'acct_example', livemode: false,
    hasPaymentCredentials: true,
    async createCheckoutSession(params, options) {
      calls.push({ params: structuredClone(params), options: structuredClone(options) });
      if (create) return create({ db, params, options, calls, sessions });
      if (!sessions.has(options.idempotencyKey)) sessions.set(options.idempotencyKey, makeSession(params));
      return sessions.get(options.idempotencyKey);
    },
  };
  const deps = {
    db, provider, log: QUIET, env: { EVENT_PUBLIC_URL: 'https://event.example.com' },
    now: () => new Date(clock),
    getConfig: async () => ({ event: { name: 'Example event' }, features: { autoApproveTicketHolders: true } }),
    auth: {
      async verifyIdToken(token, revoked) {
        assert.equal(revoked, true);
        if (token === 'ada') return ADA;
        if (token === 'bob') return BOB;
        if (token === 'unverified') return { ...ADA, email_verified: false };
        throw new Error('Invalid token');
      },
    },
  };
  return { deps, db, provider, calls, advance(ms) { clock = new Date(clock.getTime() + ms); } };
}

function makeSession(params, patch = {}) {
  const total = params.line_items.reduce((sum, line) => sum + line.quantity * line.price_data.unit_amount, 0);
  return {
    id: `cs_test_${params.metadata.eventRunnerOrderId}`, mode: 'payment', status: 'open', payment_status: 'unpaid',
    livemode: false, metadata: params.metadata, currency: params.line_items[0].price_data.currency,
    amount_total: total, amount_subtotal: total, payment_intent: null,
    url: 'https://checkout.stripe.com/c/pay/example', expires_at: params.expires_at,
    ...patch,
  };
}

async function checkout(deps, body = request(), token = 'ada') {
  const res = response();
  await createTicketingCheckoutHandler(deps)({ method: 'POST', headers: { authorization: `Bearer ${token}` }, body }, res);
  return res;
}

async function status(deps, query, token = 'ada') {
  const res = response();
  await createTicketingOrderStatusHandler(deps)({ method: 'GET', headers: { authorization: `Bearer ${token}` }, query }, res);
  return res;
}

module.exports = {
  START, ADA, BOB, PERSON, QUIET, catalog, request, response, setup, makeSession, checkout, status,
};
