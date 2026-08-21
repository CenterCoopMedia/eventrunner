'use strict';

/**
 * `scanMediaUsage` (spec §1.3 media/, §9) — which documents reference a
 * Storage object, so deleting one can warn instead of silently blanking a
 * page.
 *
 * There is no reference table to consult: an image reaches a page as a
 * plain string inside a content block, a page section, a sponsor logo, or a
 * `config/theme.logos` slot. So the scan is a value walk over the content
 * corpus, matching the object path anywhere a string carries it. That is
 * deliberately broader than an equality test on a known field name: a block
 * type added next month stores its image in a field this module has never
 * heard of, and a usage warning that misses it is worse than useless.
 *
 * Both revisions are scanned (§8.4). A draft that references an asset is a
 * real use — publishing it later would restore a reference to an object
 * that is gone — so `cmsContent_drafts` counts exactly as `cmsContent` does,
 * with the revision named in the result.
 *
 * Matching is substring, against the raw object path AND its URL-encoded
 * form, because a stored value may be either the path (`cms-images/…`) or a
 * download URL that carries the path percent-encoded in its `/o/` segment.
 *
 * Pure functions plus an injected `db`: no firebase-admin import here.
 */

const { requireAdmin } = require('../core/auth.cjs');
const { sendError, badRequest, methodNotAllowed, internal } = require('../core/errors.cjs');

/**
 * Collections searched for asset references. Live + draft for every
 * publishable collection (§8.4); `cmsVersionHistory` is deliberately NOT
 * scanned — an old revision referencing a deleted asset is history, not a
 * live use, and warning about it would make every delete look unsafe.
 */
const USAGE_COLLECTIONS = Object.freeze([
  'cmsContent',
  'cmsContent_drafts',
  'cmsPages',
  'cmsPages_drafts',
  'cmsSchedule',
  'cmsSchedule_drafts',
  'cmsOrganizations',
  'cmsOrganizations_drafts',
  'cmsTimeline',
  'cmsTimeline_drafts',
  'cmsUpdates',
  'cmsUpdates_drafts',
]);

/**
 * Config documents that carry asset paths: `config/theme.logos` holds the
 * five branding slots (§7.2), and `config/event.seo` carries the OG image.
 * `config/bootstrap` and `config/providers` never hold assets and are not
 * read here.
 */
const USAGE_CONFIG_DOCS = Object.freeze(['theme', 'event']);

/** Hard ceiling on paths per request, so one call cannot walk the corpus N times. */
const MAX_PATHS_PER_SCAN = 200;

/**
 * Every string leaf in a document, with its dotted field path. Arrays are
 * indexed (`sections.0.image`) so a warning can name the exact slot.
 *
 * @param {unknown} value
 * @param {string} [prefix]
 * @returns {Array<{ field: string, value: string }>}
 */
function stringLeaves(value, prefix = '') {
  if (typeof value === 'string') return [{ field: prefix, value }];
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      stringLeaves(entry, prefix ? `${prefix}.${index}` : String(index)),
    );
  }
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.entries(value).flatMap(([key, entry]) =>
      stringLeaves(entry, prefix ? `${prefix}.${key}` : key),
    );
  }
  return [];
}

/**
 * Does `text` reference `objectPath`, either raw or percent-encoded?
 *
 * @param {string} text
 * @param {string} objectPath
 * @returns {boolean}
 */
function referencesPath(text, objectPath) {
  if (typeof text !== 'string' || text.length === 0) return false;
  if (text.includes(objectPath)) return true;
  return text.includes(encodeURIComponent(objectPath));
}

/**
 * References to `paths` inside one document's data.
 *
 * @param {object} data
 * @param {string} docPath e.g. 'cmsPages/travel'
 * @param {string[]} paths
 * @returns {Array<{ path: string, docPath: string, field: string }>}
 */
function referencesInDoc(data, docPath, paths) {
  const found = [];
  for (const leaf of stringLeaves(data)) {
    for (const path of paths) {
      if (referencesPath(leaf.value, path)) {
        found.push({ path, docPath, field: leaf.field });
      }
    }
  }
  return found;
}

/**
 * Scan the content corpus for references to each of `paths`.
 *
 * @param {{ db: FirebaseFirestore.Firestore, paths: string[],
 *           collections?: string[], configDocs?: string[] }} args
 * @returns {Promise<Record<string, Array<{ docPath: string, field: string }>>>}
 *   one entry per requested path, `[]` when unused — so a caller can tell
 *   "scanned, unused" from "not scanned".
 */
async function scanUsage({
  db,
  paths,
  collections = USAGE_COLLECTIONS,
  configDocs = USAGE_CONFIG_DOCS,
}) {
  /** @type {Record<string, Array<{ docPath: string, field: string }>>} */
  const usage = {};
  for (const path of paths) usage[path] = [];
  if (paths.length === 0) return usage;

  const record = (hits) => {
    for (const hit of hits) {
      usage[hit.path].push({ docPath: hit.docPath, field: hit.field });
    }
  };

  for (const name of collections) {
    let snapshot;
    try {
      snapshot = await db.collection(name).get();
    } catch (err) {
      // A collection that does not exist yet reads as empty in Firestore, so
      // a throw here is a real failure (permissions, transport) and must not
      // be swallowed into a falsely clean "unused" verdict.
      throw new Error(`media usage scan failed reading ${name}: ${err.message}`);
    }
    for (const doc of snapshot.docs) {
      record(referencesInDoc(doc.data() || {}, `${name}/${doc.id}`, paths));
    }
  }

  for (const docId of configDocs) {
    const snap = await db.collection('config').doc(docId).get();
    if (!snap.exists) continue;
    record(referencesInDoc(snap.data() || {}, `config/${docId}`, paths));
  }

  return usage;
}

/**
 * The paths to scan for one request: an explicit list, or every indexed
 * asset when none is given (the library's "show me what is unused" view).
 *
 * @param {{ db: object, requested: unknown }} args
 * @returns {Promise<{ ok: true, paths: string[] } |
 *                    { ok: false, message: string }>}
 */
async function resolveScanPaths({ db, requested }) {
  if (requested === undefined || requested === null) {
    const snapshot = await db.collection('media_assets').get();
    const paths = snapshot.docs
      .map((doc) => doc.data()?.path)
      .filter((path) => typeof path === 'string' && path.length > 0);
    return { ok: true, paths: [...new Set(paths)].slice(0, MAX_PATHS_PER_SCAN) };
  }
  if (!Array.isArray(requested)) {
    return { ok: false, message: 'paths: must be an array of object paths' };
  }
  if (requested.length > MAX_PATHS_PER_SCAN) {
    return { ok: false, message: `paths: at most ${MAX_PATHS_PER_SCAN} paths per scan` };
  }
  const paths = [];
  for (const entry of requested) {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      return { ok: false, message: 'paths: every entry must be a non-empty string' };
    }
    paths.push(entry.trim());
  }
  return { ok: true, paths: [...new Set(paths)] };
}

/**
 * `scanMediaUsage` handler: POST `{ paths?: string[] }` →
 * `{ usage: { [path]: [{ docPath, field }] }, scannedAt }`.
 *
 * Admin-gated like every other media endpoint: the response describes what
 * unpublished drafts contain, which is admin-only information (§8.4).
 */
function createScanMediaUsageHandler({ db, auth, getConfig, now = Date.now, log = console }) {
  return async function handler(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const gate = await requireAdmin({ auth, getConfig }, req);
    if (!gate.ok) return sendError(res, gate.status, gate.code, gate.message);

    let resolved;
    try {
      resolved = await resolveScanPaths({ db, requested: req.body?.paths });
    } catch (err) {
      log.error('scanMediaUsage could not list media_assets', err);
      return internal(res, 'The media library could not be scanned.');
    }
    if (!resolved.ok) return badRequest(res, resolved.message);

    let usage;
    try {
      usage = await scanUsage({ db, paths: resolved.paths });
    } catch (err) {
      log.error('scanMediaUsage failed', err);
      return internal(res, 'The media library could not be scanned.');
    }
    res.status(200).json({ usage, scannedAt: new Date(now()).toISOString() });
  };
}

function buildHandlers() {
  const { onRequest } = require('firebase-functions/v2/https');
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';
  const { withMediaDeps } = require('./deps.cjs');
  return {
    scanMediaUsage: onRequest({ region }, withMediaDeps(createScanMediaUsageHandler)),
  };
}

module.exports = {
  createScanMediaUsageHandler,
  scanUsage,
  get handlers() {
    return buildHandlers();
  },
  internals: {
    stringLeaves,
    referencesPath,
    referencesInDoc,
    resolveScanPaths,
    USAGE_COLLECTIONS,
    USAGE_CONFIG_DOCS,
    MAX_PATHS_PER_SCAN,
  },
};
