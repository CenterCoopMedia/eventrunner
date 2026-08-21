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
 */

const { requireAdmin } = require('../core/auth.cjs');
const { logAdminAction } = require('../cms/store.cjs');
const { sendError, badRequest, methodNotAllowed, internal } = require('../core/errors.cjs');

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

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
    if (cursor !== undefined && !Number.isFinite(cursor)) {
      return badRequest(res, 'cursor must be a createdAt timestamp (ms) from a previous page.');
    }

    // (resolved ASC, createdAt DESC) requires the composite index declared
    // in firestore.indexes.json (systemErrorsAdmin.test.cjs asserts it).
    let query = db.collection('system_errors');
    if (!includeResolved) query = query.where('resolved', '==', false);
    query = query.orderBy('createdAt', 'desc');
    if (cursor !== undefined) query = query.startAfter(new Date(cursor));

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
    const nextCursor = snap.docs.length > pageSize ? rows[rows.length - 1].createdAt : null;
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

    const { id, kind, expectedLastSeenAt } = req.body || {};
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
      let snap;
      try {
        snap = await db.collection('system_errors').where('kind', '==', kind).where('resolved', '==', false).get();
      } catch (err) {
        log.error('resolveSystemErrors (kind) query failed', err);
        return internal(res, 'The error could not be resolved.');
      }
      const results = [];
      for (const doc of snap.docs) {
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
      return res.status(200).json({ kind, results });
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
  internals: { toRow, toMillis, resolveOne, DEFAULT_LIMIT, MAX_LIMIT },
};
