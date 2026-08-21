'use strict';

/**
 * Admin surface for `system_errors` rows (issue #58).
 *
 * Two admin-gated (core/auth.cjs requireAdmin) POST endpoints, following
 * admin/config.cjs's gate + audit conventions:
 *
 *   listSystemErrors    { includeResolved?, limit?, cursor? } → { rows, nextCursor }
 *   resolveSystemErrors { id, expectedLastSeenAt? } |
 *                       { kind } → per-target verdict, audit-logged
 *
 * `system_errors` is server-only (firestore.rules: allow read, write: if
 * false) — these two endpoints are the ONLY way an operator ever sees or
 * changes a row, mirroring how admin/config.cjs is the only writer of
 * config/*.
 *
 * Ordering field: `createdAt`, not `lastSeenAt`. Every row telemetry/
 * systemErrors.cjs's logError writes (kind: 'client-error') has no
 * `lastSeenAt` at all — only the fault-class rows auth/otp.cjs's reopen
 * path writes carry it. Firestore's orderBy silently EXCLUDES documents
 * missing the ordered field, so ordering the list query by `lastSeenAt`
 * would drop every plain client-error row from the admin view entirely.
 * `createdAt` is stamped by every writer, so it is the only field that can
 * order the full collection. `lastSeenAt` is still returned per row (null
 * when absent) for the UI to show as "last seen" (falling back to
 * createdAt), and reopening keeps bumping it — see the reopen-race note on
 * resolveOne below.
 *
 * Pagination cursor is `{ createdAt, id }`, not a bare `createdAt` (Codex
 * review finding, P2): `createdAt` alone is not unique — two rows created
 * in the same millisecond straddling a page boundary would have one of
 * them skipped by `startAfter(createdAt)` (whichever sorts second at that
 * timestamp never appears on either page). The query orderBy explicitly
 * adds `__name__` (document id) as a second, always-unique sort key, and
 * the cursor carries both values as a `startAfter` pair — no
 * firestore.indexes.json change needed: Firestore automatically appends
 * `__name__`, in the same direction as the last declared field, to every
 * index (single-field or composite), so the existing (resolved ASC,
 * createdAt DESC) declaration already covers this ordering.
 *
 * The whole-fault-class resolve (by `kind`) is bounded per call to
 * KIND_SWEEP_PAGE_SIZE rows (Codex review finding, P2: an unbounded sweep
 * is an unbounded number of sequential transactions in one HTTP request).
 * A class with more unresolved rows than that answers with `done: false`
 * and a `cursor` (the last processed row's id) the caller passes back to
 * resolve the next page of the same class.
 */

const { requireAdmin } = require('../core/auth.cjs');
const { logAdminAction } = require('../cms/store.cjs');
const { sendError, badRequest, methodNotAllowed, internal } = require('../core/errors.cjs');

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const KIND_SWEEP_PAGE_SIZE = 200;

function isPlainObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

/** A list-page cursor: `{ createdAt: number, id: string }`, both required. */
function isValidListCursor(cursor) {
  return (
    isPlainObject(cursor) &&
    Number.isFinite(cursor.createdAt) &&
    typeof cursor.id === 'string' &&
    cursor.id.length > 0
  );
}

/** @param {unknown} v @returns {number|null} millis, or null if not a usable instant */
function toMillis(v) {
  if (v instanceof Date) return v.getTime();
  if (typeof v?.toMillis === 'function') return v.toMillis();
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const ms = Date.parse(v);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

/** One system_errors row shaped for the admin panel — explicit fields only. */
function toRow(doc) {
  const data = doc.data() || {};
  return {
    id: doc.id,
    kind: typeof data.kind === 'string' ? data.kind : 'unknown',
    message: typeof data.message === 'string' ? data.message : null,
    errors: Array.isArray(data.errors) ? data.errors : null,
    url: typeof data.url === 'string' ? data.url : null,
    userAgent: typeof data.userAgent === 'string' ? data.userAgent : null,
    resolved: data.resolved === true,
    alertedAt: toMillis(data.alertedAt),
    lastSeenAt: toMillis(data.lastSeenAt),
    createdAt: toMillis(data.createdAt),
    resolvedAt: toMillis(data.resolvedAt),
    resolvedBy: typeof data.resolvedBy === 'string' ? data.resolvedBy : null,
  };
}

/**
 * @param {{ db: FirebaseFirestore.Firestore, auth, getConfig, log?: Console }} deps
 */
function createListSystemErrorsHandler({ db, auth, getConfig, log = console }) {
  return async function listSystemErrors(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const gate = await requireAdmin({ auth, getConfig }, req);
    if (!gate.ok) return sendError(res, gate.status, gate.code, gate.message);

    const { includeResolved, limit, cursor } = req.body || {};
    const pageSize = Number.isInteger(limit) && limit >= 1 && limit <= MAX_LIMIT ? limit : DEFAULT_LIMIT;
    if (cursor !== undefined && !isValidListCursor(cursor)) {
      return badRequest(res, 'cursor must be { createdAt, id } from a previous page.');
    }

    // (resolved ASC, createdAt DESC) requires the composite index declared
    // in firestore.indexes.json (systemErrorsAdmin.test.cjs asserts it).
    // The explicit __name__ tiebreaker needs no separate declaration — see
    // the pagination-cursor note at the top of this file.
    let query = db.collection('system_errors');
    if (!includeResolved) query = query.where('resolved', '==', false);
    query = query.orderBy('createdAt', 'desc').orderBy('__name__', 'desc');
    if (cursor !== undefined) query = query.startAfter(new Date(cursor.createdAt), cursor.id);

    let snap;
    try {
      // One extra row decides nextCursor without a second query.
      snap = await query.limit(pageSize + 1).get();
    } catch (err) {
      log.error('listSystemErrors query failed', err);
      return internal(res, 'The error log is temporarily unavailable.');
    }

    const docs = snap.docs.slice(0, pageSize);
    const rows = docs.map(toRow);
    const last = rows[rows.length - 1];
    const nextCursor = snap.docs.length > pageSize ? { createdAt: last.createdAt, id: last.id } : null;
    res.status(200).json({ rows, nextCursor });
  };
}

/**
 * Resolve one row by id. Runs inside a transaction so a concurrent reopen
 * (auth/otp.cjs's reopenSystemError, a plain `ref.update()`) is Firestore's
 * own optimistic-concurrency problem to solve — if a reopen commits between
 * this transaction's read and its commit, Firestore retries the callback
 * with the fresh doc, and this function reads the fresh `lastSeenAt` again.
 *
 * `expectedLastSeenAt` is what the caller last observed on this row (the
 * `lastSeenAt` from a prior listSystemErrors page). When it no longer
 * matches the stored value, the row was reopened after the admin last saw
 * it — resolving would silently hide a fault that is active again right
 * now, so this is a no-op (`reopened: true`) rather than a write. Omitting
 * it (older client, or a row with no lastSeenAt at all) skips that check.
 *
 * @returns {Promise<{ id: string, resolved: boolean, alreadyResolved?: boolean, reopened?: boolean, missing?: boolean }>}
 */
async function resolveOne({ db, id, expectedLastSeenAt, actor, now }) {
  const ref = db.collection('system_errors').doc(id);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { id, resolved: false, missing: true };
    const data = snap.data() || {};
    if (data.resolved === true) return { id, resolved: true, alreadyResolved: true };

    if (expectedLastSeenAt !== undefined) {
      const currentMs = toMillis(data.lastSeenAt);
      const expectedMs = toMillis(expectedLastSeenAt);
      if (currentMs !== expectedMs) return { id, resolved: false, reopened: true };
    }

    tx.update(ref, { resolved: true, resolvedAt: new Date(now()), resolvedBy: actor.email });
    return { id, resolved: true };
  });
}

/**
 * @param {{ db: FirebaseFirestore.Firestore, auth, getConfig, now?: () => number, log?: Console }} deps
 */
function createResolveSystemErrorsHandler({ db, auth, getConfig, now = Date.now, log = console }) {
  return async function resolveSystemErrors(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const gate = await requireAdmin({ auth, getConfig }, req);
    if (!gate.ok) return sendError(res, gate.status, gate.code, gate.message);

    const { id, kind, expectedLastSeenAt, cursor } = req.body || {};
    const actor = { uid: gate.uid, email: gate.email };

    if (typeof id === 'string' && id) {
      let result;
      try {
        result = await resolveOne({ db, id, expectedLastSeenAt, actor, now });
      } catch (err) {
        log.error('resolveSystemErrors failed', err);
        return internal(res, 'The error could not be resolved.');
      }
      if (result.missing) return sendError(res, 404, 'not-found', `system_errors/${id} does not exist.`);
      try {
        await logAdminAction({ db, action: 'resolveSystemErrors', docPath: `system_errors/${id}`, actor, now, log });
      } catch (err) {
        log.warn('admin_logs write failed', err);
      }
      return res.status(200).json(result);
    }

    if (typeof kind === 'string' && kind) {
      if (cursor !== undefined && !(typeof cursor === 'string' && cursor.length > 0)) {
        return badRequest(res, 'cursor must be a document id returned by a previous resolveSystemErrors (kind) call.');
      }

      // Ordered by document id (the __name__ tiebreaker every Firestore
      // index provides automatically) so a bounded sweep can resume exactly
      // where the last page left off — a plain equality query has no
      // guaranteed order to page over safely.
      let query = db
        .collection('system_errors')
        .where('kind', '==', kind)
        .where('resolved', '==', false)
        .orderBy('__name__');
      if (cursor !== undefined) query = query.startAfter(cursor);

      let snap;
      try {
        // One extra row decides `done` without a second query (Codex review
        // finding, P2: an unbounded sweep is an unbounded number of
        // sequential transactions in one request).
        snap = await query.limit(KIND_SWEEP_PAGE_SIZE + 1).get();
      } catch (err) {
        log.error('resolveSystemErrors (kind) query failed', err);
        return internal(res, 'The error could not be resolved.');
      }

      const docs = snap.docs.slice(0, KIND_SWEEP_PAGE_SIZE);
      const done = snap.docs.length <= KIND_SWEEP_PAGE_SIZE;
      const results = [];
      for (const doc of docs) {
        try {
          // Each row resolved in its own transaction, sequentially: one row
          // reopening mid-sweep must not abort the rest of the fault class.
          results.push(await resolveOne({ db, id: doc.id, actor, now }));
        } catch (err) {
          log.error(`resolveSystemErrors (kind) failed for ${doc.id}`, err);
          results.push({ id: doc.id, resolved: false, error: true });
        }
      }
      try {
        await logAdminAction({
          db,
          action: 'resolveSystemErrors',
          docPath: `system_errors:kind:${kind}`,
          actor,
          now,
          log,
        });
      } catch (err) {
        log.warn('admin_logs write failed', err);
      }
      const nextCursor = done ? null : docs[docs.length - 1].id;
      return res.status(200).json({ kind, results, done, cursor: nextCursor });
    }

    return badRequest(res, 'id or kind is required.');
  };
}

/** Deployable exports (spec §1.3): listSystemErrors, resolveSystemErrors. */
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

  const expose = (create) =>
    onRequest({ region }, withCors(async (req, res) => {
      await create(buildDeps())(req, res);
    }));

  return {
    listSystemErrors: expose(createListSystemErrorsHandler),
    resolveSystemErrors: expose(createResolveSystemErrorsHandler),
  };
}

module.exports = {
  createListSystemErrorsHandler,
  createResolveSystemErrorsHandler,
  get handlers() {
    return buildHandlers();
  },
  internals: { toRow, toMillis, resolveOne, isValidListCursor, DEFAULT_LIMIT, MAX_LIMIT, KIND_SWEEP_PAGE_SIZE },
};
