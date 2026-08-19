'use strict';

/**
 * Generic webhook adapter (spec §3.1): signed JSON POST to an
 * operator-configured URL. This is the only expression of the operator's
 * private relay anywhere in the repo — no hostname, no service name, no
 * identifying comment.
 *
 * Auth on both directions is the same shape: Bearer secret plus
 * `X-Signature: sha256=<hmac-sha256>` over the exact raw body, keyed by
 * EMAIL_WEBHOOK_SECRET. No retries here — the core owns retry policy and
 * treats a throw as non-retryable.
 */

const crypto = require('node:crypto');

/** @param {string} secret @param {string|Buffer} rawBody @returns {string} hex */
function signBody(secret, rawBody) {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

/**
 * Constant-time string equality: compare SHA-256 digests so length never
 * short-circuits through timingSafeEqual's length precondition.
 * @param {string} a @param {string} b
 */
function safeEqual(a, b) {
  const da = crypto.createHash('sha256').update(String(a), 'utf8').digest();
  const db = crypto.createHash('sha256').update(String(b), 'utf8').digest();
  return crypto.timingSafeEqual(da, db);
}

/** Case-insensitive header lookup. @param {Record<string,string>} headers @param {string} name */
function header(headers, name) {
  if (!headers) return undefined;
  if (name in headers) return headers[name];
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) return headers[key];
  }
  return undefined;
}

/** Retry-After (delay-seconds or HTTP-date) → ms, or undefined. @param {string|null|undefined} value */
function retryAfterMsFrom(value, now = Date.now) {
  const raw = String(value ?? '').trim();
  if (!raw) return undefined;
  // Delay-seconds form. HTTP-dates (IMF-fixdate) never start with a digit,
  // so a leading integer is unambiguous.
  if (/^-?\d+$/.test(raw)) {
    const seconds = Number.parseInt(raw, 10);
    return seconds >= 0 ? seconds * 1000 : undefined;
  }
  // HTTP-date form (RFC 9110): a past date clamps to 0, unparseable is no hint.
  const at = Date.parse(raw);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, at - now());
}

const EVENT_TYPES = new Set(['delivered', 'bounced', 'complained', 'suppressed']);

/** DeliveryEvent shape check (spec §3.1). @param {any} entry */
function isDeliveryEvent(entry) {
  return Boolean(
    entry && typeof entry === 'object' &&
    typeof entry.providerMessageId === 'string' && entry.providerMessageId &&
    EVENT_TYPES.has(entry.type) &&
    typeof entry.recipient === 'string' && entry.recipient &&
    typeof entry.occurredAt === 'string' && entry.occurredAt
  );
}

/** @param {any} entry @returns {object} DeliveryEvent */
function toDeliveryEvent(entry) {
  const event = {
    providerMessageId: entry.providerMessageId,
    type: entry.type,
    recipient: entry.recipient,
    occurredAt: entry.occurredAt,
  };
  if (typeof entry.reason === 'string') event.reason = entry.reason;
  return event;
}

/**
 * @param {{ env?: Record<string, string|undefined>,
 *           fetchImpl?: typeof fetch }} deps
 */
function createWebhookProvider({ env = process.env, fetchImpl = globalThis.fetch, log = console } = {}) {
  const url = env.EMAIL_WEBHOOK_URL;
  const secret = env.EMAIL_WEBHOOK_SECRET;
  if (!url) throw new Error('webhook email provider requires EMAIL_WEBHOOK_URL');
  if (!secret) throw new Error('webhook email provider requires EMAIL_WEBHOOK_SECRET');

  /**
   * A thrown fetch error propagates — the core treats throws as
   * non-retryable (acceptance is ambiguous).
   * @param {object} message EmailMessage @returns {Promise<object>} EmailSendResult
   */
  async function send(message) {
    const rawBody = JSON.stringify(message);
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${secret}`,
        'X-Signature': `sha256=${signBody(secret, rawBody)}`,
      },
      body: rawBody,
    });

    const providerStatus = response.status;
    if (providerStatus >= 200 && providerStatus <= 299) {
      let id = null;
      try {
        const body = await response.json();
        if (typeof body?.id === 'string' && body.id) id = body.id;
      } catch {
        // 2xx with a non-JSON body: accepted, but no id to record.
      }
      if (id === null) {
        // Accepted but untrackable: delivery-event ingest matches rows by
        // providerMessageId, so a relay that never returns an id silently
        // disables delivery tracking. Say so once per send.
        log.warn('email webhook relay returned 2xx without an id; delivery events cannot be matched');
      }
      return { providerMessageId: id, status: 'sent', providerStatus };
    }

    let error = `webhook relay responded ${providerStatus}`;
    try {
      const text = await response.text();
      if (text) error = `${error}: ${text.slice(0, 500)}`;
    } catch {
      // Body unreadable; keep the status-only error.
    }
    const result = { providerMessageId: null, status: 'failed', providerStatus, error };
    if (providerStatus === 429) {
      const retryAfterMs = retryAfterMsFrom(response.headers?.get?.('retry-after'));
      if (retryAfterMs !== undefined) result.retryAfterMs = retryAfterMs;
    }
    return result;
  }

  /**
   * Inbound requests must carry the same Bearer-plus-HMAC pair this adapter
   * sends outbound: constant-time-compare Authorization: Bearer <secret>
   * AND the X-Signature hmac over the raw body (spec §3.1). Both checks
   * must pass; there is no signature-only acceptance.
   * @param {Buffer|string} rawBody @param {Record<string,string>} headers
   */
  function verifyDeliveryWebhook(rawBody, headers) {
    const authorization = header(headers, 'authorization');
    if (typeof authorization !== 'string' || !safeEqual(authorization, `Bearer ${secret}`)) {
      return false;
    }
    const provided = header(headers, 'x-signature');
    if (typeof provided !== 'string' || rawBody == null) return false;
    return safeEqual(provided, `sha256=${signBody(secret, rawBody)}`);
  }

  /**
   * Accept an array (or single object) of DeliveryEvent-shaped JSON; filter
   * invalid entries; null for unrecognized payloads.
   * @param {unknown} body @returns {object[]|null}
   */
  function parseDeliveryEvent(body) {
    if (Array.isArray(body)) {
      return body.filter(isDeliveryEvent).map(toDeliveryEvent);
    }
    if (isDeliveryEvent(body)) return [toDeliveryEvent(body)];
    return null;
  }

  return { name: 'webhook', send, verifyDeliveryWebhook, parseDeliveryEvent };
}

module.exports = { createWebhookProvider, internals: { signBody, safeEqual, retryAfterMsFrom } };
