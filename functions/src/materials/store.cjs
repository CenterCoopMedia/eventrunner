'use strict';

const { randomUUID } = require('node:crypto');

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
 * `session-materials/{sessionId}/{allPaths}` Storage writes stay closed to
 * every client (spec §8.5). `uploadSessionMaterialBytes` therefore accepts
 * the speaker's bounded base64 payload, writes it through the Admin SDK to
 * a server-derived path, and registers that path through the same
 * `uploadSessionMaterial` primitive operator tooling already uses. A link
 * material (`addSessionMaterialLink`) needs no Storage interaction.
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

const { scrubLinkLabel, isSafeUrl } = require('shared/urlSafety');
const {
  MAX_MATERIAL_FILE_BYTES,
  MAX_MATERIAL_FILENAME_LENGTH,
  MaterialFileTooLargeError,
  MaterialFileSizeUnavailableError,
  isSessionMaterialStoragePath,
  requireAllowedMaterialFileSize,
} = require('./policy.cjs');
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
const MATERIALS_PUBLIC = 'session_materials_public';

/** Base64 with optional padding, nothing else. */
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const CONTENT_TYPE_RE = /^[a-z0-9!#$%&'*+.^_`|~-]+\/[a-z0-9!#$%&'*+.^_`|~-]+$/i;
const PRIVATE_CACHE_CONTROL = 'private, max-age=0, no-store';
const UPLOAD_ATTEMPT_METADATA_KEY = 'eventrunnerUploadAttempt';

function hasControlCharacter(value) {
  return [...value].some((character) => {
    const code = character.codePointAt(0);
    return code <= 31 || code === 127;
  });
}

function normalizeFileMaterialFilename(filename, { fallback } = {}) {
  const normalized = typeof filename === 'string' ? filename.trim() : '';
  if (!normalized && fallback) return fallback;
  if (
    !normalized
    || normalized.length > MAX_MATERIAL_FILENAME_LENGTH
    || hasControlCharacter(normalized)
  ) {
    throw new InvalidMaterialUploadError(
      `filename: must be 1-${MAX_MATERIAL_FILENAME_LENGTH} characters without control characters.`,
    );
  }
  return normalized;
}

function storageErrorHasStatus(error, status) {
  return Number(error?.code) === status || Number(error?.response?.status) === status;
}

async function removeOwnedUpload({ file, uploadAttempt, log }) {
  try {
    const [metadata] = await file.getMetadata();
    if (metadata?.metadata?.[UPLOAD_ATTEMPT_METADATA_KEY] !== uploadAttempt) return;
    if (metadata.generation == null) {
      log.error('uploadSessionMaterial: could not verify the unregistered object generation');
      return;
    }
    await file.delete({
      ignoreNotFound: true,
      ifGenerationMatch: metadata.generation,
    });
  } catch (cleanupError) {
    if (storageErrorHasStatus(cleanupError, 404)) return;
    log.error('uploadSessionMaterial: failed to remove an unregistered object', cleanupError);
  }
}

/**
 * Per-session cap on the number of materials (spec: "the per-session cap
 * moves to a materialCount field", §4.4 — the ADR names the field but not
 * the number; the reference implementation's four-collection design had
 * one too, and this is a judgment call on the value, chosen generously for
 * a conference session's realistic slide-deck/handout/link count while
 * still bounding `listSessionMaterials`' response size and the projection
 * trigger's fan-out). Enforced INSIDE the create transaction so a burst of
 * concurrent creates cannot all read the same under-cap count and all
 * commit.
 */
const MAX_MATERIALS_PER_SESSION = 25;

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

/** Thrown when a link material's `url` is not a safe http(s) target. */
class InvalidUrlError extends Error {
  constructor(message = 'url must be an http:// or https:// address.') {
    super(message);
    this.name = 'InvalidUrlError';
  }
}

/** Thrown when a session is already at MAX_MATERIALS_PER_SESSION. */
class MaterialCapExceededError extends Error {
  constructor(sessionId) {
    super(`Session ${sessionId} already has the maximum of ${MAX_MATERIALS_PER_SESSION} materials.`);
    this.name = 'MaterialCapExceededError';
  }
}

/** Thrown when a file is not under its session's Storage folder. */
class InvalidStoragePathError extends Error {
  constructor(sessionId) {
    super(`storagePath: must be inside session-materials/${sessionId}/`);
    this.name = 'InvalidStoragePathError';
  }
}

class InvalidMaterialUploadError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InvalidMaterialUploadError';
  }
}

/** Thrown when registration names no object in Storage. */
class MaterialFileNotFoundError extends Error {
  constructor() {
    super('storagePath: no file exists at this path.');
    this.name = 'MaterialFileNotFoundError';
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
  // Server-side protocol allowlist (spec's isSafeUrl, shared/urlSafety) —
  // a client-only check would let javascript:/data:/file: through a
  // hand-crafted request, get stored, get approved, and eventually reach
  // window.open post-embargo. Checked here, before the transaction: it is
  // a pure format check, independent of any stored state.
  if (!isSafeUrl(url)) throw new InvalidUrlError();
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
 * `storagePath` (this function verifies but never writes the Storage
 * object). These objects stay operator-managed when the material is
 * deleted. File material filenames are NOT scrubbed
 * (spec §4.4): a URL-shaped filename like `slides.pdf` is a display label,
 * not a secret, because the bytes are always signed-URL gated.
 *
 * @param {{ db: object, bucket: object, sessionId: string, storagePath: string, filename: string,
 *           actor: { uid: string, isAdmin: boolean, speakerId: string|null },
 *           now?: () => number }} args
 * @returns {Promise<{ id: string, material: object }>}
 */
async function uploadSessionMaterial({
  db,
  bucket,
  sessionId,
  storagePath,
  filename,
  actor,
  now = Date.now,
  managedStorageObject = false,
}) {
  if (!isSessionMaterialStoragePath(storagePath, sessionId)) {
    throw new InvalidStoragePathError(sessionId);
  }
  // Check authorization before Storage so a caller cannot use registration
  // errors to probe files for a session they do not own. The transaction
  // below repeats this check so a session change cannot race the write.
  const sessionSnap = await db.collection(SESSIONS).doc(sessionId).get();
  assertMaterialCreateAllowed({ sessionSnap, sessionId, actor });
  const normalizedFilename = normalizeFileMaterialFilename(filename, { fallback: 'Untitled file' });

  const file = bucket.file(storagePath);
  const [exists] = await file.exists();
  if (!exists) throw new MaterialFileNotFoundError();
  const [metadata] = await file.getMetadata();
  requireAllowedMaterialFileSize(metadata?.size);

  return createMaterial({
    db,
    sessionId,
    actor,
    now,
    type: 'file',
    url: null,
    storagePath,
    filename: normalizedFilename,
    managedStorageObject,
  });
}

/** Decode one browser upload without allocating a buffer above the file cap. */
function decodeMaterialUpload(data) {
  if (typeof data !== 'string' || data.length === 0 || data.length % 4 !== 0) {
    throw new InvalidMaterialUploadError('data: must be a base64-encoded string.');
  }
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  const decodedSize = (data.length / 4) * 3 - padding;
  if (decodedSize > MAX_MATERIAL_FILE_BYTES) throw new MaterialFileTooLargeError(decodedSize);
  if (!BASE64_RE.test(data)) {
    throw new InvalidMaterialUploadError('data: must be a base64-encoded string.');
  }
  const buffer = Buffer.from(data, 'base64');
  if (buffer.length === 0) throw new InvalidMaterialUploadError('data: must not be empty.');
  requireAllowedMaterialFileSize(buffer.length);
  return buffer;
}

/**
 * Select the backwards-compatible registration request or browser byte
 * upload from one HTTP body. Presence matters here: a caller may send one
 * variant only, even if the extra field is empty.
 */
async function uploadSessionMaterialRequest({ db, bucket, body, actor, now = Date.now, log = console }) {
  const { sessionId, storagePath, filename, data, contentType } = body || {};
  if (typeof sessionId !== 'string' || !sessionId) {
    throw new InvalidMaterialUploadError('sessionId: must be a non-empty string.');
  }
  const hasData = Object.prototype.hasOwnProperty.call(body || {}, 'data');
  const hasStoragePath = Object.prototype.hasOwnProperty.call(body || {}, 'storagePath');
  if (hasData && hasStoragePath) {
    throw new InvalidMaterialUploadError('Send data or storagePath, not both.');
  }
  if (hasData) {
    return uploadSessionMaterialBytes({
      db,
      bucket,
      sessionId,
      data,
      contentType,
      filename: typeof filename === 'string' ? filename : '',
      actor,
      now,
      log,
    });
  }
  if (typeof storagePath !== 'string' || !storagePath) {
    throw new InvalidMaterialUploadError('storagePath: must be a non-empty string.');
  }
  return uploadSessionMaterial({
    db,
    bucket,
    sessionId,
    storagePath,
    filename: typeof filename === 'string' ? filename : '',
    actor,
    now,
  });
}

/**
 * Store browser-supplied bytes at a server-derived path, then register the
 * material through the existing transactional create path. The stored row
 * marks the object as server-managed so the projection trigger removes it
 * when the row is deleted. Registration re-checks session ownership and
 * the per-session cap. If that check loses a race, the just-written object
 * is removed before the error is returned.
 */
async function uploadSessionMaterialBytes({
  db,
  bucket,
  sessionId,
  data,
  contentType,
  filename,
  actor,
  now = Date.now,
  log = console,
}) {
  // Refuse a foreign session before decoding or writing any supplied bytes.
  const sessionSnap = await db.collection(SESSIONS).doc(sessionId).get();
  assertMaterialCreateAllowed({ sessionSnap, sessionId, actor });

  const normalizedType = typeof contentType === 'string' && contentType.trim()
    ? contentType.trim().toLowerCase()
    : 'application/octet-stream';
  if (normalizedType.length > 100 || !CONTENT_TYPE_RE.test(normalizedType)) {
    throw new InvalidMaterialUploadError('contentType: must be a valid media type.');
  }
  const normalizedFilename = normalizeFileMaterialFilename(filename);
  const buffer = decodeMaterialUpload(data);

  const objectId = db.collection(MATERIALS).doc().id;
  const storagePath = `session-materials/${sessionId}/${objectId}`;
  const uploadAttempt = randomUUID();
  const file = bucket.file(storagePath);
  try {
    await file.save(buffer, {
      resumable: false,
      preconditionOpts: { ifGenerationMatch: 0 },
      metadata: {
        contentType: normalizedType,
        cacheControl: PRIVATE_CACHE_CONTROL,
        metadata: {
          uploadedBy: actor.uid,
          [UPLOAD_ATTEMPT_METADATA_KEY]: uploadAttempt,
        },
      },
    });
    return await uploadSessionMaterial({
      db,
      bucket,
      sessionId,
      storagePath,
      filename: normalizedFilename,
      actor,
      now,
      managedStorageObject: true,
    });
  } catch (err) {
    // A 412 means the fresh-name precondition found an existing object.
    // That object belongs to another invocation, so never inspect or delete it.
    if (!storageErrorHasStatus(err, 412)) {
      await removeOwnedUpload({ file, uploadAttempt, log });
    }
    throw err;
  }
}

function assertMaterialCreateAllowed({ sessionSnap, sessionId, actor }) {
  if (!sessionSnap.exists) throw new SessionNotFoundError(sessionId);
  const sessionData = sessionSnap.data() || {};
  if (!actor.isAdmin && !isSpeakerOfSession(sessionData, actor.speakerId)) {
    throw new NotAuthorizedError();
  }
  const currentCount = typeof sessionData.materialCount === 'number' ? sessionData.materialCount : 0;
  if (currentCount >= MAX_MATERIALS_PER_SESSION) {
    throw new MaterialCapExceededError(sessionId);
  }
  return { sessionData, currentCount };
}

async function createMaterial({
  db,
  sessionId,
  actor,
  now,
  type,
  url,
  storagePath,
  filename,
  managedStorageObject = false,
}) {
  const sessionRef = db.collection(SESSIONS).doc(sessionId);
  const materialRef = db.collection(MATERIALS).doc();

  return db.runTransaction(async (tx) => {
    const sessionSnap = await tx.get(sessionRef);
    const { currentCount } = assertMaterialCreateAllowed({ sessionSnap, sessionId, actor });

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
    if (managedStorageObject) material.managedStorageObject = true;
    tx.set(materialRef, material);
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
      // Same protocol allowlist as create — an update is just as capable of
      // smuggling in a javascript:/data:/file: target as the initial write.
      if (!isSafeUrl(patch.url)) throw new InvalidUrlError();
      next.url = patch.url;
    }
    if (typeof patch?.filename === 'string') {
      next.filename = current.type === 'link'
        ? scrubLinkLabel(patch.filename)
        : normalizeFileMaterialFilename(patch.filename);
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

/**
 * Cascade-delete every material (and its public projection) for a session
 * that is itself being deleted. Called from functions/src/cms/content.cjs's
 * `cmsDeleteContent` handler when the deleted collection is `cmsSchedule` —
 * without this, `deleteBoth` (cms/store.cjs) removes the live+draft
 * schedule doc but leaves `session_materials` and
 * `session_materials_public` rows behind, orphaned: the admin UI's
 * `listSessionMaterials` can no longer reach them (it looks up the session
 * first and 404s), and the public projection keeps serving metadata for a
 * session that no longer exists.
 *
 * Deliberately a plain batch, not a single transaction spanning the
 * schedule delete too — `deleteBoth` already owns that batch and does not
 * accept extra writes, and a session's material count is bounded by
 * MAX_MATERIALS_PER_SESSION, so one batch here (up to 2 writes per
 * material) never approaches Firestore's 500-write batch limit. The
 * schedule doc is already gone by the time this runs; the small window
 * where the session doc is absent but its materials still exist is a
 * cosmetic ordering detail, not a security or correctness gap (the
 * materials are already fully server-only either way).
 *
 * No `materialCount` decrement: the doc that field lived on is already
 * deleted.
 *
 * @param {{ db: object, sessionId: string }} args
 * @returns {Promise<{ deleted: number }>}
 */
async function deleteMaterialsForSession({ db, sessionId }) {
  const snap = await db.collection(MATERIALS).where('sessionId', '==', sessionId).get();
  if (snap.empty) return { deleted: 0 };
  const batch = db.batch();
  for (const doc of snap.docs) {
    batch.delete(doc.ref);
    batch.delete(db.collection(MATERIALS_PUBLIC).doc(doc.id));
  }
  await batch.commit();
  return { deleted: snap.docs.length };
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
  if (
    err instanceof InvalidUrlError
    || err instanceof InvalidStoragePathError
    || err instanceof InvalidMaterialUploadError
    || err instanceof MaterialFileNotFoundError
    || err instanceof MaterialCapExceededError
  ) {
    return badRequest(res, err.message);
  }
  if (err instanceof MaterialFileTooLargeError) {
    return sendError(res, 413, 'too-large', `storagePath: ${err.message}`);
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
    return {
      db,
      auth: getAuth(),
      getConfig: () => getEventConfig({ db }),
      getBucket: () => require('firebase-admin/storage').getStorage().bucket(),
    };
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
        withActor(async (req, res, { db, getBucket }, actor) => {
          try {
            const result = await uploadSessionMaterialRequest({
              db,
              bucket: getBucket(),
              body: req.body,
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
  uploadSessionMaterialBytes,
  uploadSessionMaterialRequest,
  updateSessionMaterial,
  deleteSessionMaterial,
  deleteMaterialsForSession,
  get handlers() {
    return buildHandlers();
  },
  internals: {
    SessionNotFoundError,
    MaterialNotFoundError,
    NotAuthorizedError,
    InvalidUrlError,
    InvalidStoragePathError,
    InvalidMaterialUploadError,
    MaterialFileNotFoundError,
    MaterialFileTooLargeError,
    MaterialFileSizeUnavailableError,
    MaterialCapExceededError,
    isSpeakerOfSession,
    SESSIONS,
    MATERIALS,
    MATERIALS_PUBLIC,
    MAX_MATERIALS_PER_SESSION,
    MAX_MATERIAL_FILENAME_LENGTH,
    decodeMaterialUpload,
    sendStoreError,
  },
};
