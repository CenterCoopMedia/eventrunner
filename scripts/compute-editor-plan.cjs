#!/usr/bin/env node
'use strict';

/**
 * Read-only plan for removing Google's automatic Editor grant from a client
 * project's compute runtime account (#669). It reads IAM policies and role
 * definitions and writes nothing. For each project it prints the bindings to
 * add, the Editor binding to remove, and whether every runtime call the
 * functions make keeps a covering role after that change.
 *
 *   node scripts/compute-editor-plan.cjs --project <id> [--project <id> ...] [--region us-central1]
 *
 * Run it with credentials that can read the project's IAM policy. The exit
 * code is 0 when every project is ready, 1 when a project would lose a
 * permission the runtime uses or could not be read, and 64 for bad arguments.
 */

const { applicationDefault } = require('firebase-admin/app');
const { COMPUTE_ROLES } = require('./provision-client.cjs');

const CRM = 'https://cloudresourcemanager.googleapis.com/v3';
const IAM = 'https://iam.googleapis.com/v1';
const RUN = 'https://run.googleapis.com/v2';
const PUBLISHER_JOB = 'site-publisher';
const EDITOR = 'roles/editor';
const SIGNER = 'roles/iam.serviceAccountTokenCreator';
const JOB_EXECUTOR = 'roles/run.jobsExecutorWithOverrides';

/**
 * What the deployed runtime calls in Google Cloud, with the permission each
 * call needs. `scope` names where the grant may sit: a project role covers
 * every scope, an account or job grant covers only that resource.
 */
const RUNTIME_CALLS = Object.freeze([
  { call: 'Firestore reads and writes', source: 'functions/src/users/lifecycle.cjs, functions/src/auth/otp.cjs', scope: 'project', permissions: ['datastore.entities.get', 'datastore.entities.list', 'datastore.entities.create', 'datastore.entities.update', 'datastore.entities.delete'] },
  { call: 'Auth account create, update and delete', source: 'functions/src/auth/otp.cjs:352, functions/src/users/records.cjs:649', scope: 'project', permissions: ['firebaseauth.users.get', 'firebaseauth.users.create', 'firebaseauth.users.update', 'firebaseauth.users.delete'] },
  { call: 'Sign-in authorized domains', source: 'functions/src/admin/webAddress.cjs:242', scope: 'project', permissions: ['firebaseauth.configs.get', 'firebaseauth.configs.update'] },
  { call: 'Hosting custom domains', source: 'functions/src/admin/webAddress.cjs:207', scope: 'project', permissions: ['firebasehosting.sites.get', 'firebasehosting.sites.update'] },
  { call: 'Storage media, materials and packages', source: 'functions/src/media/imageSizes.cjs, functions/src/materials/bulk.cjs', scope: 'project', permissions: ['storage.objects.get', 'storage.objects.list', 'storage.objects.create', 'storage.objects.update', 'storage.objects.delete'] },
  { call: 'Function builds as the default build account', source: 'scripts/provision-client.cjs COMPUTE_ROLES', scope: 'project', permissions: ['artifactregistry.repositories.uploadArtifacts', 'logging.logEntries.create'] },
  { call: 'Scheduler and trigger deliveries', source: 'functions/src/**/onSchedule, onDocument*, onObject*', scope: 'project', permissions: ['run.routes.invoke', 'eventarc.events.receiveEvent'] },
  { call: 'Custom sign-in tokens', source: 'functions/src/auth/otp.cjs:370', scope: 'account', permissions: ['iam.serviceAccounts.signBlob'] },
  { call: 'Start the site publisher with a queue override', source: 'functions/src/cms/publisher.cjs:146', scope: 'job', permissions: ['run.jobs.runWithOverrides'] },
]);

const unconditional = (bindings, member) => new Set(bindings
  .filter((binding) => !binding.condition && (binding.members || []).includes(member))
  .map((binding) => binding.role));

/**
 * The plan for one project from what was read. Pure, so the decision is
 * testable without a cloud.
 *
 * @param {{ compute: string, projectBindings: object[], accountBindings: object[],
 *   jobBindings: object[]|null, permissionsOf: (role: string) => string[] }} input
 *   `jobBindings` is null when the project has no publisher job.
 */
function planFor({ compute, projectBindings, accountBindings, jobBindings, permissionsOf }) {
  const member = `serviceAccount:${compute}`;
  const project = unconditional(projectBindings, member);
  const account = unconditional(accountBindings, member);
  const job = jobBindings ? unconditional(jobBindings, member) : null;
  const add = [
    ...COMPUTE_ROLES.filter((role) => !project.has(role)).map((role) => ({ resource: 'project', role })),
    ...(account.has(SIGNER) ? [] : [{ resource: 'compute account', role: SIGNER }]),
    ...(job && !job.has(JOB_EXECUTOR) ? [{ resource: `job ${PUBLISHER_JOB}`, role: JOB_EXECUTOR }] : []),
  ];
  const remove = project.has(EDITOR) ? [{ resource: 'project', role: EDITOR }] : [];
  const conditionalEditor = projectBindings.some((binding) => binding.condition && binding.role === EDITOR && (binding.members || []).includes(member));

  const after = { project: new Set([...project, ...COMPUTE_ROLES]), account: new Set([...account, SIGNER]), job: job && new Set([...job, JOB_EXECUTOR]) };
  after.project.delete(EDITOR);
  const granted = (roles) => new Set([...roles].flatMap((role) => permissionsOf(role)));
  const projectPermissions = granted(after.project);
  const scopePermissions = { project: projectPermissions, account: granted(after.account), job: after.job ? granted(after.job) : new Set() };
  const coverage = RUNTIME_CALLS.map((entry) => {
    if (entry.scope === 'job' && !job) return { ...entry, status: 'no publisher job' };
    const missing = entry.permissions.filter((permission) => !projectPermissions.has(permission) && !scopePermissions[entry.scope].has(permission));
    return { ...entry, status: missing.length === 0 ? 'covered' : 'not covered', missing };
  });
  return { add, remove, conditionalEditor, coverage, ready: coverage.every((entry) => entry.status !== 'not covered') };
}

async function readProject({ projectId, region, request }) {
  const project = await request(`${CRM}/projects/${projectId}`);
  const compute = `${project.name.split('/')[1]}-compute@developer.gserviceaccount.com`;
  // Version 3 returns conditions; an older version names a conditional binding `_withcond_<hash>` without one.
  // Resource Manager takes the version in the body, IAM and Cloud Run in the query.
  const v3 = 'options.requestedPolicyVersion=3';
  const policy = await request(`${CRM}/projects/${projectId}:getIamPolicy`, { method: 'POST', body: { options: { requestedPolicyVersion: 3 } } });
  const accountPolicy = await request(`${IAM}/projects/${projectId}/serviceAccounts/${compute}:getIamPolicy?${v3}`, { method: 'POST', body: {} });
  const jobName = `${RUN}/projects/${projectId}/locations/${region}/jobs/${PUBLISHER_JOB}`;
  const jobPolicy = (await request(jobName, { allow404: true })) ? await request(`${jobName}:getIamPolicy?${v3}`) : null;
  return { compute, projectBindings: policy.bindings || [], accountBindings: accountPolicy.bindings || [], jobBindings: jobPolicy ? jobPolicy.bindings || [] : null };
}

/** Read each role's permissions once. Project custom roles resolve by their full name. */
async function rolePermissions(roles, request) {
  const permissions = new Map();
  for (const role of roles) {
    if (permissions.has(role)) continue;
    permissions.set(role, (await request(`${IAM}/${role}`)).includedPermissions || []);
  }
  return permissions;
}

function parseArgs(argv) {
  const projects = [];
  let region = 'us-central1';
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--project' && argv[i + 1]) projects.push(argv[(i += 1)]);
    else if (argv[i] === '--region' && argv[i + 1]) region = argv[(i += 1)];
    else return null;
  }
  return projects.length > 0 ? { projects, region } : null;
}

function makeRequest({ fetch, getAccessToken }) {
  return async (url, { method = 'GET', body, allow404 = false } = {}) => {
    const token = await getAccessToken();
    const response = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (allow404 && response.status === 404) return null;
    if (!response.ok) throw new Error(`${method} ${new URL(url).pathname}: HTTP ${response.status}`);
    return response.json();
  };
}

function report(log, projectId, plan) {
  log.log(`${projectId}: ${plan.ready ? 'ready' : 'NOT READY'}`);
  for (const { resource, role } of plan.add) log.log(`  add     ${role} on ${resource}`);
  for (const { resource, role } of plan.remove) log.log(`  remove  ${role} on ${resource}`);
  if (plan.remove.length === 0) log.log('  remove  nothing: the compute account holds no unconditional Editor binding');
  if (plan.conditionalEditor) log.log('  note    a conditional Editor binding exists and is outside this plan');
  for (const entry of plan.coverage) {
    log.log(`  ${entry.status.padEnd(16)} ${entry.call} (${entry.source})${entry.missing?.length ? `: lacks ${entry.missing.join(', ')}` : ''}`);
  }
}

async function main(argv = process.argv.slice(2), deps = null) {
  const args = parseArgs(argv);
  const log = deps?.log || console;
  if (!args) {
    log.error('usage: compute-editor-plan.cjs --project <id> [--project <id> ...] [--region <region>]');
    return 64;
  }
  const credential = deps ? null : applicationDefault();
  const request = makeRequest({
    fetch: deps?.fetch || globalThis.fetch,
    getAccessToken: deps?.getAccessToken || (async () => (await credential.getAccessToken()).access_token),
  });
  let code = 0;
  for (const projectId of args.projects) {
    try {
      const read = await readProject({ projectId, region: args.region, request });
      const member = `serviceAccount:${read.compute}`;
      const held = [read.projectBindings, read.accountBindings, read.jobBindings || []]
        .flatMap((bindings) => [...unconditional(bindings, member)]);
      const permissions = await rolePermissions([...new Set([...held, ...COMPUTE_ROLES, SIGNER, JOB_EXECUTOR])].filter((role) => role !== EDITOR), request);
      const plan = planFor({ ...read, permissionsOf: (role) => permissions.get(role) || [] });
      report(log, projectId, plan);
      if (!plan.ready) code = 1;
    } catch (err) {
      log.error(`${projectId}: could not read (${err.message})`);
      code = 1;
    }
  }
  return code;
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code; });
}

module.exports = { RUNTIME_CALLS, main, planFor };
