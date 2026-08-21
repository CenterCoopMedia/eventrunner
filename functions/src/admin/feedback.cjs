'use strict';

/**
 * Feedback inbox (spec §9 "Feedback inbox", issue #28): a public bug/feedback
 * submission endpoint, hardened the same way telemetry/clientErrors.cjs
 * hardens its own unauthenticated write path, plus the admin review actions.
 * Kept in admin/ rather than a public/ module because the review-side
 * handler (updateFeedbackStatus) is admin-gated and the two share one
 * collection and one set of constants — splitting them would just be two
 * files agreeing with each other from a distance.
 *
 *   submitFeedback       POST { message, email?, category?, honeypot,
 *                         startedAt, submissionKey? } — unauthenticated.
 *                         Writes `feedback` (renamed from `bug_reports`,
 *                         spec §4.1) and, with an email, sends an
 *                         onceKey-gated confirmation.
 *   updateFeedbackStatus POST { id, status } — admin-gated. Marks a row
 *                         reviewed or archived. Audit-logged.
 *
 * Hardening on submitFeedback, same four layers as clientErrors.cjs and
 * ported as-is from the reference implementation (spec §9):
 *   1. Size caps — every field truncated/rejected before further use.
 *   2. Honeypot — a hidden field real users never fill; a submission that
 *      does is silently accepted-looking but never written or emailed.
 *   3. Minimum-time gate — `startedAt` is when the client rendered the form;
 *      a submission arriving before MIN_ELAPSED_MS elapsed reads as
 *      scripted, not a person reading a message field. Same silent
 *      not-actually-written response as the honeypot case — a bot must not
 *      be able to distinguish "dropped" from "accepted" (clientErrors.cjs
 *      calls this benign handling).
 *   4. Rate limit — a transactional per-IP-hash sliding window
 *      (feedback_rate_limits/{ipHash}), same shape as clientErrors.cjs's
 *      takeClientErrorRateLimitSlot; extractClientIp/hashIp are reused
 *      directly from that module rather than re-implemented, including the
 *      last-XFF-entry rule that keeps a direct caller from forging its own
 *      rate-limit bucket (see clientErrors.cjs for the full citation).
 *
 * Retry idempotency (Codex P2 finding): the feedback doc id used to be
 * server-random (`db.collection('feedback').doc()`), so a client retry after
 * a dropped response — the write landed, but the caller never saw the 201 —
 * created a second row AND, because onceKey was derived from that random id,
 * a second confirmation email. `submissionKey` fixes this: FeedbackModal.jsx
 * generates one per form-open session and resends it unchanged on every
 * retry of the same submission, this handler uses it AS the doc id (so the
 * onceKey derived from it is stable too), and the write goes through
 * `.create()` — a retry that lands after the first one already committed
 * gets Firestore's ALREADY_EXISTS rather than silently overwriting a row an
 * admin may have already reviewed. A missing or malformed submissionKey
 * falls back to a random id (older/non-conforming callers keep working,
 * just without retry-safety).
 *
 * Telegram triage from the reference implementation is explicitly cut (spec
 * §9): the review surface is this module's admin endpoint plus the plain
 * admin review tab reading `feedback` via firestore.rules' isAdmin() gate.
 */

const crypto = require('node:crypto');
const { requireAdmin } = require('../core/auth.cjs');
const { sendError, badRequest, notFound, methodNotAllowed, internal } = require('../core/errors.cjs');
const { logAdminAction } = require('../cms/store.cjs');
const { internals: clientErrorInternals } = require('../telemetry/clientErrors.cjs');
// Reused rather than re-implemented: send.cjs already owns the canonical
// Firestore ALREADY_EXISTS check (gRPC code 6) for its own onceKey claims.
const { isAlreadyExists } = require('../email/send.cjs').internals;

const { extractClientIp, hashIp } = clientErrorInternals;

const FEEDBACK_COLLECTION = 'feedback';
const RATE_LIMIT_COLLECTION = 'feedback_rate_limits';

const MAX_MESSAGE_LEN = 4000;
const MAX_EMAIL_LEN = 320;
const MAX_USER_AGENT_LEN = 300;
// Generous for a real report, small enough that a request cannot push an
// arbitrarily large payload through an unauthenticated endpoint.
const MAX_BODY_BYTES = 16 * 1024;

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

// A person reading a feedback form and typing a real message takes longer
// than this; a submission that arrives faster is treated as scripted.
const MIN_ELAPSED_MS = 3000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CATEGORIES = Object.freeze(['bug', 'feedback', 'other']);
const STATUSES = Object.freeze(['new', 'reviewed', 'archived']);
// Bounded and restricted to characters safe as a bare Firestore doc-id
// segment (no '/', no '.'/'..'): a hex or uuid-shaped client-generated
// token, never caller-chosen free text.
const SUBMISSION_KEY_RE = /^[A-Za-z0-9_-]{8,128}$/;

/** @param {unknown} value @param {number} max @returns {string|null} */
function truncateString(value, max) {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/**
 * Check and record one feedback rate-limit slot atomically — same
 * transactional sliding-window shape as clientErrors.cjs's
 * takeClientErrorRateLimitSlot, over its own collection so the two features'
 * budgets never share (and cannot starve each other).
 *
 * @param {{ db: FirebaseFirestore.Firestore, ipHash: string, now?: () => number }} args
 * @returns {Promise<{ limited: boolean, retryAfterMs?: number }>}
 */
async function takeFeedbackRateLimitSlot({ db, ipHash, now = Date.now }) {
  const ref = db.collection(RATE_LIMIT_COLLECTION).doc(ipHash);
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
 * Whether this submission is bot-like: a filled honeypot, or a submission
 * that arrived before a human plausibly could have. Pure — no db, no
 * side effects — so submitFeedback can decide the (identical-looking)
 * response before touching Firestore.
 *
 * @param {{ honeypot: unknown, startedAt: unknown, now: number }} args
 * @returns {boolean}
 */
function looksLikeBot({ honeypot, startedAt, now }) {
  if (typeof honeypot === 'string' && honeypot.trim().length > 0) return true;
  const started = typeof startedAt === 'number' ? startedAt : Number(startedAt);
  if (!Number.isFinite(started)) return true; // no timestamp at all reads as scripted
  const elapsed = now - started;
  // Only a floor: a real visitor may take arbitrarily long to write a
  // message, but nothing legitimate submits before a human could have read
  // the form and typed into it.
  return elapsed < MIN_ELAPSED_MS;
}

/**
 * @param {{ db: FirebaseFirestore.Firestore,
 *           sendEmail?: (m: object) => Promise<object>,
 *           getConfig?: () => Promise<object>,
 *           now?: () => number, log?: Pick<Console, 'warn'|'error'> }} deps
 */
function createSubmitFeedbackHandler({ db, sendEmail, getConfig, now = Date.now, log = console }) {
  return async function submitFeedback(req, res) {
    if (req.method !== 'POST') {
      res.set('Allow', 'POST');
      res.status(405).json({ error: { code: 'method-not-allowed', message: 'Use POST.' } });
      return;
    }

    let bodyBytes = 0;
    try {
      bodyBytes = Buffer.byteLength(JSON.stringify(req.body || {}), 'utf8');
    } catch {
      bodyBytes = MAX_BODY_BYTES + 1;
    }
    if (bodyBytes > MAX_BODY_BYTES) {
      res.status(413).json({ error: { code: 'payload-too-large', message: 'Feedback is too large.' } });
      return;
    }

    const message = truncateString(req.body?.message, MAX_MESSAGE_LEN);
    if (!message) {
      res.status(400).json({ error: { code: 'bad-request', message: 'message is required.' } });
      return;
    }
    const rawEmail = truncateString(req.body?.email, MAX_EMAIL_LEN);
    if (rawEmail && !EMAIL_RE.test(rawEmail)) {
      res.status(400).json({ error: { code: 'bad-request', message: 'email must be a valid address.' } });
      return;
    }
    const email = rawEmail ? rawEmail.toLowerCase() : null;
    const rawCategory = typeof req.body?.category === 'string' ? req.body.category : 'feedback';
    const category = CATEGORIES.includes(rawCategory) ? rawCategory : 'feedback';
    const headerUserAgent = typeof req?.get === 'function' ? req.get('user-agent') : req?.headers?.['user-agent'];
    const userAgent = truncateString(headerUserAgent, MAX_USER_AGENT_LEN);

    // submissionKey (optional): validated by SHAPE only — never trusted as
    // anything but an idempotency token — so a malformed value is rejected
    // by name rather than silently coerced or ignored.
    const rawSubmissionKey = req.body?.submissionKey;
    if (rawSubmissionKey !== undefined && !SUBMISSION_KEY_RE.test(String(rawSubmissionKey))) {
      res.status(400).json({ error: { code: 'bad-request', message: 'submissionKey: must be 8-128 characters of [A-Za-z0-9_-].' } });
      return;
    }

    const nowMs = now();
    // Honeypot + time-gate first: a bot must not spend a rate-limit slot
    // learning which check caught it, and the response is identical to a
    // real accepted submission either way (benign handling, same principle
    // as clientErrors.cjs's isBenignClientError early-return).
    if (looksLikeBot({ honeypot: req.body?.honeypot, startedAt: req.body?.startedAt, now: nowMs })) {
      res.status(201).json({ ok: true });
      return;
    }

    const clientIpHash = hashIp(extractClientIp(req));
    const slot = await takeFeedbackRateLimitSlot({ db, ipHash: clientIpHash, now });
    if (slot.limited) {
      const retryAfterSeconds = slot.retryAfterMs ? Math.ceil(slot.retryAfterMs / 1000) : null;
      if (retryAfterSeconds) res.set('Retry-After', String(retryAfterSeconds));
      res.status(429).json({
        error: { code: 'rate-limited', message: 'Too many submissions. Try again later.', retryAfterSeconds },
      });
      return;
    }

    // A validated submissionKey becomes the doc id (and, below, the onceKey
    // base) so a retry of the SAME submission after a dropped response lands
    // on the SAME doc instead of minting a new one; absent one, fall back to
    // a random id (no retry-safety, but every other check still applies).
    const docId = rawSubmissionKey !== undefined ? String(rawSubmissionKey) : crypto.randomUUID();
    const ref = db.collection(FEEDBACK_COLLECTION).doc(docId);
    try {
      // .create(), not .set(): a retry that lands after the first attempt
      // already committed must not silently overwrite a row an admin may
      // have already reviewed — it should look like the ORIGINAL write,
      // not a second one.
      await ref.create({
        message,
        email,
        category,
        status: 'new',
        ipHash: clientIpHash,
        userAgent,
        createdAt: new Date(nowMs),
      });
    } catch (err) {
      if (!isAlreadyExists(err)) {
        log.error('feedback write failed', err);
        res.status(500).json({ error: { code: 'internal', message: 'Your feedback could not be saved. Try again.' } });
        return;
      }
      // Idempotent retry of an already-durable submission: fall through to
      // the (onceKey-protected) email step and answer 201 exactly as the
      // original request would have — a caller cannot tell the difference.
    }

    // Confirmation email is best-effort and onceKey-gated on the doc id: a
    // client retry after a dropped response must not send a second mail for
    // the same submission. A failure here never turns an already-durable
    // submission into a caller-visible error.
    if (email && typeof sendEmail === 'function' && typeof getConfig === 'function') {
      try {
        const { render } = require('../email/render.cjs');
        const { getDefaultTemplate, loadTemplate } = require('../email/templates.cjs');
        const config = await getConfig();
        const template = getDefaultTemplate('feedback.confirmation');
        const { override } = await loadTemplate({ db, id: 'feedback.confirmation', now });
        const rendered = render({ template, override, tokenValues: {}, config });
        await sendEmail({
          to: email,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          tag: 'feedback.confirmation',
          source: 'feedback',
          onceKey: `feedback-confirmation:${ref.id}`,
          storeRendered: rendered.storeRendered,
          hasLegalFooterHtml: rendered.hasLegalFooterHtml,
          hasLegalFooterText: rendered.hasLegalFooterText,
        });
      } catch (err) {
        log.error('feedback confirmation email failed', err);
      }
    }

    res.status(201).json({ id: ref.id, ok: true });
  };
}

/**
 * @param {{ db: FirebaseFirestore.Firestore,
 *           auth: { verifyIdToken: (t: string) => Promise<object> },
 *           getConfig: () => Promise<object>,
 *           now?: () => number, log?: Pick<Console, 'warn'|'error'> }} deps
 */
function createUpdateFeedbackStatusHandler({ db, auth, getConfig, now = Date.now, log = console }) {
  return async function updateFeedbackStatus(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const gate = await requireAdmin({ auth, getConfig }, req);
    if (!gate.ok) return sendError(res, gate.status, gate.code, gate.message);

    const id = req.body?.id;
    if (typeof id !== 'string' || !id) return badRequest(res, 'id: must be a non-empty string');
    const status = req.body?.status;
    if (!STATUSES.includes(status)) {
      return badRequest(res, `status: must be one of ${STATUSES.join(', ')}`);
    }

    const ref = db.collection(FEEDBACK_COLLECTION).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return notFound(res, 'Feedback not found.');

    const at = new Date(now());
    try {
      await ref.update({ status, reviewedAt: at, reviewedBy: gate.email });
    } catch (err) {
      log.error('updateFeedbackStatus failed', err);
      return internal(res, 'The feedback status could not be updated.');
    }
    await logAdminAction({
      db,
      action: 'updateFeedbackStatus',
      docPath: `${FEEDBACK_COLLECTION}/${id}`,
      actor: { uid: gate.uid, email: gate.email },
      now,
      log,
    });
    res.status(200).json({ id, status });
  };
}

/** Deployable exports (spec §1.3): submitFeedback, updateFeedbackStatus. */
function buildHandlers() {
  const { onRequest } = require('firebase-functions/v2/https');
  const { defineSecret } = require('firebase-functions/params');
  const { SEND_SECRETS_BY_PROVIDER } = require('../email/send.cjs').internals;

  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';
  const providerName = (process.env.EVENT_EMAIL_PROVIDER || '').trim();
  const secrets = (SEND_SECRETS_BY_PROVIDER[providerName] || []).map(defineSecret);

  const withCors = (handler) => async (req, res) => {
    const { applyCors, parseAllowedOrigins } = require('../core/http.cjs');
    const handled = applyCors(req, res, {
      allowedOrigins: parseAllowedOrigins(process.env.EVENT_ALLOWED_ORIGINS),
    });
    if (handled) return;
    await handler(req, res);
  };

  const buildAdminDeps = () => {
    const { getDb } = require('../core/firestore.cjs');
    const { getAuth } = require('firebase-admin/auth');
    const { getEventConfig } = require('../core/config.cjs');
    const db = getDb();
    return { db, auth: getAuth(), getConfig: () => getEventConfig({ db }) };
  };

  return {
    submitFeedback: onRequest({ region, secrets }, withCors(async (req, res) => {
      const { getDb } = require('../core/firestore.cjs');
      const { getEventConfig } = require('../core/config.cjs');
      const { getEmailProvider } = require('../email/providers/index.cjs');
      const { createEmailCore } = require('../email/send.cjs');
      const db = getDb();
      const getConfig = () => getEventConfig({ db });
      const emailCore = createEmailCore({ db, provider: getEmailProvider({ env: process.env }), getConfig });
      await createSubmitFeedbackHandler({ db, sendEmail: emailCore.send, getConfig })(req, res);
    })),
    updateFeedbackStatus: onRequest({ region }, withCors(async (req, res) => {
      await createUpdateFeedbackStatusHandler(buildAdminDeps())(req, res);
    })),
  };
}

module.exports = {
  createSubmitFeedbackHandler,
  createUpdateFeedbackStatusHandler,
  takeFeedbackRateLimitSlot,
  looksLikeBot,
  get handlers() {
    return buildHandlers();
  },
  internals: {
    truncateString,
    MAX_MESSAGE_LEN,
    MAX_EMAIL_LEN,
    MAX_USER_AGENT_LEN,
    MAX_BODY_BYTES,
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_MS,
    MIN_ELAPSED_MS,
    EMAIL_RE,
    CATEGORIES,
    STATUSES,
    FEEDBACK_COLLECTION,
    RATE_LIMIT_COLLECTION,
  },
};
