'use strict';

/**
 * `syncSessionMaterialPublic` — session_materials → session_materials_public
 * projection (spec §4.4).
 *
 * The projection carries exactly `{ sessionId, type, filename, reviewStatus }`
 * for **approved** materials only. That last part is a judgment call the ADR
 * prose doesn't spell out in so many words, but the issue's "done when"
 * criterion does: "anonymous discovery shows only approved-material
 * metadata". `materialCount` (the per-session cap) counts every material
 * regardless of status — this projection is a narrower, review-gated
 * *discovery* surface, not the cap. A material that is `pending` or
 * `rejected` therefore has NO row in `session_materials_public` at all
 * (the projection is deleted, not written with a non-approved status),
 * which is also what keeps a rejected link's filename from ever reaching
 * an anonymous reader.
 *
 * **The URL-shaped-filename scrub is re-applied here, in the projection**
 * (`scrubLinkLabel`), not merely trusted from the write path. This is
 * deliberate defense in depth (spec §4.4): the trigger fires on *every*
 * write to `session_materials`, including Admin SDK writes from recovery
 * scripts, console edits, or data seeded before a scrubbed write path
 * existed — none of which go through materials/store.cjs. File materials
 * are never scrubbed: their filename is a display label, not a secret,
 * because the bytes are always signed-URL gated (spec §4.4's asymmetry).
 *
 * Same "re-read inside the transaction" discipline as users/projection.cjs:
 * the event payload is a wake-up, not data, so out-of-order or duplicate
 * trigger deliveries converge on whatever `session_materials/{id}` holds
 * right now, and the projection write happens in the SAME transaction.
 */

const { scrubLinkLabel } = require('shared/urlSafety');

const MATERIALS = 'session_materials';
const MATERIALS_PUBLIC = 'session_materials_public';

/**
 * Compute the projection payload for one material doc, or null when the
 * material should have NO public row (missing, or not approved).
 *
 * @param {object|null} data session_materials/{id} data, or null if deleted
 * @returns {{ sessionId: string, type: string, filename: string, reviewStatus: string } | null}
 */
function projectMaterial(data) {
  if (!data || data.reviewStatus !== 'approved') return null;
  const filename = data.type === 'link' ? scrubLinkLabel(data.filename) : data.filename;
  return {
    sessionId: data.sessionId,
    type: data.type,
    filename,
    reviewStatus: data.reviewStatus,
  };
}

/**
 * @param {{ db: object, log?: { error: Function } }} deps
 * @returns {(change: { materialId: string }) => Promise<{ action: 'deleted'|'written'|'unchanged' }>}
 */
function createSyncSessionMaterialPublic({ db, log = console }) {
  return async function syncSessionMaterialPublic({ materialId }) {
    if (typeof materialId !== 'string' || !materialId) {
      log.error('syncSessionMaterialPublic called without a materialId');
      return { action: 'unchanged' };
    }

    const materialRef = db.collection(MATERIALS).doc(materialId);
    const publicRef = db.collection(MATERIALS_PUBLIC).doc(materialId);

    return db.runTransaction(async (tx) => {
      const materialSnap = await tx.get(materialRef);
      const source = materialSnap.exists ? materialSnap.data() : null;
      const payload = projectMaterial(source);

      const publicSnap = await tx.get(publicRef);

      if (!payload) {
        if (!publicSnap.exists) return { action: 'unchanged' };
        tx.delete(publicRef);
        return { action: 'deleted' };
      }

      if (publicSnap.exists && sameProjection(publicSnap.data(), payload)) {
        return { action: 'unchanged' };
      }
      tx.set(publicRef, payload);
      return { action: 'written' };
    });
  };
}

function sameProjection(a, b) {
  if (!a || !b) return false;
  return (
    a.sessionId === b.sessionId &&
    a.type === b.type &&
    a.filename === b.filename &&
    a.reviewStatus === b.reviewStatus
  );
}

/** Deployable export (spec §1.3 materials/): the projection trigger. */
function buildHandlers() {
  const { onDocumentWritten } = require('firebase-functions/v2/firestore');
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';

  return {
    syncSessionMaterialPublic: onDocumentWritten(
      { region, document: 'session_materials/{materialId}' },
      async (event) => {
        const { getDb } = require('../core/firestore.cjs');
        const db = getDb();
        const handler = createSyncSessionMaterialPublic({ db });
        await handler({ materialId: event.params.materialId });
      },
    ),
  };
}

module.exports = {
  createSyncSessionMaterialPublic,
  get handlers() {
    return buildHandlers();
  },
  internals: { projectMaterial, sameProjection, MATERIALS, MATERIALS_PUBLIC },
};
