'use strict';

/**
 * One server-maintained count for the six CMS draft collections (issue #287).
 * The admin shell listens to this document instead of downloading every dirty
 * draft. Draft status and its count always change in the same atomic write.
 */

const { requireAdmin } = require('../core/auth.cjs');
const { sendError, methodNotAllowed, badRequest, internal } = require('../core/errors.cjs');
const { PUBLISHABLE_COLLECTIONS, draftCollectionFor } = require('./blockTypes.cjs');

const META_COLLECTION = 'cmsMeta';
const META_DOC = 'pending';
const SCHEMA_VERSION = 1;

function emptyCounts() {
  return Object.fromEntries(PUBLISHABLE_COLLECTIONS.map((collection) => [collection, 0]));
}

/** Return a detached valid count map, or null for a missing/invalid document. */
function parsePendingCounts(data) {
  if (data?.schemaVersion !== SCHEMA_VERSION || !data.counts || typeof data.counts !== 'object') {
    return null;
  }
  const counts = {};
  for (const collection of PUBLISHABLE_COLLECTIONS) {
    const value = data.counts[collection];
    if (!Number.isSafeInteger(value) || value < 0) return null;
    counts[collection] = value;
  }
  return counts;
}

function pendingCountsRef(db) {
  return db.collection(META_COLLECTION).doc(META_DOC);
}

/** Count all dirty drafts inside the caller's transaction. */
async function countDirtyDrafts({ db, tx }) {
  const snapshots = await Promise.all(PUBLISHABLE_COLLECTIONS.map((collection) =>
    tx.get(db.collection(draftCollectionFor(collection)).where('status', '==', 'dirty').count()),
  ));
  const counts = emptyCounts();
  snapshots.forEach((snapshot, index) => {
    const count = snapshot?.data?.()?.count;
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error(`Dirty draft count is invalid for ${PUBLISHABLE_COLLECTIONS[index]}.`);
    }
    counts[PUBLISHABLE_COLLECTIONS[index]] = count;
  });
  return counts;
}

/**
 * Read the count document in a transaction, rebuilding it from aggregate
 * queries when it is absent, malformed, or explicitly forced.
 */
async function readPendingCountsInTransaction({ db, tx, force = false }) {
  const ref = pendingCountsRef(db);
  const snapshot = await tx.get(ref);
  const stored = snapshot.exists ? parsePendingCounts(snapshot.data()) : null;
  if (!force && stored) return { ref, counts: stored, rebuilt: false };
  return { ref, counts: await countDirtyDrafts({ db, tx }), rebuilt: true };
}

function pendingPayload(counts, now) {
  return { schemaVersion: SCHEMA_VERSION, counts, updatedAt: new Date(now()) };
}

/** Idempotently create or repair cmsMeta/pending. */
async function ensurePendingCounts({ db, now = Date.now, force = false }) {
  return db.runTransaction(async (tx) => {
    const state = await readPendingCountsInTransaction({ db, tx, force });
    if (state.rebuilt) tx.set(state.ref, pendingPayload(state.counts, now));
    return state.counts;
  });
}

/**
 * Apply one collection's status transition in the caller's transaction.
 * If a valid-looking stored count would underflow, rebuild once before the
 * transition. This repairs drift without ever committing a negative count.
 * Call only after the caller has completed its other transaction reads.
 */
async function writePendingDelta({ db, tx, collection, delta, now = Date.now }) {
  if (!PUBLISHABLE_COLLECTIONS.includes(collection) || !Number.isSafeInteger(delta)) {
    throw new Error('Invalid pending-count transition.');
  }
  let state = await readPendingCountsInTransaction({ db, tx });
  if (state.counts[collection] + delta < 0) {
    state = await readPendingCountsInTransaction({ db, tx, force: true });
  }
  const next = state.counts[collection] + delta;
  if (!Number.isSafeInteger(next) || next < 0) {
    throw new Error(`Pending count underflow for ${collection}.`);
  }
  if (delta !== 0 || state.rebuilt) {
    const counts = { ...state.counts, [collection]: next };
    tx.set(state.ref, pendingPayload(counts, now));
    return counts;
  }
  return state.counts;
}

/** A complete count map after subtracting this publish chunk, or null on underflow. */
function countsAfterPublish(counts, collection, dirtyCount) {
  if (!parsePendingCounts({ schemaVersion: SCHEMA_VERSION, counts }) ||
      !PUBLISHABLE_COLLECTIONS.includes(collection) ||
      !Number.isSafeInteger(dirtyCount) || dirtyCount < 0) {
    return null;
  }
  const next = counts[collection] - dirtyCount;
  return next < 0 ? null : { ...counts, [collection]: next };
}

function createEnsurePendingCountsHandler({ db, auth, getConfig, now = Date.now, log = console }) {
  return async function cmsEnsurePendingCounts(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const actor = await requireAdmin({ auth, db, getConfig }, req, { tier: 'staff' });
    if (!actor.ok) return sendError(res, actor.status, actor.code, actor.message);
    const force = req.body?.force;
    if (force !== undefined && typeof force !== 'boolean') {
      return badRequest(res, 'force: must be a boolean');
    }
    try {
      await ensurePendingCounts({ db, now, force: force === true });
    } catch (err) {
      log.error('cmsEnsurePendingCounts failed', err);
      return internal(res, 'The unpublished count could not be prepared.');
    }
    res.status(200).json({ ok: true });
  };
}

function buildHandlers() {
  const { onRequest } = require('firebase-functions/v2/https');
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';
  const withCors = (handler) => async (req, res) => {
    const { applyCors, parseAllowedOrigins } = require('../core/http.cjs');
    const handled = applyCors(req, res, {
      allowedOrigins: parseAllowedOrigins(process.env.EVENT_ALLOWED_ORIGINS),
    });
    if (!handled) await handler(req, res);
  };
  return {
    cmsEnsurePendingCounts: onRequest({ region }, withCors(async (req, res) => {
      const { getDb } = require('../core/firestore.cjs');
      const { getAuth } = require('firebase-admin/auth');
      const { getEventConfig } = require('../core/config.cjs');
      const db = getDb();
      await createEnsurePendingCountsHandler({
        db,
        auth: getAuth(),
        getConfig: () => getEventConfig({ db }),
      })(req, res);
    })),
  };
}

module.exports = {
  ensurePendingCounts,
  writePendingDelta,
  parsePendingCounts,
  pendingCountsRef,
  pendingPayload,
  countsAfterPublish,
  createEnsurePendingCountsHandler,
  get handlers() {
    return buildHandlers();
  },
  internals: {
    META_COLLECTION,
    META_DOC,
    SCHEMA_VERSION,
    countDirtyDrafts,
    readPendingCountsInTransaction,
  },
};
