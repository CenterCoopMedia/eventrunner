'use strict';

/**
 * TEST-ONLY in-memory TicketingProvider (no emulator, no network — house
 * rule). Not a deployable module: nothing under src/ requires it outside
 * *.test.cjs, and the test glob (`src/(asterisk)/*.test.cjs`) never
 * executes it directly.
 *
 * It is a full, honest implementation of the §3.3 interface rather than a
 * stub, because the core is only as well tested as the provider it is
 * exercised against. In particular it reproduces the two provider
 * behaviors the core exists to survive:
 *
 *   • HMAC-signed deliveries, verified over the EXACT raw body — the same
 *     shape as email/providers/webhook.cjs, so the webhook endpoint is
 *     tested against real signature checking, not a boolean.
 *   • Eventually consistent reads: an order can report `complete: false`
 *     for its first N fetches, which is precisely the placeholder-attendee
 *     case the sync queue and its backoff exist for.
 */

const crypto = require('node:crypto');

const SIGNATURE_HEADER = 'x-fake-signature';

/** @param {string} secret @param {Buffer|string} rawBody @returns {string} hex */
function signBody(secret, rawBody) {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

/** Constant-time compare of two strings via their digests (webhook.cjs's shape). */
function safeEqual(a, b) {
  const da = crypto.createHash('sha256').update(String(a), 'utf8').digest();
  const db = crypto.createHash('sha256').update(String(b), 'utf8').digest();
  return crypto.timingSafeEqual(da, db);
}

/**
 * Build a signed delivery the way a real provider would: one JSON body,
 * one signature over its exact bytes.
 *
 * @param {{ secret?: string, deliveryId: string, eventType?: string,
 *           orderId?: string|null, eventId?: string|null }} opts
 * @returns {{ rawBody: Buffer, headers: Record<string,string>, body: object }}
 */
function buildDelivery({ secret = 'fake-secret', deliveryId, eventType = 'order.placed', orderId = null, eventId = null }) {
  const body = { deliveryId, eventType, orderId, eventId };
  const rawBody = Buffer.from(JSON.stringify(body), 'utf8');
  return { rawBody, body, headers: { [SIGNATURE_HEADER]: signBody(secret, rawBody) } };
}

/**
 * @param {{
 *   name?: string,
 *   externalEventId?: string|null,
 *   secret?: string,
 *   orders?: Record<string, { tickets?: object[], externalEventId?: string,
 *                             completeAfter?: number, throwTimes?: number }>,
 *   pages?: Array<{ tickets: object[], nextPageToken?: string|null }>,
 *   withLookup?: boolean,
 *   withRegisterWebhook?: boolean,
 * }} [opts]
 */
function createFakeTicketingProvider({
  name = 'eventbrite',
  externalEventId = 'evt-1',
  secret = 'fake-secret',
  orders = {},
  pages = [],
  withLookup = true,
  withRegisterWebhook = false,
} = {}) {
  /** Per-order fetch counter — drives `completeAfter` and `throwTimes`. */
  const fetchCounts = new Map();
  const calls = { verifyWebhook: 0, fetchOrder: [], listTickets: [], lookupByOrderNumber: [] };

  const provider = {
    name,
    externalEventId,
    calls,

    async verifyWebhook(rawBody, headers) {
      calls.verifyWebhook += 1;
      const provided = headers?.[SIGNATURE_HEADER];
      if (typeof provided !== 'string' || !safeEqual(provided, signBody(secret, rawBody))) {
        return { valid: false, deliveryId: '', eventType: 'unknown', resourceId: null, reason: 'bad signature' };
      }
      let body = null;
      try {
        body = JSON.parse(Buffer.from(rawBody).toString('utf8'));
      } catch {
        return { valid: false, deliveryId: '', eventType: 'unknown', resourceId: null, reason: 'unparseable' };
      }
      const verification = {
        valid: true,
        deliveryId: typeof body.deliveryId === 'string' ? body.deliveryId : '',
        eventType: typeof body.eventType === 'string' ? body.eventType : 'unknown',
        resourceId: typeof body.orderId === 'string' ? body.orderId : null,
      };
      // A correctly signed delivery about another event: refused with the
      // wrong-event reason, which the endpoint answers 200 + ignored.
      if (body.eventId && externalEventId && body.eventId !== externalEventId) {
        return { ...verification, valid: false, reason: 'wrong_event' };
      }
      return verification;
    },

    async fetchOrder(orderId) {
      const n = (fetchCounts.get(orderId) || 0) + 1;
      fetchCounts.set(orderId, n);
      calls.fetchOrder.push(orderId);
      const spec = orders[orderId];
      if (!spec) {
        return { orderId, externalEventId, tickets: [], complete: true };
      }
      if (typeof spec.throwTimes === 'number' && n <= spec.throwTimes) {
        throw new Error(`provider unavailable (call ${n})`);
      }
      const completeAfter = typeof spec.completeAfter === 'number' ? spec.completeAfter : 0;
      const complete = n > completeAfter;
      return {
        orderId,
        externalEventId: spec.externalEventId ?? externalEventId,
        tickets: complete ? (spec.tickets || []) : [],
        complete,
      };
    },

    async listTickets(opts = {}) {
      calls.listTickets.push(opts);
      const index = opts.pageToken ? Number(opts.pageToken) : 0;
      const page = pages[index];
      if (!page) return { tickets: [], nextPageToken: null };
      return {
        tickets: page.tickets || [],
        nextPageToken: page.nextPageToken === undefined
          ? (pages[index + 1] ? String(index + 1) : null)
          : page.nextPageToken,
      };
    },

    async getRegistrationPrompt() {
      return {
        send: true,
        templateId: 'ticket.get_ticket',
        ctaLabel: 'Get your ticket',
        ctaUrl: 'https://tickets.example/evt-1',
        action: 'purchase',
        bodyNote: null,
      };
    },
  };

  if (withLookup) {
    provider.lookupByOrderNumber = async (orderNumber, email) => {
      calls.lookupByOrderNumber.push({ orderNumber, email });
      const spec = orders[orderNumber];
      if (!spec) return null;
      if (spec.externalEventId && externalEventId && spec.externalEventId !== externalEventId) return null;
      return spec.tickets || [];
    };
  }
  if (withRegisterWebhook) {
    provider.registerWebhook = async ({ callbackUrl }) => ({ webhookId: `hook-for-${callbackUrl}` });
  }

  return provider;
}

/** One well-formed TicketRecord (§3.3), overridable field by field. */
function fakeTicket(overrides = {}) {
  return {
    externalId: 'tkt-1',
    orderId: 'ord-1',
    email: 'attendee@example.com',
    firstName: 'Ada',
    lastName: 'Lovelace',
    ticketClass: 'General',
    quantity: 1,
    purchasedAt: '2026-08-01T12:00:00.000Z',
    status: 'valid',
    ...overrides,
  };
}

module.exports = {
  createFakeTicketingProvider,
  buildDelivery,
  fakeTicket,
  signBody,
  SIGNATURE_HEADER,
};
