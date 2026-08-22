'use strict';

/**
 * `setMaterialReviewStatus` — admin-only moderation of a session material
 * (spec §4.4). Review is deliberately admin-only, unlike create/update/
 * delete: a speaker who could self-approve their own material would defeat
 * the review gate entirely, since `getSessionMaterialUrl`'s embargo
 * predicate (materials/access.cjs) treats `reviewStatus === 'approved'` as
 * the release signal for everyone who is not the session's own speaker or
 * an admin.
 *
 * Writing `reviewStatus` here is what the projection trigger
 * (materials/projection.cjs) reacts to: an approval publishes the scrubbed
 * `{sessionId, type, filename, reviewStatus}` row into
 * `session_materials_public`; a rejection (or a move back to pending)
 * removes it. No `materialCount` change — the cap counts all materials
 * regardless of review status, only creation/deletion touches it.
 */

const {
  sendError,
  badRequest,
  notFound,
  methodNotAllowed,
  internal,
} = require('../core/errors.cjs');

const MATERIALS = 'session_materials';
const VALID_STATUSES = ['pending', 'approved', 'rejected'];

class MaterialNotFoundError extends Error {
  constructor(materialId) {
    super(`session_materials/${materialId} does not exist`);
    this.name = 'MaterialNotFoundError';
  }
}

class InvalidReviewStatusError extends Error {
  constructor(status) {
    super(`reviewStatus must be one of ${VALID_STATUSES.join(', ')}, got ${JSON.stringify(status)}`);
    this.name = 'InvalidReviewStatusError';
  }
}

/**
 * @param {{ db: object, materialId: string, reviewStatus: string,
 *           now?: () => number }} args
 * @returns {Promise<{ material: object }>}
 */
async function setMaterialReviewStatus({ db, materialId, reviewStatus, now = Date.now }) {
  if (!VALID_STATUSES.includes(reviewStatus)) {
    throw new InvalidReviewStatusError(reviewStatus);
  }
  const ref = db.collection(MATERIALS).doc(materialId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new MaterialNotFoundError(materialId);
    const next = { reviewStatus, updatedAt: new Date(now()) };
    tx.update(ref, next);
    return { material: { ...snap.data(), ...next } };
  });
}

/** Deployable export: setMaterialReviewStatus (admin only). */
function buildHandlers() {
  const { onRequest } = require('firebase-functions/v2/https');
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';

  return {
    setMaterialReviewStatus: onRequest({ region }, async (req, res) => {
      const { applyCors, parseAllowedOrigins } = require('../core/http.cjs');
      const handled = applyCors(req, res, {
        allowedOrigins: parseAllowedOrigins(process.env.EVENT_ALLOWED_ORIGINS),
      });
      if (handled) return;
      if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

      const { getDb } = require('../core/firestore.cjs');
      const { getAuth } = require('firebase-admin/auth');
      const { getEventConfig } = require('../core/config.cjs');
      const { requireAdmin } = require('../core/auth.cjs');
      const db = getDb();
      const getConfig = () => getEventConfig({ db });

      const gate = await requireAdmin({ auth: getAuth(), getConfig }, req);
      if (!gate.ok) return sendError(res, gate.status, gate.code, gate.message);

      const { materialId, reviewStatus } = req.body || {};
      if (typeof materialId !== 'string' || !materialId) {
        return badRequest(res, 'materialId: must be a non-empty string');
      }
      if (!VALID_STATUSES.includes(reviewStatus)) {
        return badRequest(res, `reviewStatus: must be one of ${VALID_STATUSES.join(', ')}`);
      }
      try {
        const result = await setMaterialReviewStatus({ db, materialId, reviewStatus });
        res.status(200).json(result);
      } catch (err) {
        if (err instanceof MaterialNotFoundError) return notFound(res, 'Material not found.');
        console.error('setMaterialReviewStatus failed', err);
        return internal(res, 'The review status could not be saved.');
      }
    }),
  };
}

module.exports = {
  setMaterialReviewStatus,
  get handlers() {
    return buildHandlers();
  },
  internals: { MaterialNotFoundError, InvalidReviewStatusError, VALID_STATUSES, MATERIALS },
};
