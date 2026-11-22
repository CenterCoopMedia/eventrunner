'use strict';

/**
 * `mediaUpdateMetadata` (spec §1.3 media/) — the editable half of an asset
 * row: alt text, title, caption and credit.
 *
 * Alt text is the reason this endpoint exists rather than being folded into
 * upload: an image is usually uploaded in a hurry and described later, and
 * the issue's done-when is "the library round-trips uploads with alt text".
 * Object identity stays fixed: `path`, `contentType`, `size`,
 * `uploadedBy`, and `createdAt` describe an object in the bucket, and a row
 * that could be pointed at a different path would be an authorization
 * bypass wearing a metadata form: the object path is what every rule and
 * every consumer trusts.
 */

const { requireAdmin } = require('../core/auth.cjs');
const { logAdminAction } = require('../cms/store.cjs');
const { sendError, badRequest, methodNotAllowed, notFound, internal } = require('../core/errors.cjs');
const { internals: uploadInternals } = require('./upload.cjs');
const { scanUsage } = require('./usage.cjs');
const { MAX_CAPTION_LENGTH, MAX_CREDIT_LENGTH } = require('shared/imageCaption');

const {
  MAX_ALT_LENGTH, MAX_TITLE_LENGTH, trimmedText, isBrandingAsset, referencedByBranding, BRANDING_REFUSAL,
} = uploadInternals;

/** Fields a client may change on an existing row. */
const FIELD_LIMITS = Object.freeze({
  alt: MAX_ALT_LENGTH,
  title: MAX_TITLE_LENGTH,
  caption: MAX_CAPTION_LENGTH,
  credit: MAX_CREDIT_LENGTH,
});
const EDITABLE_FIELDS = Object.freeze(Object.keys(FIELD_LIMITS));

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
  for (const [field, limit] of Object.entries(FIELD_LIMITS)) {
    if (!Object.hasOwn(body, field)) continue;
    if (typeof body[field] !== 'string') return { ok: false, message: `${field}: must be a string` };
    patch[field] = trimmedText(body[field], limit);
  }
  if (Object.keys(patch).length === 0) {
    return { ok: false, message: `body: nothing to update (${EDITABLE_FIELDS.join(', ')})` };
  }
  return { ok: true, patch };
}

/** `mediaUpdateMetadata`: POST `{ assetId, alt?, title?, caption?, credit? }`. */
function createMediaUpdateMetadataHandler({ db, auth, getConfig, now = Date.now, log = console }) {
  return async function handler(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const gate = await requireAdmin({ auth, db, getConfig }, req, { tier: 'staff' });
    if (!gate.ok) return sendError(res, gate.status, gate.code, gate.message);

    const assetId = typeof req.body?.assetId === 'string' ? req.body.assetId.trim() : '';
    if (!assetId || assetId.includes('/')) return badRequest(res, 'assetId: required');

    const verdict = validateMetadata(req.body);
    if (!verdict.ok) return badRequest(res, verdict.message);

    const ref = db.collection('media_assets').doc(assetId);
    const actor = { uid: gate.uid, email: gate.email };
    const at = new Date(now());
    let stored;
    try {
      const snap = await ref.get();
      if (!snap.exists) return notFound(res, 'That asset is not in the media library.');
      stored = snap.data() || {};
    } catch (err) {
      log.error('mediaUpdateMetadata could not read the asset', err);
      return internal(res, 'The asset could not be updated. Keep this page open and contact support for help.');
    }
    if (gate.tier !== 'operator') {
      // A branding asset's words are the operator's too (upload.cjs), and
      // so are a page image's once a theme slot or the social card names
      // it. Only config/theme and config/event can name it so, and the scan
      // reads those two documents alone: the CMS collections that
      // mediaDelete also scans answer nothing here. A scan that cannot run
      // is not permission to write: staff cannot prove the asset is not on
      // a branding surface.
      if (isBrandingAsset(stored)) return sendError(res, 403, 'forbidden', BRANDING_REFUSAL);
      const path = typeof stored.path === 'string' ? stored.path : '';
      let references = [];
      if (path) {
        try {
          const usage = await scanUsage({ db, paths: [path], collections: [] });
          references = usage[path] ?? [];
        } catch (err) {
          log.error('mediaUpdateMetadata usage scan failed', err);
          return internal(res, 'The asset could not be checked for usage. Keep this page open and contact support for help.');
        }
      }
      if (referencedByBranding(references)) return sendError(res, 403, 'forbidden', BRANDING_REFUSAL);
    }
    try {
      const { caption, credit } = verdict.patch;
      const outcome = await db.runTransaction(async (tx) => {
        const current = await tx.get(ref);
        if (!current.exists) return 'missing';
        if (current.data()?.deleting === true) return 'deleting';
        tx.update(ref, { ...verdict.patch, updatedAt: at, updatedBy: actor.email });
        if (caption !== undefined || credit !== undefined) {
          tx.set(db.collection('media_captions').doc(assetId), {
            ...(caption !== undefined ? { caption } : {}),
            ...(credit !== undefined ? { credit } : {}),
          }, { merge: true });
        }
        return 'updated';
      });
      if (outcome === 'missing') return notFound(res, 'That asset is not in the media library.');
      if (outcome === 'deleting') return sendError(res, 409, 'asset-deleting', 'This asset is being deleted. Reload the media library.');
    } catch (err) {
      log.error('mediaUpdateMetadata failed', err);
      return internal(res, 'The asset could not be updated. Keep this page open and contact support for help.');
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
