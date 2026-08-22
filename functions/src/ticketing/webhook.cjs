'use strict';

/**
 * `ticketingWebhook` — the ONLY place a ticketing webhook is processed
 * (spec §3.3, "centralized dedup"). It does no ticket work at all: it
 * verifies the delivery, claims it, enqueues the order, and answers. All
 * reading of the provider happens later, in sync.cjs's drain, because the
 * provider's own APIs are eventually consistent.
 *
 * THE ONE TRANSACTION (§3.3 step 2). The delivery claim
 * (`ticket_webhook_deliveries/{deliveryId}`, a create()) and the queue row
 * (`ticket_sync_queue/{orderId}`, a set()) commit together, before the 200.
 * They must not be two writes: claiming first and enqueuing second loses
 * the order permanently if the container dies in between, because every
 * retry of that delivery then sees the claim and acknowledges without
 * work. A create() that fails its precondition is a duplicate delivery —
 * 200, no work.
 *
 * Two distinct deliveries about the same order (`order.placed` then
 * `order.updated`) collapse onto ONE queue row keyed by orderId. That is
 * the intended behavior, not a collision.
 *
 * UNAUTHENTICATED-ENDPOINT HARDENING, following the precedents in
 * email/send.cjs's emailDeliveryWebhook and telemetry/clientErrors.cjs:
 *   • POST only; body size capped before anything else touches it.
 *   • Verification is the adapter's job and is required — there is no
 *     unverified-acceptance fallback.
 *   • One generic refusal body per class. The response never echoes
 *     request content and never says WHY verification failed, so it
 *     cannot be used as a signature or delivery-id oracle. (The
 *     duplicate/enqueued distinction is visible only to a caller that has
 *     already produced a valid signature.)
 *   • Every provider-supplied identifier is validated before it becomes a
 *     document id (ticketing/index.cjs isSafeDocId).
 *
 * No rate-limit collection here, deliberately, unlike logClientError:
 * that endpoint persists a document for any caller, so it needs a bucket
 * to bound durable writes. This one writes nothing at all until a
 * cryptographic check passes, and §4.1 enumerates the collections that
 * exist — adding a fourth ticketing collection to bound what the
 * signature check already bounds is not a trade worth making.
 */

const {
  internals: { WEBHOOK_DELIVERIES, SYNC_QUEUE, QUEUE_PENDING, QUEUE_EXHAUSTED, safeDocId },
} = require('./index.cjs');

/**
 * Generous for a webhook envelope (a full order payload with attendees),
 * small enough that one request cannot be used to push an arbitrary
 * payload through an unauthenticated endpoint.
 */
const MAX_BODY_BYTES = 128 * 1024;

/**
 * The reason string a provider returns from `verifyWebhook` for a
 * correctly signed delivery about an event this deployment is not
 * configured for. §3.3 step 1 answers those with "200 + ignored" so the
 * provider stops retrying a misconfiguration, instead of a 401 that looks
 * like a broken signature and gets retried for days.
 */
const WRONG_EVENT_REASON = 'wrong_event';

/** Event types that carry order work. Anything else is acknowledged and ignored. */
const ACTIONABLE_EVENT_TYPES = new Set(['order.placed', 'order.updated', 'attendee.updated']);

/**
 * A create() whose document already exists. The Admin SDK reports
 * ALREADY_EXISTS (gRPC 6) for a plain create and FAILED_PRECONDITION
 * (gRPC 9) when the precondition is evaluated at transaction commit —
 * §3.3 names the latter. Both mean the same thing here: a delivery we
 * have already claimed.
 *
 * @param {Error & { code?: number|string }} err
 */
function isDuplicateClaim(err) {
  if (!err) return false;
  if (err.code === 6 || err.code === 9) return true;
  if (err.code === 'already-exists' || err.code === 'failed-precondition') return true;
  return /ALREADY_EXISTS|FAILED_PRECONDITION/i.test(String(err.message || ''));
}

/** @param {object} req @returns {Buffer} the exact bytes the signature covers */
function rawBodyOf(req) {
  if (Buffer.isBuffer(req?.rawBody)) return req.rawBody;
  if (typeof req?.rawBody === 'string') return Buffer.from(req.rawBody, 'utf8');
  try {
    return Buffer.from(JSON.stringify(req?.body ?? {}), 'utf8');
  } catch {
    return Buffer.alloc(0);
  }
}

/**
 * Claim the delivery and enqueue its order in ONE transaction (§3.3 step 2).
 *
 * The existing queue row is READ inside the transaction so that:
 *   • a pending row keeps its spent attempts — a fresh delivery about an
 *     order already being retried must not reset the attempt cap and turn
 *     the 6-attempt bound into an unbounded loop;
 *   • an EXHAUSTED row is re-armed. A new delivery is new information
 *     (`order.updated` is exactly the signal that the data finally
 *     landed), the operator has already been alerted once, and the
 *     alternative — ignoring it — is the silent drop this issue exists to
 *     remove.
 * Reading it also puts the row in the transaction's read set, so two
 * concurrent deliveries about one order serialize instead of interleaving.
 *
 * @param {{ db: object, deliveryId: string, orderId: string, eventType: string,
 *           providerName: string, now?: () => Date }} deps
 * @returns {Promise<{ enqueued: boolean, duplicate: boolean }>}
 */
async function claimAndEnqueue({ db, deliveryId, orderId, eventType, providerName, now = () => new Date() }) {
  const claimRef = db.collection(WEBHOOK_DELIVERIES).doc(deliveryId);
  const queueRef = db.collection(SYNC_QUEUE).doc(orderId);
  try {
    await db.runTransaction(async (tx) => {
      const existing = await tx.get(queueRef);
      const prior = existing.exists ? existing.data() : null;
      const at = now();

      // The claim is queued FIRST so that a duplicate fails before the
      // queue write is applied. (Real Firestore commits the whole
      // transaction or none of it; ordering costs nothing there and makes
      // the in-memory fake behave the same way.)
      tx.create(claimRef, {
        deliveryId,
        orderId,
        eventType,
        provider: providerName,
        receivedAt: at,
      });

      const keepAttempts = prior?.status === QUEUE_PENDING && Number.isInteger(prior.attempts)
        ? prior.attempts
        : 0;
      tx.set(queueRef, {
        orderId,
        status: QUEUE_PENDING,
        attempts: keepAttempts,
        readyAt: at,
        provider: providerName,
        firstEnqueuedAt: prior?.firstEnqueuedAt || at,
        lastDeliveryId: deliveryId,
        lastEventType: eventType,
        updatedAt: at,
        // A re-armed row is no longer exhausted; clear the forensics of
        // the previous give-up so the drain does not read a stale error.
        ...(prior?.status === QUEUE_EXHAUSTED ? { exhaustedAt: null, lastError: null } : {}),
      }, { merge: true });
    });
    return { enqueued: true, duplicate: false };
  } catch (err) {
    if (isDuplicateClaim(err)) return { enqueued: false, duplicate: true };
    throw err;
  }
}

/**
 * @param {{ db: object, provider: object, now?: () => Date,
 *           log?: Pick<Console,'warn'|'error'> }} deps
 * @returns {(req: object, res: object) => Promise<void>}
 */
function createTicketingWebhookHandler({ db, provider, now = () => new Date(), log = console }) {
  return async function ticketingWebhook(req, res) {
    if (req.method !== 'POST') {
      res.set('Allow', 'POST');
      res.status(405).json({ error: { code: 'method-not-allowed', message: 'Use POST.' } });
      return;
    }

    const rawBody = rawBodyOf(req);
    if (rawBody.length > MAX_BODY_BYTES) {
      res.status(413).json({ error: { code: 'payload-too-large', message: 'Delivery is too large.' } });
      return;
    }

    let verification = null;
    try {
      verification = await provider.verifyWebhook(rawBody, req.headers || {});
    } catch (err) {
      // A throw is ambiguous — a malformed body and an unreachable key
      // store look the same from here. 500 so the provider retries; the
      // dedup claim makes that retry free.
      log.error('ticketing: verifyWebhook threw', err);
      res.status(500).json({ error: { code: 'internal', message: 'Delivery could not be processed.' } });
      return;
    }

    if (!verification?.valid) {
      // Wrong-event deliveries are acknowledged, not refused: a 401 here
      // is a misconfiguration the provider would retry for days (§3.3).
      if (verification?.reason === WRONG_EVENT_REASON) {
        res.status(200).json({ ok: true, ignored: WRONG_EVENT_REASON });
        return;
      }
      // One body for every other refusal: no signature oracle.
      res.status(401).json({ error: { code: 'unauthorized', message: 'Verification failed.' } });
      return;
    }

    const deliveryId = safeDocId(verification.deliveryId);
    const orderId = safeDocId(verification.resourceId);
    const eventType = typeof verification.eventType === 'string' ? verification.eventType : 'unknown';

    if (!deliveryId) {
      // Verified but unkeyable: without a stable delivery id there is no
      // dedup, and processing it would re-enqueue on every retry. Say so
      // in the log, acknowledge to the provider.
      log.warn('ticketing: verified delivery carried no usable deliveryId');
      res.status(200).json({ ok: true, ignored: 'no_delivery_id' });
      return;
    }
    if (!ACTIONABLE_EVENT_TYPES.has(eventType) || !orderId) {
      // Nothing to fetch (an unknown event type, or an event with no
      // derivable order). Acknowledged so the provider stops retrying.
      res.status(200).json({ ok: true, ignored: 'not_actionable' });
      return;
    }

    let outcome = null;
    try {
      outcome = await claimAndEnqueue({
        db, deliveryId, orderId, eventType, providerName: provider.name, now,
      });
    } catch (err) {
      // Never acknowledge work that was not committed — a 5xx makes the
      // provider redeliver, and the unclaimed delivery id makes the
      // redelivery do the work.
      log.error('ticketing: webhook claim/enqueue failed', err);
      res.status(500).json({ error: { code: 'internal', message: 'Delivery could not be processed.' } });
      return;
    }

    res.status(200).json({ ok: true, ...outcome });
  };
}

/** Deployable exports (spec §1.3): ticketingWebhook. */
function buildHandlers() {
  const { onRequest } = require('firebase-functions/v2/https');
  const { defineSecret } = require('firebase-functions/params');
  const { ticketingSecretNames } = require('./providers/index.cjs');
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';
  const secrets = ticketingSecretNames(process.env).map(defineSecret);

  return {
    ticketingWebhook: onRequest({ region, secrets }, async (req, res) => {
      // No CORS: a provider's server-to-server POST is not a browser
      // request, and an allow-origin header on a signed webhook endpoint
      // would only invite one.
      const { getDb } = require('../core/firestore.cjs');
      const { getEventConfig } = require('../core/config.cjs');
      const { getTicketingProvider } = require('./providers/index.cjs');
      const db = getDb();
      await createTicketingWebhookHandler({
        db,
        provider: getTicketingProvider({ env: process.env, db, getConfig: () => getEventConfig({ db }) }),
      })(req, res);
    }),
  };
}

module.exports = {
  createTicketingWebhookHandler,
  claimAndEnqueue,
  get handlers() {
    return buildHandlers();
  },
  internals: {
    isDuplicateClaim,
    rawBodyOf,
    MAX_BODY_BYTES,
    WRONG_EVENT_REASON,
    ACTIONABLE_EVENT_TYPES,
  },
};
