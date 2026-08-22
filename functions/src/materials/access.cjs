'use strict';

/**
 * `getSessionMaterialUrl` — the embargo gate (spec §4.4).
 *
 * Access is granted to: the session's own speaker, an admin, or anyone with
 * `reviewStatus === 'approved' && isSessionPast(config, session, now)`.
 * `isSessionPast` (packages/shared/src/time.cjs) fails closed on a
 * malformed/missing endTime or an unconfigured `dayId` — the reference
 * implementation's strict-ISO discipline, preserved verbatim.
 *
 * `listSessionMaterials` is NOT in the spec table's export list, but is
 * necessary glue this port needs and the spec doesn't name: with
 * `session_materials` fully server-only (`allow read, write: if false`),
 * an admin reviewing a session's queue — or a speaker checking their own
 * submissions — has no client-side read path at all. This is the read
 * counterpart of store.cjs's write ACL: admin sees everything for the
 * session, a speaker sees only their own session's materials. Judgment
 * call, called out in the PR description.
 */

const { isSessionPast } = require('shared/time');
const {
  sendError,
  badRequest,
  notFound,
  forbidden,
  methodNotAllowed,
  internal,
} = require('../core/errors.cjs');

const MATERIALS = 'session_materials';
const SESSIONS = 'cmsSchedule';

class MaterialNotFoundError extends Error {
  constructor(materialId) {
    super(`session_materials/${materialId} does not exist`);
    this.name = 'MaterialNotFoundError';
  }
}

class SessionNotFoundError extends Error {
  constructor(sessionId) {
    super(`cmsSchedule/${sessionId} does not exist`);
    this.name = 'SessionNotFoundError';
  }
}

class EmbargoedError extends Error {
  constructor() {
    super('This material is not available yet.');
    this.name = 'EmbargoedError';
  }
}

/**
 * @param {object} sessionData cmsSchedule doc data
 * @param {object} materialData session_materials doc data
 * @param {{ isAdmin: boolean, speakerId: string|null }} actor
 * @param {object} eventConfig config/event shape
 * @param {Date} now
 * @returns {boolean}
 */
function canAccessMaterial({ sessionData, materialData, actor, eventConfig, now }) {
  if (actor.isAdmin) return true;
  const speakerIds = Array.isArray(sessionData?.speakerIds) ? sessionData.speakerIds : [];
  if (actor.speakerId != null && speakerIds.includes(actor.speakerId)) return true;
  if (materialData.reviewStatus !== 'approved') return false;
  return isSessionPast(eventConfig, sessionData, now);
}

/**
 * Load a material + its session and apply the embargo gate. Shared by
 * `getSessionMaterialUrl` and materials/download.cjs's `downloadSessionMaterial`
 * — both need the identical material-lookup-then-embargo-check sequence,
 * and factoring it out is what lets the download endpoint re-run the SAME
 * check at download time rather than trusting a URL minted earlier.
 *
 * @param {{ db: object, materialId: string, actor: { uid: string, isAdmin: boolean, speakerId: string|null },
 *           getConfig: () => Promise<{ event: object|null }>, now?: () => Date }} args
 * @returns {Promise<{ material: object, session: object }>}
 */
async function resolveMaterialAccess({ db, materialId, actor, getConfig, now = () => new Date() }) {
  const materialSnap = await db.collection(MATERIALS).doc(materialId).get();
  if (!materialSnap.exists) throw new MaterialNotFoundError(materialId);
  const material = materialSnap.data();

  const sessionSnap = await db.collection(SESSIONS).doc(material.sessionId).get();
  if (!sessionSnap.exists) throw new SessionNotFoundError(material.sessionId);
  const session = sessionSnap.data();

  const config = await getConfig();
  const allowed = canAccessMaterial({
    sessionData: session,
    materialData: material,
    actor,
    eventConfig: config?.event,
    now: now(),
  });
  if (!allowed) throw new EmbargoedError();

  return { material, session };
}

/**
 * Resolve a material for the caller, embargo-gated.
 *
 * A **link** material returns its real `url` directly — the client opens
 * it, no further server round trip needed.
 *
 * A **file** material returns NO url at all. Handing back the raw
 * `storagePath` (the earlier version of this function) is a dead end for
 * the browser (storage.rules denies direct reads of
 * `session-materials/...`, spec §8.5) and, worse, looks like a usable link
 * while actually being an unopenable relative path. Minting a real Cloud
 * Storage v4 signed URL is the normal fix, but the runtime service account
 * on a fresh project has no `roles/iam.serviceAccountTokenCreator` (no
 * `signBlob`) — see materials/download.cjs's module doc for the full
 * reasoning. Instead: the caller re-fetches the bytes from
 * `downloadSessionMaterial`, an authenticated POST that re-applies this
 * SAME embargo check at download time and streams the object through the
 * Cloud Function itself. That needs no `url` here at all — just the
 * confirmation that the caller may proceed, which is exactly what NOT
 * throwing already means.
 *
 * @param {{ db: object, materialId: string, actor: { uid: string, isAdmin: boolean, speakerId: string|null },
 *           getConfig: () => Promise<{ event: object|null }>, now?: () => Date }} args
 * @returns {Promise<{ type: string, filename: string, url?: string }>}
 */
async function getSessionMaterialUrl({ db, materialId, actor, getConfig, now = () => new Date() }) {
  const { material } = await resolveMaterialAccess({ db, materialId, actor, getConfig, now });
  if (material.type === 'link') {
    return { type: 'link', filename: material.filename, url: material.url };
  }
  return { type: 'file', filename: material.filename };
}

/**
 * List materials for one session. Admin sees every material; a speaker
 * sees materials for a session they speak at (own submissions and
 * anyone else's for that session, so co-presenters can coordinate); anyone
 * else gets an empty list rather than an error, so the endpoint is safe to
 * call speculatively from the UI.
 *
 * @param {{ db: object, sessionId: string, actor: { uid: string, isAdmin: boolean, speakerId: string|null } }} args
 * @returns {Promise<{ materials: Array<object> }>}
 */
async function listSessionMaterials({ db, sessionId, actor }) {
  const sessionSnap = await db.collection(SESSIONS).doc(sessionId).get();
  if (!sessionSnap.exists) throw new SessionNotFoundError(sessionId);
  const session = sessionSnap.data();
  const speakerIds = Array.isArray(session.speakerIds) ? session.speakerIds : [];
  const canSee = actor.isAdmin || (actor.speakerId != null && speakerIds.includes(actor.speakerId));
  if (!canSee) return { materials: [] };

  const snap = await db.collection(MATERIALS).where('sessionId', '==', sessionId).get();
  const materials = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return { materials };
}

/**
 * Deployable exports: getSessionMaterialUrl, listSessionMaterials.
 *
 * `getSessionMaterialUrl` accepts an ANONYMOUS caller on purpose: the
 * embargo predicate itself (`canAccessMaterial`) is what decides access —
 * "approved AND the session is past" is a discovery grant for anyone, not
 * only signed-in attendees, and gating the endpoint on attendee access
 * would turn away exactly the public visitor §4.4's post-embargo release
 * is meant to serve. `listSessionMaterials` requires a verified sign-in
 * (it can surface a still-pending material's existence), but not full
 * attendee access — a speaker mid-invite-flow is not yet "approved" but
 * must still be able to see their own session's queue.
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

  const withOptionalActor = (fn) => async (req, res) => {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const { resolveActorOptional } = require('./actor.cjs');
    const deps = buildDeps();
    const actor = await resolveActorOptional(deps, req);
    await fn(req, res, deps, actor);
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
    getSessionMaterialUrl: onRequest(
      { region },
      withCors(
        withOptionalActor(async (req, res, { db, getConfig }, actor) => {
          const { materialId } = req.body || {};
          if (typeof materialId !== 'string' || !materialId) {
            return badRequest(res, 'materialId: must be a non-empty string');
          }
          try {
            const result = await getSessionMaterialUrl({ db, materialId, actor, getConfig });
            res.status(200).json(result);
          } catch (err) {
            if (err instanceof MaterialNotFoundError || err instanceof SessionNotFoundError) {
              return notFound(res, 'Material not found.');
            }
            if (err instanceof EmbargoedError) return forbidden(res, err.message);
            console.error('getSessionMaterialUrl failed', err);
            return internal(res, 'The material could not be retrieved.');
          }
        }),
      ),
    ),
    listSessionMaterials: onRequest(
      { region },
      withCors(
        withActor(async (req, res, { db }, actor) => {
          const { sessionId } = req.body || {};
          if (typeof sessionId !== 'string' || !sessionId) {
            return badRequest(res, 'sessionId: must be a non-empty string');
          }
          try {
            const result = await listSessionMaterials({ db, sessionId, actor });
            res.status(200).json(result);
          } catch (err) {
            if (err instanceof SessionNotFoundError) return notFound(res, 'Session not found.');
            console.error('listSessionMaterials failed', err);
            return internal(res, 'Materials could not be listed.');
          }
        }),
      ),
    ),
  };
}

module.exports = {
  getSessionMaterialUrl,
  listSessionMaterials,
  resolveMaterialAccess,
  get handlers() {
    return buildHandlers();
  },
  internals: {
    canAccessMaterial,
    MaterialNotFoundError,
    SessionNotFoundError,
    EmbargoedError,
    MATERIALS,
    SESSIONS,
  },
};
