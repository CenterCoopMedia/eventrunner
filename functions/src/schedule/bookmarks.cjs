'use strict';

/**
 * bookmarkSession — toggle a personal session bookmark (spec §9 "Bookmarks":
 * split out of the shared reactions/bookmarks backend block the reference
 * implementation occupied; access gated via `hasAttendeeAccess`).
 *
 * Two collections, spec §4.1:
 *   users/{uid}/bookmarks/{sessionId}   { bookmarkedAt } — the per-user
 *     membership record. Private to its owner (firestore.rules: self-read,
 *     no client write — every write goes through this handler). The
 *     frontend's "my schedule" view reads this subcollection directly.
 *   sessionBookmarks/{sessionId}        { count, updatedAt } — the public
 *     aggregate the table (§4.1) describes. Kept in the SAME transaction as
 *     the membership write so the two can never drift out of sync.
 *
 * `bookmarked` in the request body is the caller's DESIRED state, not a
 * toggle signal — idempotent by construction: bookmarking an
 * already-bookmarked session (e.g. a retried request) is a no-op, not a
 * double-increment.
 */

const { requireAttendeeAccess } = require('../core/auth.cjs');
const {
  sendError,
  badRequest,
  notFound,
  methodNotAllowed,
  internal,
} = require('../core/errors.cjs');

class SessionNotFoundError extends Error {
  constructor(sessionId) {
    super(`cmsSchedule/${sessionId} does not exist or is not visible`);
    this.name = 'SessionNotFoundError';
  }
}

/**
 * @param {{ db: FirebaseFirestore.Firestore, uid: string, sessionId: string,
 *           bookmarked: boolean, now?: () => number }} args
 * @returns {Promise<{ bookmarked: boolean, count: number }>}
 * @throws {SessionNotFoundError} the session does not exist or is hidden
 */
async function toggleSessionBookmark({ db, uid, sessionId, bookmarked, now = Date.now }) {
  const sessionRef = db.collection('cmsSchedule').doc(sessionId);
  const membershipRef = db.collection(`users/${uid}/bookmarks`).doc(sessionId);
  const aggregateRef = db.collection('sessionBookmarks').doc(sessionId);

  return db.runTransaction(async (tx) => {
    const sessionSnap = await tx.get(sessionRef);
    if (!sessionSnap.exists || sessionSnap.data()?.visible !== true) {
      throw new SessionNotFoundError(sessionId);
    }
    const [membershipSnap, aggregateSnap] = await Promise.all([
      tx.get(membershipRef),
      tx.get(aggregateRef),
    ]);
    const alreadyBookmarked = membershipSnap.exists;
    const storedCount =
      aggregateSnap.exists && typeof aggregateSnap.data()?.count === 'number'
        ? aggregateSnap.data().count
        : 0;

    // Desired state already holds — no-op, but still report the true count
    // rather than trusting a caller's stale copy.
    if (bookmarked === alreadyBookmarked) {
      return { bookmarked: alreadyBookmarked, count: storedCount };
    }

    const at = new Date(now());
    const nextCount = bookmarked ? storedCount + 1 : Math.max(0, storedCount - 1);
    if (bookmarked) {
      tx.set(membershipRef, { bookmarkedAt: at });
    } else {
      tx.delete(membershipRef);
    }
    tx.set(aggregateRef, { count: nextCount, updatedAt: at });
    return { bookmarked, count: nextCount };
  });
}

/**
 * @param {{ db: object, auth: object, getConfig: () => Promise<object>,
 *           now?: () => number, log?: Pick<Console, 'warn'|'error'> }} deps
 */
function createBookmarkSessionHandler({ db, auth, getConfig, now = Date.now, log = console }) {
  return async function handler(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

    // Defense in depth: the client already hides bookmark UI behind this
    // flag (Schedule.jsx), but a direct POST must not bypass it.
    const config = await getConfig();
    if (config?.features?.sessionBookmarks !== true) {
      return notFound(res, 'Session bookmarking is not enabled for this event.');
    }

    const gate = await requireAttendeeAccess({ auth, db }, req);
    if (!gate.ok) return sendError(res, gate.status, gate.code, gate.message);

    const { sessionId, bookmarked } = req.body || {};
    if (typeof sessionId !== 'string' || !sessionId) {
      return badRequest(res, 'sessionId: must be a non-empty string');
    }
    if (typeof bookmarked !== 'boolean') {
      return badRequest(res, 'bookmarked: must be a boolean');
    }

    let result;
    try {
      result = await toggleSessionBookmark({ db, uid: gate.uid, sessionId, bookmarked, now });
    } catch (err) {
      if (err instanceof SessionNotFoundError) return notFound(res, 'Session not found.');
      log.error('bookmarkSession failed', err);
      return internal(res, 'The bookmark could not be saved.');
    }
    res.status(200).json(result);
  };
}

/**
 * Deployable export: bookmarkSession. firebase-functions and firebase-admin
 * are required lazily HERE ONLY (house rule, spec §1.3).
 */
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
    bookmarkSession: onRequest(
      { region },
      withCors(async (req, res) => {
        await createBookmarkSessionHandler(buildDeps())(req, res);
      }),
    ),
  };
}

module.exports = {
  createBookmarkSessionHandler,
  get handlers() {
    return buildHandlers();
  },
  internals: { toggleSessionBookmark, SessionNotFoundError },
};
