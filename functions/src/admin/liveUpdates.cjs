'use strict';

/**
 * Live updates dashboard feed — admin-form authored (spec §9 "Live updates
 * card", issue #28). Migrated WITHOUT the Slack ingestion path: the original
 * feature's `slackPushWebhook` and its four secrets are not ported (the
 * issue is explicit that this is now fed by an admin form only).
 *
 *   saveLiveUpdate   POST { id?, update: { message, pinned? } } — create or
 *                    edit one entry. Omitting `id` creates a new entry with a
 *                    random id. `postedAt` is stamped once, on first create,
 *                    and preserved on every later edit — editing a typo must
 *                    not bump an entry back to the top of a time-ordered feed.
 *   deleteLiveUpdate POST { id } — remove one entry.
 *
 * `live_updates` has no draft/publish revision model (unlike cmsUpdates):
 * every write lands directly on the live doc, and firestore.rules make the
 * collection anonymously readable (a plain admin-authored feed, not gated
 * editorial content) with all writes denied to clients — only this module,
 * via the Admin SDK, ever writes it. Every write gets an admin_logs row
 * (cms/store.cjs's logAdminAction, same best-effort contract as elsewhere:
 * a failed audit write never fails the mutation it describes).
 *
 * The public doc deliberately carries no actor identity: `live_updates` is
 * anonymously readable, and config/bootstrap.adminEmails is a server-only
 * allowlist (firestore.rules denies even an admin a direct read of it) —
 * stamping `updatedBy` here would let any visitor enumerate admin addresses
 * simply by reading the feed. Actor identity lives ONLY in admin_logs
 * (admin-read-only), which already records it on every write.
 */

const crypto = require('node:crypto');
const { requireAdmin } = require('../core/auth.cjs');
const { sendError, badRequest, notFound, methodNotAllowed, internal } = require('../core/errors.cjs');
const { logAdminAction } = require('../cms/store.cjs');
const { internals: pagesInternals } = require('../cms/pages.cjs');

const { DOC_ID_RE } = pagesInternals;

const LIVE_UPDATES_COLLECTION = 'live_updates';
const MAX_MESSAGE_LEN = 1000;

/** Keys a live_updates doc may carry — anything else is rejected by name. */
const UPDATE_KEYS = Object.freeze(['message', 'pinned']);

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * Validate a live_updates content doc. Pure — no db, no clock. Returns every
 * error, each naming the offending field.
 *
 * @param {unknown} doc
 * @returns {{ ok: boolean, errors: string[] }}
 */
function validateLiveUpdateDoc(doc) {
  const errors = [];
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    return { ok: false, errors: ['update: must be an object'] };
  }
  for (const key of Object.keys(doc)) {
    if (!UPDATE_KEYS.includes(key)) errors.push(`${key}: unknown field`);
  }
  if (!isNonEmptyString(doc.message)) {
    errors.push('message: must be a non-empty string');
  } else if (doc.message.length > MAX_MESSAGE_LEN) {
    errors.push(`message: must be ${MAX_MESSAGE_LEN} characters or fewer`);
  }
  if ('pinned' in doc && typeof doc.pinned !== 'boolean') {
    errors.push('pinned: must be a boolean');
  }
  return { ok: errors.length === 0, errors };
}

/**
 * @param {{ db: FirebaseFirestore.Firestore,
 *           auth: { verifyIdToken: (t: string) => Promise<object> },
 *           getConfig: () => Promise<object>,
 *           now?: () => number, log?: Pick<Console, 'warn'|'error'> }} deps
 */
function createSaveLiveUpdateHandler({ db, auth, getConfig, now = Date.now, log = console }) {
  return async function saveLiveUpdate(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const gate = await requireAdmin({ auth, getConfig }, req);
    if (!gate.ok) return sendError(res, gate.status, gate.code, gate.message);

    const update = req.body?.update;
    const verdict = validateLiveUpdateDoc(update);
    if (!verdict.ok) return badRequest(res, `Invalid update: ${verdict.errors.join('; ')}`);

    const rawId = req.body?.id;
    if (rawId !== undefined && (!isNonEmptyString(rawId) || !DOC_ID_RE.test(rawId))) {
      return badRequest(res, 'id: must be a valid live update id');
    }
    const id = rawId === undefined ? crypto.randomUUID() : rawId;

    const at = new Date(now());
    const ref = db.collection(LIVE_UPDATES_COLLECTION).doc(id);
    try {
      const snap = await ref.get();
      // postedAt is stamped once and never moved: an edit fixing a typo must
      // not bump an entry back to the top of a time-ordered feed.
      const postedAt = snap.exists && snap.data()?.postedAt ? snap.data().postedAt : at;
      // No updatedBy/actor field here — see the module doc comment: this
      // doc is anonymously readable, and admin_logs (below) is where actor
      // identity belongs.
      await ref.set({
        message: update.message,
        pinned: update.pinned === true,
        postedAt,
        updatedAt: at,
      });
    } catch (err) {
      log.error('saveLiveUpdate write failed', err);
      return internal(res, 'The live update could not be saved.');
    }
    await logAdminAction({
      db,
      action: 'saveLiveUpdate',
      docPath: `${LIVE_UPDATES_COLLECTION}/${id}`,
      actor: { uid: gate.uid, email: gate.email },
      now,
      log,
    });
    res.status(200).json({ id });
  };
}

/**
 * @param {{ db: FirebaseFirestore.Firestore,
 *           auth: { verifyIdToken: (t: string) => Promise<object> },
 *           getConfig: () => Promise<object>,
 *           now?: () => number, log?: Pick<Console, 'warn'|'error'> }} deps
 */
function createDeleteLiveUpdateHandler({ db, auth, getConfig, now = Date.now, log = console }) {
  return async function deleteLiveUpdate(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const gate = await requireAdmin({ auth, getConfig }, req);
    if (!gate.ok) return sendError(res, gate.status, gate.code, gate.message);

    const id = req.body?.id;
    if (!isNonEmptyString(id) || !DOC_ID_RE.test(id)) {
      return badRequest(res, 'id: must be a valid live update id');
    }

    const ref = db.collection(LIVE_UPDATES_COLLECTION).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return notFound(res, 'Live update not found.');

    try {
      await ref.delete();
    } catch (err) {
      log.error('deleteLiveUpdate failed', err);
      return internal(res, 'The live update could not be deleted.');
    }
    await logAdminAction({
      db,
      action: 'deleteLiveUpdate',
      docPath: `${LIVE_UPDATES_COLLECTION}/${id}`,
      actor: { uid: gate.uid, email: gate.email },
      now,
      log,
    });
    res.status(200).json({ id, deleted: true });
  };
}

/** Deployable exports (spec §1.3 admin/): saveLiveUpdate, deleteLiveUpdate. */
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
    const handled = applyCors(req, res, {
      allowedOrigins: parseAllowedOrigins(process.env.EVENT_ALLOWED_ORIGINS),
    });
    if (handled) return;
    await handler(req, res);
  };

  return {
    saveLiveUpdate: onRequest({ region }, withCors(async (req, res) => {
      await createSaveLiveUpdateHandler(buildDeps())(req, res);
    })),
    deleteLiveUpdate: onRequest({ region }, withCors(async (req, res) => {
      await createDeleteLiveUpdateHandler(buildDeps())(req, res);
    })),
  };
}

module.exports = {
  validateLiveUpdateDoc,
  createSaveLiveUpdateHandler,
  createDeleteLiveUpdateHandler,
  get handlers() {
    return buildHandlers();
  },
  internals: { UPDATE_KEYS, MAX_MESSAGE_LEN, LIVE_UPDATES_COLLECTION },
};
