'use strict';

/** Organizer-owned Stripe account, hosted Checkout, and authoritative reconciliation. */
const { createHash } = require('node:crypto');
const { checkDemoWrites, throwIfDemoPolicyUnavailable } = require('../../core/demoWrites.cjs');

const WEBHOOK_EVENTS = [
  'checkout.session.completed', 'checkout.session.expired',
  'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed',
  'payment_intent.succeeded', 'payment_intent.payment_failed', 'payment_intent.canceled',
  'refund.created', 'refund.updated', 'refund.failed', 'charge.refunded',
  'charge.dispute.created', 'charge.dispute.updated', 'charge.dispute.closed',
  'charge.dispute.funds_withdrawn', 'charge.dispute.funds_reinstated',
];
const ORDER_PAGE_SIZE = 25;
const MAX_PROVIDER_PAGES = 10;

function objectId(value) {
  return typeof value === 'string' ? value : value?.id || null;
}

function safeId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value) ? value : null;
}

function stripeScope(env = process.env) {
  const externalEventId = safeId(env.EVENT_TICKETING_EVENT_ID?.trim());
  const stripeAccountId = env.EVENT_STRIPE_ACCOUNT_ID?.trim();
  const mode = env.EVENT_STRIPE_MODE?.trim();
  if (!externalEventId) throw new Error('EVENT_TICKETING_EVENT_ID is required for Stripe.');
  if (!/^acct_[A-Za-z0-9]+$/.test(stripeAccountId || '')) {
    throw new Error('EVENT_STRIPE_ACCOUNT_ID must identify the organizer-owned Stripe account.');
  }
  if (!['test', 'live'].includes(mode)) throw new Error('EVENT_STRIPE_MODE must be test or live.');
  const livemode = mode === 'live';
  if (livemode && (env.FUNCTIONS_EMULATOR === 'true' || env.FIRESTORE_EMULATOR_HOST ||
      env.EVENT_DEPLOY_CLIENT === 'demo' ||
      /^demo-/.test(env.EVENT_FIREBASE_PROJECT_ID || env.GCLOUD_PROJECT || ''))) {
    throw new Error('Stripe live mode is not available in an emulator or demo deployment.');
  }
  return { externalEventId, stripeAccountId, livemode };
}

function hasPaymentCredentials(env, livemode) {
  const token = typeof env.TICKETING_API_TOKEN === 'string' ? env.TICKETING_API_TOKEN.trim() : '';
  return new RegExp(`^(sk|rk)_${livemode ? 'live' : 'test'}_[A-Za-z0-9]+$`).test(token);
}

/** The installed SDK is locked by package-lock; no browser sees either secret. */
function createStripeClient({ env = process.env, stripeClient } = {}) {
  if (stripeClient) return stripeClient;
  const scope = stripeScope(env);
  if (!hasPaymentCredentials(env, scope.livemode)) {
    throw new Error('TICKETING_API_TOKEN must match EVENT_STRIPE_MODE.');
  }
  const token = env.TICKETING_API_TOKEN.trim();
  const Stripe = require('stripe');
  return new Stripe(token, { timeout: 10_000, maxNetworkRetries: 1 });
}

async function allProviderPages(list, params) {
  const data = [];
  let cursor;
  for (let page = 0; page < MAX_PROVIDER_PAGES; page += 1) {
    const result = await list({ ...params, limit: 100, ...(cursor ? { starting_after: cursor } : {}) });
    if (!Array.isArray(result?.data)) throw new Error('Stripe returned an incomplete list.');
    data.push(...result.data);
    if (!result.has_more) return data;
    const next = objectId(result.data.at(-1));
    if (!next || next === cursor) throw new Error('Stripe returned an invalid pagination cursor.');
    cursor = next;
  }
  throw new Error('Stripe reconciliation exceeded its bounded page limit.');
}

function scopeMatches(order, scope) {
  return order?.provider === 'stripe' && order.eventId === scope.externalEventId &&
    order.stripeAccountId === scope.stripeAccountId && order.livemode === scope.livemode;
}

function metadataMatches(metadata, order) {
  return metadata?.eventRunnerOrderId === order.id && metadata.eventRunnerEventId === order.eventId &&
    metadata.eventRunnerAttemptId === order.attemptId;
}

const INVOICE_ID = /^inv_[a-z0-9]{16,40}$/;

/**
 * The invoice pay link policy (issue #519, ADR 0004 amendment): hosted
 * Checkout, card only, one line of quantity one at a fixed amount, no
 * tax, promotion, adaptive price, transfer or fee, and metadata that names
 * one invoice of this event and one pay link. No ticket order id.
 */
function isInvoiceCheckoutRequest(params, scope) {
  const metadata = params?.metadata;
  const intent = params?.payment_intent_data;
  const line = Array.isArray(params?.line_items) && params.line_items.length === 1 ? params.line_items[0] : null;
  const price = line?.price_data;
  return params?.mode === 'payment' && params.ui_mode === 'hosted_page'
    && params.allowed_payment_method_types?.length === 1 && params.allowed_payment_method_types[0] === 'card'
    && params.adaptive_pricing?.enabled === false && params.automatic_tax?.enabled === false
    && params.allow_promotion_codes === false
    && line?.quantity === 1 && !line.price && Number.isSafeInteger(price?.unit_amount) && price.unit_amount > 0
    && typeof price.currency === 'string' && typeof price.product_data?.name === 'string'
    && typeof metadata?.eventRunnerInvoiceId === 'string' && INVOICE_ID.test(metadata.eventRunnerInvoiceId)
    && metadata.eventRunnerEventId === scope.externalEventId && Boolean(safeId(metadata.eventRunnerPayLinkId))
    && metadata.eventRunnerOrderId === undefined && metadata.eventRunnerAttemptId === undefined
    && params.client_reference_id === metadata.eventRunnerInvoiceId
    && intent?.metadata?.eventRunnerInvoiceId === metadata.eventRunnerInvoiceId
    && intent.metadata.eventRunnerEventId === metadata.eventRunnerEventId
    && intent.metadata.eventRunnerPayLinkId === metadata.eventRunnerPayLinkId
    && intent.metadata.eventRunnerOrderId === undefined
    && !intent.transfer_data && !intent.on_behalf_of && !intent.application_fee_amount
    && !params.subscription_data && !params.discounts;
}

function createStripeProvider({ env = process.env, db, getConfig, stripeClient, now = () => new Date() } = {}) {
  const scope = stripeScope(env);
  let client = null;
  let accountCheck = null;
  const sdk = () => (client ||= createStripeClient({ env, stripeClient }));

  // With no Connect account header, GET /v1/account is the account owning
  // the configured key. An account name in metadata cannot establish this.
  async function assertAccount() {
    if (!accountCheck) {
      accountCheck = Promise.resolve().then(async () => {
        const account = await sdk().accounts.retrieve();
        if (account?.id !== scope.stripeAccountId) throw new Error('Stripe account does not match deployment.');
        return account.id;
      }).catch((err) => { accountCheck = null; throw err; });
    }
    return accountCheck;
  }

  const provider = {
    name: 'stripe',
    ...scope,
    // This is a local configuration check, not a Stripe request or a claim
    // that the merchant account has passed its separate launch checks.
    hasPaymentCredentials: Boolean(stripeClient) || hasPaymentCredentials(env, scope.livemode),
    ownsTicketPersistence: true,
    requiresRawBody: true,
    webhookEventTypes: WEBHOOK_EVENTS,

    async createCheckoutSession(params, { idempotencyKey } = {}) {
      if (!idempotencyKey || params?.mode !== 'payment' || params.ui_mode !== 'hosted_page' ||
          params.allowed_payment_method_types?.length !== 1 || params.allowed_payment_method_types[0] !== 'card' ||
          params.metadata?.eventRunnerEventId !== scope.externalEventId ||
          !safeId(params.metadata?.eventRunnerOrderId) || !safeId(params.metadata?.eventRunnerAttemptId) ||
          params.payment_intent_data?.metadata?.eventRunnerOrderId !== params.metadata.eventRunnerOrderId ||
          params.payment_intent_data?.metadata?.eventRunnerEventId !== scope.externalEventId ||
          params.payment_intent_data?.metadata?.eventRunnerAttemptId !== params.metadata.eventRunnerAttemptId ||
          params.payment_intent_data?.transfer_data || params.payment_intent_data?.on_behalf_of ||
          params.payment_intent_data?.application_fee_amount || params.allow_promotion_codes === true ||
          params.automatic_tax?.enabled === true || params.adaptive_pricing?.enabled !== false) {
        throw new Error('Checkout request does not match the configured hosted, card-only ticket policy.');
      }
      await assertAccount();
      return sdk().checkout.sessions.create(params, { idempotencyKey });
    },

    /** A hosted card page for one issued invoice (#519); see isInvoiceCheckoutRequest. */
    async createInvoiceCheckoutSession(params, { idempotencyKey } = {}) {
      if (!idempotencyKey || !isInvoiceCheckoutRequest(params, scope)) {
        throw new Error('Checkout request does not match the invoice pay link policy.');
      }
      await assertAccount();
      return sdk().checkout.sessions.create(params, { idempotencyKey });
    },

    async retrieveCheckoutSession(sessionId) {
      if (!safeId(sessionId)) throw new Error('Invalid Checkout Session identifier.');
      await assertAccount();
      return sdk().checkout.sessions.retrieve(sessionId);
    },

    async expireCheckoutSession(sessionId) {
      if (!safeId(sessionId)) throw new Error('Invalid Checkout Session identifier.');
      await assertAccount();
      return sdk().checkout.sessions.expire(sessionId);
    },

    async readFinancialState(order) {
      if (!scopeMatches(order, scope)) throw new Error('Order is outside the configured Stripe scope.');
      await assertAccount();
      const session = await sdk().checkout.sessions.retrieve(order.stripeSessionId);
      const lineItems = await allProviderPages(
        (params) => sdk().checkout.sessions.listLineItems(session.id, params), { expand: ['data.price.product'] },
      );
      const paymentIntentId = objectId(session.payment_intent);
      let paymentIntent = null;
      let refunds = [];
      let disputes = [];
      if (paymentIntentId) {
        paymentIntent = await sdk().paymentIntents.retrieve(paymentIntentId);
        refunds = await allProviderPages((params) => sdk().refunds.list(params), { payment_intent: paymentIntentId });
        disputes = await allProviderPages((params) => sdk().disputes.list(params), { payment_intent: paymentIntentId });
        // Refund/dispute objects are not deleted. An eventually consistent
        // list must not erase a financial record already observed here.
        for (const known of order.refunds || []) {
          if (!refunds.some((item) => item.id === known.id)) refunds.push(await sdk().refunds.retrieve(known.id));
        }
        for (const known of order.disputes || []) {
          if (!disputes.some((item) => item.id === known.id)) disputes.push(await sdk().disputes.retrieve(known.id));
        }
      }
      return { session, lineItems, paymentIntent, refunds, disputes };
    },

    async verifyWebhook(rawBody, headers) {
      if (!Buffer.isBuffer(rawBody) || !rawBody.length) return { valid: false, reason: 'raw_body_required' };
      const signature = headers?.['stripe-signature'] || headers?.['Stripe-Signature'];
      const secret = env.TICKETING_WEBHOOK_SECRET?.trim();
      if (typeof signature !== 'string' || !secret) return { valid: false, reason: 'verification_failed' };
      let event;
      try { event = sdk().webhooks.constructEvent(rawBody, signature, secret); }
      catch { return { valid: false, reason: 'verification_failed' }; }
      if (!WEBHOOK_EVENTS.includes(event.type)) return { valid: true, eventType: 'ignored', deliveryId: safeId(event.id) };
      if (event.livemode !== scope.livemode || (event.account && event.account !== scope.stripeAccountId)) {
        return { valid: false, reason: 'wrong_event' };
      }
      const policy = await checkDemoWrites({ db });
      throwIfDemoPolicyUnavailable(policy);
      if (!policy.ok) return { valid: true, eventType: 'ignored', deliveryId: safeId(event.id) };
      await assertAccount();
      // Standalone account events omit event.account. Retrieve the event
      // using this account's key before trusting its order association.
      const currentEvent = await sdk().events.retrieve(event.id);
      if (currentEvent?.id !== event.id || currentEvent.type !== event.type ||
          currentEvent.livemode !== scope.livemode ||
          (currentEvent.account && currentEvent.account !== scope.stripeAccountId)) {
        return { valid: false, reason: 'wrong_event' };
      }
      const object = currentEvent.data?.object;
      const dedupScope = `${scope.stripeAccountId}:${scope.livemode}:${scope.externalEventId}:${event.id}`;
      const deliveryId = `stripe_${createHash('sha256').update(dedupScope).digest('hex')}`;
      // An invoice pay link (#519). Its Session events go to the invoice;
      // the invoice step reads the Session again before it changes anything.
      // Its PaymentIntent, charge, refund and dispute events are
      // acknowledged only: the Session event records the payment.
      if (object?.metadata?.eventRunnerInvoiceId !== undefined && object.metadata.eventRunnerOrderId === undefined) {
        const invoiceId = typeof object.metadata.eventRunnerInvoiceId === 'string' && INVOICE_ID.test(object.metadata.eventRunnerInvoiceId)
          ? object.metadata.eventRunnerInvoiceId : null;
        if (!invoiceId || object.metadata.eventRunnerEventId !== scope.externalEventId) return { valid: false, reason: 'wrong_event' };
        if (!event.type.startsWith('checkout.session.')) return { valid: true, eventType: 'ignored', deliveryId };
        const sessionId = safeId(object.id);
        if (!sessionId) return { valid: false, reason: 'wrong_event' };
        return { valid: true, deliveryId, eventType: 'invoice.checkout', resourceId: invoiceId, sessionId };
      }
      let metadata = object?.metadata;
      let paymentIntentId = event.type.startsWith('payment_intent.') ? objectId(object) : objectId(object?.payment_intent);
      if (!metadata?.eventRunnerOrderId && !event.type.startsWith('checkout.session.')) {
        if (!paymentIntentId && objectId(object?.charge)) {
          const charge = await sdk().charges.retrieve(objectId(object.charge));
          paymentIntentId = objectId(charge?.payment_intent);
        }
        if (paymentIntentId) metadata = (await sdk().paymentIntents.retrieve(paymentIntentId))?.metadata;
        if (metadata?.eventRunnerInvoiceId !== undefined && metadata.eventRunnerOrderId === undefined) {
          return { valid: true, eventType: 'ignored', deliveryId };
        }
      }
      const orderId = safeId(metadata?.eventRunnerOrderId);
      if (!orderId || !db) return { valid: false, reason: 'wrong_event' };
      const order = (await db.collection('ticket_orders').doc(orderId).get()).data();
      if (!scopeMatches(order, scope) || !metadataMatches(metadata, order) || order.id !== orderId ||
          (order.stripePaymentIntentId && paymentIntentId && order.stripePaymentIntentId !== paymentIntentId)) {
        return { valid: false, reason: 'wrong_event' };
      }
      if (event.type.startsWith('checkout.session.')) {
        if (order.stripeSessionId && order.stripeSessionId !== object.id) return { valid: false, reason: 'wrong_event' };
        // A completion can beat the create response. Recover that exact
        // durable attempt without treating a caller's Session ID as proof.
        if (!order.stripeSessionId) {
          await db.runTransaction(async (tx) => {
            const policy = await checkDemoWrites({ db, transaction: tx });
            throwIfDemoPolicyUnavailable(policy);
            if (!policy.ok) return;
            const ref = db.collection('ticket_orders').doc(orderId);
            const attemptRef = db.collection('ticket_payment_attempts').doc(order.attemptId);
            const snap = await tx.get(ref);
            const attempt = await tx.get(attemptRef);
            const live = snap.data();
            if (!scopeMatches(live, scope) || !metadataMatches(metadata, live) || !attempt.exists ||
                attempt.data()?.orderId !== orderId ||
                (live.stripeSessionId && live.stripeSessionId !== object.id) ||
                (attempt.data()?.stripeSessionId && attempt.data().stripeSessionId !== object.id)) {
              throw new Error('Stripe webhook could not recover its payment attempt.');
            }
            const at = now();
            tx.set(ref, { stripeSessionId: object.id, updatedAt: at }, { merge: true });
            tx.set(attemptRef, { stripeSessionId: object.id, updatedAt: at }, { merge: true });
          });
        }
      }
      return { valid: true, deliveryId, eventType: 'order.updated', resourceId: orderId };
    },

    async reconcileOrder(orderId) {
      const { reconcileStripeOrder } = require('../stripeReconcile.cjs');
      return reconcileStripeOrder({ db, provider, orderId, now });
    },

    async fetchOrder(orderId) { return provider.reconcileOrder(orderId); },

    async lookupByOrderNumber(orderId, email) {
      if (!safeId(orderId) || !db || typeof email !== 'string') return null;
      const before = (await db.collection('ticket_orders').doc(orderId).get()).data();
      if (!scopeMatches(before, scope) || !before.seats?.some((seat) => seat.email === email.trim().toLowerCase())) return null;
      const result = await provider.reconcileOrder(orderId);
      return result.tickets.filter((ticket) => ticket.email === email.trim().toLowerCase());
    },

    async listTickets({ pageToken } = {}) {
      if (!db) throw new Error('Stripe ticket reconciliation requires a database.');
      let query = db.collection('ticket_orders').where('provider', '==', 'stripe').orderBy('id').limit(ORDER_PAGE_SIZE);
      if (pageToken) {
        if (!safeId(pageToken)) throw new Error('Invalid Stripe ticket page token.');
        query = query.startAfter(pageToken);
      }
      const page = await query.get();
      const tickets = [];
      for (const doc of page.docs) {
        if (!scopeMatches(doc.data(), scope)) continue;
        const result = await provider.reconcileOrder(doc.id);
        if (result.complete !== true) throw new Error('An order is still being reconciled; retry the sync.');
        tickets.push(...result.tickets);
      }
      return { tickets, ticketsPersisted: true, nextPageToken: page.size === ORDER_PAGE_SIZE ? page.docs.at(-1).id : null };
    },

    async getRegistrationPrompt(ctx = {}) {
      // Registration prompt entitlement skips apply to every provider and
      // trigger, before configuration reads or any delivery onceKey is used.
      if (ctx?.isSpeaker === true || ctx?.hasClaimedTicket === true) {
        return { send: false, templateId: null, ctaLabel: null, ctaUrl: null, action: null, bodyNote: null };
      }
      const config = typeof getConfig === 'function' ? await getConfig() : null;
      const publicUrl = env.EVENT_PUBLIC_URL?.trim();
      let origin;
      try { origin = new URL(publicUrl); } catch { return { send: false }; }
      if (origin.protocol !== 'https:' || config?.features?.ticketing === false) return { send: false };
      return { send: true, templateId: 'ticket.get_ticket', ctaLabel: 'Choose tickets',
        ctaUrl: new URL('/tickets', origin).href, action: 'purchase', bodyNote: null };
    },

    async registerWebhook({ callbackUrl }) {
      await assertAccount();
      let url;
      try { url = new URL(callbackUrl); } catch { throw new Error('A valid HTTPS webhook URL is required.'); }
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
        throw new Error('A valid HTTPS webhook URL without credentials or query parameters is required.');
      }
      const endpoints = await allProviderPages((params) => sdk().webhookEndpoints.list(params), {});
      const endpoint = endpoints.find((item) => item.url === url.href && item.status === 'enabled' &&
        item.livemode === scope.livemode && WEBHOOK_EVENTS.every((type) => item.enabled_events?.includes(type)));
      if (!endpoint || !env.TICKETING_WEBHOOK_SECRET?.trim()) {
        throw new Error('Create a Stripe snapshot webhook endpoint with the documented event types, then bind its generated signing secret as TICKETING_WEBHOOK_SECRET and retry verification.');
      }
      return { webhookId: endpoint.id };
    },
  };
  return provider;
}

module.exports = {
  createStripeProvider, createStripeClient, stripeScope,
  internals: { WEBHOOK_EVENTS, scopeMatches, metadataMatches, objectId, safeId, allProviderPages, isInvoiceCheckoutRequest },
};
