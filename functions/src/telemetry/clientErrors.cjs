'use strict';

/**
 * logClientError — the browser's early-warning endpoint (spec §9, issue
 * #10). Unauthenticated on purpose: a signed-out attendee hitting a broken
 * page is exactly the report the operator needs, and gating it on auth
 * would drop that class of report silently. Everything else in this file
 * exists to make an unauthenticated write endpoint safe to expose:
 *
 *   1. Size caps — every field is truncated before it is touched further,
 *      and the whole body is rejected outright past MAX_BODY_BYTES. Bounds
 *      the cost of one request regardless of what a caller sends.
 *   2. Benign filter (benignFilter.cjs) — SafeLinks/stale-bundle/extension
 *      noise never reaches Firestore at all.
 *   3. Rate limit — a transactional per-IP-hash sliding window
 *      (client_error_rate_limits/{ipHash}), the same shape as
 *      auth/challenges.cjs's takeRateLimitSlot. Bounds the number of
 *      durable writes one source can cause.
 *   4. PII redaction (redact.cjs) — applied AFTER the benign filter and
 *      BEFORE the Firestore write, so a redacted (but still noisy) report
 *      never gets a false pass from the benign filter matching redacted
 *      text instead of the original.
 *
 * Persistence goes through telemetry/systemErrors.cjs's logError, which
 * owns the persist-fail inline notify fallback.
 */

const crypto = require('node:crypto');

const { isBenignClientError } = require('./benignFilter.cjs');
const { redactText, redactUrl } = require('./redact.cjs');
const { logError, internals: systemErrorsInternals } = require('./systemErrors.cjs');

const MAX_MESSAGE_LEN = 2000;
const MAX_STACK_LEN = 8000;
const MAX_URL_LEN = 2000;
const MAX_USER_AGENT_LEN = 300;
const MAX_CONTEXT_LEN = 2000;
// Generous for a stack trace, small enough that a request cannot be used to
// push an arbitrarily large payload through an unauthenticated endpoint.
const MAX_BODY_BYTES = 32 * 1024;

const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

/** @param {unknown} value @param {number} max @returns {string|null} */
function truncateString(value, max) {
  if (typeof value !== 'string' || value.length === 0) return null;
  return value.length > max ? `${value.slice(0, max)}…[truncated]` : value;
}

/** @param {string} ip @returns {string} sha256 hex — never store a raw IP */
function hashIp(ip) {
  return crypto.createHash('sha256').update(String(ip || 'unknown'), 'utf8').digest('hex');
}

/**
 * Codex review finding (P1): the FIRST X-Forwarded-For entry is whatever
 * the caller sent — a direct (non-browser) POST to this unauthenticated
 * endpoint can set its own `X-Forwarded-For: 1.2.3.4` and mint a fresh
 * rate-limit bucket on every request, defeating the limiter entirely.
 *
 * Cloud Functions v2 runs on Cloud Run behind Google's front end, which is
 * documented to APPEND the real connecting client's IP to whatever
 * X-Forwarded-For value arrived with the request — it does not trust or
 * strip the incoming header, it adds to it
 * (https://cloud.google.com/run/docs/container-contract#https-headers).
 * So the platform-vetted value is the LAST entry, never the first: that
 * position is written by Google's infrastructure on the hop into the
 * container and cannot be forged by the caller. `req.ip` is the fallback
 * for a request with no XFF header at all (e.g. a direct test fake).
 * @param {object} req @returns {string}
 */
function extractClientIp(req) {
  const forwarded = typeof req?.get === 'function' ? req.get('x-forwarded-for') : req?.headers?.['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    const entries = forwarded.split(',').map((s) => s.trim()).filter(Boolean);
    if (entries.length > 0) return entries[entries.length - 1];
  }
  return req?.ip || 'unknown';
}

/**
 * Check and record one client-error rate-limit slot atomically (mirrors
 * auth/challenges.cjs's takeRateLimitSlot — same sliding-window shape).
 *
 * @param {{ db: FirebaseFirestore.Firestore, ipHash: string, now?: () => number }} args
 * @returns {Promise<{ limited: boolean, retryAfterMs?: number }>}
 */
async function takeClientErrorRateLimitSlot({ db, ipHash, now = Date.now }) {
  const ref = db.collection('client_error_rate_limits').doc(ipHash);
  const nowMs = now();
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const stored = snap.exists ? snap.data()?.requests : null;
    const requests = (Array.isArray(stored) ? stored : [])
      .filter((t) => typeof t === 'number' && nowMs - t < RATE_LIMIT_WINDOW_MS);
    if (requests.length >= RATE_LIMIT_MAX) {
      const oldest = Math.min(...requests);
      return { limited: true, retryAfterMs: Math.max(0, oldest + RATE_LIMIT_WINDOW_MS - nowMs) };
    }
    requests.push(nowMs);
    tx.set(ref, { requests, updatedAt: new Date(nowMs) });
    return { limited: false };
  });
}

/**
 * @param {{ db: FirebaseFirestore.Firestore, notifyOperator?: (e: object) => Promise<object>,
 *           now?: () => number, log?: Pick<Console, 'error'> }} deps
 */
function createLogClientErrorHandler({ db, notifyOperator, now = Date.now, log = console }) {
  return async function logClientError(req, res) {
    if (req.method !== 'POST') {
      res.set('Allow', 'POST');
      res.status(405).json({ error: { code: 'method-not-allowed', message: 'Use POST.' } });
      return;
    }

    let bodyBytes = 0;
    try {
      bodyBytes = Buffer.byteLength(JSON.stringify(req.body || {}), 'utf8');
    } catch {
      bodyBytes = MAX_BODY_BYTES + 1; // unserializable body — treat as oversized, not a crash
    }
    if (bodyBytes > MAX_BODY_BYTES) {
      res.status(413).json({ error: { code: 'payload-too-large', message: 'Error report is too large.' } });
      return;
    }

    const message = truncateString(req.body?.message, MAX_MESSAGE_LEN);
    if (!message) {
      res.status(400).json({ error: { code: 'bad-request', message: 'message is required.' } });
      return;
    }
    const stack = truncateString(req.body?.stack, MAX_STACK_LEN);
    const url = truncateString(req.body?.url, MAX_URL_LEN);
    const headerUserAgent = typeof req?.get === 'function' ? req.get('user-agent') : req?.headers?.['user-agent'];
    const userAgent = truncateString(req.body?.userAgent, MAX_USER_AGENT_LEN)
      ?? truncateString(headerUserAgent, MAX_USER_AGENT_LEN);
    const context = req.body?.context && typeof req.body.context === 'object'
      ? truncateString(JSON.stringify(req.body.context), MAX_CONTEXT_LEN)
      : null;

    // Benign filter runs on the ORIGINAL text — redaction can only obscure
    // the patterns it looks for (a SafeLinks URL's host is not credential
    // data and is never touched, but checking pre-redaction keeps the two
    // concerns independent).
    if (isBenignClientError({ message, stack, url, userAgent })) {
      res.status(204).send('');
      return;
    }

    const clientIpHash = hashIp(extractClientIp(req));
    const slot = await takeClientErrorRateLimitSlot({ db, ipHash: clientIpHash, now });
    if (slot.limited) {
      const retryAfterSeconds = slot.retryAfterMs ? Math.ceil(slot.retryAfterMs / 1000) : null;
      if (retryAfterSeconds) res.set('Retry-After', String(retryAfterSeconds));
      res.status(429).json({
        error: { code: 'rate-limited', message: 'Too many error reports.', retryAfterSeconds },
      });
      return;
    }

    const result = await logError({
      db,
      kind: 'client-error',
      message: redactText(message),
      stack: stack ? redactText(stack) : null,
      url: url ? redactUrl(url) : null,
      userAgent,
      context: context ? redactText(context) : null,
      ipHash: clientIpHash,
      notifyOperator,
      now,
      log,
    });

    // 202: accepted for processing regardless of whether the durable write
    // landed — logError already ran its own persist-fail fallback, and the
    // client has nothing useful to do with a 5xx here beyond retrying,
    // which would just repeat load against the same rate-limit bucket.
    res.status(result.persisted ? 201 : 202).json({ ok: true });
  };
}

/** Deployable exports (spec §1.3): logClientError. */
function buildHandlers() {
  const { onRequest } = require('firebase-functions/v2/https');
  const { defineSecret } = require('firebase-functions/params');

  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';
  // Same secret set as systemErrors.cjs's onSystemErrorCreated — this
  // handler's own logError persist-fail fallback goes through the same
  // notifier (see systemErrorsInternals.notifierSecretNames).
  const secrets = systemErrorsInternals.notifierSecretNames(process.env).map(defineSecret);

  const withCors = (handler) => async (req, res) => {
    const { applyCors, parseAllowedOrigins } = require('../core/http.cjs');
    const handled = applyCors(req, res, {
      allowedOrigins: parseAllowedOrigins(process.env.EVENT_ALLOWED_ORIGINS),
    });
    if (handled) return;
    await handler(req, res);
  };

  return {
    logClientError: onRequest({ region, secrets }, withCors(async (req, res) => {
      const { db, notifyOperator } = systemErrorsInternals.buildNotifyDeps();
      await createLogClientErrorHandler({ db, notifyOperator })(req, res);
    })),
  };
}

module.exports = {
  createLogClientErrorHandler,
  takeClientErrorRateLimitSlot,
  get handlers() {
    return buildHandlers();
  },
  internals: {
    truncateString, hashIp, extractClientIp,
    MAX_MESSAGE_LEN, MAX_STACK_LEN, MAX_URL_LEN, MAX_USER_AGENT_LEN, MAX_CONTEXT_LEN, MAX_BODY_BYTES,
    RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS,
  },
};
