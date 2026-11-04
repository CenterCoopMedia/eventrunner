'use strict';

/**
 * Whether a build can be tried again. Pure, and apart from buildRetry.cjs, so
 * the request and connection modules can ask without an import cycle.
 *
 * `console_builds/{appId}` is the record scripts/provision-client.cjs writes:
 * { state, runUrl, testMode, startedAt, updatedAt, finishedAt, failedStep,
 *   error, steps: [{ id, label, state, at, detail }] }
 * The browser cannot read it (console/firestore.rules). An operator reads it
 * through getApplicationForReview; a client gets only buildForClient.
 */

const { toMillis } = require('./access.cjs');
const { connectionProblem } = require('./connectionState.cjs');
const { reviewedAnswers } = require('./reviewAccess.cjs');

const BUILD_COLLECTION = 'console_builds';
const RETRY_STATUSES = Object.freeze(['approved', 'building']);
const SILENT_START_MS = 60 * 60 * 1000;
// More than provision-client.yml's timeout-minutes, so a run this old is not alive.
const RUN_LIMIT_MS = 6 * 60 * 60 * 1000;
// The step of scripts/provision-client.cjs that tests the client's ticket account.
const TICKETS_STEP = 'tickets';

/** @returns {Promise<object|null>} the stored record, read with `get` (a transaction's or the database's) */
async function readBuild(get, db, appId) {
  const snap = await get(db.collection(BUILD_COLLECTION).doc(appId));
  return snap.exists ? snap.data() : null;
}

/**
 * A run writes its record as soon as it is ready. One that dies before that
 * (checkout, npm ci, sign-in) cannot say so, and a function that dies after
 * acceptance leaves `pending`, so a long silence counts as failed.
 */
function startWentSilent(app, build, at) {
  return ['pending', 'started'].includes(app.buildStart?.state)
    && (!build || build.state === 'queued')
    && at - toMillis(app.buildStart.at) > SILENT_START_MS;
}

/**
 * A lost runner never runs the workflow's last step, and a failed write leaves
 * the record as it was, so a `running` record can outlive its run.
 */
function runWentSilent(build, at) {
  return build?.state === 'running' && at - toMillis(build.startedAt) > RUN_LIMIT_MS;
}

/** No run is coming and nothing has said so. */
function buildWentSilent(app, build, at) {
  return RETRY_STATUSES.includes(app.status)
    && app.buildStart?.state !== 'failed' && build?.state !== 'failed'
    && (startWentSilent(app, build, at) || runWentSilent(build, at));
}

/**
 * A start or a run that failed, or a run that went silent, on a request still
 * waiting for its site. A dispatch whose answer was lost is flagged failed
 * while its run goes on, so a live run wins over the flag.
 */
function canRetryBuild(app, build, at) {
  if (build?.state === 'running' && !runWentSilent(build, at)) return false;
  return RETRY_STATUSES.includes(app.status)
    && (app.buildStart?.state === 'failed' || build?.state === 'failed' || buildWentSilent(app, build, at));
}

/** What a client may know: never the error text, the run address or the step detail. */
function buildForClient(app, build, at, { testMode = false } = {}) {
  const failed = canRetryBuild(app, build, at);
  const ticketsFailed = build?.state === 'failed' && build.failedStep === TICKETS_STEP;
  // The same check a retry makes, so the page offers a way out of every connection refusal.
  const refused = Boolean(connectionProblem(reviewedAnswers(app)?.tickets?.choice, app.connections, { testMode }));
  return { failed, needsReconnect: failed && (ticketsFailed || refused) };
}

module.exports = { BUILD_COLLECTION, RETRY_STATUSES, buildForClient, buildWentSilent, canRetryBuild, readBuild };
