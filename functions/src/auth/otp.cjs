'use strict';

/**
 * Emailed-code sign-in (spec §3.1 auth notes, §6.1, issue #11).
 *
 * Two HTTP endpoints and one scheduled sweep:
 *   sendOtpCode    { email } → { challengeId, expiresInMinutes }
 *   verifyOtpCode  { challengeId, email, code } → { token } (custom token)
 *   cleanupExpiredAuthChallenges — scheduled sweep of expired challenges
 *
 * Response discipline: neither endpoint reveals whether an address has an
 * account. sendOtpCode answers identically for known and unknown
 * addresses; verifyOtpCode has a single failure shape for every miss.
 */

const crypto = require('node:crypto');
const { isAlreadyExists } = require('../email/send.cjs').internals;

const {
  takeRateLimitSlot,
  takeGlobalSendSlot,
  createChallenge,
  verifyChallenge,
  finalizeChallenge,
  releaseChallenge,
  sweepExpired,
  normalizeEmail,
  internals: challengeInternals,
} = require('./challenges.cjs');
const { render } = require('../email/render.cjs');
const { getDefaultTemplate, loadTemplate } = require('../email/templates.cjs');

const EXPIRY_MINUTES = Math.floor(challengeInternals.CHALLENGE_TTL_MS / 60000);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Six digits, cryptographically random, leading zeros kept. */
function generateOtpCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

/**
 * The send-boundary gate (spec §6.1): refuse to send a rendered OTP mail
 * whose html and text do not BOTH contain the code as a nonempty
 * substring. A user must never spend a rate-limit slot on a mail that
 * cannot sign them in — so this runs before the slot is taken.
 */
function renderedMailCarriesCode(rendered, code) {
  return Boolean(code) &&
    typeof rendered.html === 'string' && rendered.html.includes(code) &&
    typeof rendered.text === 'string' && rendered.text.includes(code);
}

/**
 * How stale a `lastSeenAt` may get before the reopen path refreshes it.
 * The fallback branch runs on every request while an override is broken,
 * and that branch sits ahead of the rate limit — refreshing on a timer
 * keeps the durable row's writes bounded (one per window per fault class)
 * instead of one per unauthenticated request against a single hot doc.
 */
const LAST_SEEN_REFRESH_MS = 5 * 60 * 1000;

/**
 * Reopen the durable row for a fault class whose `.create()` came back
 * ALREADY_EXISTS (issue #48). `resolved: false` is written immediately
 * whenever the stored row is not already unresolved-and-fresh, so a new
 * fault that happens to produce the same validation messages as a
 * previously fixed one still raises a durable signal.
 *
 * A lost update between the read and the write is harmless: the next
 * request repeats it, and both writers write the same intent.
 *
 * @param {{ db, errorId: string, seenAt: Date }} args
 * @returns {Promise<boolean>} whether the row was written
 */
async function reopenSystemError({ db, errorId, seenAt }) {
  const ref = db.collection('system_errors').doc(errorId);
  const snap = await ref.get();
  if (!snap.exists) return false;
  const data = snap.data() || {};
  const lastSeenMs = data.lastSeenAt instanceof Date
    ? data.lastSeenAt.getTime()
    : typeof data.lastSeenAt?.toMillis === 'function'
      ? data.lastSeenAt.toMillis()
      : Date.parse(data.lastSeenAt);
  const fresh = Number.isFinite(lastSeenMs) &&
    seenAt.getTime() - lastSeenMs < LAST_SEEN_REFRESH_MS;
  if (data.resolved === false && fresh) return false;
  await ref.update({ resolved: false, lastSeenAt: seenAt });
  return true;
}

/**
 * Read the deploy-time OTP send ceiling (spec §2.1). Absent, unparseable,
 * or non-positive falls back to the module default rather than to "no
 * ceiling" — a typo in a deploy variable must not silently remove a
 * safety control. `0` is not a way to disable it; lower it instead.
 * @param {Record<string, string|undefined>} [env]
 * @returns {number}
 */
function parseSendCeiling(env = process.env) {
  const raw = Number.parseInt(String(env.EVENT_OTP_SEND_CEILING_PER_HOUR ?? '').trim(), 10);
  return Number.isFinite(raw) && raw > 0 ? raw : challengeInternals.SEND_CEILING_MAX;
}

/**
 * @param {{ db, sendEmail: (m: object) => Promise<object>,
 *           getConfig: () => Promise<object>,
 *           notifyOperator?: (e: object) => Promise<object>,
 *           sendCeilingMax?: number, sendCeilingWindowMs?: number,
 *           now?: () => number, log?: Pick<Console, 'warn'|'error'> }} deps
 */
function createSendOtpHandler({
  db,
  sendEmail,
  getConfig,
  notifyOperator,
  sendCeilingMax = challengeInternals.SEND_CEILING_MAX,
  sendCeilingWindowMs = challengeInternals.SEND_CEILING_WINDOW_MS,
  now = Date.now,
  log = console,
  renderFn = render,
}) {
  return async function sendOtpCode(req, res) {
    if (req.method !== 'POST') {
      res.set('Allow', 'POST');
      res.status(405).json({ error: { code: 'method-not-allowed', message: 'Use POST.' } });
      return;
    }
    const email = typeof req.body?.email === 'string' ? normalizeEmail(req.body.email) : '';
    if (!EMAIL_RE.test(email)) {
      res.status(400).json({ error: { code: 'bad-request', message: 'A valid email address is required.' } });
      return;
    }

    const config = await getConfig();
    const code = generateOtpCode();

    // Render first — a broken override must not consume a rate-limit slot.
    const template = getDefaultTemplate('auth.otp');
    const { override } = await loadTemplate({ db, id: 'auth.otp', now });
    const rendered = renderFn({
      template,
      override,
      tokenValues: { code, expiry_minutes: String(EXPIRY_MINUTES) },
      config,
    });
    if (rendered.usedFallback) {
      // The client's sign-in keeps working on the shipped copy; the
      // operator learns the override is broken (spec §6.1 step 4) — via a
      // DURABLE system_errors row first (the notifier is best-effort and
      // may be configured to none), then the notifier.
      // Deterministic id: one durable row per distinct broken override,
      // not one per request — this runs before the rate limit, so an
      // attacker must not be able to mint unbounded Firestore writes.
      const errorId = crypto.createHash('sha256')
        .update(`template-override-invalid:auth.otp:${rendered.overrideErrors.join('|')}`, 'utf8')
        .digest('hex');
      const seenAt = new Date(now());
      try {
        await db.collection('system_errors').doc(errorId).create({
          kind: 'template-override-invalid',
          templateId: 'auth.otp',
          errors: rendered.overrideErrors,
          resolved: false,
          createdAt: seenAt,
          lastSeenAt: seenAt,
        });
      } catch (err) {
        if (!isAlreadyExists(err)) {
          log.error('system_errors write for auth.otp override fallback failed', err);
        } else {
          // The row for this fault class already exists — possibly marked
          // resolved after an earlier override was fixed. A create() alone
          // would leave a new, differently-caused fault with no durable
          // signal at all, so reopen it and stamp a fresh lastSeenAt. One
          // row per fault class is kept; operators also get a "still
          // happening" timestamp on a fault that was never resolved.
          try {
            await reopenSystemError({ db, errorId, seenAt });
          } catch (reopenErr) {
            log.error('system_errors reopen for auth.otp override fallback failed', reopenErr);
          }
        }
      }
      if (notifyOperator) {
        await notifyOperator({
          kind: 'warning',
          title: 'auth.otp override failed validation; shipped default used',
          summary: rendered.overrideErrors.join('; '),
          dedupeKey: 'auth-otp-override-fallback',
        });
      }
    }
    if (!renderedMailCarriesCode(rendered, code)) {
      log.error('auth.otp render lacks the code in html and/or text; refusing to send');
      res.status(500).json({ error: { code: 'internal', message: 'Sign-in mail could not be prepared.' } });
      return;
    }

    // The hint rides in the body too: Retry-After is not a CORS-safelisted
    // response header, so cross-origin JS cannot read it.
    const rateLimited = (retryAfterMs) => {
      const retryAfterSeconds = retryAfterMs ? Math.ceil(retryAfterMs / 1000) : null;
      if (retryAfterSeconds) res.set('Retry-After', String(retryAfterSeconds));
      res.status(429).json({
        error: { code: 'rate-limited', message: 'Too many code requests. Try again later.', retryAfterSeconds },
      });
    };

    const slot = await takeRateLimitSlot({ db, email, now });
    if (slot.limited) {
      rateLimited(slot.retryAfterMs);
      return;
    }

    // The deployment-wide ceiling runs AFTER the per-address bucket: a
    // single address hammering the endpoint is already stopped by its own
    // budget and must not be able to spend everyone else's (issue #45).
    // Same response shape as the per-address limit — a caller cannot tell
    // which control refused it.
    const ceiling = await takeGlobalSendSlot({ db, now, max: sendCeilingMax, windowMs: sendCeilingWindowMs });
    if (ceiling.limited) {
      log.error(`OTP send ceiling reached: ${ceiling.count} sends in the window (max ${sendCeilingMax})`);
      if (ceiling.firstTrip && notifyOperator) {
        // firstTrip is the durable, cross-container once-per-episode gate;
        // dedupeKey is the notifier's own in-memory window on top of it.
        await notifyOperator({
          kind: 'error',
          title: 'OTP send ceiling reached; sign-in codes are paused',
          summary: `${ceiling.count} sign-in codes were sent in the last ${Math.round(sendCeilingWindowMs / 60000)} minutes, reaching this deployment's ceiling of ${sendCeilingMax}. New code requests are refused until the window drains. Check for an email-bomb or a stuck client before raising the ceiling.`,
          fields: {
            ceiling: String(sendCeilingMax),
            windowMinutes: String(Math.round(sendCeilingWindowMs / 60000)),
            sendsInWindow: String(ceiling.count),
          },
          dedupeKey: 'otp-send-ceiling-tripped',
        });
      }
      rateLimited(ceiling.retryAfterMs);
      return;
    }

    const { token } = await createChallenge({ db, email, code, now });

    // No onceKey — every request must send a new code (spec §3.1).
    const result = await sendEmail({
      to: email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      tag: 'auth.otp',
      source: 'auth-otp',
      storeRendered: rendered.storeRendered,
      hasLegalFooterHtml: rendered.hasLegalFooterHtml,
      hasLegalFooterText: rendered.hasLegalFooterText,
    });
    if (result.status !== 'sent') {
      res.status(502).json({ error: { code: 'send-failed', message: 'The sign-in email could not be sent. Try again.' } });
      return;
    }

    res.status(200).json({ challengeId: token, expiresInMinutes: EXPIRY_MINUTES });
  };
}

/**
 * @param {{ db, auth: { getUserByEmail: (email: string) => Promise<{uid: string}>,
 *           createUser: (props: object) => Promise<{uid: string}>,
 *           createCustomToken: (uid: string) => Promise<string> },
 *           now?: () => number, log?: Pick<Console, 'warn'|'error'> }} deps
 */
function createVerifyOtpHandler({ db, auth, now = Date.now, log = console }) {
  return async function verifyOtpCode(req, res) {
    if (req.method !== 'POST') {
      res.set('Allow', 'POST');
      res.status(405).json({ error: { code: 'method-not-allowed', message: 'Use POST.' } });
      return;
    }
    const email = typeof req.body?.email === 'string' ? normalizeEmail(req.body.email) : '';
    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
    const challengeId = req.body?.challengeId;
    if (!EMAIL_RE.test(email) || !/^\d{6}$/.test(code) || typeof challengeId !== 'string') {
      res.status(400).json({ error: { code: 'bad-request', message: 'challengeId, email, and the 6-digit code are required.' } });
      return;
    }

    const verdict = await verifyChallenge({ db, token: challengeId, email, code, now });
    if (!verdict.ok) {
      // One failure shape for every miss — no oracle.
      res.status(401).json({ error: { code: 'invalid-code', message: 'That code is invalid or has expired. Request a new one.' } });
      return;
    }

    // The challenge is marked consumed (concurrent replay blocked) but not
    // yet deleted: a transient Auth failure below releases it so the user
    // can retry the same code instead of burning another rate slot.
    let token;
    try {
      let uid;
      try {
        uid = (await auth.getUserByEmail(verdict.email)).uid;
      } catch (err) {
        if (err?.code !== 'auth/user-not-found') throw err;
        uid = (await auth.createUser({ email: verdict.email, emailVerified: true })).uid;
      }
      token = await auth.createCustomToken(uid);
    } catch (err) {
      log.error('token issuance failed after successful verification', err);
      try {
        await releaseChallenge({ db, token: challengeId });
      } catch (releaseErr) {
        log.error('challenge release failed', releaseErr);
      }
      res.status(500).json({ error: { code: 'internal', message: 'Sign-in failed. Try again.' } });
      return;
    }

    // Best-effort: a failed delete leaves a consumed challenge for the
    // sweeper; it can never be verified again.
    try {
      await finalizeChallenge({ db, token: challengeId });
    } catch (err) {
      log.error('challenge finalize failed', err);
    }
    res.status(200).json({ token });
  };
}

/**
 * App Check enforcement options for the two public OTP endpoints (issue
 * #45). Off by default so an existing deployment keeps working untouched;
 * a deployment that has provisioned a reCAPTCHA site key for the web app
 * sets EVENT_APP_CHECK_ENFORCED=true and every unattested request is
 * rejected by the platform before the handler runs.
 *
 * Deploy-time, not runtime, on purpose: this is the control that survives
 * an attacker who ignores our own rate buckets entirely.
 *
 * @param {Record<string, string|undefined>} [env]
 * @returns {{ enforceAppCheck?: true }} spread into the onRequest options
 */
function appCheckOptions(env = process.env) {
  const raw = String(env.EVENT_APP_CHECK_ENFORCED ?? '').trim().toLowerCase();
  return raw === 'true' ? { enforceAppCheck: true } : {};
}

/** Deployable exports (spec §1.3): sendOtpCode, verifyOtpCode, cleanup. */
function buildHandlers() {
  const { onRequest } = require('firebase-functions/v2/https');
  const { onSchedule } = require('firebase-functions/v2/scheduler');
  const { defineSecret } = require('firebase-functions/params');
  const { SEND_SECRETS_BY_PROVIDER } = require('../email/send.cjs').internals;

  const providerName = (process.env.EVENT_EMAIL_PROVIDER || '').trim();
  // Send-path secrets only — never the delivery-ingest set (a postmark
  // deployment without ingest has no EMAIL_WEBHOOK_BASIC_AUTH to bind).
  // The operator webhook sink runs inside this function on a broken
  // override, so its secrets bind here too when that notifier is selected.
  const secretNames = new Set(SEND_SECRETS_BY_PROVIDER[providerName] || []);
  if ((process.env.EVENT_OPERATOR_NOTIFIER || '').trim() === 'webhook') {
    secretNames.add('OPERATOR_WEBHOOK_URL');
    secretNames.add('OPERATOR_WEBHOOK_SECRET');
  }
  const secrets = [...secretNames].map(defineSecret);
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';
  const appCheck = appCheckOptions(process.env);
  const sendCeilingMax = parseSendCeiling(process.env);

  const buildDeps = () => {
    const { getDb } = require('../core/firestore.cjs');
    const { getEventConfig } = require('../core/config.cjs');
    const { getEmailProvider } = require('../email/providers/index.cjs');
    const { createEmailCore } = require('../email/send.cjs');
    const { createOperatorNotifier } = require('../notify/operator.cjs');
    const db = getDb();
    const getConfig = () => getEventConfig({ db });
    const emailCore = createEmailCore({ db, provider: getEmailProvider({ env: process.env }), getConfig });
    const notifier = createOperatorNotifier({ env: process.env, getConfig, sendEmail: emailCore.send });
    return { db, getConfig, sendEmail: emailCore.send, notifyOperator: notifier.notify, sendCeilingMax };
  };

  const withCors = (handler) => async (req, res) => {
    const { applyCors, parseAllowedOrigins } = require('../core/http.cjs');
    const handled = applyCors(req, res, {
      allowedOrigins: parseAllowedOrigins(process.env.EVENT_ALLOWED_ORIGINS),
    });
    if (handled) return;
    await handler(req, res);
  };

  return {
    sendOtpCode: onRequest({ region, secrets, ...appCheck }, withCors(async (req, res) => {
      await createSendOtpHandler(buildDeps())(req, res);
    })),
    verifyOtpCode: onRequest({ region, ...appCheck }, withCors(async (req, res) => {
      const { getDb } = require('../core/firestore.cjs');
      const { getAuth } = require('firebase-admin/auth');
      await createVerifyOtpHandler({ db: getDb(), auth: getAuth() })(req, res);
    })),
    cleanupExpiredAuthChallenges: onSchedule({ region, schedule: 'every 24 hours' }, async () => {
      const { getDb } = require('../core/firestore.cjs');
      await sweepExpired({ db: getDb() });
    }),
  };
}

module.exports = {
  createSendOtpHandler,
  createVerifyOtpHandler,
  generateOtpCode,
  get handlers() {
    return buildHandlers();
  },
  internals: {
    renderedMailCarriesCode,
    reopenSystemError,
    appCheckOptions,
    parseSendCeiling,
    EXPIRY_MINUTES,
    EMAIL_RE,
    LAST_SEEN_REFRESH_MS,
  },
};
