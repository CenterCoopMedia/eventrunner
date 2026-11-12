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
 *
 * Each decision writes an `admin_logs` row: an approval releases embargoed
 * material, so who released it must be on record.
 */

const {
  sendError,
  badRequest,
  notFound,
  methodNotAllowed,
  internal,
} = require('../core/errors.cjs');
const { logAdminAction } = require('../cms/store.cjs');

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
 *           actor?: { uid: string, email: string }, now?: () => number,
 *           log?: Pick<Console, 'warn'> }} args
 * @returns {Promise<{ material: object }>}
 */
async function setMaterialReviewStatus({ db, materialId, reviewStatus, actor, now = Date.now, log = console }) {
  if (!VALID_STATUSES.includes(reviewStatus)) {
    throw new InvalidReviewStatusError(reviewStatus);
  }
  const ref = db.collection(MATERIALS).doc(materialId);
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new MaterialNotFoundError(materialId);
    const next = { reviewStatus, updatedAt: new Date(now()) };
    tx.update(ref, next);
    return { material: { ...snap.data(), ...next } };
  });
  if (actor) {
    await logAdminAction({
      db,
      action: 'setMaterialReviewStatus',
      docPath: `${MATERIALS}/${materialId}`,
      actor,
      now,
      details: { sessionId: result.material.sessionId ?? null, reviewStatus },
      log,
    });
  }
  return result;
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

      const gate = await requireAdmin({ auth: getAuth(), db, getConfig }, req, { tier: 'staff' });
      if (!gate.ok) return sendError(res, gate.status, gate.code, gate.message);

      const { materialId, reviewStatus } = req.body || {};
      if (typeof materialId !== 'string' || !materialId) {
        return badRequest(res, 'materialId: must be a non-empty string');
      }
      if (!VALID_STATUSES.includes(reviewStatus)) {
        return badRequest(res, `reviewStatus: must be one of ${VALID_STATUSES.join(', ')}`);
      }
      try {
        const result = await setMaterialReviewStatus({
          db, materialId, reviewStatus, actor: { uid: gate.uid, email: gate.email },
        });
        res.status(200).json(result);
      } catch (err) {
        if (err instanceof MaterialNotFoundError) return notFound(res, 'Material not found.');
        console.error('setMaterialReviewStatus failed', err);
        return internal(res, 'The review status could not be saved. Keep this page open and contact support for help.');
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
