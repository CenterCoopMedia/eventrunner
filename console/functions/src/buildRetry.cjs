'use strict';

/**
 * The build record and the operator's retry (ADR 0007 §6).
 *
 * `console_builds/{appId}` is the record scripts/provision-client.cjs writes:
 * { state, runUrl, testMode, startedAt, updatedAt, finishedAt, failedStep,
 *   error, steps: [{ id, label, state, at, detail }] }
 * The browser cannot read it (console/firestore.rules). An operator reads it
 * through getApplicationForReview; a client sees only the status.
 *
 * Without a retry a failed build is a dead end. The steps are safe to run
 * again, so a retry starts the same workflow.
 */

const { ConsoleError } = require('./http.cjs');
const { toIso, toMillis } = require('./access.cjs');
const { applicationRef, requireAppId, requireOperator, reviewedAnswers, NOT_FOUND } = require('./reviewAccess.cjs');
const { runStartBuild } = require('./buildDispatch.cjs');

const BUILD_COLLECTION = 'console_builds';
const RETRY_STATUSES = Object.freeze(['approved', 'building']);
const SILENT_START_MS = 60 * 60 * 1000;

/** @returns {Promise<object|null>} the stored record */
async function readBuild(db, appId) {
  const snap = await db.collection(BUILD_COLLECTION).doc(appId).get();
  return snap.exists ? snap.data() : null;
}

/**
 * A run writes its record as soon as it is ready. One that dies before that
 * (checkout, npm ci, sign-in) cannot say so, so a long silence counts as failed.
 */
function startWentSilent(app, build, at) {
  return app.buildStart?.state === 'started'
    && (!build || build.state === 'queued')
    && at - toMillis(app.buildStart.at) > SILENT_START_MS;
}

/** A start or a run that failed, or a run that never reported, on a request still waiting for its site. */
function canRetryBuild(app, build, at) {
  return RETRY_STATUSES.includes(app.status)
    && (app.buildStart?.state === 'failed' || build?.state === 'failed' || startWentSilent(app, build, at));
}

function readableBuild(build) {
  if (!build) return null;
  return {
    state: build.state,
    runUrl: build.runUrl || null,
    testMode: build.testMode === true,
    startedAt: toIso(build.startedAt),
    updatedAt: toIso(build.updatedAt),
    finishedAt: toIso(build.finishedAt),
    failedStep: build.failedStep || null,
    error: build.error || null,
    steps: (Array.isArray(build.steps) ? build.steps : []).map((step) => ({
      id: step.id,
      label: step.label,
      state: step.state,
      at: toIso(step.at),
      detail: step.detail || null,
    })),
  };
}

/**
 * One transaction checks the state and clears it, so a second operator, or a
 * second click, gets `not-retryable` instead of a second run. The record stays
 * `queued` until the run writes over it.
 *
 * @returns {Promise<{ body: { started: boolean } }>} `started` is false when
 *   the dispatch failed, which runStartBuild records and tells operators
 */
async function retryBuild(deps, { body, user }) {
  const { db, now = Date.now } = deps;
  await requireOperator(db, user);
  const appId = requireAppId(body.appId);
  const ref = applicationRef(db, appId);
  const buildRef = db.collection(BUILD_COLLECTION).doc(appId);
  const app = await db.runTransaction(async (tx) => {
    const [snap, buildSnap] = await Promise.all([tx.get(ref), tx.get(buildRef)]);
    if (!snap.exists) throw new ConsoleError(404, 'not-found', NOT_FOUND);
    const data = snap.data();
    if (!canRetryBuild(data, buildSnap.exists ? buildSnap.data() : null, now())) {
      throw new ConsoleError(409, 'not-retryable', 'This build has not failed. Reload the page to see it.');
    }
    const at = new Date(now());
    tx.update(ref, { buildStart: { state: 'pending', at } });
    if (buildSnap.exists) tx.update(buildRef, { state: 'queued', updatedAt: at });
    tx.create(db.collection('console_audit').doc(), { action: 'build-retried', appId, by: user.uid, at });
    return data;
  });
  const started = await runStartBuild(
    { log: console, now, ...deps },
    { orgId: app.orgId, appId, eventName: reviewedAnswers(app)?.event?.name || '', by: user.uid },
  );
  return { body: { started } };
}

module.exports = { BUILD_COLLECTION, canRetryBuild, readBuild, readableBuild, retryBuild };
