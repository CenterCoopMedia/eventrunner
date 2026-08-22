'use strict';

/**
 * `downloadSessionMaterial` — serving a **file**-type material's bytes
 * (issue #23 follow-up, spec §4.4/§8.5).
 *
 * `getSessionMaterialUrl` (materials/access.cjs) cannot hand back a usable
 * URL for a file material: `storage.rules` denies every direct read of
 * `session-materials/{sessionId}/...` (spec §8.5), so the raw
 * `storagePath` is a dead relative path in the browser — not a working
 * link, and not even a broken-but-honest one, since it LOOKS like a URL.
 *
 * The normal fix is a short-lived Cloud Storage v4 signed URL. That needs
 * `client_email` + a private key OR the
 * `roles/iam.serviceAccountTokenCreator` role on the runtime service
 * account so the SDK can call `signBlob` on its own identity — and on a
 * FRESH client project (spec §5, no manual IAM grants beyond what
 * `init-event.cjs` sets up) the default compute/App-Engine-default runtime
 * service account has neither. The media-library work (issue #24)
 * independently hit the same wall trying to mint upload URLs. Requiring an
 * operator to hand-grant `iam.serviceAccountTokenCreator` just to make
 * embargoed materials downloadable is exactly the kind of extra-IAM-step
 * spec §5.1's bootstrap flow is designed to avoid.
 *
 * So instead of signing anything: this endpoint reads the object with the
 * Admin SDK (`bucket.file(path).createReadStream()`, which only needs
 * ordinary Storage object read access — already true of the runtime SA on
 * every fresh project, since it holds `roles/editor` by default) and
 * streams the bytes back as the HTTP response, with the real
 * `Content-Type` and a `Content-Disposition` naming the material's
 * (scrub-exempt, spec §4.4) filename. The embargo gate
 * (`resolveMaterialAccess`, materials/access.cjs) runs on THIS request,
 * not on some earlier request that minted a token — a signed URL's whole
 * point is deferring the access check to mint time so the browser can
 * fetch it directly later; without one, deferring is not an option, so the
 * check simply runs every time, which is also strictly more precise (an
 * embargo lifting or a review status flipping between mint-time and
 * fetch-time can never leak a stale grant).
 *
 * The client cannot `window.open()` this the way it does a link material
 * (a plain top-level GET carries no Authorization header, and a
 * pre-embargo speaker/admin fetch needs one) — apps/web/src/lib/
 * materialsSource.js instead does an authenticated `fetch`, receives the
 * bytes as a Blob, and triggers the browser's save/open behavior itself
 * via a local object URL.
 */

const { badRequest, notFound, forbidden, methodNotAllowed, internal } =
  require('../core/errors.cjs');

/** Strip characters that would break a Content-Disposition header value
 * (quotes, CR/LF) rather than reject the whole filename — this is a
 * display label (spec §4.4: file filenames are never scrubbed for
 * URL-shape), so the goal is a SAFE header, not a rejected upload. */
function sanitizeForHeader(filename) {
  const cleaned = String(filename ?? 'download').replace(/["\r\n]/g, '');
  return cleaned.trim() || 'download';
}

/**
 * Stream one Storage object to an HTTP response.
 *
 * @param {{ file: { exists: () => Promise<[boolean]>,
 *                    getMetadata: () => Promise<[{contentType?: string}]>,
 *                    createReadStream: () => import('stream').Readable },
 *           res: import('express').Response, filename: string,
 *           log?: { error: Function } }} args
 * @returns {Promise<boolean>} true if the object existed and streaming started
 */
async function streamMaterialFile({ file, res, filename, log = console }) {
  const [exists] = await file.exists();
  if (!exists) return false;

  const [metadata] = await file.getMetadata().catch(() => [{}]);
  const contentType = typeof metadata?.contentType === 'string' && metadata.contentType
    ? metadata.contentType
    : 'application/octet-stream';

  res.set('Content-Type', contentType);
  res.set('Content-Disposition', `attachment; filename="${sanitizeForHeader(filename)}"`);
  res.set('Cache-Control', 'private, max-age=0, no-store');

  await new Promise((resolve, reject) => {
    const stream = file.createReadStream();
    stream.on('error', (err) => {
      log.error('downloadSessionMaterial: Storage read stream failed', err);
      // Headers may already be flushed once bytes started flowing — end
      // the response either way rather than trying to send a second
      // status/body onto a stream already in progress.
      if (!res.headersSent) res.status(500);
      res.end();
      reject(err);
    });
    stream.on('end', resolve);
    stream.pipe(res);
  }).catch(() => {
    // Already logged and responded to above; nothing further to do here —
    // this catch exists only so a stream error doesn't become an unhandled
    // rejection.
  });
  return true;
}

/** Deployable export: downloadSessionMaterial. */
function buildHandlers() {
  const { onRequest } = require('firebase-functions/v2/https');
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';

  return {
    downloadSessionMaterial: onRequest({ region }, async (req, res) => {
      const { applyCors, parseAllowedOrigins } = require('../core/http.cjs');
      const handled = applyCors(req, res, {
        allowedOrigins: parseAllowedOrigins(process.env.EVENT_ALLOWED_ORIGINS),
      });
      if (handled) return;
      if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

      const { getDb } = require('../core/firestore.cjs');
      const { getAuth } = require('firebase-admin/auth');
      const { getStorage } = require('firebase-admin/storage');
      const { getEventConfig } = require('../core/config.cjs');
      const { resolveActorOptional } = require('./actor.cjs');
      const { resolveMaterialAccess, internals } = require('./access.cjs');

      const db = getDb();
      const deps = { db, auth: getAuth(), getConfig: () => getEventConfig({ db }) };
      const actor = await resolveActorOptional(deps, req);

      const { materialId } = req.body || {};
      if (typeof materialId !== 'string' || !materialId) {
        return badRequest(res, 'materialId: must be a non-empty string');
      }

      let material;
      try {
        ({ material } = await resolveMaterialAccess({ db, materialId, actor, getConfig: deps.getConfig }));
      } catch (err) {
        if (err instanceof internals.MaterialNotFoundError || err instanceof internals.SessionNotFoundError) {
          return notFound(res, 'Material not found.');
        }
        if (err instanceof internals.EmbargoedError) return forbidden(res, err.message);
        console.error('downloadSessionMaterial failed', err);
        return internal(res, 'The material could not be retrieved.');
      }

      if (material.type !== 'file') {
        return badRequest(res, 'This material is a link, not a downloadable file.');
      }

      const bucket = getStorage().bucket();
      const file = bucket.file(material.storagePath);
      let served;
      try {
        served = await streamMaterialFile({ file, res, filename: material.filename });
      } catch {
        // streamMaterialFile already responded/ended on a stream error.
        return;
      }
      if (!served) return notFound(res, 'The underlying file could not be found.');
    }),
  };
}

module.exports = {
  streamMaterialFile,
  get handlers() {
    return buildHandlers();
  },
  internals: { sanitizeForHeader },
};
