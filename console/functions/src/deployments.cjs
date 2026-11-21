'use strict';

const { ConsoleError } = require('./http.cjs');
const { confirmationVersion, requireConfirmation } = require('./confirmation.cjs');
const { toIso, toMillis } = require('./access.cjs');
const { requireOperator, readApplication, reviewedAnswers, siteNameOf } = require('./reviewAccess.cjs');
const { BUILD_COLLECTION, canRetryBuild, readBuild } = require('./buildState.cjs');
const { readableBuild } = require('./buildRetry.cjs');
const { CONSOLE_REQUEST_GROUPS } = require('shared/consoleRequest');

const built = (app) => CONSOLE_REQUEST_GROUPS.built.includes(app.status);
const targetOf = (build) => build?.resources?.environment || build?.environmentClaim;
const active = (run) => run && run.status !== 'completed';
const conflict = (message) => new ConsoleError(409, 'deployment-changed', message);

function target(build) {
  const value = targetOf(build);
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(value) || ['console', 'provisioning', 'github-pages'].includes(value)) {
    throw conflict('This site has no recorded deployment environment. Open the request to check its build.');
  }
  return value;
}

function runId(build, repository) {
  const prefix = `https://github.com/${repository}/actions/runs/`;
  const id = build?.runUrl?.startsWith(prefix) ? build.runUrl.slice(prefix.length) : '';
  return /^\d+$/.test(id) ? id : null;
}

/** One GitHub run page is shared by every site, rather than one poll per site. */
async function listDeployments({ db, now = Date.now, deployments }, { user }) {
  await requireOperator(db, user);
  const [apps, builds, runs] = await Promise.all([
    db.collection('applications').get(), db.collection(BUILD_COLLECTION).get(), deployments.list(),
  ]);
  const records = new Map(builds.docs.map((doc) => [doc.id, doc.data()]));
  const sites = apps.docs.filter((doc) => records.has(doc.id) || doc.data().buildStart).map((doc) => {
    const app = doc.data();
    const build = records.get(doc.id) || {};
    const environment = targetOf(build);
    const recent = runs.runs.filter((run) => run.clients.includes(environment));
    const current = recent.find(active) || recent[0] || null;
    return {
      id: doc.id, eventName: reviewedAnswers(app)?.event?.name || siteNameOf(app) || doc.id,
      confirmationVersion: confirmationVersion(doc),
      status: app.status, environment: environment || null, build: records.has(doc.id) ? readableBuild(build) : null,
      canRetry: canRetryBuild(app, build, now()), canStop: Boolean(runId(build, deployments.repository) &&
        ['running', 'failed', 'waiting'].includes(build.state) && (build.state === 'running' || recent.some(active))),
      canRedeploy: built(app) && Boolean(environment) && !recent.some(active),
      runs: recent, health: build.health ? { site: build.health.site, admin: build.health.admin, checkedAt: toIso(build.health.checkedAt) } : null,
      current,
    };
  }).sort((a, b) => a.eventName.localeCompare(b.eventName));
  return { body: { sites, nextPage: runs.nextPage, checkedAt: new Date(now()).toISOString() } };
}

async function deploymentHistory({ db, deployments }, { body, user }) {
  await requireOperator(db, user);
  const app = await readApplication(db, body.appId);
  const build = await readBuild((ref) => ref.get(), db, app.id);
  const environment = target(build);
  const page = body.page;
  if (!Number.isInteger(page) || page < 1 || page > 50) throw new ConsoleError(400, 'bad-request', 'Choose a run history page.');
  const result = await deployments.list(page);
  return { body: { runs: result.runs.filter((run) => run.clients.includes(environment)), nextPage: result.nextPage } };
}

/** Cancel the parent to completion before finding its children: it can no longer dispatch another. */
async function stopBuild({ db, deployments, now = Date.now }, { body, user }) {
  await requireOperator(db, user);
  const app = await readApplication(db, body.appId);
  const build = await readBuild((ref) => ref.get(), db, app.id);
  const id = runId(build, deployments.repository);
  if (body.confirm !== true || !id || id !== String(body.runId) || !['running', 'failed', 'waiting'].includes(build.state)) {
    throw conflict('The build changed. Refresh the page before stopping it.');
  }
  const parent = await deployments.get(id);
  if (parent.path !== '.github/workflows/provision-client.yml' || parent.display_title !== `Provision ${app.id}` || parent.head_branch !== 'main') {
    throw conflict('The recorded run is not this request’s build.');
  }
  await deployments.stop(id);
  const environment = targetOf(build);
  // Search only runs that could have been started by this parent; pagination
  // finishes before reporting success, including when the parent was already stopped.
  if (environment) await deployments.stopChildren({ environment: target(build), parentId: id, after: parent.created_at });
  await db.collection('console_audit').doc().create({ action: 'build-stopped', appId: app.id, by: user.uid, at: new Date(now()), runId: id });
  return { body: { stopped: true } };
}

async function redeploySite({ db, deployments, now = Date.now }, { body, user }) {
  await requireOperator(db, user);
  const app = await readApplication(db, body.appId);
  const build = await readBuild((ref) => ref.get(), db, app.id);
  const environment = target(build);
  if (body.confirm !== true || body.environment !== environment || !built(app)) {
    throw conflict('The site changed. Refresh the page before deploying it.');
  }
  // The workflow serializes each client's deploys. This short transaction
  // prevents repeated clicks before GitHub publishes the dispatched run.
  const ref = db.collection(BUILD_COLLECTION).doc(app.id);
  const at = now();
  await db.runTransaction(async (tx) => {
    const [currentApp, currentBuild] = await Promise.all([tx.get(db.collection('applications').doc(app.id)), tx.get(ref)]);
    if (!currentApp.exists || !built(currentApp.data()) || target(currentBuild.data()) !== environment ||
        at - toMillis(currentBuild.data().redeployRequestedAt) < 60_000) throw conflict('A deploy was just requested or the site changed. Refresh in a minute.');
    requireConfirmation(body.expectedVersion, currentApp);
    tx.update(ref, { redeployRequestedAt: new Date(at) });
    tx.create(db.collection('console_audit').doc(), { action: 'site-redeploy-requested', appId: app.id, by: user.uid, at: new Date(at), environment });
  });
  await deployments.redeploy(environment);
  return { body: { started: true } };
}

module.exports = { deploymentHistory, listDeployments, redeploySite, stopBuild };
