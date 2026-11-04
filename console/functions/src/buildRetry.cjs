'use strict';

/**
 * The build record and the retry (ADR 0007 §6). The record's shape and the
 * gate are in buildState.cjs.
 *
 * Without a retry a failed build is a dead end. The steps are safe to run
 * again, so a retry starts the same workflow.
 */

const { ConsoleError } = require('./http.cjs');
const { isOperator, readMember, toIso } = require('./access.cjs');
const { BUILD_COLLECTION, RETRY_STATUSES, buildWentSilent, canRetryBuild, readBuild } = require('./buildState.cjs');
const { notifyOperators, notifyOwners } = require('./applicationStatus.cjs');
const { connectionProblem } = require('./connectionState.cjs');
const { takeSlotIn } = require('./rateLimit.cjs');
const { applicationRef, readApplication, requireAppId, reviewedAnswers, NOT_FOUND } = require('./reviewAccess.cjs');
const { runStartBuild } = require('./buildDispatch.cjs');

const DAY_MS = 24 * 60 * 60 * 1000;
const OWNER_RETRIES_PER_DAY = 5;

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

/** Operators, and the request's Owners. A stranger reads the same as for a missing request. */
async function requireRetrier(db, app, user) {
  if (await isOperator(db, user.email)) return { operator: true };
  const member = typeof app.orgId === 'string' ? await readMember(db, app.orgId, user.uid) : null;
  if (!member) throw new ConsoleError(404, 'not-found', NOT_FOUND);
  if (member.role !== 'owner') throw new ConsoleError(403, 'forbidden', 'Only an Owner can retry the build.');
  return { operator: false };
}

/** @throws {ConsoleError} 409 when this request cannot be built again now */
function refuseRetry(app, build, at, testMode) {
  if (!canRetryBuild(app, build, at)) {
    throw new ConsoleError(409, 'not-retryable', 'This build has not failed. Reload the page to see it.');
  }
  // A run on this connection can only fail again: the account is gone, in test mode, or being changed.
  const problem = connectionProblem(reviewedAnswers(app)?.tickets?.choice, app.connections, { testMode });
  if (problem) throw new ConsoleError(409, 'connection-needed', `${problem.message} Then retry the build.`);
}

/**
 * One transaction checks the state and clears it, so a second person, or a
 * second click, gets `not-retryable` instead of a second run. The record stays
 * `queued` until the run writes over it. The slot is in that transaction, so a
 * refused retry does not use one of an Owner's daily slots.
 *
 * @returns {Promise<{ body: { started: boolean } }>} `started` is false when
 *   the dispatch failed, which runStartBuild records and tells operators
 */
async function retryBuild(deps, { body, user }) {
  const { db, now = Date.now, consoleTestMode: testMode = false } = deps;
  const appId = requireAppId(body.appId);
  const first = await readApplication(db, appId);
  const { operator } = await requireRetrier(db, first, user);
  const ref = applicationRef(db, appId);
  const buildRef = db.collection(BUILD_COLLECTION).doc(appId);
  const app = await db.runTransaction(async (tx) => {
    const [snap, buildSnap] = await Promise.all([tx.get(ref), tx.get(buildRef)]);
    if (!snap.exists) throw new ConsoleError(404, 'not-found', NOT_FOUND);
    const data = snap.data();
    refuseRetry(data, buildSnap.exists ? buildSnap.data() : null, now(), testMode);
    if (!operator) {
      await takeSlotIn(tx, db, {
        key: `retry-build-${user.uid}`,
        max: OWNER_RETRIES_PER_DAY,
        windowMs: DAY_MS,
        now,
        message: 'You have retried the build too many times today. Try again tomorrow.',
      });
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

/** Flag one silent request in a transaction, so two runs of the job tell people once. @returns {Promise<boolean>} whether this call flagged it */
async function flagSilentBuild(db, appId, at) {
  const ref = applicationRef(db, appId);
  const buildRef = db.collection(BUILD_COLLECTION).doc(appId);
  return db.runTransaction(async (tx) => {
    const [snap, buildSnap] = await Promise.all([tx.get(ref), tx.get(buildRef)]);
    if (!snap.exists || !buildWentSilent(snap.data(), buildSnap.exists ? buildSnap.data() : null, at)) return false;
    const when = new Date(at);
    tx.update(ref, { buildStart: { state: 'failed', at: when } });
    tx.create(db.collection('console_audit').doc(), { action: 'build-went-silent', appId, by: 'build-watch', at: when });
    return true;
  });
}

/**
 * The scheduled job for runs that cannot report: one that fails before it signs
 * in to Google Cloud writes nothing, and a lost runner stays `running`. The
 * Owners were told to expect an email, so this sends one, and flags the request
 * so it is said once. A new start clears the flag.
 *
 * @returns {Promise<{ flagged: string[], failed: string[] }>}
 */
async function reportSilentBuilds(deps) {
  const { db, now = Date.now, log = console } = deps;
  const at = now();
  const flagged = [];
  const failed = [];
  for (const status of RETRY_STATUSES) {
    const snap = await db.collection('applications').where('status', '==', status).get();
    for (const doc of snap.docs) {
      try {
        const app = doc.data();
        if (!buildWentSilent(app, await readBuild((r) => r.get(), db, doc.id), at)) continue;
        if (!(await flagSilentBuild(db, doc.id, at))) continue;
        flagged.push(doc.id);
        const notice = { orgId: app.orgId, appId: doc.id, eventName: reviewedAnswers(app)?.event?.name || '' };
        await notifyOperators({ log, ...deps }, { ...notice, kind: 'build-run-failed', problem: 'The run stopped without reporting. Read the run log.' });
        await notifyOwners({ log, ...deps }, { ...notice, status: 'build-failed' });
      } catch (err) {
        failed.push(doc.id);
        log.error('console could not report a silent build', doc.id, err);
      }
    }
  }
  return { flagged, failed };
}

module.exports = { BUILD_COLLECTION, canRetryBuild, readBuild, readableBuild, reportSilentBuilds, retryBuild };
