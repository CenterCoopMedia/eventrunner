'use strict';

/**
 * Publish endpoints for the two-revision model (spec §8.4 step 3,
 * issue #12). Publish is a Firestore revision copy, not a deploy — no
 * repository_dispatch, no PAT, no workflow.
 *
 *   cmsPublish             admin POST { collection, docIds } |
 *                          { all: true } (every dirty draft in every
 *                          publishable collection) | { queueId } (resume a
 *                          FAILED row; a row still 'running' is a 409 so
 *                          overlapping runs can never double-bump
 *                          revisions). Creates/reuses a cmsPublishQueue
 *                          row, runs the chunked publish, marks the row
 *                          done or failed. New requests can supply a
 *                          requestId (UUID v4) to name their new row.
 *   cmsGetPublishQueue     admin POST { queueId? , limit? }
 *   cmsUpdatePublishStatus admin POST { queueId, status, note? } — e.g.
 *                          mark a stranded 'running' row failed (the
 *                          maintenance sweep's job-level timeout does the
 *                          same, §8.4).
 *
 * Queue row shape:
 *   { status: 'running'|'done'|'failed', request: { [collection]: docIds },
 *     progress: { [collection]: { published, skipped, chunksCommitted } }, plannedChunks,
 *     requestedBy, requestedAt, updatedAt, finishedAt?, error?, note? }
 *
 * A resume keeps the published and skipped outcomes from completed chunks
 * and processes the remaining items.
 */

const { requireAdmin } = require('../core/auth.cjs');
const { sendError, badRequest, notFound, methodNotAllowed } = require('../core/errors.cjs');
const { confirmationVersion, matchesConfirmation, ConfirmationConflict } = require('../core/confirmation.cjs');
const { PUBLISHABLE_COLLECTIONS, draftCollectionFor } = require('./blockTypes.cjs');
const { listDirty, publishDocs, remainingPublishIds, logAdminAction, isValidDocId, isAlreadyExistsError, internals } = require('./store.cjs');
const { publisherNotificationSecrets, refreshSiteAfterPublish, requestSitePublish, withPublisherNotifier } = require('./publisher.cjs');
const { runMediaReplacement } = require('../media/replace.cjs');
const { checkSchedulePublishSet } = require('../schedule/sessions.cjs');
const { isComingSoon } = require('./launch.cjs');
const { publishMenuOrder } = require('./menuOrder.cjs');

const MAX_DOC_IDS = 2000;
const QUEUE_LIST_DEFAULT = 20;
const QUEUE_LIST_MAX = 50;
const SETTABLE_STATUSES = Object.freeze(['failed', 'done']);
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function countPlannedChunks(request) {
  return Object.values(request).reduce((total, ids) => (
    total + (Array.isArray(ids) ? Math.ceil(ids.length / internals.DOCS_PER_CHUNK) : 0)
  ), 0);
}

async function draftVersionsMatch(db, request, versions) {
  if (!versions || typeof versions !== 'object' || Array.isArray(versions)) return false;
  const entries = Object.entries(request);
  if (Object.keys(versions).length !== entries.length) return false;
  for (const [collection, ids] of entries) {
    const expected = versions[collection];
    if (!expected || typeof expected !== 'object' || Array.isArray(expected) ||
        Object.keys(expected).length !== ids.length || ids.some((id) => !Object.hasOwn(expected, id) ||
          typeof expected[id] !== 'string' || !/^[a-f0-9]{64}$/.test(expected[id]))) return false;
    const drafts = db.collection(draftCollectionFor(collection));
    for (let start = 0; start < ids.length; start += internals.DOCS_PER_CHUNK) {
      const chunk = ids.slice(start, start + internals.DOCS_PER_CHUNK);
      const snaps = await db.getAll(...chunk.map((id) => drafts.doc(id)));
      if (snaps.some((snap, index) => !snap.exists || !matchesConfirmation(expected[chunk[index]], snap.ref.path, snap.data()))) return false;
    }
  }
  return true;
}

/** Shared admin-POST preamble; sends the response itself on failure. */
async function gateAdminPost({ auth, db, getConfig }, req, res) {
  if (req.method !== 'POST') {
    methodNotAllowed(res, ['POST']);
    return null;
  }
  const verdict = await requireAdmin({ auth, db, getConfig }, req, { tier: 'staff' });
  if (!verdict.ok) {
    sendError(res, verdict.status, verdict.code, verdict.message);
    return null;
  }
  return verdict;
}

/**
 * Turn a cmsPublish body into a per-collection request map, or an error
 * message. `{ all: true }` selects the dirty drafts of every publishable
 * collection at call time.
 *
 * @param {{ db }} deps @param {object} body
 * @returns {Promise<{ ok: true, request: Record<string, string[]> } |
 *                    { ok: false, message: string }>}
 */
async function resolveRequest({ db }, body) {
  if (body?.all === true) {
    const request = {};
    const dirtyLists = await Promise.all(
      PUBLISHABLE_COLLECTIONS.map((collection) => listDirty({ db, collection })),
    );
    PUBLISHABLE_COLLECTIONS.forEach((collection, i) => {
      if (dirtyLists[i].length > 0) request[collection] = dirtyLists[i];
    });
    return { ok: true, request };
  }
  const { collection, docIds } = body || {};
  if (!PUBLISHABLE_COLLECTIONS.includes(collection)) {
    return { ok: false, message: `collection must be one of: ${PUBLISHABLE_COLLECTIONS.join(', ')} (or pass all: true).` };
  }
  if (!Array.isArray(docIds) || docIds.length === 0 || docIds.length > MAX_DOC_IDS ||
      !docIds.every((id) => typeof id === 'string' && id.length > 0 && !id.includes('/'))) {
    return { ok: false, message: `docIds must be 1-${MAX_DOC_IDS} document ids.` };
  }
  return { ok: true, request: { [collection]: [...new Set(docIds)] } };
}

/**
 * Structural refusals for a resolved request, before any queue row is
 * written: a publish that cannot be right should not exist as a row to
 * resume.
 *
 * Only cmsSchedule has one today — a child session may not go live ahead of
 * its parent (schedule/sessions.cjs checkSchedulePublishSet). The draft
 * world lets a child name a parent that is still a draft, which is correct
 * for editing and wrong the moment only the child is published: the live
 * schedule then carries a calling point whose service does not exist.
 *
 * @param {{ db }} deps @param {Record<string, string[]>} request
 * @returns {Promise<string|null>} the refusal message, or null
 */
async function structuralRefusal({ db }, request) {
  const sessions = request?.cmsSchedule;
  if (!Array.isArray(sessions) || sessions.length === 0) return null;
  const verdict = await checkSchedulePublishSet({ db, docIds: sessions });
  return verdict.ok ? null : verdict.errors.join('; ');
}

/**
 * @param {{ db, auth, getConfig, env?: object, fetchImpl?: typeof fetch,
 *           notifyOperator?: Function, now?: () => number, log?: Console }} deps
 */
function createCmsPublishHandler({
  db,
  auth,
  getConfig,
  env = process.env,
  fetchImpl,
  notifyOperator,
  getBucket = () => require('../core/storage.cjs').getBucket(),
  now = Date.now,
  log = console,
}) {
  return async function cmsPublish(req, res) {
    const actor = await gateAdminPost({ auth, db, getConfig }, req, res);
    if (!actor) return;

    const { queueId, requestId, mediaReplacement, menuOrder, expectedVersion } = req.body || {};
    if (requestId !== undefined) {
      if (queueId !== undefined) return badRequest(res, 'Use queueId alone to resume a publish.');
      if (typeof requestId !== 'string' || requestId.length !== 36 || !REQUEST_ID_PATTERN.test(requestId)) {
        return badRequest(res, 'requestId must be a lowercase UUID v4.');
      }
    }
    const publishSnapshot = (id) => requestSitePublish({ db, queueId: id, env, fetchImpl, notifyOperator, now, log });
    if (menuOrder !== undefined) {
      if (!requestId || mediaReplacement !== undefined || req.body.all || req.body.collection || req.body.docIds) {
        return badRequest(res, 'Publish the menu order on its own.');
      }
      return publishMenuOrder({
        db, ids: menuOrder, queueRef: db.collection('cmsPublishQueue').doc(requestId),
        actor, now, log, res, publish: publishSnapshot, expectedVersion,
      });
    }
    const replace = (queueRef, body) => runMediaReplacement({
      db, getBucket, queueRef, body, actor, now, log, res,
      publish: publishSnapshot,
    });
    if (mediaReplacement !== undefined) {
      if (!requestId) return badRequest(res, 'An image replacement requires a requestId.');
      return replace(db.collection('cmsPublishQueue').doc(requestId), mediaReplacement);
    }

    let queueRef;
    let request;
    let expectedVersions;
    let openingOnly = false;
    if (queueId !== undefined) {
      // Resume: the stored request is authoritative; progress on the row
      // makes the re-run skip whatever already committed.
      if (!isValidDocId(queueId)) {
        return badRequest(res, 'queueId must be a single publish-queue doc id.');
      }
      queueRef = db.collection('cmsPublishQueue').doc(queueId);
      const snap = await queueRef.get();
      if (!snap.exists) return notFound(res, 'No such publish queue row.');
      const row = snap.data();
      if (row.mediaReplacement) return replace(queueRef);
      if (row.status === 'done') {
        return res.status(200).json({ queueId: queueRef.id, status: 'done', results: row.progress || {} });
      }
      if (row.status === 'running') {
        // Overlapping runs would each read the same recorded progress and
        // live revisions, double-bumping revisions and duplicating history
        // rows. Only a failed row is resumable; a stranded 'running' row is
        // marked failed first via cmsUpdatePublishStatus.
        return sendError(
          res,
          409,
          'already-running',
          'That publish is still running. If it is stranded, mark it failed via cmsUpdatePublishStatus, then resume.',
        );
      }
      request = row.request;
      expectedVersions = row.expectedVersions;
      if (!request || typeof request !== 'object') {
        return badRequest(res, 'That queue row has no stored request to resume.');
      }
      // Check against the progress of the row we claim. A skipped parent
      // cannot satisfy the publish set for a child that is still pending.
      const claim = await db.runTransaction(async (tx) => {
        const current = await tx.get(queueRef);
        const { status, progress } = current.data() || {};
        if (status === 'running' || status === 'done') return { status };
        if (expectedVersions !== undefined) {
          const remaining = Object.fromEntries(Object.entries(request)
            .map(([collection, ids]) => [collection, remainingPublishIds(ids, progress?.[collection])])
            .filter(([, ids]) => ids.length));
          const versions = Object.fromEntries(Object.entries(remaining).map(([collection, ids]) => [
            collection, Object.fromEntries(ids.map((id) => [id, expectedVersions[collection][id]])),
          ]));
          if (!await draftVersionsMatch(db, remaining, versions)) return { status: 'stale' };
        }
        const cmsSchedule = remainingPublishIds(request.cmsSchedule ?? [], progress?.cmsSchedule);
        const refusal = await structuralRefusal({ db }, { cmsSchedule });
        if (refusal) return { status: 'refused', refusal };
        tx.set(queueRef, {
          status: 'running',
          error: null,
          plannedChunks: countPlannedChunks(request),
          updatedAt: new Date(now()),
        }, { merge: true });
        return { status: 'claimed' };
      });
      if (claim.status === 'refused') return badRequest(res, claim.refusal);
      if (claim.status === 'stale') {
        const conflict = new ConfirmationConflict();
        return sendError(res, conflict.status, conflict.code, conflict.message);
      }
      if (claim.status === 'done') {
        const latest = (await queueRef.get()).data() || {};
        return res.status(200).json({ queueId: queueRef.id, status: 'done', results: latest.progress || {} });
      }
      if (claim.status === 'running') {
        return sendError(res, 409, 'already-running', 'That publish is already running. Wait for it to finish.');
      }
    } else {
      const resolved = await resolveRequest({ db }, req.body);
      if (!resolved.ok) return badRequest(res, resolved.message);
      request = resolved.request;
      expectedVersions = req.body?.expectedVersions;
      if (expectedVersions !== undefined && !await draftVersionsMatch(db, request, expectedVersions)) {
        const conflict = new ConfirmationConflict();
        return sendError(res, conflict.status, conflict.code, conflict.message);
      }
      openingOnly = Object.keys(request).length === 0;
      if (openingOnly) {
        // Nothing dirty: no queue row for a no-op. A team that publishes a
        // new site without changing anything still means to open it, and
        // the deployed snapshot still says coming soon, so that one case
        // gets a row and a snapshot refresh like any other publish.
        // The row is written before the flag is cleared: if the row's write
        // failed after the site opened, a retry would find nothing to do and
        // the snapshot would never be rebuilt.
        if (!(await isComingSoon({ db, log }))) {
          return res.status(200).json({ queueId: null, status: 'done', results: {} });
        }
      }
      const refusal = await structuralRefusal({ db }, request);
      if (refusal) return badRequest(res, refusal);
      const queue = db.collection('cmsPublishQueue');
      queueRef = requestId === undefined ? queue.doc() : queue.doc(requestId);
      const timestamp = new Date(now());
      try {
        await queueRef.create({
          status: openingOnly ? 'done' : 'running',
          request,
          ...(expectedVersions === undefined ? {} : { expectedVersions }),
          progress: {},
          plannedChunks: countPlannedChunks(request),
          requestedBy: actor.email,
          requestedAt: timestamp,
          updatedAt: timestamp,
          ...(openingOnly ? { finishedAt: timestamp } : {}),
        });
      } catch (err) {
        if (!isAlreadyExistsError(err)) throw err;
        return sendError(res, 409, 'request-id-in-use', 'That publish request ID is already in use. Check Recent publishes for its status.');
      }
    }

    const results = {};
    try {
      for (const [collection, docIds] of Object.entries(request)) {
        results[collection] = await publishDocs({ db, collection, docIds, actor, now, queueRef, expectedVersions: expectedVersions?.[collection] });
      }
    } catch (err) {
      log.error('cmsPublish failed part-way', err);
      try {
        await queueRef.set(
          { status: 'failed', error: String(err?.message || err), updatedAt: new Date(now()) },
          { merge: true },
        );
      } catch (markErr) {
        log.error('failed to mark publish queue row failed', markErr);
      }
      await logAdminAction({ db, action: 'cms-publish-failed', docPath: queueRef.path, actor, now, log });
      if (err instanceof ConfirmationConflict) {
        return res.status(409).json({
          error: { code: err.code, message: 'Drafts changed during publishing. Check Recent publishes for completed work, then review the remaining drafts.' },
          queueId: queueRef.id,
        });
      }
      // Committed chunks stay committed and recorded on the row; the
      // client resumes with { queueId }.
      return res.status(500).json({
        error: { code: 'publish-failed', message: 'Publish failed part-way. Re-run with { queueId } to resume.' },
        queueId: queueRef.id,
      });
    }

    if (!openingOnly) {
      await queueRef.set({ status: 'done', finishedAt: new Date(now()), updatedAt: new Date(now()) }, { merge: true });
    }
    await logAdminAction({ db, action: 'cms-publish', docPath: queueRef.path, actor, now, log });
    // The publish is committed and the row says so. Refreshing the static
    // snapshot is a separate, best-effort concern (§8.4 phase 5): the
    // runtime read path already serves the new content to human visitors,
    // and a publisher that cannot be reached only leaves crawler first
    // paint stale — the exact phase 2-4 state. So this is fail-soft by
    // construction: requestSitePublish never throws, records its own
    // outcome on the row, and raises an OperatorEvent on failure.
    const publisher = await refreshSiteAfterPublish({
      db, queueId: queueRef.id, env, fetchImpl, notifyOperator, now, log,
    });

    res.status(200).json({ queueId: queueRef.id, status: 'done', results, publisher });
  };
}

/**
 * @param {{ db, auth, getConfig }} deps
 */
function queueRow(snap) {
  const data = snap.data();
  return { id: snap.id, ...data, confirmationVersion: confirmationVersion(snap.ref.path, data) };
}

function createGetPublishQueueHandler({ db, auth, getConfig }) {
  return async function cmsGetPublishQueue(req, res) {
    const actor = await gateAdminPost({ auth, db, getConfig }, req, res);
    if (!actor) return;

    const { queueId, limit } = req.body || {};
    if (queueId !== undefined) {
      if (!isValidDocId(queueId)) {
        return badRequest(res, 'queueId must be a single publish-queue doc id.');
      }
      const snap = await db.collection('cmsPublishQueue').doc(queueId).get();
      if (!snap.exists) return notFound(res, 'No such publish queue row.');
      return res.status(200).json({ rows: [queueRow(snap)] });
    }
    const pageSize = Number.isInteger(limit) && limit >= 1 && limit <= QUEUE_LIST_MAX
      ? limit
      : QUEUE_LIST_DEFAULT;
    const snap = await db
      .collection('cmsPublishQueue')
      .orderBy('requestedAt', 'desc')
      .limit(pageSize)
      .get();
    res.status(200).json({ rows: snap.docs.map(queueRow) });
  };
}

/**
 * @param {{ db, auth, getConfig, now?: () => number, log?: Console }} deps
 */
function createUpdatePublishStatusHandler({ db, auth, getConfig, now = Date.now, log = console }) {
  return async function cmsUpdatePublishStatus(req, res) {
    const actor = await gateAdminPost({ auth, db, getConfig }, req, res);
    if (!actor) return;

    const { queueId, status, note } = req.body || {};
    if (!isValidDocId(queueId)) {
      return badRequest(res, 'queueId must be a single publish-queue doc id.');
    }
    if (!SETTABLE_STATUSES.includes(status)) {
      return badRequest(res, `status must be one of: ${SETTABLE_STATUSES.join(', ')}.`);
    }
    const ref = db.collection('cmsPublishQueue').doc(queueId);
    const outcome = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return 'missing';
      if (!matchesConfirmation(req.body?.expectedVersion, ref.path, snap.data())) return 'stale';
      tx.set(ref, {
        status,
        note: typeof note === 'string' ? note.slice(0, 500) : null,
        statusSetBy: actor.email,
        updatedAt: new Date(now()),
        ...(status === 'done' ? { finishedAt: new Date(now()) } : {}),
      }, { merge: true });
      return 'updated';
    });
    if (outcome === 'missing') return notFound(res, 'No such publish queue row.');
    if (outcome === 'stale') {
      const conflict = new ConfirmationConflict();
      return sendError(res, conflict.status, conflict.code, conflict.message);
    }
    await logAdminAction({ db, action: 'cms-update-publish-status', docPath: ref.path, actor, now, log });
    res.status(200).json({ queueId, status });
  };
}

/** Deployable exports (spec §1.3 cms/). */
function buildHandlers() {
  const { onRequest } = require('firebase-functions/v2/https');
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';
  const secrets = publisherNotificationSecrets();

  const buildDeps = () => {
    const { getDb } = require('../core/firestore.cjs');
    const { getAuth } = require('firebase-admin/auth');
    const { getEventConfig } = require('../core/config.cjs');
    const db = getDb();
    return { db, auth: getAuth(), getConfig: () => getEventConfig({ db }), now: Date.now, log: console };
  };

  const withCors = (handler) => async (req, res) => {
    const { applyCors, parseAllowedOrigins } = require('../core/http.cjs');
    const handled = applyCors(req, res, {
      allowedOrigins: parseAllowedOrigins(process.env.EVENT_ALLOWED_ORIGINS),
    });
    if (handled) return;
    await handler(req, res);
  };

  return {
    cmsPublish: onRequest({ region, secrets }, withCors(async (req, res) => {
      await createCmsPublishHandler(withPublisherNotifier(buildDeps()))(req, res);
    })),
    cmsGetPublishQueue: onRequest({ region }, withCors(async (req, res) => {
      await createGetPublishQueueHandler(buildDeps())(req, res);
    })),
    cmsUpdatePublishStatus: onRequest({ region }, withCors(async (req, res) => {
      await createUpdatePublishStatusHandler(buildDeps())(req, res);
    })),
  };
}

module.exports = {
  createCmsPublishHandler,
  createGetPublishQueueHandler,
  createUpdatePublishStatusHandler,
  get handlers() {
    return buildHandlers();
  },
  internals: { resolveRequest, structuralRefusal, MAX_DOC_IDS, SETTABLE_STATUSES },
};
