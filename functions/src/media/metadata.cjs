'use strict';

/**
 * `mediaUpdateMetadata` (spec §1.3 media/) — the editable half of an asset
 * row: alt text and title.
 *
 * Alt text is the reason this endpoint exists rather than being folded into
 * upload: an image is usually uploaded in a hurry and described later, and
 * the issue's done-when is "the library round-trips uploads with alt text".
 * Nothing else on the row is editable — `path`, `contentType`, `size`,
 * `uploadedBy`, and `createdAt` describe an object in the bucket, and a row
 * that could be pointed at a different path would be an authorization
 * bypass wearing a metadata form: the object path is what every rule and
 * every consumer trusts.
 */

const { requireAdmin } = require('../core/auth.cjs');
const { logAdminAction } = require('../cms/store.cjs');
const { sendError, badRequest, methodNotAllowed, notFound, internal } = require('../core/errors.cjs');
const { internals: uploadInternals } = require('./upload.cjs');

const { MAX_ALT_LENGTH, MAX_TITLE_LENGTH, trimmedText } = uploadInternals;

/** Fields a client may change on an existing row. */
const EDITABLE_FIELDS = Object.freeze(['alt', 'title']);

/**
 * The patch for one metadata request. Absent keys are left alone (a form
 * that only edits alt must not blank the title); a key present with a
 * non-string value is a rejection, not a silent coercion.
 *
 * @param {object} body
 * @returns {{ ok: true, patch: object } | { ok: false, message: string }}
 */
function validateMetadata(body) {
  if (!body || typeof body !== 'object') return { ok: false, message: 'body: must be a JSON object' };
  const unknown = Object.keys(body).filter(
    (key) => !EDITABLE_FIELDS.includes(key) && key !== 'assetId',
  );
  if (unknown.length > 0) {
    return {
      ok: false,
      message: unknown.map((key) => `${key}: not an editable asset field`).join('; '),
    };
  }
  const patch = {};
  if ('alt' in body) {
    if (typeof body.alt !== 'string') return { ok: false, message: 'alt: must be a string' };
    patch.alt = trimmedText(body.alt, MAX_ALT_LENGTH);
  }
  if ('title' in body) {
    if (typeof body.title !== 'string') return { ok: false, message: 'title: must be a string' };
    patch.title = trimmedText(body.title, MAX_TITLE_LENGTH);
  }
  if (Object.keys(patch).length === 0) {
    return { ok: false, message: `body: nothing to update (${EDITABLE_FIELDS.join(', ')})` };
  }
  return { ok: true, patch };
}

/** `mediaUpdateMetadata`: POST `{ assetId, alt?, title? }`. */
function createMediaUpdateMetadataHandler({ db, auth, getConfig, now = Date.now, log = console }) {
  return async function handler(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const gate = await requireAdmin({ auth, getConfig }, req);
    if (!gate.ok) return sendError(res, gate.status, gate.code, gate.message);

    const assetId = typeof req.body?.assetId === 'string' ? req.body.assetId.trim() : '';
    if (!assetId || assetId.includes('/')) return badRequest(res, 'assetId: required');

    const verdict = validateMetadata(req.body);
    if (!verdict.ok) return badRequest(res, verdict.message);

    const ref = db.collection('media_assets').doc(assetId);
    const actor = { uid: gate.uid, email: gate.email };
    const at = new Date(now());
    try {
      const snap = await ref.get();
      if (!snap.exists) return notFound(res, 'That asset is not in the media library.');
      await ref.update({ ...verdict.patch, updatedAt: at, updatedBy: actor.email });
    } catch (err) {
      log.error('mediaUpdateMetadata failed', err);
      return internal(res, 'The asset could not be updated.');
    }

    await logAdminAction({
      db,
      action: 'mediaUpdateMetadata',
      docPath: `media_assets/${assetId}`,
      actor,
      now,
      log,
    });
    res.status(200).json({ assetId, ...verdict.patch });
  };
}

function buildHandlers() {
  const { onRequest } = require('firebase-functions/v2/https');
  const { withMediaDeps } = require('./deps.cjs');
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';
  return {
    mediaUpdateMetadata: onRequest({ region }, withMediaDeps(createMediaUpdateMetadataHandler)),
  };
}

module.exports = {
  createMediaUpdateMetadataHandler,
  get handlers() {
    return buildHandlers();
  },
  internals: { validateMetadata, EDITABLE_FIELDS },
};
