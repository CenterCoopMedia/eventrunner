'use strict';

/**
 * The schedule share projection (issue #172).
 *
 * WHY THIS COLLECTION EXISTS. A shared personal schedule cannot ride on
 * users_public: the rules authorize that whole document from the profile's
 * own profileVisibility, so bookmarks stored there would inherit the
 * profile's level — every existing public profile would have started
 * leaking its saved sessions the moment the feature shipped. The schedule
 * therefore gets its own projection, with its own visibility field, its
 * own rules, and a private default that fails closed.
 *
 *   users/{uid}/bookmarks/{sessionId}   the canonical membership store
 *                                       (firestore.rules: self-read only,
 *                                       no client write).
 *   schedule_shares/{uid}               the projection: sessionIds, the
 *                                       owner's display name, and its OWN
 *                                       scheduleVisibility. Written ONLY
 *                                       by this module's server code —
 *                                       the rules deny every client write.
 *
 * CONSENT IS A SEPARATE ACT. scheduleVisibility is chosen by the owner
 * through setScheduleVisibility — a callable the owner drives, separately
 * from the profile visibility choice on the profile form. Widening is the
 * owner's decision; the client confirms before it, and the server never
 * widens on its own: the trigger below preserves whatever visibility is
 * already stored, and a missing or malformed stored value falls back to
 * `private`.
 *
 * IDEMPOTENCE, for the reason syncUserPublic's module doc gives: trigger
 * deliveries are unordered and retried, so every run re-reads the
 * membership subcollection and the account document and writes only when
 * the projection actually changes. A bookmark toggle an attendee regrets
 * a second later does not amplify into projection churn.
 */

const VISIBILITIES = Object.freeze(['private', 'attendees_only', 'public']);

/** The stored visibility when nothing usable is stored — fail closed. */
const DEFAULT_VISIBILITY = 'private';

/** @param {*} v @returns {boolean} */
function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

/** @param {*} v @returns {string} the value the rules will read it as */
function storedVisibility(value) {
  return VISIBILITIES.includes(value) ? value : DEFAULT_VISIBILITY;
}

/**
 * Build the projection document from what is stored right now. Pure; tests
 * drive it directly.
 *
 * @param {{ sessionIds: string[], displayName: unknown, existing: object | null,
 *           visibility?: string, now?: Date }} args
 *   `visibility` is set only by setScheduleVisibility — the owner's own
 *   consented choice; every other caller preserves what is stored.
 * @returns {object}
 */
function buildScheduleShare({ sessionIds, displayName, existing, visibility, now = new Date() }) {
  const names = Array.isArray(sessionIds) ? sessionIds.filter(isNonEmptyString) : [];
  return {
    sessionIds: [...new Set(names)].sort(),
    displayName: isNonEmptyString(displayName) ? displayName.trim() : null,
    scheduleVisibility:
      visibility !== undefined ? storedVisibility(visibility) : storedVisibility(existing?.scheduleVisibility),
    updatedAt: now,
  };
}

/** Whether `stored` (what the document holds now) equals `next` in the projected fields. */
function sameProjection(stored, next) {
  if (!stored) return false;
  const sameList =
    Array.isArray(stored.sessionIds) &&
    stored.sessionIds.length === next.sessionIds.length &&
    next.sessionIds.every((id, index) => stored.sessionIds[index] === id);
  return (
    sameList &&
    (stored.displayName ?? null) === next.displayName &&
    storedVisibility(stored.scheduleVisibility) === next.scheduleVisibility
  );
}

/**
 * Recompute one account's projection from the canonical stores.
 *
 * @param {{ db: FirebaseFirestore.Firestore, uid: string, now?: Date,
 *           visibility?: string, log?: Pick<Console, 'warn'> }} args
 * @returns {Promise<boolean>} whether a write was needed
 */
async function syncScheduleShare({ db, uid, now = new Date(), visibility, log = console }) {
  const [membersSnap, userSnap, shareSnap] = await Promise.all([
    db.collection(`users/${uid}/bookmarks`).get(),
    db
      .collection('users')
      .doc(uid)
      .get()
      .catch((err) => {
        log.warn(`schedule share: users/${uid} read failed`, err);
        return null;
      }),
    db
      .collection('schedule_shares')
      .doc(uid)
      .get()
      .catch((err) => {
        log.warn(`schedule share: schedule_shares/${uid} read failed`, err);
        return null;
      }),
  ]);

  const next = buildScheduleShare({
    sessionIds: membersSnap.docs.map((d) => d.id),
    displayName: userSnap?.exists ? userSnap.data()?.displayName : null,
    existing: shareSnap?.exists ? shareSnap.data() : null,
    visibility,
    now,
  });

  const stored = shareSnap?.exists ? shareSnap.data() : null;
  if (sameProjection(stored, next)) return false;
  await db.collection('schedule_shares').doc(uid).set(next);
  return true;
}

// ------------------------------------------------------------------ server

const { requireAttendeeAccess } = require('../core/auth.cjs');
const { sendError, badRequest, methodNotAllowed, internal } = require('../core/errors.cjs');

/**
 * The owner's consent act. requireAttendeeAccess keeps the endpoint to the
 * same callers who can hold bookmarks at all, and the visibility value is
 * validated against the closed list the rules read — a client cannot
 * invent a fourth level, and cannot write the projection by any other
 * route (the rules deny client writes outright).
 *
 * @param {{ db: object, auth: object, getConfig: () => Promise<object>,
 *           now?: () => number, log?: Pick<Console, 'warn'|'error'> }} deps
 */
function createSetScheduleVisibilityHandler({ db, auth, getConfig, now = Date.now, log = console }) {
  return async function handler(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

    const gate = await requireAttendeeAccess({ auth, db, getConfig }, req);
    if (!gate.ok) return sendError(res, gate.status, gate.code, gate.message);

    const { visibility } = req.body || {};
    if (!VISIBILITIES.includes(visibility)) {
      return badRequest(res, 'visibility: must be one of private, attendees_only, public');
    }

    try {
      await syncScheduleShare({ db, uid: gate.uid, visibility, now: new Date(now()) });
      const share = await db.collection('schedule_shares').doc(gate.uid).get();
      res.status(200).json({
        scheduleVisibility: share.exists ? share.data()?.scheduleVisibility : visibility,
        sessionIds: share.exists ? share.data()?.sessionIds ?? [] : [],
      });
    } catch (err) {
      log.error('setScheduleVisibility failed', err);
      internal(res, 'The schedule visibility could not be saved.');
    }
  };
}

// ---------------------------------------------------------------- triggers

/**
 * The wake-up the projection needs. The event payload is not the input:
 * like syncUserPublic, every run re-reads the canonical stores, so
 * out-of-order and duplicate deliveries converge on the same document.
 */
function buildHandlers() {
  const { onDocumentWritten } = require('firebase-functions/v2/firestore');
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

  const runSync = () => {
    const { getDb } = require('../core/firestore.cjs');
    return createSyncHandler(getDb());
  };

  function createSyncHandler(db) {
    return async (event) => {
      const uid = event?.params?.uid;
      if (typeof uid !== 'string' || !uid) return;
      try {
        await syncScheduleShare({ db, uid });
      } catch (err) {
        console.error(`schedule share sync failed for ${uid}`, err);
        throw err;
      }
    };
  }

  return {
    // A bookmark membership write, or a rename on the account, is the only
    // thing that can change the projection's content.
    syncScheduleShare: onDocumentWritten({ region, document: 'users/{uid}/bookmarks/{sessionId}' }, runSync()),
    syncScheduleShareOnAccountWrite: onDocumentWritten({ region, document: 'users/{uid}' }, runSync()),
    setScheduleVisibility: onRequest({ region }, withCors(async (req, res) => {
      await createSetScheduleVisibilityHandler(buildDeps())(req, res);
    })),
  };
}

module.exports = {
  internals: { buildScheduleShare, sameProjection, storedVisibility, syncScheduleShare, VISIBILITIES, DEFAULT_VISIBILITY },
  createSetScheduleVisibilityHandler,
  get handlers() {
    return buildHandlers();
  },
};
