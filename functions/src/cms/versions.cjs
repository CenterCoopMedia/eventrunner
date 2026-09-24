'use strict';

/**
 * Version-history reads (spec §8.4, issue #12).
 *
 * cmsGetVersionHistory — admin POST { docPath, limit?, cursor? }.
 * Entries are the append-only rows publishDocs writes to
 * cmsVersionHistory, ordered newest-first by revision. Pagination is
 * revision-cursor based: `cursor` is the last revision of the previous
 * page (revisions are unique per docPath because each publish bumps by
 * exactly one inside an atomic batch).
 *
 * Admin-only: history rows carry unpublished intermediate field values,
 * which are exactly the data the draft collections exist to keep private.
 *
 * WHAT CHANGED (issue #195). A row stores a full snapshot of the content
 * fields, not a diff, so each entry is compared here with the row before
 * it and answers a `changes` list the version history page reads as it
 * stands. The predecessor of every entry is the next row of the same
 * query: the query already reads one row past the page to decide
 * nextCursor, so the last entry on a full page has its predecessor too,
 * at no extra read. Every instant leaves as milliseconds (a Firestore
 * Timestamp has no toJSON and would otherwise serialize as its internal
 * `{ _seconds, _nanoseconds }`), in `publishedAt`, in a change, and as an
 * ISO string in the `fields` snapshot the page restores from.
 */

const { isDeepStrictEqual } = require('node:util');
const { requireAdmin } = require('../core/auth.cjs');
const { sendError, badRequest, methodNotAllowed, internal } = require('../core/errors.cjs');
const { PUBLISHABLE_COLLECTIONS } = require('./blockTypes.cjs');

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
/** The most changes one entry lists; `moreChanges` counts the rest. */
const MAX_CHANGES = 50;
/**
 * The seed's own bookkeeping (content.cjs SEED_FIELDS). Seeding a record
 * and the first edit that clears the flag are not edits a reader asked
 * about, so they never show as a change.
 */
const SKIPPED_PATHS = Object.freeze(['seeded', 'seededAt']);

/** @param {unknown} value @returns {number|null} millis, or null if not a usable instant */
function toMillis(value) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

/** A Date, or anything with a `toMillis()` (a Firestore Timestamp). */
function isInstant(value) {
  return value instanceof Date || (value !== null && typeof value === 'object' && typeof value.toMillis === 'function');
}

/** A map value: an object literal or a null-prototype object, never a class instance. */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

const isScalar = (value) => value === null || value === undefined || typeof value !== 'object';

/**
 * Flatten a value to its leaves, keyed by path segments joined with '.'.
 * A map recurses by key. An array of scalars is one leaf (a list of tags
 * reads as one value). Any other array recurses by index. An empty map or
 * array, an instant, and any other object are leaves.
 */
function flattenInto(value, path, out) {
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) out.set(path, value);
    for (const key of keys) flattenInto(value[key], path ? `${path}.${key}` : key, out);
    return;
  }
  if (Array.isArray(value) && value.length > 0 && !value.every(isScalar)) {
    value.forEach((item, index) => flattenInto(item, `${path}.${index}`, out));
    return;
  }
  out.set(path, value);
}

/** @param {unknown} fields @returns {Map<string, unknown>} the leaves, seed bookkeeping left out */
function leavesOf(fields) {
  const out = new Map();
  if (!isPlainObject(fields)) return out;
  for (const [key, value] of Object.entries(fields)) {
    if (!SKIPPED_PATHS.includes(key)) flattenInto(value, key, out);
  }
  return out;
}

/** An instant leaves as milliseconds; everything else as stored. */
const leafValue = (value) => (isInstant(value) ? toMillis(value) : value);

function sameLeaf(a, b) {
  if (isInstant(a) || isInstant(b)) return isInstant(a) && isInstant(b) && toMillis(a) === toMillis(b);
  return isDeepStrictEqual(a, b);
}

/**
 * Path order: segment by segment, index segments by number, so
 * `sections.2` comes before `sections.10`.
 */
function comparePaths(a, b) {
  const left = a.split('.');
  const right = b.split('.');
  for (let i = 0; i < Math.min(left.length, right.length); i += 1) {
    if (left[i] === right[i]) continue;
    const numeric = /^\d+$/.test(left[i]) && /^\d+$/.test(right[i]);
    if (numeric) return Number(left[i]) - Number(right[i]);
    return left[i] < right[i] ? -1 : 1;
  }
  return left.length - right.length;
}

function change(path, kind, before, after) {
  const entry = { path, kind, before: leafValue(before), after: leafValue(after) };
  if (isInstant(before) || isInstant(after)) entry.time = true;
  return entry;
}

/**
 * What changed from one history row to the next. Pure. `previous` is the
 * row before `current`, or null when `current` is the oldest stored row,
 * whose every leaf then reads as added. `visible` is a reserved field
 * (store.cjs RESERVED_FIELDS), so no content path can collide with it; it
 * shows when it moved, and on a first row that went out hidden.
 *
 * @param {{ fields?: object, visible?: boolean }|null} previous
 * @param {{ fields?: object, visible?: boolean }} current
 * @returns {{ changes: Array<{ path: string, kind: 'added'|'removed'|'changed',
 *             before: unknown, after: unknown, time?: true }>, moreChanges: number }}
 */
function describeChanges(previous, current) {
  const after = leavesOf(current?.fields);
  const changes = [];
  if (!previous) {
    for (const [path, value] of after) changes.push(change(path, 'added', null, value));
    if (current?.visible === false) changes.push(change('visible', 'added', null, false));
  } else {
    const before = leavesOf(previous.fields);
    for (const path of new Set([...before.keys(), ...after.keys()])) {
      if (!after.has(path)) changes.push(change(path, 'removed', before.get(path), null));
      else if (!before.has(path)) changes.push(change(path, 'added', null, after.get(path)));
      else if (!sameLeaf(before.get(path), after.get(path))) {
        changes.push(change(path, 'changed', before.get(path), after.get(path)));
      }
    }
    const wasVisible = previous.visible !== false;
    const isVisible = current?.visible !== false;
    if (wasVisible !== isVisible) changes.push(change('visible', 'changed', wasVisible, isVisible));
  }
  changes.sort((a, b) => comparePaths(a.path, b.path));
  return {
    changes: changes.slice(0, MAX_CHANGES),
    moreChanges: Math.max(0, changes.length - MAX_CHANGES),
  };
}

/**
 * The stored snapshot with every instant as an ISO string, so it survives
 * JSON and the page can send it back to a save endpoint to restore it
 * (cmsSaveUpdate takes `publishAt` as ISO-8601).
 */
function jsonSafe(value) {
  if (isInstant(value)) {
    const ms = toMillis(value);
    return ms === null ? null : new Date(ms).toISOString();
  }
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (isPlainObject(value)) {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = jsonSafe(item);
    return out;
  }
  return value;
}

/**
 * One history row shaped for the page, named fields only.
 *
 * @param {{ id: string, data: () => object }} doc
 * @param {{ data: () => object }|null} previousDoc the next row down, or null
 */
function toEntry(doc, previousDoc) {
  const data = doc.data() || {};
  const previous = previousDoc ? previousDoc.data() || {} : null;
  const { changes, moreChanges } = describeChanges(previous, data);
  return {
    id: doc.id,
    docPath: data.docPath,
    revision: data.revision,
    fields: jsonSafe(isPlainObject(data.fields) ? data.fields : {}),
    visible: data.visible !== false,
    publishedAt: toMillis(data.publishedAt),
    publishedBy: typeof data.publishedBy === 'string' ? data.publishedBy : null,
    publishedByUid: typeof data.publishedByUid === 'string' ? data.publishedByUid : null,
    previousRevision: typeof previous?.revision === 'number' ? previous.revision : null,
    changes,
    moreChanges,
  };
}

/** `<publishable-collection>/<docId>` with a sane single-segment doc id. */
function isValidDocPath(docPath) {
  if (typeof docPath !== 'string') return false;
  const slash = docPath.indexOf('/');
  if (slash <= 0) return false;
  const collection = docPath.slice(0, slash);
  const docId = docPath.slice(slash + 1);
  return (
    PUBLISHABLE_COLLECTIONS.includes(collection) &&
    docId.length > 0 &&
    docId.length <= 300 &&
    !docId.includes('/')
  );
}

/**
 * @param {{ db, auth, getConfig, log?: Console }} deps
 */
function createGetVersionHistoryHandler({ db, auth, getConfig, log = console }) {
  return async function cmsGetVersionHistory(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const verdict = await requireAdmin({ auth, db, getConfig }, req, { tier: 'staff' });
    if (!verdict.ok) return sendError(res, verdict.status, verdict.code, verdict.message);

    const { docPath, limit, cursor } = req.body || {};
    if (!isValidDocPath(docPath)) {
      return badRequest(res, 'docPath must be <publishableCollection>/<docId>.');
    }
    const pageSize = Number.isInteger(limit) && limit >= 1 && limit <= MAX_LIMIT ? limit : DEFAULT_LIMIT;
    if (cursor !== undefined && !Number.isFinite(cursor)) {
      return badRequest(res, 'cursor must be a revision number from a previous page.');
    }

    // (docPath ==, revision desc) requires the composite index declared in
    // firestore.indexes.json — versions.test.cjs asserts the declaration so
    // the query can never silently outrun the deployed indexes again.
    let query = db
      .collection('cmsVersionHistory')
      .where('docPath', '==', docPath)
      .orderBy('revision', 'desc');
    if (cursor !== undefined) query = query.startAfter(cursor);
    let snap;
    try {
      // One extra row decides nextCursor without a second query.
      snap = await query.limit(pageSize + 1).get();
    } catch (err) {
      // Shape infra failures (e.g. FAILED_PRECONDITION on a missing index)
      // as a core/errors body instead of an unshaped 500.
      log.error('cmsGetVersionHistory query failed', err);
      return internal(res, 'Version history is temporarily unavailable.');
    }

    const entries = snap.docs
      .slice(0, pageSize)
      .map((d, index) => toEntry(d, snap.docs[index + 1] ?? null));
    const nextCursor = snap.docs.length > pageSize ? entries[entries.length - 1].revision : null;
    res.status(200).json({ entries, nextCursor });
  };
}

/** Deployable exports (spec §1.3 cms/). */
function buildHandlers() {
  const { onRequest } = require('firebase-functions/v2/https');
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';

  return {
    cmsGetVersionHistory: onRequest({ region }, async (req, res) => {
      const { applyCors, parseAllowedOrigins } = require('../core/http.cjs');
      const handled = applyCors(req, res, {
        allowedOrigins: parseAllowedOrigins(process.env.EVENT_ALLOWED_ORIGINS),
      });
      if (handled) return;
      const { getDb } = require('../core/firestore.cjs');
      const { getAuth } = require('firebase-admin/auth');
      const { getEventConfig } = require('../core/config.cjs');
      const db = getDb();
      await createGetVersionHistoryHandler({
        db,
        auth: getAuth(),
        getConfig: () => getEventConfig({ db }),
      })(req, res);
    }),
  };
}

module.exports = {
  createGetVersionHistoryHandler,
  get handlers() {
    return buildHandlers();
  },
  internals: {
    isValidDocPath,
    describeChanges,
    toEntry,
    toMillis,
    DEFAULT_LIMIT,
    MAX_LIMIT,
    MAX_CHANGES,
  },
};
