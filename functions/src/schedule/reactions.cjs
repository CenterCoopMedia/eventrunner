'use strict';

/**
 * reactToSession — set (or clear) a caller's single emoji reaction on a
 * session (spec §9 "Session reactions": split out of the shared
 * reactions/bookmarks backend block the reference implementation occupied,
 * same as bookmarks.cjs; access gated via `hasAttendeeAccess`).
 *
 * "The one social feature kept (aggregate counts, no user-generated text,
 * near-zero moderation surface)" (issue #25) — so the reaction vocabulary is
 * a fixed, small, server-enforced set, not free text. There is no emoji
 * picker in the reference implementation to port verbatim (the reaction bar
 * there is a GitHub-issue-style fixed row), so REACTION_KINDS below is this
 * port's judgment call: five reactions covering the sentiments a session
 * card's audience would want to leave (agreement, appreciation, excitement,
 * insight, applause) without opening a text field. A client request naming
 * anything outside this set is a 400, same enforcement point as `bookmarked`
 * being required to be a boolean in bookmarks.cjs.
 *
 * Two collections, spec §4.1:
 *   sessionReactions/{sessionId}/users/{uid}  { emoji, reactedAt } — the
 *     per-user membership record: AT MOST ONE reaction per user per session
 *     (setting a new emoji replaces the old one; this is the "dedup"
 *     subcollection the spec names, and it is what makes a switch a single
 *     transactional decrement+increment instead of two separate calls).
 *     Private to its owner — no aggregate-only observer can read who left
 *     which reaction, only the counts.
 *   sessionReactions/{sessionId}              { counts, updatedAt } — the
 *     public aggregate: an object keyed by emoji, each value the current
 *     count. Kept in the SAME transaction as the membership write so the
 *     two can never drift out of sync (same discipline as
 *     sessionBookmarks/{sessionId}).
 *
 * `emoji` in the request body is the caller's DESIRED reaction — idempotent
 * by construction: reacting with an emoji the caller already left is a
 * no-op, not a double-increment. `emoji: null` clears the caller's
 * reaction entirely.
 */

const { requireAttendeeAccess } = require('../core/auth.cjs');
const {
  sendError,
  badRequest,
  notFound,
  methodNotAllowed,
  internal,
} = require('../core/errors.cjs');

/**
 * The fixed reaction vocabulary (see module doc above for why this is
 * fixed rather than free text). Exported so the web client and its tests
 * can render/validate against the same list instead of a second copy.
 */
const REACTION_KINDS = Object.freeze(['👍', '❤️', '🎉', '💡', '👏']);

class SessionNotFoundError extends Error {
  constructor(sessionId) {
    super(`cmsSchedule/${sessionId} does not exist or is not visible`);
    this.name = 'SessionNotFoundError';
  }
}

class InvalidReactionError extends Error {
  constructor(emoji) {
    super(`${JSON.stringify(emoji)} is not a supported reaction`);
    this.name = 'InvalidReactionError';
  }
}

function emptyCounts() {
  const counts = {};
  for (const kind of REACTION_KINDS) counts[kind] = 0;
  return counts;
}

/**
 * @param {{ db: FirebaseFirestore.Firestore, uid: string, sessionId: string,
 *           emoji: string|null, now?: () => number }} args
 * @returns {Promise<{ emoji: string|null, counts: Record<string, number> }>}
 * @throws {SessionNotFoundError} the session does not exist or is hidden
 * @throws {InvalidReactionError} `emoji` is neither null nor in REACTION_KINDS
 */
async function toggleSessionReaction({ db, uid, sessionId, emoji, now = Date.now }) {
  if (emoji !== null && !REACTION_KINDS.includes(emoji)) {
    throw new InvalidReactionError(emoji);
  }

  const sessionRef = db.collection('cmsSchedule').doc(sessionId);
  const membershipRef = db.collection(`sessionReactions/${sessionId}/users`).doc(uid);
  const aggregateRef = db.collection('sessionReactions').doc(sessionId);

  return db.runTransaction(async (tx) => {
    const sessionSnap = await tx.get(sessionRef);
    if (!sessionSnap.exists || sessionSnap.data()?.visible !== true) {
      throw new SessionNotFoundError(sessionId);
    }
    const [membershipSnap, aggregateSnap] = await Promise.all([
      tx.get(membershipRef),
      tx.get(aggregateRef),
    ]);
    const previousEmoji = membershipSnap.exists ? membershipSnap.data()?.emoji ?? null : null;
    const storedCounts = { ...emptyCounts(), ...(aggregateSnap.exists ? aggregateSnap.data()?.counts : null) };

    // Desired state already holds — no-op, but still report the true
    // counts rather than trusting a caller's stale copy.
    if (emoji === previousEmoji) {
      return { emoji: previousEmoji, counts: storedCounts };
    }

    const at = new Date(now());
    const nextCounts = { ...storedCounts };
    if (previousEmoji !== null) {
      nextCounts[previousEmoji] = Math.max(0, (nextCounts[previousEmoji] || 0) - 1);
    }
    if (emoji !== null) {
      nextCounts[emoji] = (nextCounts[emoji] || 0) + 1;
    }

    if (emoji === null) {
      tx.delete(membershipRef);
    } else {
      tx.set(membershipRef, { emoji, reactedAt: at });
    }
    tx.set(aggregateRef, { counts: nextCounts, updatedAt: at });
    return { emoji, counts: nextCounts };
  });
}

/**
 * @param {{ db: object, auth: object, getConfig: () => Promise<object>,
 *           now?: () => number, log?: Pick<Console, 'warn'|'error'> }} deps
 */
function createReactToSessionHandler({ db, auth, getConfig, now = Date.now, log = console }) {
  return async function handler(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

    // Defense in depth: the client already hides the reaction bar behind
    // this flag (SessionCard.jsx), but a direct POST must not bypass it.
    const config = await getConfig();
    if (config?.features?.sessionReactions !== true) {
      return notFound(res, 'Session reactions are not enabled for this event.');
    }

    const gate = await requireAttendeeAccess({ auth, db, getConfig }, req);
    if (!gate.ok) return sendError(res, gate.status, gate.code, gate.message);

    const { sessionId, emoji } = req.body || {};
    if (typeof sessionId !== 'string' || !sessionId) {
      return badRequest(res, 'sessionId: must be a non-empty string');
    }
    if (emoji !== null && !(typeof emoji === 'string' && REACTION_KINDS.includes(emoji))) {
      return badRequest(res, `emoji: must be null or one of ${REACTION_KINDS.join(' ')}`);
    }

    let result;
    try {
      result = await toggleSessionReaction({ db, uid: gate.uid, sessionId, emoji, now });
    } catch (err) {
      if (err instanceof SessionNotFoundError) return notFound(res, 'Session not found.');
      log.error('reactToSession failed', err);
      return internal(res, 'The reaction could not be saved.');
    }
    res.status(200).json(result);
  };
}

/**
 * Deployable export: reactToSession. firebase-functions and firebase-admin
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
    reactToSession: onRequest(
      { region },
      withCors(async (req, res) => {
        await createReactToSessionHandler(buildDeps())(req, res);
      }),
    ),
  };
}

module.exports = {
  createReactToSessionHandler,
  REACTION_KINDS,
  get handlers() {
    return buildHandlers();
  },
  internals: { toggleSessionReaction, SessionNotFoundError, InvalidReactionError, emptyCounts },
};
