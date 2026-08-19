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
 */

const { requireAdmin } = require('../core/auth.cjs');
const { sendError, badRequest, methodNotAllowed } = require('../core/errors.cjs');
const { PUBLISHABLE_COLLECTIONS } = require('./blockTypes.cjs');

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

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
function createGetVersionHistoryHandler({ db, auth, getConfig }) {
  return async function cmsGetVersionHistory(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const verdict = await requireAdmin({ auth, getConfig }, req);
    if (!verdict.ok) return sendError(res, verdict.status, verdict.code, verdict.message);

    const { docPath, limit, cursor } = req.body || {};
    if (!isValidDocPath(docPath)) {
      return badRequest(res, 'docPath must be <publishableCollection>/<docId>.');
    }
    const pageSize = Number.isInteger(limit) && limit >= 1 && limit <= MAX_LIMIT ? limit : DEFAULT_LIMIT;
    if (cursor !== undefined && !Number.isFinite(cursor)) {
      return badRequest(res, 'cursor must be a revision number from a previous page.');
    }

    let query = db
      .collection('cmsVersionHistory')
      .where('docPath', '==', docPath)
      .orderBy('revision', 'desc');
    if (cursor !== undefined) query = query.startAfter(cursor);
    // One extra row decides nextCursor without a second query.
    const snap = await query.limit(pageSize + 1).get();

    const entries = snap.docs.slice(0, pageSize).map((d) => ({ id: d.id, ...d.data() }));
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
  internals: { isValidDocPath, DEFAULT_LIMIT, MAX_LIMIT },
};
