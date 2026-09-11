'use strict';

/**
 * removeUserCustomBadge — an admin removes one free-text custom badge from
 * an attendee's account (issue #176).
 *
 * A custom badge is user-generated text on a public profile, so the removal
 * action is part of the feature: a word that slipped past the block list,
 * or one an operator simply decides against, comes off the account here,
 * and the act lands in admin_logs with the actor's identity on it. The
 * caller is admin-gated exactly like approveUser; the audit row is
 * best-effort, the same contract the approval actions run on.
 */

const { requireAdmin } = require('../core/auth.cjs');
const { sendError, badRequest, notFound, methodNotAllowed, internal } = require('../core/errors.cjs');
const { logAdminAction } = require('../cms/store.cjs');

const USERS = 'users';

/** @param {unknown} value @returns {string|null} */
function readUid(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Read the badge the request names. Matched case-insensitively against the
 * stored list, because the attendee's capitalisation is not part of the
 * identification — "Admin", "admin" and "ADMIN" are one word to remove.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
function readBadge(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Match labels using the same whitespace and case normalization as the shared validator. */
function normalizedBadgeLabel(value) {
  return typeof value === 'string'
    ? value.trim().replace(/\s+/g, ' ').toLowerCase()
    : null;
}

/**
 * Remove one custom badge from a user's account document.
 *
 * @param {{ db: object, uid: string, badge: string }} args
 * @returns {Promise<{ ok: boolean, status?: number, code?: string,
 *                     message?: string, removed?: string, customBadges?: string[] }>}
 */
async function applyRemoveCustomBadge({ db, uid, badge }) {
  return db.runTransaction(async (tx) => {
    const ref = db.collection(USERS).doc(uid);
    const snap = await tx.get(ref);
    if (!snap.exists) {
      return { ok: false, status: 404, code: 'not-found', message: 'No such account.' };
    }
    const stored = Array.isArray(snap.data()?.customBadges) ? snap.data().customBadges : [];
    const requestedLabel = normalizedBadgeLabel(badge);
    const removed = stored.find((entry) => normalizedBadgeLabel(entry) === requestedLabel);
    if (removed === undefined) {
      return {
        ok: false,
        status: 404,
        code: 'not-found',
        message: 'That account carries no such custom badge.',
      };
    }
    const next = stored.filter((entry) => normalizedBadgeLabel(entry) !== requestedLabel);
    tx.set(ref, { customBadges: next }, { merge: true });
    return { ok: true, removed, customBadges: next };
  });
}

/**
 * @param {{ db: object, auth: object, getConfig: () => Promise<object>,
 *           now?: () => Date, log?: object }} deps
 */
function createRemoveUserCustomBadgeHandler({ db, auth, getConfig, now = () => new Date(), log = console }) {
  return async function handler(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

    const verdict = await requireAdmin({ auth, getConfig }, req);
    if (!verdict.ok) return sendError(res, verdict.status, verdict.code, verdict.message);

    const uid = readUid(req.body?.uid);
    if (!uid) return badRequest(res, 'uid is required.');
    const badge = readBadge(req.body?.badge);
    if (!badge) return badRequest(res, 'badge is required.');

    let result;
    try {
      result = await applyRemoveCustomBadge({ db, uid, badge });
    } catch (err) {
      log.error('removeUserCustomBadge failed', err);
      return internal(res, 'The custom badge could not be removed.');
    }
    if (!result.ok) {
      return result.status === 404
        ? notFound(res, result.message)
        : sendError(res, result.status, result.code, result.message);
    }

    await logAdminAction({
      db,
      action: 'removeUserCustomBadge',
      docPath: `${USERS}/${uid}`,
      actor: verdict,
      now,
      log,
    });

    res.status(200).json({ ok: true, uid, removed: result.removed, customBadges: result.customBadges });
  };
}

/** Deployable export: removeUserCustomBadge. */
function buildHandlers() {
  const { onRequest } = require('firebase-functions/v2/https');
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';

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
    const { getEventConfig } = require('../core/config.cjs');
    const { getAuth } = require('firebase-admin/auth');
    const db = getDb();
    return { db, auth: getAuth(), getConfig: () => getEventConfig({ db }) };
  };

  return {
    removeUserCustomBadge: onRequest({ region }, withCors(async (req, res) => {
      await createRemoveUserCustomBadgeHandler(buildAdminDeps())(req, res);
    })),
  };
}

module.exports = {
  applyRemoveCustomBadge,
  createRemoveUserCustomBadgeHandler,
  get handlers() {
    return buildHandlers();
  },
};
