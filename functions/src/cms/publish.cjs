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
 *                          done or failed.
 *   cmsGetPublishQueue     admin POST { queueId? , limit? }
 *   cmsUpdatePublishStatus admin POST { queueId, status, note? } — e.g.
 *                          mark a stranded 'running' row failed (the
 *                          maintenance sweep's job-level timeout does the
 *                          same, §8.4).
 *
 * Queue row shape:
 *   { status: 'running'|'done'|'failed', request: { [collection]: docIds },
 *     progress: { [collection]: { published, skipped, chunksCommitted } },
 *     requestedBy, requestedAt, updatedAt, finishedAt?, error?, note? }
 *
 * Because publishDocs records progress per committed chunk and skips
 * already-recorded docIds, resuming a failed row is exactly a re-run:
 * completed chunks are not re-published and revisions never double-bump.
 */

const { requireAdmin } = require('../core/auth.cjs');
const { sendError, badRequest, notFound, methodNotAllowed } = require('../core/errors.cjs');
const { PUBLISHABLE_COLLECTIONS } = require('./blockTypes.cjs');
const { listDirty, publishDocs, logAdminAction, isValidDocId } = require('./store.cjs');
const { requestSitePublish } = require('./publisher.cjs');

const MAX_DOC_IDS = 2000;
const QUEUE_LIST_DEFAULT = 20;
const QUEUE_LIST_MAX = 50;
const SETTABLE_STATUSES = Object.freeze(['failed', 'done']);

/** Shared admin-POST preamble; sends the response itself on failure. */
async function gateAdminPost({ auth, getConfig }, req, res) {
  if (req.method !== 'POST') {
    methodNotAllowed(res, ['POST']);
    return null;
  }
  const verdict = await requireAdmin({ auth, getConfig }, req);
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
    for (const collection of PUBLISHABLE_COLLECTIONS) {
      const dirty = await listDirty({ db, collection });
      if (dirty.length > 0) request[collection] = dirty;
    }
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
  now = Date.now,
  log = console,
}) {
  return async function cmsPublish(req, res) {
    const actor = await gateAdminPost({ auth, getConfig }, req, res);
    if (!actor) return;

    let queueRef;
    let request;
    if (req.body?.queueId !== undefined) {
      // Resume: the stored request is authoritative; progress on the row
      // makes the re-run skip whatever already committed.
      if (!isValidDocId(req.body.queueId)) {
        return badRequest(res, 'queueId must be a single publish-queue doc id.');
      }
      queueRef = db.collection('cmsPublishQueue').doc(req.body.queueId);
      const snap = await queueRef.get();
      if (!snap.exists) return notFound(res, 'No such publish queue row.');
      const row = snap.data();
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
      if (!request || typeof request !== 'object') {
        return badRequest(res, 'That queue row has no stored request to resume.');
      }
      await queueRef.set({ status: 'running', error: null, updatedAt: new Date(now()) }, { merge: true });
    } else {
      const resolved = await resolveRequest({ db }, req.body);
      if (!resolved.ok) return badRequest(res, resolved.message);
      request = resolved.request;
      if (Object.keys(request).length === 0) {
        // Nothing dirty: no queue row for a no-op.
        return res.status(200).json({ queueId: null, status: 'done', results: {} });
      }
      queueRef = db.collection('cmsPublishQueue').doc();
      await queueRef.set({
        status: 'running',
        request,
        progress: {},
        requestedBy: actor.email,
        requestedAt: new Date(now()),
        updatedAt: new Date(now()),
      });
    }

    const results = {};
    try {
      for (const [collection, docIds] of Object.entries(request)) {
        results[collection] = await publishDocs({ db, collection, docIds, actor, now, queueRef });
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
      // Committed chunks stay committed and recorded on the row; the
      // client resumes with { queueId }.
      return res.status(500).json({
        error: { code: 'publish-failed', message: 'Publish failed part-way. Re-run with { queueId } to resume.' },
        queueId: queueRef.id,
      });
    }

    await queueRef.set({ status: 'done', finishedAt: new Date(now()), updatedAt: new Date(now()) }, { merge: true });
    await logAdminAction({ db, action: 'cms-publish', docPath: queueRef.path, actor, now, log });

    // The publish is committed and the row says so. Refreshing the static
    // snapshot is a separate, best-effort concern (§8.4 phase 5): the
    // runtime read path already serves the new content to human visitors,
    // and a publisher that cannot be reached only leaves crawler first
    // paint stale — the exact phase 2-4 state. So this is fail-soft by
    // construction: requestSitePublish never throws, records its own
    // outcome on the row, and raises an OperatorEvent on failure.
    const publisher = await requestSitePublish({
      db, queueId: queueRef.id, env, fetchImpl, notifyOperator, now, log,
    });

    res.status(200).json({ queueId: queueRef.id, status: 'done', results, publisher });
  };
}

/**
 * @param {{ db, auth, getConfig }} deps
 */
function createGetPublishQueueHandler({ db, auth, getConfig }) {
  return async function cmsGetPublishQueue(req, res) {
    const actor = await gateAdminPost({ auth, getConfig }, req, res);
    if (!actor) return;

    const { queueId, limit } = req.body || {};
    if (queueId !== undefined) {
      if (!isValidDocId(queueId)) {
        return badRequest(res, 'queueId must be a single publish-queue doc id.');
      }
      const snap = await db.collection('cmsPublishQueue').doc(queueId).get();
      if (!snap.exists) return notFound(res, 'No such publish queue row.');
      return res.status(200).json({ rows: [{ id: snap.id, ...snap.data() }] });
    }
    const pageSize = Number.isInteger(limit) && limit >= 1 && limit <= QUEUE_LIST_MAX
      ? limit
      : QUEUE_LIST_DEFAULT;
    const snap = await db
      .collection('cmsPublishQueue')
      .orderBy('requestedAt', 'desc')
      .limit(pageSize)
      .get();
    res.status(200).json({ rows: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
  };
}

/**
 * @param {{ db, auth, getConfig, now?: () => number, log?: Console }} deps
 */
function createUpdatePublishStatusHandler({ db, auth, getConfig, now = Date.now, log = console }) {
  return async function cmsUpdatePublishStatus(req, res) {
    const actor = await gateAdminPost({ auth, getConfig }, req, res);
    if (!actor) return;

    const { queueId, status, note } = req.body || {};
    if (!isValidDocId(queueId)) {
      return badRequest(res, 'queueId must be a single publish-queue doc id.');
    }
    if (!SETTABLE_STATUSES.includes(status)) {
      return badRequest(res, `status must be one of: ${SETTABLE_STATUSES.join(', ')}.`);
    }
    const ref = db.collection('cmsPublishQueue').doc(queueId);
    const snap = await ref.get();
    if (!snap.exists) return notFound(res, 'No such publish queue row.');

    await ref.set(
      {
        status,
        note: typeof note === 'string' ? note.slice(0, 500) : null,
        statusSetBy: actor.email,
        updatedAt: new Date(now()),
        ...(status === 'done' ? { finishedAt: new Date(now()) } : {}),
      },
      { merge: true },
    );
    await logAdminAction({ db, action: 'cms-update-publish-status', docPath: ref.path, actor, now, log });
    res.status(200).json({ queueId, status });
  };
}

/** Deployable exports (spec §1.3 cms/). */
function buildHandlers() {
  const { onRequest } = require('firebase-functions/v2/https');
  const { defineSecret } = require('firebase-functions/params');
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';

  // cmsPublish raises an OperatorEvent when the site-publisher invoke fails
  // (§8.4 phase 5), so whichever sink is selected has to be usable from
  // inside it — same reasoning as auth/otp.cjs and ticketing/sync.cjs.
  const notifierName = (process.env.EVENT_OPERATOR_NOTIFIER || '').trim();
  const secretNames = new Set();
  if (notifierName === 'webhook') {
    secretNames.add('OPERATOR_WEBHOOK_URL');
    secretNames.add('OPERATOR_WEBHOOK_SECRET');
  }
  if (notifierName === 'email') {
    const { SEND_SECRETS_BY_PROVIDER } = require('../email/send.cjs').internals;
    const provider = (process.env.EVENT_EMAIL_PROVIDER || '').trim();
    for (const name of SEND_SECRETS_BY_PROVIDER[provider] || []) secretNames.add(name);
  }
  const secrets = [...secretNames].map(defineSecret);

  const buildDeps = () => {
    const { getDb } = require('../core/firestore.cjs');
    const { getAuth } = require('firebase-admin/auth');
    const { getEventConfig } = require('../core/config.cjs');
    const db = getDb();
    return { db, auth: getAuth(), getConfig: () => getEventConfig({ db }), now: Date.now, log: console };
  };

  const buildPublishDeps = () => {
    const deps = buildDeps();
    const { createOperatorNotifier } = require('../notify/operator.cjs');
    // The email sink is resolved lazily inside the notifier, and only when
    // a publish actually fails to invoke — an ordinary publish never loads
    // the email core at all.
    const notifier = createOperatorNotifier({
      env: process.env,
      getConfig: deps.getConfig,
      sendEmail: async (message) => {
        const { getEmailProvider } = require('../email/providers/index.cjs');
        const { createEmailCore } = require('../email/send.cjs');
        return createEmailCore({
          db: deps.db,
          provider: getEmailProvider({ env: process.env }),
          getConfig: deps.getConfig,
        }).send(message);
      },
    });
    return { ...deps, env: process.env, notifyOperator: notifier.notify };
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
      await createCmsPublishHandler(buildPublishDeps())(req, res);
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
  internals: { resolveRequest, MAX_DOC_IDS, SETTABLE_STATUSES },
};
