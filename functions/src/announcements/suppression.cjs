'use strict';

/**
 * Announcement email unsubscribe (issue #490).
 *
 *   emailUnsubscribe         public GET and POST at the signed link every
 *                            announcement carries. GET shows one button;
 *                            POST records the opt-out. A mail client's
 *                            one-click POST (RFC 8058, the
 *                            List-Unsubscribe-Post header) reaches the same
 *                            POST path.
 *   removeEmailSuppression   staff POST { email }: the removal path, for a
 *                            person who asks to get announcements again.
 *
 * THE SUPPRESSION RECORD. `email_suppressions/{id}` where id is the SHA-256
 * of the lowercased address. The record holds no address, so the
 * collection is not a second mailing list. Audience resolution hashes each
 * candidate address and leaves out every one with a record, so a later
 * send honours the opt-out. It covers announcement email only: sign-in
 * codes, receipts and speaker mail are transactional and do not read it.
 *
 * THE SIGNED LINK. The link names the send and the recipient's suppression
 * id, plus an HMAC-SHA256 of the two under a random key that lives only on
 * the server-only send record (`announcement_sends/{sendId}.unsubscribeKey`).
 * That keeps the ADR's rule of no new deployment secret (ADR §3.1), and a
 * link cannot be forged for another address or another send. A test send
 * carries an inert link (`?test=1`) that changes nothing.
 *
 * A GET never records an opt-out: mail scanners fetch links, and a scanner
 * must not unsubscribe a reader. A request whose signature fails is rate
 * limited per client IP; a correctly signed one never is, because mail
 * providers and link scanners send many readers' requests from one
 * address. Each recorded opt-out writes an admin_logs row with no address.
 */

const crypto = require('node:crypto');
const { requireAdmin } = require('../core/auth.cjs');
const { sendError, badRequest, methodNotAllowed, internal } = require('../core/errors.cjs');
const { logAdminAction } = require('../cms/store.cjs');
const { checkDemoWrites } = require('../core/demoWrites.cjs');
const { internals: clientErrorInternals } = require('../telemetry/clientErrors.cjs');

const { extractClientIp, hashIp } = clientErrorInternals;

const SUPPRESSIONS = 'email_suppressions';
const SENDS = 'announcement_sends';
const RATE_LIMIT_COLLECTION = 'unsubscribe_rate_limits';
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const UNSUBSCRIBE_PATH = '/unsubscribe';
const SEND_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const SUPPRESSION_ID_RE = /^[0-9a-f]{64}$/;
const SIGNATURE_RE = /^[A-Za-z0-9_-]{43}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 320;

/** The lowercased, trimmed form every comparison uses. @param {string} email */
function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

/** The suppression record id for an address. @param {string} email */
function suppressionIdFor(email) {
  return crypto.createHash('sha256').update(normalizeEmail(email), 'utf8').digest('hex');
}

/** @param {string} key hex @param {string} sendId @param {string} rid */
function signUnsubscribe(key, sendId, rid) {
  return crypto.createHmac('sha256', Buffer.from(key, 'hex')).update(`${sendId}.${rid}`, 'utf8').digest('base64url');
}

/** Constant-time compare of two signatures. */
function signaturesMatch(a, b) {
  const da = crypto.createHash('sha256').update(String(a), 'utf8').digest();
  const db = crypto.createHash('sha256').update(String(b), 'utf8').digest();
  return crypto.timingSafeEqual(da, db);
}

/** A fresh per-send signing key, hex. */
function newUnsubscribeKey() {
  return crypto.randomBytes(32).toString('hex');
}

/** @param {object} config */
function siteUrlOf(config) {
  const url = config?.tierA?.publicUrl;
  return typeof url === 'string' ? url.replace(/\/+$/, '') : '';
}

/**
 * The live link for one recipient of one send, or null when the site has
 * no public URL to put it on.
 */
function unsubscribeUrlFor({ config, sendId, key, email }) {
  const site = siteUrlOf(config);
  if (!site) return null;
  const rid = suppressionIdFor(email);
  const params = new URLSearchParams({ s: sendId, r: rid, t: signUnsubscribe(key, sendId, rid) });
  return `${site}${UNSUBSCRIBE_PATH}?${params.toString()}`;
}

/** The inert link a test send and the preview carry. */
function testUnsubscribeUrl(config) {
  const site = siteUrlOf(config);
  return site ? `${site}${UNSUBSCRIBE_PATH}?test=1` : null;
}

/**
 * Which of the given suppression ids hold a record. Reads by document id in
 * groups, so the cost is one read per candidate and no query index.
 * @param {FirebaseFirestore.Firestore} db @param {string[]} ids
 * @returns {Promise<Set<string>>}
 */
async function readSuppressedIds(db, ids) {
  const found = new Set();
  const unique = [...new Set(ids)];
  for (let start = 0; start < unique.length; start += 300) {
    const refs = unique.slice(start, start + 300).map((id) => db.collection(SUPPRESSIONS).doc(id));
    if (refs.length === 0) continue;
    const snaps = await db.getAll(...refs);
    for (const snap of snaps) if (snap.exists) found.add(snap.id);
  }
  return found;
}

/**
 * Record an opt-out. Idempotent: a repeat keeps the first time.
 * @param {{ db, id: string, via: string, sendId?: string|null, now?: () => number }} args
 */
async function recordSuppression({ db, id, via, sendId = null, now = Date.now }) {
  const ref = db.collection(SUPPRESSIONS).doc(id);
  try {
    await ref.create({ scope: 'announcements', via, sendId, createdAt: new Date(now()) });
    return { created: true };
  } catch (err) {
    if (err?.code === 6 || err?.code === 'already-exists' || /ALREADY_EXISTS/i.test(String(err?.message || ''))) {
      return { created: false };
    }
    throw err;
  }
}

async function takeRateLimitSlot({ db, ipHash, now = Date.now }) {
  const ref = db.collection(RATE_LIMIT_COLLECTION).doc(ipHash);
  const nowMs = now();
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const requests = (Array.isArray(snap.exists ? snap.data()?.requests : null) ? snap.data().requests : [])
      .filter((at) => typeof at === 'number' && nowMs - at < RATE_LIMIT_WINDOW_MS);
    if (requests.length >= RATE_LIMIT_MAX) return { limited: true };
    tx.set(ref, { requests: [...requests, nowMs], updatedAt: new Date(nowMs) });
    return { limited: false };
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * A small standalone page. System colours only, so no brand or hex value
 * appears here, and no script.
 */
function page({ title, body, form = null }) {
  const formHtml = form
    ? `<form method="post" action="${escapeHtml(form.action)}"><button type="submit">${escapeHtml(form.label)}</button></form>`
    : '';
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex">',
    `<title>${escapeHtml(title)}</title>`,
    '<style>body{font-family:system-ui,sans-serif;background:Canvas;color:CanvasText;margin:0;padding:48px 16px;line-height:1.5}',
    'main{max-width:36rem;margin:0 auto}button{font:inherit;padding:10px 20px;cursor:pointer}',
    'button:focus-visible{outline:3px solid Highlight;outline-offset:2px}</style>',
    '</head>',
    '<body><main>',
    `<h1>${escapeHtml(title)}</h1>`,
    `<p>${escapeHtml(body)}</p>`,
    formHtml,
    '</main></body>',
    '</html>',
  ].join('\n');
}

function sendPage(res, status, content) {
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.set('Cache-Control', 'no-store');
  res.set('X-Robots-Tag', 'noindex');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'");
  res.status(status).send(content);
}

function queryParam(req, name) {
  const value = req.query?.[name];
  return typeof value === 'string' ? value : null;
}

/**
 * @param {{ db, getConfig: () => Promise<object>, now?: () => number,
 *           log?: Pick<Console, 'error'|'warn'> }} deps
 */
function createEmailUnsubscribeHandler({ db, getConfig, now = Date.now, log = console }) {
  return async function emailUnsubscribe(req, res) {
    if (req.method === 'OPTIONS') {
      // The deploy smoke job preflights every export; no CORS is granted.
      res.set('Allow', 'GET, POST');
      return res.status(204).send('');
    }
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.set('Allow', 'GET, POST');
      return sendPage(res, 405, page({ title: 'Unsubscribe', body: 'Open the link from your email.' }));
    }
    let config = null;
    try {
      config = await getConfig();
    } catch (err) {
      log.error('emailUnsubscribe config read failed', err);
    }
    const eventName = config?.event?.name || 'this event';

    if (queryParam(req, 'test') === '1') {
      return sendPage(res, 200, page({
        title: 'Test message link',
        body: 'This link is from a test message. Nothing changed.',
      }));
    }

    const sendId = queryParam(req, 's');
    const rid = queryParam(req, 'r');
    const signature = queryParam(req, 't');
    const invalid = () => sendPage(res, 400, page({
      title: 'This link is not valid',
      body: 'Copy the whole unsubscribe link from your email, or reply to the email to ask the organizers.',
    }));
    if (!sendId || !SEND_ID_RE.test(sendId) || !rid || !SUPPRESSION_ID_RE.test(rid)
        || !signature || !SIGNATURE_RE.test(signature)) {
      return invalid();
    }

    try {
      // The signature is checked first, and a correctly signed request is
      // never rate limited. Mail providers post one-click opt-outs from
      // their own servers and link scanners fetch every link, so many
      // readers share one client address; a per-address limit on them
      // would drop real opt-outs that no mail client retries. Only a
      // request that fails the check takes a slot.
      const sendSnap = await db.collection(SENDS).doc(sendId).get();
      const key = sendSnap.exists ? sendSnap.data()?.unsubscribeKey : null;
      if (typeof key !== 'string' || !signaturesMatch(signUnsubscribe(key, sendId, rid), signature)) {
        const limit = await takeRateLimitSlot({ db, ipHash: hashIp(extractClientIp(req)), now });
        if (limit.limited) {
          return sendPage(res, 429, page({ title: 'Try again later', body: 'Too many requests came from this network. Try again in 15 minutes.' }));
        }
        return invalid();
      }

      if (req.method === 'GET') {
        return sendPage(res, 200, page({
          title: 'Unsubscribe from announcements',
          body: `Stop announcement emails from ${eventName}. You still get sign-in codes and receipts.`,
          // A query-only action posts back to the path this page came from,
          // the site rewrite or the function URL alike.
          form: { action: `?${new URLSearchParams({ s: sendId, r: rid, t: signature })}`, label: 'Unsubscribe' },
        }));
      }

      const policy = await checkDemoWrites({ db });
      if (!policy.ok) {
        return sendPage(res, policy.status || 503, page({ title: 'Nothing changed', body: policy.message }));
      }
      const oneClick = req.body && typeof req.body === 'object' && req.body['List-Unsubscribe'] === 'One-Click';
      const via = oneClick ? 'one-click' : 'link';
      const recorded = await recordSuppression({ db, id: rid, via, sendId, now });
      if (recorded.created) {
        await logAdminAction({
          db,
          action: 'emailUnsubscribe',
          docPath: `${SUPPRESSIONS}/${rid}`,
          actor: { uid: null, email: null },
          details: { sendId, via },
          now,
          log,
        });
      }
      return sendPage(res, 200, page({
        title: 'You are unsubscribed',
        body: `You will not get announcement emails from ${eventName} again. You still get sign-in codes and receipts.`,
      }));
    } catch (err) {
      log.error('emailUnsubscribe failed', err);
      return sendPage(res, 500, page({ title: 'Nothing changed', body: 'The server could not record this request. Try the link again later.' }));
    }
  };
}

/**
 * Staff removal path: delete the suppression record for one address, so
 * that address is in the next announcement audience again.
 */
function createRemoveEmailSuppressionHandler({ db, auth, getConfig, now = Date.now, log = console }) {
  return async function removeEmailSuppression(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const gate = await requireAdmin({ auth, db, getConfig }, req, { tier: 'staff' });
    if (!gate.ok) return sendError(res, gate.status, gate.code, gate.message);
    const email = normalizeEmail(req.body?.email);
    if (!email || email.length > MAX_EMAIL_LENGTH || !EMAIL_RE.test(email)) {
      return badRequest(res, 'email: must be an email address');
    }
    const id = suppressionIdFor(email);
    let removed = false;
    try {
      const ref = db.collection(SUPPRESSIONS).doc(id);
      const snap = await ref.get();
      if (snap.exists) {
        await ref.delete();
        removed = true;
      }
    } catch (err) {
      log.error('removeEmailSuppression failed', err);
      return internal(res, 'The address could not be restored.');
    }
    if (removed) {
      await logAdminAction({
        db,
        action: 'removeEmailSuppression',
        docPath: `${SUPPRESSIONS}/${id}`,
        actor: { uid: gate.uid, email: gate.email },
        now,
        log,
      });
    }
    return res.status(200).json({ removed });
  };
}

/** Deployable exports (spec §1.3): emailUnsubscribe, removeEmailSuppression. */
function buildHandlers() {
  const { onRequest } = require('firebase-functions/v2/https');
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';
  const buildDeps = () => {
    const { getDb } = require('../core/firestore.cjs');
    const { getAuth } = require('firebase-admin/auth');
    const { getEventConfig } = require('../core/config.cjs');
    const db = getDb();
    return { db, auth: getAuth(), getConfig: () => getEventConfig({ db }) };
  };
  const withCors = (handler) => async (req, res) => {
    const { applyCors, parseAllowedOrigins } = require('../core/http.cjs');
    if (applyCors(req, res, { allowedOrigins: parseAllowedOrigins(process.env.EVENT_ALLOWED_ORIGINS) })) return;
    await handler(req, res);
  };
  return {
    // Reached from a mail client and from the site's /unsubscribe rewrite,
    // never from the admin app, so it takes no CORS wrapper.
    emailUnsubscribe: onRequest({ region }, async (req, res) => {
      await createEmailUnsubscribeHandler(buildDeps())(req, res);
    }),
    removeEmailSuppression: onRequest({ region }, withCors(async (req, res) => {
      await createRemoveEmailSuppressionHandler(buildDeps())(req, res);
    })),
  };
}

module.exports = {
  get handlers() { return buildHandlers(); },
  SUPPRESSIONS,
  normalizeEmail,
  suppressionIdFor,
  signUnsubscribe,
  newUnsubscribeKey,
  unsubscribeUrlFor,
  testUnsubscribeUrl,
  readSuppressedIds,
  recordSuppression,
  createEmailUnsubscribeHandler,
  createRemoveEmailSuppressionHandler,
  internals: {
    RATE_LIMIT_COLLECTION,
    RATE_LIMIT_MAX,
    UNSUBSCRIBE_PATH,
    EMAIL_RE,
    siteUrlOf,
    page,
  },
};
