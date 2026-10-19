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
 *   - exactly one sent_emails audit row per permitted send() call
 */

const crypto = require('node:crypto');
const { checkDemoWrites, throwIfDemoPolicyUnavailable } = require('../core/demoWrites.cjs');
const { internals: renderInternals } = require('./render.cjs');

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
 * The adapter-bound form of one message: sender, reply-to, stream and the
 * legal footer resolved from config. Shared by send() and sendBatch() so a
 * batch entry is resolved exactly as a single send is.
 *
 * @param {object} message EmailMessage
 * @param {object} config loaded event config
 * @returns {object} the message the adapter receives
 */
function resolveMessage(message, config) {
  const sender = config?.event?.sender || {};
  const fullMessage = {
    ...message,
    // The original string-or-EmailAddress form reaches the adapter so a
    // display name survives; toEmail is for validation and the audit row.
    to: message.to,
    from: message.from || { email: sender.email, name: sender.name },
    replyTo: message.replyTo || sender.replyTo || undefined,
    // Tier B stream selection (config/providers.email.messageStream)
    // reaches the adapter here; a per-message value wins.
    messageStream: message.messageStream
      ?? config?.providers?.email?.messageStream
      ?? undefined,
  };

  // Footer resolution is a core duty (spec §3.1). Rendered mail carries
  // per-body flags derived from the effective template source; any body
  // that does not already carry the footer — an override that dropped
  // the token, the operator email sink, ad-hoc callers — gets the
  // configured legal block appended here.
  const postalHtml = config?.event?.legal?.postalAddressHtml;
  if (typeof postalHtml === 'string' && postalHtml) {
    if (typeof fullMessage.html === 'string' && !message.hasLegalFooterHtml) {
      fullMessage.html += `\n<hr>\n<p>${postalHtml}</p>`;
    }
    if (typeof fullMessage.text === 'string' && !message.hasLegalFooterText) {
      fullMessage.text += `\n\n--\n${renderInternals.stripHtmlToText(postalHtml)}`;
    }
  }
  return fullMessage;
}

/** The recipient address of a message, or null. @param {object} message */
function recipientEmail(message) {
  const to = typeof message?.to === 'string' ? message.to : message?.to?.email;
  return typeof to === 'string' && to ? to : null;
}

/** A batch refused before any claim, audit row, or provider request. */
class EmailBatchError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = 'EmailBatchError';
    this.code = code;
  }
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
   *   source?, storeRendered?, auditRedact? }. `auditRedact` is a list of
   *   { find, replace } pairs applied to the bodies the audit row stores,
   *   never to the mail sent: a per-recipient secret such as a signed
   *   unsubscribe link stays out of the admin-readable log.
   * @returns {Promise<object>} EmailSendResult
   */
  /** One sent_emails row per permitted send() call, whatever the outcome. */
  async function writeAuditRow(message, fromEmail, toEmail, outcome) {
    const bodyStored = message.storeRendered !== false;
    const redact = (body) => (typeof body === 'string' && Array.isArray(message.auditRedact)
      ? message.auditRedact.reduce((out, { find, replace }) => (find ? out.split(find).join(replace ?? '') : out), body)
      : body);
    const html = bodyStored ? truncateForAudit(redact(message.html)) : { value: null, truncated: false };
    const text = bodyStored ? truncateForAudit(redact(message.text)) : { value: null, truncated: false };
    try {
      await db.collection('sent_emails').add({
        to: toEmail,
        from: fromEmail,
        // The bearer-secret rule covers the subject too: a valid auth.otp
        // override may reference {{code}} there, and sent_emails is
        // admin-readable. templateId still identifies the mail.
        subject: bodyStored ? (message.subject || null) : null,
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
    // The final boundary protects every mail caller, including delayed
    // triggers. Refusal must not itself create claims or audit records.
    const policy = await checkDemoWrites({ db });
    // Preserve retryable background-trigger semantics for a transient read
    // failure, rather than acknowledging mail that never reached a provider.
    throwIfDemoPolicyUnavailable(policy);
    if (!policy.ok) {
      return { providerMessageId: null, status: 'failed', error: policy.code, retries: 0 };
    }

    const config = await getConfig();

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

    const fullMessage = resolveMessage(message, config);

    let result = null;
    let attempts = 0;
    let ambiguous = false;
    while (attempts < MAX_ATTEMPTS) {
      attempts += 1;
      try {
        result = await provider.send(fullMessage);
      } catch (err) {
        // Never retry a throw: ambiguous about acceptance.
        ambiguous = true;
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
      // A caller that offers its own retry must not treat this as a refusal:
      // the provider may have accepted the message before the throw.
      ...(ambiguous ? { ambiguous: true } : {}),
    };

    // Audit what was actually handed to the adapter (footer included).
    await writeAuditRow(fullMessage, fullMessage.from?.email || null, toEmail, outcome);
    return outcome;
  }

  /**
   * Batch send (issue #201, ADR §3.1): one provider batch call for many
   * single-recipient messages, one audit row per newly attempted recipient.
   *
   * Every entry needs its own stable `onceKey`. The claims are the replay
   * guard: the provider keeps no idempotency key, so a repeat of the same
   * batch, or a concurrent one, skips every key that already holds a claim.
   * A skipped result says an earlier call claimed the key. It does not prove
   * that the earlier call delivered the message.
   *
   * Refusals that are the caller's to fix (no batch support, a malformed
   * batch, a batch over the provider's limits) throw EmailBatchError before
   * any claim, audit row, or provider request. The demo policy refusal
   * returns one failed result per entry and writes nothing, as send() does.
   *
   * Retry follows send(): only an adapter-reported 5xx, or a 429 with a
   * retry hint, and at most MAX_ATTEMPTS requests. A retry carries only the
   * entries that came back retryable. An entry the provider accepted is
   * never sent again. A throw, or a response the adapter cannot match to an
   * entry, is uncertain: no retry, the claim stays, and the result carries
   * `uncertain: true`.
   *
   * @param {object[]} messages EmailMessage[], one recipient each
   * @returns {Promise<object[]>} one EmailSendResult per entry, in input order
   */
  async function sendBatch(messages) {
    if (!Array.isArray(messages)) {
      throw new EmailBatchError('invalid-batch', 'A batch must be a list of messages.');
    }
    if (messages.length === 0) return [];
    if (typeof provider.sendBatch !== 'function') {
      throw new EmailBatchError(
        'batch-unsupported',
        `The ${provider.name || 'configured'} email provider has no batch send.`,
      );
    }
    const limits = provider.batchLimits || {};
    if (Number.isInteger(limits.maxMessages) && messages.length > limits.maxMessages) {
      throw new EmailBatchError(
        'batch-too-large',
        `A batch may hold at most ${limits.maxMessages} messages; this one holds ${messages.length}.`,
      );
    }
    const seenKeys = new Set();
    messages.forEach((message, index) => {
      if (!recipientEmail(message)) {
        throw new EmailBatchError('invalid-batch', `Message ${index + 1} has no recipient.`);
      }
      if (typeof message.onceKey !== 'string' || message.onceKey.trim() === '') {
        throw new EmailBatchError('invalid-batch', `Message ${index + 1} has no send-once key.`);
      }
      if (seenKeys.has(message.onceKey)) {
        throw new EmailBatchError('invalid-batch', `Message ${index + 1} repeats a send-once key.`);
      }
      seenKeys.add(message.onceKey);
    });

    const policy = await checkDemoWrites({ db });
    throwIfDemoPolicyUnavailable(policy);
    if (!policy.ok) {
      return messages.map(() => ({ providerMessageId: null, status: 'failed', error: policy.code, retries: 0 }));
    }

    const config = await getConfig();
    const resolved = messages.map((message) => resolveMessage(message, config));
    if (typeof provider.checkBatch === 'function') {
      const verdict = provider.checkBatch(resolved);
      if (verdict && verdict.ok === false) {
        throw new EmailBatchError('batch-too-large', verdict.error || 'The batch is over the provider limit.');
      }
    }

    // Claims first, never rolled back (as in send()). A key another call
    // already holds is skipped here and never reaches the provider.
    const results = new Array(messages.length).fill(null);
    const claimed = [];
    await Promise.all(messages.map(async (message, index) => {
      const ref = db.collection('email_claims').doc(claimIdForOnceKey(message.onceKey));
      try {
        await ref.create({ onceKey: message.onceKey, source: message.source || null, createdAt: new Date() });
        claimed.push(index);
      } catch (err) {
        if (isAlreadyExists(err)) {
          results[index] = { providerMessageId: null, status: 'sent', skipped: true, retries: 0 };
          return;
        }
        // A claim that may or may not exist cannot be sent safely.
        results[index] = {
          providerMessageId: null,
          status: 'failed',
          uncertain: true,
          error: `send-once claim failed: ${String(err?.message || err)}`,
          retries: 0,
        };
      }
    }));
    claimed.sort((a, b) => a - b);

    const attemptsOf = new Map();
    let pending = claimed;
    let attempt = 0;
    while (pending.length > 0 && attempt < MAX_ATTEMPTS) {
      attempt += 1;
      let answer;
      try {
        answer = await provider.sendBatch(pending.map((index) => resolved[index]));
      } catch (err) {
        for (const index of pending) {
          attemptsOf.set(index, attempt);
          results[index] = {
            providerMessageId: null,
            status: 'failed',
            uncertain: true,
            error: String(err?.message || err),
          };
        }
        pending = [];
        break;
      }
      const retry = [];
      pending.forEach((index, position) => {
        attemptsOf.set(index, attempt);
        const result = Array.isArray(answer) ? answer[position] : undefined;
        if (!result || typeof result !== 'object') {
          results[index] = {
            providerMessageId: null,
            status: 'failed',
            uncertain: true,
            error: 'The provider response has no result for this message.',
          };
          return;
        }
        results[index] = result;
        if (isRetryable(result) && attempt < MAX_ATTEMPTS) retry.push(index);
      });
      pending = retry;
      if (pending.length > 0) {
        const hint = Math.max(0, ...pending.map((index) => results[index].retryAfterMs ?? 0));
        await wait(Math.max(hint, BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)]));
      }
    }

    // One audit row per newly attempted recipient, after its last attempt.
    const outcomes = await Promise.all(claimed.map(async (index) => {
      const result = results[index];
      const outcome = {
        providerMessageId: result.providerMessageId ?? null,
        status: result.status === 'sent' ? 'sent' : 'failed',
        providerStatus: result.providerStatus,
        error: result.error,
        retries: (attemptsOf.get(index) || 1) - 1,
        ...(result.uncertain ? { uncertain: true } : {}),
      };
      const message = resolved[index];
      await writeAuditRow(message, message.from?.email || null, recipientEmail(message), outcome);
      return [index, outcome];
    }));
    for (const [index, outcome] of outcomes) results[index] = outcome;
    return results;
  }

  return { send, sendBatch };
}

/**
 * Delivery-event ingest (spec §3.1): authenticates through the adapter,
 * parses events, and patches matching sent_emails rows. Writes nothing
 * else except the announcement opt-out it mirrors into
 * `email_suppressions` (issue #490). Returns 401 on a failed check and never
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
      // A provider-side opt-out from an announcement (a Postmark broadcast
      // stream with Postmark unsubscribe handling, issue #490) becomes the
      // application's suppression record too, so the next audience leaves
      // the address out. Transactional rows never write one.
      if (event.type === 'suppressed' && typeof event.recipient === 'string'
          && snap.docs[0].data?.()?.source === 'announcement') {
        const { recordSuppression, suppressionIdFor } = require('../announcements/suppression.cjs');
        try {
          await recordSuppression({ db, id: suppressionIdFor(event.recipient), via: 'provider' });
        } catch (err) {
          log.warn('announcement suppression mirror failed', err);
        }
      }
      const occurredAt = event.occurredAt || new Date().toISOString();
      // Providers retry and deliver out of order; a replayed older event
      // must not overwrite a newer bounce/complaint. The compare-and-set
      // runs in a transaction so two concurrent deliveries cannot
      // interleave between read and write.
      const applied = await db.runTransaction(async (tx) => {
        const doc = await tx.get(ref);
        const existing = doc.data()?.deliveryUpdatedAt;
        // Compare as instants — ISO strings with different offsets do not
        // order lexically. An unparseable incoming timestamp is skipped;
        // an unparseable stored one is overwritten.
        const incomingMs = Date.parse(occurredAt);
        const existingMs = typeof existing === 'string' ? Date.parse(existing) : NaN;
        if (Number.isNaN(incomingMs)) return false;
        if (!Number.isNaN(existingMs) && existingMs >= incomingMs) return false;
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
 * Secrets by provider, split by duty (spec §2.1): binding a secret the
 * deployment never created would fail the deploy, so each function binds
 * only what its own runtime path reads. EMAIL_WEBHOOK_BASIC_AUTH exists
 * only for postmark deployments WITH delivery ingest enabled — it belongs
 * to the ingest endpoint, never to send-only functions.
 */
const SEND_SECRETS_BY_PROVIDER = {
  postmark: ['EMAIL_PROVIDER_API_KEY'],
  webhook: ['EMAIL_WEBHOOK_URL', 'EMAIL_WEBHOOK_SECRET'],
  console: [],
};
const INGEST_SECRETS_BY_PROVIDER = {
  postmark: ['EMAIL_PROVIDER_API_KEY', 'EMAIL_WEBHOOK_BASIC_AUTH'],
  webhook: ['EMAIL_WEBHOOK_URL', 'EMAIL_WEBHOOK_SECRET'],
  console: [],
};

/** Deployable exports (spec §1.3): emailDeliveryWebhook only. */
function buildHandlers() {
  const { onRequest } = require('firebase-functions/v2/https');
  const { defineSecret } = require('firebase-functions/params');
  const providerName = (process.env.EVENT_EMAIL_PROVIDER || '').trim();
  const secrets = (INGEST_SECRETS_BY_PROVIDER[providerName] || []).map(defineSecret);
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
  EmailBatchError,
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
    resolveMessage,
    MAX_ATTEMPTS,
    BACKOFF_MS,
    BODY_STORE_LIMIT,
    SEND_SECRETS_BY_PROVIDER,
    INGEST_SECRETS_BY_PROVIDER,
  },
};
