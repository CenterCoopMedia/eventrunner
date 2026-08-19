'use strict';

/**
 * The one send path (spec §3.1). Deliberately minimal: no queue collection,
 * no scheduler, no chunking, no pacing. A managed transactional provider
 * owns queuing, retry shaping, and suppression.
 *
 * Core responsibilities live here, not in adapters:
 *   - resolve from/replyTo from config/event.sender
 *   - bounded retry on adapter-REPORTED retryable statuses only
 *   - send-once claims (onceKey) in email_claims
 *   - exactly one sent_emails audit row per send() call
 */

const crypto = require('node:crypto');

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [500, 2000];
const BODY_STORE_LIMIT = 100 * 1024; // 100 KB, per body (spec §3.1)

/** @param {string} onceKey */
function claimIdForOnceKey(onceKey) {
  return crypto.createHash('sha256').update(onceKey, 'utf8').digest('hex');
}

/**
 * Retry ONLY on adapter-reported retryable statuses: 5xx, and 429 with a
 * provider-supplied retry hint. Never a thrown exception — a throw is
 * ambiguous about whether the message was accepted (spec §3.1).
 * @param {{ status: string, providerStatus?: number, retryAfterMs?: number }} result
 */
function isRetryable(result) {
  if (!result || result.status !== 'failed') return false;
  const status = result.providerStatus;
  if (typeof status !== 'number') return false;
  if (status >= 500 && status <= 599) return true;
  if (status === 429 && typeof result.retryAfterMs === 'number') return true;
  return false;
}

/** @param {string|undefined} body @returns {{ value: string|null, truncated: boolean }} */
function truncateForAudit(body) {
  if (typeof body !== 'string') return { value: null, truncated: false };
  if (Buffer.byteLength(body, 'utf8') <= BODY_STORE_LIMIT) {
    return { value: body, truncated: false };
  }
  // Truncate on a byte budget without splitting a code point.
  const buf = Buffer.from(body, 'utf8').subarray(0, BODY_STORE_LIMIT);
  return { value: buf.toString('utf8').replace(/�+$/, ''), truncated: true };
}

/** Firestore ALREADY_EXISTS is gRPC code 6. @param {Error & {code?: number|string}} err */
function isAlreadyExists(err) {
  return err?.code === 6 || err?.code === 'already-exists' ||
    /ALREADY_EXISTS/i.test(String(err?.message || ''));
}

/**
 * Build the email core around injected dependencies so tests drive it with
 * fakes and no emulator.
 *
 * @param {{
 *   db: FirebaseFirestore.Firestore,
 *   provider: import('./providers/index.cjs').EmailProvider,
 *   getConfig: () => Promise<object>,
 *   sleep?: (ms: number) => Promise<void>,
 *   log?: Pick<Console, 'warn'|'error'|'info'>,
 * }} deps
 */
function createEmailCore({ db, provider, getConfig, sleep, log = console }) {
  const wait = sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

  /**
   * @param {object} message EmailMessage (spec §3.1): { to, from?, replyTo?,
   *   subject, text?, html?, headers?, tag?, onceKey?, idempotencyKey?,
   *   source?, storeRendered? }
   * @returns {Promise<object>} EmailSendResult
   */
  /** One sent_emails row per send() call, whatever the outcome. */
  async function writeAuditRow(message, fromEmail, toEmail, outcome) {
    const bodyStored = message.storeRendered !== false;
    const html = bodyStored ? truncateForAudit(message.html) : { value: null, truncated: false };
    const text = bodyStored ? truncateForAudit(message.text) : { value: null, truncated: false };
    try {
      await db.collection('sent_emails').add({
        to: toEmail,
        from: fromEmail,
        subject: message.subject || null,
        templateId: message.tag || null,
        providerMessageId: outcome.providerMessageId,
        status: outcome.status,
        providerStatus: outcome.providerStatus ?? null,
        error: outcome.error ?? null,
        retries: outcome.retries,
        bodyStored,
        html: html.value,
        text: text.value,
        bodyTruncated: html.truncated || text.truncated,
        source: message.source || null,
        sentAt: new Date(),
      });
    } catch (err) {
      // The audit row must not turn a delivered mail into a caller-visible
      // failure; log and continue.
      log.error('sent_emails audit write failed', err);
    }
  }

  async function send(message) {
    const config = await getConfig();
    const sender = config?.event?.sender || {};

    const toEmail = typeof message.to === 'string' ? message.to : message.to?.email;
    if (!toEmail) {
      // Even a caller integration bug leaves an audit record — an invisible
      // failed send is how operators lose mail-delivery incidents.
      const outcome = { providerMessageId: null, status: 'failed', error: 'no recipient', retries: 0 };
      await writeAuditRow(message, null, null, outcome);
      return outcome;
    }

    // Send-once claim, written BEFORE the send and never rolled back —
    // a rolled-back claim plus repeated webhook deliveries is how a
    // recipient gets the same message a dozen times (spec §3.1).
    if (message.onceKey) {
      const ref = db.collection('email_claims').doc(claimIdForOnceKey(message.onceKey));
      try {
        await ref.create({
          onceKey: message.onceKey,
          source: message.source || null,
          createdAt: new Date(),
        });
      } catch (err) {
        if (isAlreadyExists(err)) {
          return { providerMessageId: null, status: 'sent', skipped: true, retries: 0 };
        }
        throw err;
      }
    }

    const fullMessage = {
      ...message,
      to: toEmail,
      from: message.from || { email: sender.email, name: sender.name },
      replyTo: message.replyTo || sender.replyTo || undefined,
      // Tier B stream selection (config/providers.email.messageStream)
      // reaches the adapter here; a per-message value wins.
      messageStream: message.messageStream
        ?? config?.providers?.email?.messageStream
        ?? undefined,
    };

    let result = null;
    let attempts = 0;
    while (attempts < MAX_ATTEMPTS) {
      attempts += 1;
      try {
        result = await provider.send(fullMessage);
      } catch (err) {
        // Never retry a throw: ambiguous about acceptance.
        result = {
          providerMessageId: null,
          status: 'failed',
          error: String(err?.message || err),
        };
        break;
      }
      if (!isRetryable(result) || attempts >= MAX_ATTEMPTS) break;
      await wait(BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)]);
    }

    const retries = attempts - 1;
    const outcome = {
      providerMessageId: result.providerMessageId ?? null,
      status: result.status === 'sent' ? 'sent' : 'failed',
      providerStatus: result.providerStatus,
      error: result.error,
      retries,
    };

    await writeAuditRow(message, fullMessage.from?.email || null, toEmail, outcome);
    return outcome;
  }

  return { send };
}

/**
 * Delivery-event ingest (spec §3.1): authenticates through the adapter,
 * parses events, and patches matching sent_emails rows. Writes nothing
 * else and creates no collection. Returns 401 on a failed check and never
 * falls back to accepting unauthenticated deliveries.
 *
 * @param {{ db: FirebaseFirestore.Firestore,
 *           provider: object, log?: Pick<Console, 'warn'|'error'> }} deps
 * @returns {(req: any, res: any) => Promise<void>}
 */
function createDeliveryWebhookHandler({ db, provider, log = console }) {
  return async function emailDeliveryWebhook(req, res) {
    if (req.method !== 'POST') {
      res.set('Allow', 'POST');
      res.status(405).json({ error: { code: 'method-not-allowed', message: 'Use POST.' } });
      return;
    }
    const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
    const headers = req.headers || {};
    if (typeof provider.verifyDeliveryWebhook !== 'function' ||
        !provider.verifyDeliveryWebhook(rawBody, headers)) {
      res.status(401).json({ error: { code: 'unauthorized', message: 'Verification failed.' } });
      return;
    }

    let events = null;
    try {
      events = provider.parseDeliveryEvent ? provider.parseDeliveryEvent(req.body, headers) : null;
    } catch (err) {
      log.warn('parseDeliveryEvent threw', err);
    }
    if (!Array.isArray(events)) {
      res.status(400).json({ error: { code: 'bad-request', message: 'Unrecognized payload.' } });
      return;
    }

    let patched = 0;
    for (const event of events) {
      if (!event?.providerMessageId) continue;
      const snap = await db
        .collection('sent_emails')
        .where('providerMessageId', '==', event.providerMessageId)
        .limit(1)
        .get();
      if (snap.empty) continue;
      const ref = snap.docs[0].ref;
      const occurredAt = event.occurredAt || new Date().toISOString();
      // Providers retry and deliver out of order; a replayed older event
      // must not overwrite a newer bounce/complaint. The compare-and-set
      // runs in a transaction so two concurrent deliveries cannot
      // interleave between read and write.
      const applied = await db.runTransaction(async (tx) => {
        const doc = await tx.get(ref);
        const existing = doc.data()?.deliveryUpdatedAt;
        if (typeof existing === 'string' && existing >= occurredAt) return false;
        tx.update(ref, {
          deliveryStatus: event.type,
          deliveryUpdatedAt: occurredAt,
          bounceReason: event.reason || null,
        });
        return true;
      });
      if (applied) patched += 1;
    }
    res.status(200).json({ processed: events.length, patched });
  };
}

/**
 * Secrets each provider's delivery ingest needs at runtime (spec §2.1).
 * Bound conditionally on the analysis-time EVENT_EMAIL_PROVIDER value —
 * binding a secret the deployment never created would fail the deploy.
 * A postmark deployment must create EMAIL_WEBHOOK_BASIC_AUTH in Secret
 * Manager before deploying this function (it IS the delivery ingest).
 */
const SECRETS_BY_PROVIDER = {
  postmark: ['EMAIL_PROVIDER_API_KEY', 'EMAIL_WEBHOOK_BASIC_AUTH'],
  webhook: ['EMAIL_WEBHOOK_URL', 'EMAIL_WEBHOOK_SECRET'],
  console: [],
};

/** Deployable exports (spec §1.3): emailDeliveryWebhook only. */
function buildHandlers() {
  const { onRequest } = require('firebase-functions/v2/https');
  const { defineSecret } = require('firebase-functions/params');
  const providerName = (process.env.EVENT_EMAIL_PROVIDER || '').trim();
  const secrets = (SECRETS_BY_PROVIDER[providerName] || []).map(defineSecret);
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';
  return {
    emailDeliveryWebhook: onRequest({ region, secrets }, async (req, res) => {
      const { getDb } = require('../core/firestore.cjs');
      const { getEmailProvider } = require('./providers/index.cjs');
      const handler = createDeliveryWebhookHandler({
        db: getDb(),
        provider: getEmailProvider({ env: process.env }),
      });
      await handler(req, res);
    }),
  };
}

module.exports = {
  createEmailCore,
  createDeliveryWebhookHandler,
  // Lazily built so requiring this module in tests never pulls in
  // firebase-functions.
  get handlers() {
    return buildHandlers();
  },
  internals: {
    isRetryable,
    truncateForAudit,
    claimIdForOnceKey,
    isAlreadyExists,
    MAX_ATTEMPTS,
    BACKOFF_MS,
    BODY_STORE_LIMIT,
  },
};
