'use strict';

/**
 * Postmark adapter (spec §3.1): the reference client-facing provider.
 * One REST call per send, synchronous MessageID, real verifySenderDomain.
 *
 * Postmark delivers delivery webhooks UNSIGNED, so verifyDeliveryWebhook is
 * HTTP Basic credentials embedded in the registered webhook URL,
 * constant-time-compared against EMAIL_WEBHOOK_BASIC_AUTH (spec §3.1).
 *
 * No retries here — the core owns retry policy.
 */

const crypto = require('node:crypto');

const API_BASE = 'https://api.postmarkapp.com';

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

/**
 * 'Name <email>' when name present. A display name outside plain
 * atom/space characters is quoted per RFC 5322 mailbox syntax — an
 * unquoted comma ('Doe, Jane') reads as a recipient-list delimiter.
 * @param {string|{email:string,name?:string}|undefined} addr
 */
function formatAddress(addr) {
  if (!addr) return undefined;
  if (typeof addr === 'string') return addr;
  if (!addr.email) return undefined;
  if (!addr.name) return addr.email;
  const name = /^[A-Za-z0-9 !#$%&'*+/=?^_`{|}~.-]*$/.test(addr.name) && !addr.name.includes(',')
    ? addr.name
    : `"${addr.name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  return `${name} <${addr.email}>`;
}

/** EmailMessage → Postmark /email payload (spec §3.1). @param {object} message */
function toPostmarkPayload(message) {
  const payload = {
    From: formatAddress(message.from),
    To: formatAddress(message.to),
    Subject: message.subject,
  };
  if (message.html) payload.HtmlBody = message.html;
  if (message.text) payload.TextBody = message.text;
  if (message.replyTo) payload.ReplyTo = message.replyTo;
  if (message.tag) payload.Tag = message.tag;
  if (message.headers && Object.keys(message.headers).length > 0) {
    payload.Headers = Object.entries(message.headers)
      .map(([Name, Value]) => ({ Name, Value: String(Value) }));
  }
  if (message.messageStream) payload.MessageStream = message.messageStream;
  return payload;
}

/** @param {boolean|undefined} flag @returns {'pass'|'fail'|'unknown'} */
function passFail(flag) {
  if (flag === true) return 'pass';
  if (flag === false) return 'fail';
  return 'unknown';
}

/**
 * @param {{ env?: Record<string, string|undefined>,
 *           fetchImpl?: typeof fetch }} deps
 */
function createPostmarkProvider({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const serverToken = env.EMAIL_PROVIDER_API_KEY;
  if (!serverToken) throw new Error('postmark email provider requires EMAIL_PROVIDER_API_KEY');

  /**
   * A thrown fetch error propagates — the core treats throws as
   * non-retryable (acceptance is ambiguous).
   * @param {object} message EmailMessage @returns {Promise<object>} EmailSendResult
   */
  async function send(message) {
    const response = await fetchImpl(`${API_BASE}/email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Postmark-Server-Token': serverToken,
      },
      body: JSON.stringify(toPostmarkPayload(message)),
    });

    const providerStatus = response.status;
    let body = null;
    try {
      body = await response.json();
    } catch {
      // Non-JSON body (e.g. a 5xx from a proxy); mapped below by status.
    }

    // Postmark contractually returns 200, but an intermediary 202/204 still
    // means the request left our hands — mapping any 2xx to 'failed' is the
    // one direction that produces a false-failure audit row and a duplicate
    // admin resend.
    if (providerStatus >= 200 && providerStatus <= 299) {
      return {
        providerMessageId: body?.MessageID || null,
        status: 'sent',
        providerStatus,
      };
    }

    const parts = [body?.ErrorCode, body?.Message].filter((v) => v != null && v !== '');
    const detail = parts.length > 0 ? parts.join(': ') : `postmark responded ${providerStatus}`;
    const result = { providerMessageId: null, status: 'failed', providerStatus, error: detail };
    if (providerStatus === 429) {
      const retryAfterMs = retryAfterMsFrom(response.headers?.get?.('retry-after'));
      if (retryAfterMs !== undefined) result.retryAfterMs = retryAfterMs;
    }
    return result;
  }

  /**
   * Decode Authorization: Basic and constant-time-compare user:pass against
   * EMAIL_WEBHOOK_BASIC_AUTH; false when either side is absent (spec §3.1).
   * @param {Buffer|string} rawBody @param {Record<string,string>} headers
   */
  function verifyDeliveryWebhook(rawBody, headers) {
    const expected = env.EMAIL_WEBHOOK_BASIC_AUTH;
    const auth = header(headers, 'authorization');
    if (!expected || typeof auth !== 'string') return false;
    const match = /^Basic\s+([A-Za-z0-9+/=]+)$/.exec(auth.trim());
    if (!match) return false;
    let decoded;
    try {
      decoded = Buffer.from(match[1], 'base64').toString('utf8');
    } catch {
      return false;
    }
    return safeEqual(decoded, expected);
  }

  /**
   * Postmark posts ONE JSON object per delivery. Returns a one-element
   * DeliveryEvent array, or null when unrecognized.
   * @param {unknown} body @returns {object[]|null}
   */
  function parseDeliveryEvent(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    const record = /** @type {Record<string, any>} */ (body);
    const providerMessageId = record.MessageID;
    if (typeof providerMessageId !== 'string' || !providerMessageId) return null;

    let event = null;
    switch (record.RecordType) {
      case 'Delivery':
        event = {
          type: 'delivered',
          recipient: record.Recipient,
          occurredAt: record.DeliveredAt,
        };
        break;
      case 'Bounce':
        event = {
          type: 'bounced',
          recipient: record.Email,
          occurredAt: record.BouncedAt,
          reason: record.Description || record.Name || undefined,
        };
        break;
      case 'SpamComplaint':
        event = {
          type: 'complained',
          recipient: record.Email,
          occurredAt: record.BouncedAt,
          reason: record.Description || record.Name || undefined,
        };
        break;
      case 'SubscriptionChange':
        if (record.SuppressSending !== true) return null;
        event = {
          type: 'suppressed',
          recipient: record.Recipient,
          occurredAt: record.ChangedAt,
          reason: record.SuppressionReason || undefined,
        };
        break;
      default:
        return null;
    }

    if (typeof event.recipient !== 'string' || !event.recipient) return null;
    const out = {
      providerMessageId,
      type: event.type,
      recipient: event.recipient,
      // DeliveryEvent requires an ISO occurredAt; a payload missing its
      // timestamp gets ingest time rather than a contract-violating ''.
      occurredAt: typeof event.occurredAt === 'string' && event.occurredAt
        ? event.occurredAt
        : new Date().toISOString(),
    };
    if (typeof event.reason === 'string') out.reason = event.reason;
    return [out];
  }

  /**
   * Postmark's domains API needs the ACCOUNT token, which the spec §2.1 env
   * set does not include — without EMAIL_ACCOUNT_API_KEY this reports
   * unknown rather than guessing.
   * @param {string} domain @returns {Promise<object>} SenderDomainStatus
   */
  async function verifySenderDomain(domain) {
    const accountToken = env.EMAIL_ACCOUNT_API_KEY;
    if (!accountToken) {
      return {
        domain,
        verified: false,
        spf: 'unknown',
        dkim: 'unknown',
        returnPath: 'unknown',
        detail: 'EMAIL_ACCOUNT_API_KEY not configured',
      };
    }

    const headersForAccount = {
      'Accept': 'application/json',
      'X-Postmark-Account-Token': accountToken,
    };
    const listResponse = await fetchImpl(`${API_BASE}/domains?count=500&offset=0`, {
      method: 'GET',
      headers: headersForAccount,
    });
    if (listResponse.status !== 200) {
      return {
        domain,
        verified: false,
        spf: 'unknown',
        dkim: 'unknown',
        returnPath: 'unknown',
        detail: `postmark domains list responded ${listResponse.status}`,
      };
    }
    const list = await listResponse.json();
    const entry = (Array.isArray(list?.Domains) ? list.Domains : [])
      .find((d) => typeof d?.Name === 'string' && d.Name.toLowerCase() === domain.toLowerCase());
    if (!entry) {
      return {
        domain,
        verified: false,
        spf: 'unknown',
        dkim: 'unknown',
        returnPath: 'unknown',
        detail: `domain not found in postmark account`,
      };
    }

    const detailResponse = await fetchImpl(`${API_BASE}/domains/${entry.ID}`, {
      method: 'GET',
      headers: headersForAccount,
    });
    if (detailResponse.status !== 200) {
      return {
        domain,
        verified: false,
        spf: 'unknown',
        dkim: 'unknown',
        returnPath: 'unknown',
        detail: `postmark domain detail responded ${detailResponse.status}`,
      };
    }
    const detail = await detailResponse.json();
    const spf = passFail(detail?.SPFVerified);
    const dkim = passFail(detail?.DKIMVerified);
    const returnPath = passFail(detail?.ReturnPathDomainVerified);
    return {
      domain,
      verified: spf === 'pass' && dkim === 'pass' && returnPath === 'pass',
      spf,
      dkim,
      returnPath,
    };
  }

  return { name: 'postmark', send, verifyDeliveryWebhook, parseDeliveryEvent, verifySenderDomain };
}

module.exports = {
  createPostmarkProvider,
  internals: { toPostmarkPayload, formatAddress, passFail, API_BASE },
};
