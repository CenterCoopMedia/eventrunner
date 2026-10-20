'use strict';

/**
 * Live updates dashboard feed — admin-form authored (spec §9 "Live updates
 * card", issue #28). Migrated WITHOUT the Slack ingestion path: the original
 * feature's `slackPushWebhook` and its four secrets are not ported (the
 * issue is explicit that this is now fed by an admin form only).
 *
 *   saveLiveUpdate   POST { id?, update: { message, pinned?, category?,
 *                    audience? } } — create or edit one entry. Omitting `id`
 *                    creates a new entry with a random id. `postedAt` is
 *                    stamped once, on first create, and preserved on every
 *                    later edit — editing a typo must not bump an entry back
 *                    to the top of a time-ordered feed.
 *   deleteLiveUpdate POST { id } — remove one entry.
 *
 * `live_updates` has no draft/publish revision model (unlike cmsUpdates):
 * every write lands directly on the live doc, with all client writes denied
 * — only this module, via the Admin SDK, ever writes it.
 *
 * AUDIENCE (issue #200). Every row names who may read it: `everyone`,
 * `attendees` (approved attendees and speakers), or `speakers`.
 * firestore.rules enforce it at the database, so the card's query carries
 * the matching predicate and cannot widen it. The field is optional on the
 * wire and always stored. An edit that omits it keeps the row's audience,
 * so a client that does not know the field (an admin tab still open on an
 * older bundle) can never widen a speaker-only row. A new row, or an old
 * one with none, gets `everyone`, which is what every row meant before the
 * field existed. The rules fail closed on a row with no audience, so a save
 * is also how an old row gets one. The audience goes into the admin_logs
 * row with the one it replaced, so a widened row can be traced.
 *
 * CATEGORY. One short line the card sets as a tag, with the same rule the
 * Updates page's category uses (shared/update validUpdateCategory), so the
 * two tags cannot disagree. Optional; omitted on an edit, the row keeps its
 * category, and omitted on a new row, it is stored null.
 *
 * Every write gets an admin_logs row (cms/store.cjs's logAdminAction, same
 * best-effort contract as elsewhere: a failed audit write never fails the
 * mutation it describes).
 *
 * The public doc deliberately carries no actor identity: an `everyone` row is
 * anonymously readable, and config/bootstrap is a server-only
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
const { validUpdateCategory, UPDATE_CATEGORY_MAX } = require('shared/update');

const { DOC_ID_RE } = pagesInternals;

const LIVE_UPDATES_COLLECTION = 'live_updates';
const MAX_MESSAGE_LEN = 1000;

/** Keys a live_updates doc may carry — anything else is rejected by name. */
const UPDATE_KEYS = Object.freeze(['message', 'pinned', 'category', 'audience']);

/**
 * Who may read a row, narrowest last. firestore.rules
 * (readableLiveUpdateAudiences) and apps/web/src/lib/liveUpdatesSource.js
 * carry the same three words; rules cannot import this list.
 */
const AUDIENCES = Object.freeze(['everyone', 'attendees', 'speakers']);
const DEFAULT_AUDIENCE = 'everyone';

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
  if (doc.category !== undefined && doc.category !== null && !validUpdateCategory(doc.category)) {
    errors.push(`category: must be null or 1 to ${UPDATE_CATEGORY_MAX} characters on one line`);
  }
  if (doc.audience !== undefined && !AUDIENCES.includes(doc.audience)) {
    errors.push(`audience: must be one of ${AUDIENCES.join(', ')}`);
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
    const gate = await requireAdmin({ auth, db, getConfig }, req, { tier: 'staff' });
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
    let audience = DEFAULT_AUDIENCE;
    let previousAudience = null;
    try {
      const snap = await ref.get();
      const prior = snap.exists ? snap.data() : null;
      // postedAt is stamped once and never moved: an edit fixing a typo must
      // not bump an entry back to the top of a time-ordered feed.
      const postedAt = prior?.postedAt ? prior.postedAt : at;
      previousAudience = typeof prior?.audience === 'string' ? prior.audience : null;
      if (update.audience !== undefined) audience = update.audience;
      else if (AUDIENCES.includes(previousAudience)) audience = previousAudience;
      let category = typeof prior?.category === 'string' ? prior.category : null;
      if (update.category !== undefined) category = typeof update.category === 'string' ? update.category.trim() : null;
      // No updatedBy/actor field here — see the module doc comment: this
      // doc can be anonymously readable, and admin_logs (below) is where
      // actor identity belongs.
      await ref.set({
        message: update.message,
        pinned: update.pinned === true,
        category,
        audience,
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
      details: { audience, previousAudience },
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
    const gate = await requireAdmin({ auth, db, getConfig }, req, { tier: 'staff' });
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
  internals: { UPDATE_KEYS, MAX_MESSAGE_LEN, LIVE_UPDATES_COLLECTION, AUDIENCES, DEFAULT_AUDIENCE },
};
