'use strict';

/**
 * `mediaUpload` and `mediaDelete` (spec §1.3 media/, §8.5) — the server
 * half of the media library.
 *
 * WHY THE BYTES COME THROUGH THE FUNCTION. §8.5 offers two shapes for a
 * server-authorized upload: "either writes through the Admin SDK or returns
 * a short-lived resumable upload URL scoped to one object path". This module
 * takes the first. A resumable-session URL is issued by the bucket, not
 * signed locally, but the alternative form (`getSignedUrl`) needs
 * `iam.serviceAccounts.signBlob` on the runtime service account — a
 * deploy-time IAM grant §8 does not provision, so an upload path built on it
 * would work in the emulator and 403 on a fresh client project. Posting the
 * bytes to an admin-gated endpoint needs no extra IAM, and it lets the
 * server see the size and the content type BEFORE anything lands in the
 * bucket, which a pre-issued URL cannot (the client picks what it PUTs).
 * The cost is the request-size ceiling below.
 *
 * What the endpoint enforces, in order: admin token (core/auth requireAdmin
 * — a verified ID token, never a React conditional), a known folder, a
 * known content type, a size cap, and a filename it derives itself. The
 * client never chooses the object path: it is `{folder}/{assetId}/{name}`
 * with a server-generated assetId, so two uploads of `logo.png` cannot
 * collide and no payload can traverse into another namespace.
 *
 * Object metadata mirrors scripts/lib/branding.cjs's convention: init marks
 * what it seeds with `metadata.seeded = 'true'` and refuses to overwrite
 * anything else, so uploads here stamp `seeded: 'false'` explicitly. An
 * operator re-running `init-event --force` after replacing a logo therefore
 * leaves the replacement alone.
 */

const { requireAdmin } = require('../core/auth.cjs');
const { logAdminAction } = require('../cms/store.cjs');
const { sendError, badRequest, methodNotAllowed, notFound, internal } = require('../core/errors.cjs');
const { scanUsage } = require('./usage.cjs');

/**
 * Storage namespaces the media library owns, and the content types each
 * accepts (§8.5 lists them as `cms-images/**` and `branding/**`).
 *
 * SVG is accepted for `branding/` ONLY. The four seeded placeholder logos
 * are SVG (scripts/lib/branding.cjs), so a client replacing its logo with a
 * PNG-only library would be downgrading its own branding — and the objects
 * are served from the Storage host, a different origin from the site, so a
 * hostile SVG there cannot reach the site's DOM or cookies. `cms-images/`
 * has no such need and does not take the trade: an image dropped into a
 * page body is the surface most editors use most often.
 */
const FOLDERS = Object.freeze({
  'cms-images': Object.freeze(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
  branding: Object.freeze(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']),
});

/** Extensions written onto the object path, one per accepted type. */
const EXTENSIONS = Object.freeze({
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
});

/**
 * 5 MiB of image, which is ~6.7 MB of base64 in the request body — inside
 * the platform's HTTP request limit with room for the JSON envelope, and
 * well above any sensible web image. Profile photos are capped lower (2 MiB)
 * by storage.rules, since those upload directly.
 */
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** Alt text and title caps — enough for a real description, not a document. */
const MAX_ALT_LENGTH = 500;
const MAX_TITLE_LENGTH = 200;

const CACHE_CONTROL = 'public, max-age=3600';

/** Base64 with optional padding, nothing else. */
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

function isPlainObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

/**
 * A filename safe to append to an object path: basename only, lowercased,
 * non-alphanumerics collapsed to hyphens, extension forced to match the
 * declared content type. Never trusted for uniqueness — the assetId segment
 * provides that — so a name that sanitizes to nothing simply becomes
 * `asset.<ext>`.
 *
 * @param {unknown} filename
 * @param {string} contentType
 * @returns {string}
 */
function safeObjectName(filename, contentType) {
  const ext = EXTENSIONS[contentType] || 'bin';
  const raw = typeof filename === 'string' ? filename : '';
  const base = raw.split(/[\\/]/).pop() || '';
  const stem = base
    .replace(/\.[^.]*$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${stem || 'asset'}.${ext}`;
}

/**
 * Decode the request's base64 payload, refusing anything that is not
 * plainly base64 or that exceeds the cap. The length check runs on the
 * ENCODED string first, so an oversize payload is rejected without
 * allocating its decoded buffer.
 *
 * A `data:` URL prefix is accepted and stripped: it is what a browser's
 * FileReader hands the caller, and rejecting it would only push the same
 * strip into every client.
 *
 * @param {unknown} data
 * @returns {{ ok: true, buffer: Buffer } | { ok: false, message: string }}
 */
function decodeUpload(data) {
  if (typeof data !== 'string' || data.length === 0) {
    return { ok: false, message: 'data: must be a base64-encoded string' };
  }
  const body = data.startsWith('data:') ? data.slice(data.indexOf(',') + 1) : data;
  const compact = body.replace(/\s+/g, '');
  if (!BASE64_RE.test(compact)) {
    return { ok: false, message: 'data: must be a base64-encoded string' };
  }
  // 4 base64 chars → 3 bytes; a cheap upper bound before decoding.
  if ((compact.length / 4) * 3 > MAX_UPLOAD_BYTES + 3) {
    return { ok: false, message: `data: exceeds the ${MAX_UPLOAD_BYTES} byte limit` };
  }
  const buffer = Buffer.from(compact, 'base64');
  if (buffer.length === 0) {
    return { ok: false, message: 'data: decoded to zero bytes' };
  }
  if (buffer.length > MAX_UPLOAD_BYTES) {
    return { ok: false, message: `data: exceeds the ${MAX_UPLOAD_BYTES} byte limit` };
  }
  return { ok: true, buffer };
}

/** @param {unknown} value @param {number} max @returns {string} */
function trimmedText(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/**
 * Validate one upload request into everything the write needs. Pure —
 * every rejection names the offending field, matching the message contract
 * adminApi.js splits on.
 *
 * @param {object} body
 * @param {() => string} newId
 * @returns {{ ok: true, asset: object, buffer: Buffer } |
 *            { ok: false, message: string }}
 */
function validateUpload(body, newId) {
  if (!isPlainObject(body)) return { ok: false, message: 'body: must be a JSON object' };

  const folder = typeof body.folder === 'string' ? body.folder.trim() : '';
  if (!Object.prototype.hasOwnProperty.call(FOLDERS, folder)) {
    return {
      ok: false,
      message: `folder: must be one of ${Object.keys(FOLDERS).join(', ')}`,
    };
  }

  const contentType = typeof body.contentType === 'string' ? body.contentType.trim() : '';
  if (!FOLDERS[folder].includes(contentType)) {
    return {
      ok: false,
      message: `contentType: ${folder} accepts ${FOLDERS[folder].join(', ')}`,
    };
  }

  const decoded = decodeUpload(body.data);
  if (!decoded.ok) return decoded;

  const alt = trimmedText(body.alt, MAX_ALT_LENGTH);
  const title = trimmedText(body.title, MAX_TITLE_LENGTH);
  const assetId = newId();
  const name = safeObjectName(body.filename, contentType);

  return {
    ok: true,
    buffer: decoded.buffer,
    asset: {
      assetId,
      // The client never supplies this. A server-built path is what keeps
      // `folder: 'cms-images'` from being talked into `../branding`.
      path: `${folder}/${assetId}/${name}`,
      folder,
      filename: name,
      contentType,
      size: decoded.buffer.length,
      alt,
      title,
    },
  };
}

/**
 * Write the object, then index it. In that order on purpose: an object with
 * no row is invisible in the library and costs storage, while a row with no
 * object renders as a broken image on a live page. If the row fails, the
 * object is removed again (best effort) so neither state persists.
 *
 * @param {{ db: object, bucket: object, asset: object, buffer: Buffer,
 *           actor: { uid: string, email: string }, now?: () => number,
 *           log?: Pick<Console,'warn'|'error'> }} args
 * @returns {Promise<object>} the stored asset row, with its id
 */
async function storeAsset({ db, bucket, asset, buffer, actor, now = Date.now, log = console }) {
  const at = new Date(now());
  const file = bucket.file(asset.path);
  await file.save(buffer, {
    resumable: false,
    contentType: asset.contentType,
    metadata: {
      contentType: asset.contentType,
      cacheControl: CACHE_CONTROL,
      metadata: {
        // scripts/lib/branding.cjs overwrites ONLY objects stamped
        // seeded='true'. Stamping 'false' here (rather than omitting it)
        // states the provenance explicitly: an init --force re-run must
        // never replace a logo an admin uploaded.
        seeded: 'false',
        uploadedBy: actor.email,
        assetId: asset.assetId,
      },
    },
  });

  const row = {
    path: asset.path,
    folder: asset.folder,
    filename: asset.filename,
    contentType: asset.contentType,
    size: asset.size,
    alt: asset.alt,
    title: asset.title,
    uploadedBy: actor.email,
    uploadedByUid: actor.uid,
    createdAt: at,
    updatedAt: at,
    updatedBy: actor.email,
  };
  try {
    await db.collection('media_assets').doc(asset.assetId).set(row);
  } catch (err) {
    try {
      await file.delete();
    } catch (cleanupErr) {
      log.warn('media upload rollback failed; orphaned object left in the bucket', cleanupErr);
    }
    throw err;
  }
  return { id: asset.assetId, ...row };
}

/** `mediaUpload`: POST a base64 image, get back the indexed asset. */
function createMediaUploadHandler({
  db,
  bucket,
  auth,
  getConfig,
  now = Date.now,
  newId = () => require('node:crypto').randomBytes(12).toString('hex'),
  log = console,
}) {
  return async function handler(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const gate = await requireAdmin({ auth, getConfig }, req);
    if (!gate.ok) return sendError(res, gate.status, gate.code, gate.message);

    const verdict = validateUpload(req.body, newId);
    if (!verdict.ok) return badRequest(res, verdict.message);

    const actor = { uid: gate.uid, email: gate.email };
    let asset;
    try {
      asset = await storeAsset({
        db,
        bucket,
        asset: verdict.asset,
        buffer: verdict.buffer,
        actor,
        now,
        log,
      });
    } catch (err) {
      log.error('mediaUpload failed', err);
      return internal(res, 'The file could not be uploaded.');
    }

    await logAdminAction({
      db,
      action: 'mediaUpload',
      docPath: `media_assets/${asset.id}`,
      actor,
      now,
      log,
    });
    res.status(200).json({ asset });
  };
}

/**
 * `mediaDelete`: remove an asset and its object.
 *
 * Refuses by default when the scan finds the path referenced anywhere
 * (§9 "so deletion can warn"), answering 409 with the reference list so the
 * UI can show WHERE it is used. `{ force: true }` is the admin saying they
 * read the list — the same two-step the CMS delete flow uses, not a silent
 * cascade that blanks a live page.
 */
function createMediaDeleteHandler({ db, bucket, auth, getConfig, now = Date.now, log = console }) {
  return async function handler(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const gate = await requireAdmin({ auth, getConfig }, req);
    if (!gate.ok) return sendError(res, gate.status, gate.code, gate.message);

    const assetId = typeof req.body?.assetId === 'string' ? req.body.assetId.trim() : '';
    if (!assetId || assetId.includes('/')) return badRequest(res, 'assetId: required');
    const force = req.body?.force === true;

    const ref = db.collection('media_assets').doc(assetId);
    let snap;
    try {
      snap = await ref.get();
    } catch (err) {
      log.error('mediaDelete could not read the asset', err);
      return internal(res, 'The file could not be deleted.');
    }
    if (!snap.exists) return notFound(res, 'That asset is not in the media library.');
    const stored = snap.data() || {};
    const path = typeof stored.path === 'string' ? stored.path : '';

    let references = [];
    if (path) {
      try {
        const usage = await scanUsage({ db, paths: [path] });
        references = usage[path] ?? [];
      } catch (err) {
        // A scan that cannot run is not permission to delete blindly: the
        // whole point of the warning is that the admin sees the references
        // first. Only --force gets past it.
        log.error('mediaDelete usage scan failed', err);
        if (!force) return internal(res, 'The file could not be checked for usage.');
      }
    }
    if (references.length > 0 && !force) {
      return res.status(409).json({
        error: {
          code: 'asset-in-use',
          message: `That asset is used by ${references.length} document${
            references.length === 1 ? '' : 's'
          }. Delete it anyway to remove it from the library and the bucket.`,
        },
        usage: references,
      });
    }

    try {
      if (path) {
        // ignoreNotFound: an object already gone (a half-finished earlier
        // delete) must not strand its row in the library forever.
        await bucket.file(path).delete({ ignoreNotFound: true });
      }
      await ref.delete();
    } catch (err) {
      log.error('mediaDelete failed', err);
      return internal(res, 'The file could not be deleted.');
    }

    await logAdminAction({
      db,
      action: 'mediaDelete',
      docPath: `media_assets/${assetId}`,
      actor: { uid: gate.uid, email: gate.email },
      now,
      log,
    });
    res.status(200).json({ assetId, path, usage: references });
  };
}

function buildHandlers() {
  const { onRequest } = require('firebase-functions/v2/https');
  const { withMediaDeps } = require('./deps.cjs');
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';
  return {
    mediaUpload: onRequest({ region, memory: '512MiB' }, withMediaDeps(createMediaUploadHandler)),
    mediaDelete: onRequest({ region }, withMediaDeps(createMediaDeleteHandler)),
  };
}

module.exports = {
  createMediaUploadHandler,
  createMediaDeleteHandler,
  storeAsset,
  get handlers() {
    return buildHandlers();
  },
  internals: {
    validateUpload,
    decodeUpload,
    safeObjectName,
    trimmedText,
    FOLDERS,
    EXTENSIONS,
    MAX_UPLOAD_BYTES,
    MAX_ALT_LENGTH,
    MAX_TITLE_LENGTH,
    CACHE_CONTROL,
  },
};
