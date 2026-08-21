'use strict';

/**
 * Session materials — canonical CRUD (spec §4.4, issue #23).
 *
 * Two collections, not four: `session_materials/{id}` is the server-only
 * canonical record (every field, including the link URL, lives here —
 * `allow read, write: if false` in firestore.rules); `session_materials_public/{id}`
 * is a trigger-maintained projection (functions/src/materials/projection.cjs)
 * carrying exactly `{ sessionId, type, filename, reviewStatus }` for
 * approved materials. The per-session cap that used to need its own
 * `session_material_counts` collection is now `cmsSchedule/{sessionId}.materialCount`,
 * kept in the SAME transaction as the material write — no reconciler,
 * because there is no second document to drift.
 *
 * **Uploads are out of scope here.** `session-materials/{sessionId}/{allPaths}`
 * Storage writes are server-authorized (spec §8.5) and belong to the media
 * library work (issue #24, in flight on a parallel branch). This module
 * only registers metadata for a file whose bytes already exist at a given
 * Storage path (`uploadSessionMaterial`) — it never accepts or moves bytes.
 * A link material (`addSessionMaterialLink`) needs no Storage interaction
 * at all.
 *
 * **Who may write (judgment call — the spec table names the exports but not
 * the write ACL; this mirrors §3.4's `hasAttendeeAccess`-adjacent posture
 * for speaker-authored content elsewhere in the port):**
 *   - create (`addSessionMaterialLink`, `uploadSessionMaterial`): an admin,
 *     or a signed-in speaker whose `speakerId` appears in the session's
 *     `speakerIds` (cmsSchedule) — a speaker may only submit for their own
 *     session.
 *   - update (`updateSessionMaterial`): an admin (any field), or the
 *     submitting speaker while the material is still `pending` — once a
 *     material has been reviewed, only an admin may change it. This keeps a
 *     speaker from silently altering a link after admin sign-off.
 *   - delete (`deleteSessionMaterial`): an admin, or the submitting speaker
 *     for their own material at any review status (withdrawing a submission
 *     is always allowed, the same way a bookmark owner may always unbookmark).
 *
 * **The URL-shaped-filename scrub is applied here, at the write path**
 * (`scrubLinkLabel`, packages/shared/src/urlSafety.cjs) — a link material
 * whose trimmed label is empty or URL-shaped is stored with
 * `filename: 'External link'`. This is layer one of the two-layer defense;
 * the projection trigger (materials/projection.cjs) re-applies the same
 * scrub on every write, including Admin SDK writes that bypass this module
 * entirely.
 */

const { scrubLinkLabel } = require('shared/urlSafety');
const {
  sendError,
  badRequest,
  notFound,
  forbidden,
  methodNotAllowed,
  internal,
} = require('../core/errors.cjs');

const SESSIONS = 'cmsSchedule';
const MATERIALS = 'session_materials';

class SessionNotFoundError extends Error {
  constructor(sessionId) {
    super(`cmsSchedule/${sessionId} does not exist or is not visible`);
    this.name = 'SessionNotFoundError';
  }
}

class MaterialNotFoundError extends Error {
  constructor(materialId) {
    super(`session_materials/${materialId} does not exist`);
    this.name = 'MaterialNotFoundError';
  }
}

/** Thrown when the caller is neither admin nor a speaker of the session. */
class NotAuthorizedError extends Error {
  constructor(message = 'Not authorized to manage materials for this session.') {
    super(message);
    this.name = 'NotAuthorizedError';
  }
}

/** True when `speakerId` appears in the session doc's `speakerIds` array. */
function isSpeakerOfSession(sessionData, speakerId) {
  if (!speakerId || !sessionData) return false;
  const ids = Array.isArray(sessionData.speakerIds) ? sessionData.speakerIds : [];
  return ids.includes(speakerId);
}

/**
 * Create a link-type material. Runs the session existence check, the
 * write-path filename scrub, and the `materialCount` increment all inside
 * one transaction.
 *
 * @param {{ db: object, sessionId: string, url: string, label: string,
 *           actor: { uid: string, isAdmin: boolean, speakerId: string|null },
 *           now?: () => number }} args
 * @returns {Promise<{ id: string, material: object }>}
 */
async function addSessionMaterialLink({ db, sessionId, url, label, actor, now = Date.now }) {
  return createMaterial({
    db,
    sessionId,
    actor,
    now,
    type: 'link',
    url,
    storagePath: null,
    filename: scrubLinkLabel(label),
  });
}

/**
 * Register metadata for a file material whose bytes already exist at
 * `storagePath` (uploaded through the media library, issue #24 — this
 * function never writes Storage). File material filenames are NOT scrubbed
 * (spec §4.4): a URL-shaped filename like `slides.pdf` is a display label,
 * not a secret, because the bytes are always signed-URL gated.
 *
 * @param {{ db: object, sessionId: string, storagePath: string, filename: string,
 *           actor: { uid: string, isAdmin: boolean, speakerId: string|null },
 *           now?: () => number }} args
 * @returns {Promise<{ id: string, material: object }>}
 */
async function uploadSessionMaterial({ db, sessionId, storagePath, filename, actor, now = Date.now }) {
  return createMaterial({
    db,
    sessionId,
    actor,
    now,
    type: 'file',
    url: null,
    storagePath,
    filename: typeof filename === 'string' && filename.trim() ? filename.trim() : 'Untitled file',
  });
}

async function createMaterial({ db, sessionId, actor, now, type, url, storagePath, filename }) {
  const sessionRef = db.collection(SESSIONS).doc(sessionId);
  const materialRef = db.collection(MATERIALS).doc();

  return db.runTransaction(async (tx) => {
    const sessionSnap = await tx.get(sessionRef);
    if (!sessionSnap.exists) throw new SessionNotFoundError(sessionId);
    const sessionData = sessionSnap.data() || {};

    if (!actor.isAdmin && !isSpeakerOfSession(sessionData, actor.speakerId)) {
      throw new NotAuthorizedError();
    }

    const at = new Date(now());
    const material = {
      sessionId,
      type,
      url,
      storagePath,
      filename,
      reviewStatus: 'pending',
      submittedBySpeakerId: actor.speakerId ?? null,
      createdBy: actor.uid,
      createdAt: at,
      updatedAt: at,
    };
    tx.set(materialRef, material);
    const currentCount = typeof sessionData.materialCount === 'number' ? sessionData.materialCount : 0;
    tx.update(sessionRef, { materialCount: currentCount + 1 });
    return { id: materialRef.id, material };
  });
}

/**
 * Update a material's `filename` and/or link `url`. Re-scrubs `filename`
 * for link materials on every update — the same invariant as create.
 *
 * @param {{ db: object, materialId: string, patch: { filename?: string, url?: string },
 *           actor: { uid: string, isAdmin: boolean, speakerId: string|null },
 *           now?: () => number }} args
 * @returns {Promise<{ material: object }>}
 */
async function updateSessionMaterial({ db, materialId, patch, actor, now = Date.now }) {
  const materialRef = db.collection(MATERIALS).doc(materialId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(materialRef);
    if (!snap.exists) throw new MaterialNotFoundError(materialId);
    const current = snap.data();

    const isOwner = !actor.isAdmin && actor.speakerId != null && actor.speakerId === current.submittedBySpeakerId;
    if (!actor.isAdmin) {
      if (!isOwner) throw new NotAuthorizedError();
      if (current.reviewStatus !== 'pending') {
        throw new NotAuthorizedError('This material has already been reviewed; ask an admin to change it.');
      }
    }

    const next = { updatedAt: new Date(now()) };
    if (typeof patch?.url === 'string' && current.type === 'link') {
      next.url = patch.url;
    }
    if (typeof patch?.filename === 'string') {
      next.filename = current.type === 'link' ? scrubLinkLabel(patch.filename) : patch.filename.trim() || 'Untitled file';
    }
    tx.update(materialRef, next);
    return { material: { ...current, ...next } };
  });
}

/**
 * Delete a material and decrement `cmsSchedule/{sessionId}.materialCount`
 * in the same transaction.
 *
 * @param {{ db: object, materialId: string,
 *           actor: { uid: string, isAdmin: boolean, speakerId: string|null } }} args
 * @returns {Promise<{ sessionId: string }>}
 */
async function deleteSessionMaterial({ db, materialId, actor }) {
  const materialRef = db.collection(MATERIALS).doc(materialId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(materialRef);
    if (!snap.exists) throw new MaterialNotFoundError(materialId);
    const current = snap.data();

    const isOwner = !actor.isAdmin && actor.speakerId != null && actor.speakerId === current.submittedBySpeakerId;
    if (!actor.isAdmin && !isOwner) throw new NotAuthorizedError();

    const sessionRef = db.collection(SESSIONS).doc(current.sessionId);
    const sessionSnap = await tx.get(sessionRef);
    tx.delete(materialRef);
    if (sessionSnap.exists) {
      const currentCount = typeof sessionSnap.data().materialCount === 'number' ? sessionSnap.data().materialCount : 0;
      tx.update(sessionRef, { materialCount: Math.max(0, currentCount - 1) });
    }
    return { sessionId: current.sessionId };
  });
}

/** Map a store.cjs error to an HTTP response. Shared by all three handlers
 * below so the error shape (spec: `{ error: { code, message } }`) stays
 * consistent across create/update/delete. */
function sendStoreError(res, err, log) {
  if (err instanceof SessionNotFoundError || err instanceof MaterialNotFoundError) {
    return notFound(res, 'Not found.');
  }
  if (err instanceof NotAuthorizedError) {
    return forbidden(res, err.message);
  }
  log.error('materials store operation failed', err);
  return internal(res, 'The material could not be saved.');
}

/**
 * Deployable exports: addSessionMaterialLink, uploadSessionMaterial,
 * updateSessionMaterial, deleteSessionMaterial. firebase-functions and
 * firebase-admin required lazily HERE ONLY (house rule, spec §1.3).
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

  const withActor = (fn) => async (req, res) => {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const { resolveActor } = require('./actor.cjs');
    const deps = buildDeps();
    const actor = await resolveActor(deps, req);
    if (!actor.ok) return sendError(res, actor.status, actor.code, actor.message);
    await fn(req, res, deps, actor);
  };

  return {
    addSessionMaterialLink: onRequest(
      { region },
      withCors(
        withActor(async (req, res, { db }, actor) => {
          const { sessionId, url, label } = req.body || {};
          if (typeof sessionId !== 'string' || !sessionId) {
            return badRequest(res, 'sessionId: must be a non-empty string');
          }
          if (typeof url !== 'string' || !url) {
            return badRequest(res, 'url: must be a non-empty string');
          }
          try {
            const result = await addSessionMaterialLink({
              db,
              sessionId,
              url,
              label: typeof label === 'string' ? label : '',
              actor,
            });
            res.status(200).json(result);
          } catch (err) {
            sendStoreError(res, err, console);
          }
        }),
      ),
    ),
    uploadSessionMaterial: onRequest(
      { region },
      withCors(
        withActor(async (req, res, { db }, actor) => {
          const { sessionId, storagePath, filename } = req.body || {};
          if (typeof sessionId !== 'string' || !sessionId) {
            return badRequest(res, 'sessionId: must be a non-empty string');
          }
          if (typeof storagePath !== 'string' || !storagePath) {
            return badRequest(res, 'storagePath: must be a non-empty string');
          }
          try {
            const result = await uploadSessionMaterial({
              db,
              sessionId,
              storagePath,
              filename: typeof filename === 'string' ? filename : '',
              actor,
            });
            res.status(200).json(result);
          } catch (err) {
            sendStoreError(res, err, console);
          }
        }),
      ),
    ),
    updateSessionMaterial: onRequest(
      { region },
      withCors(
        withActor(async (req, res, { db }, actor) => {
          const { materialId, filename, url } = req.body || {};
          if (typeof materialId !== 'string' || !materialId) {
            return badRequest(res, 'materialId: must be a non-empty string');
          }
          try {
            const result = await updateSessionMaterial({
              db,
              materialId,
              patch: { filename, url },
              actor,
            });
            res.status(200).json(result);
          } catch (err) {
            sendStoreError(res, err, console);
          }
        }),
      ),
    ),
    deleteSessionMaterial: onRequest(
      { region },
      withCors(
        withActor(async (req, res, { db }, actor) => {
          const { materialId } = req.body || {};
          if (typeof materialId !== 'string' || !materialId) {
            return badRequest(res, 'materialId: must be a non-empty string');
          }
          try {
            const result = await deleteSessionMaterial({ db, materialId, actor });
            res.status(200).json(result);
          } catch (err) {
            sendStoreError(res, err, console);
          }
        }),
      ),
    ),
  };
}

module.exports = {
  addSessionMaterialLink,
  uploadSessionMaterial,
  updateSessionMaterial,
  deleteSessionMaterial,
  get handlers() {
    return buildHandlers();
  },
  internals: {
    SessionNotFoundError,
    MaterialNotFoundError,
    NotAuthorizedError,
    isSpeakerOfSession,
    SESSIONS,
    MATERIALS,
  },
};
