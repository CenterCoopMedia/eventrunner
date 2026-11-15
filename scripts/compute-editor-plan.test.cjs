'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { main, planFor } = require('./compute-editor-plan.cjs');

const PROJECT = 'er-client';
const NUMBER = '555000111';
const COMPUTE = `${NUMBER}-compute@developer.gserviceaccount.com`;
const MEMBER = `serviceAccount:${COMPUTE}`;

// Permission subsets read from `gcloud iam roles describe` on 2026-11-15.
const ROLE_PERMISSIONS = {
  'roles/datastore.user': ['datastore.entities.create', 'datastore.entities.delete', 'datastore.entities.get', 'datastore.entities.list', 'datastore.entities.update'],
  'roles/firebaseauth.admin': ['firebaseauth.configs.get', 'firebaseauth.configs.update', 'firebaseauth.users.create', 'firebaseauth.users.delete', 'firebaseauth.users.get', 'firebaseauth.users.update'],
  'roles/firebasehosting.admin': ['firebasehosting.sites.get', 'firebasehosting.sites.update'],
  'roles/cloudbuild.builds.builder': ['artifactregistry.repositories.uploadArtifacts', 'logging.logEntries.create', 'storage.objects.create', 'storage.objects.delete', 'storage.objects.get', 'storage.objects.list', 'storage.objects.update'],
  'roles/run.invoker': ['run.jobs.run', 'run.routes.invoke'],
  'roles/eventarc.eventReceiver': ['eventarc.events.receiveEvent'],
  'roles/iam.serviceAccountTokenCreator': ['iam.serviceAccounts.signBlob'],
  'roles/run.jobsExecutorWithOverrides': ['run.jobs.run', 'run.jobs.runWithOverrides'],
};
const permissionsOf = (role) => ROLE_PERMISSIONS[role] || [];
const RUNTIME = ['roles/datastore.user', 'roles/firebaseauth.admin', 'roles/firebasehosting.admin', 'roles/cloudbuild.builds.builder', 'roles/run.invoker', 'roles/eventarc.eventReceiver'];
const provisioned = () => [
  { role: 'roles/editor', members: [MEMBER, 'user:support@example.org'] },
  ...RUNTIME.map((role) => ({ role, members: [MEMBER] })),
];

test('a provisioned project removes only the compute Editor binding and stays covered', () => {
  const plan = planFor({ compute: COMPUTE, projectBindings: provisioned(), accountBindings: [{ role: 'roles/iam.serviceAccountTokenCreator', members: [MEMBER] }], jobBindings: null, permissionsOf });
  assert.deepEqual(plan.add, []);
  assert.deepEqual(plan.remove, [{ resource: 'project', role: 'roles/editor' }]);
  assert.equal(plan.ready, true);
  assert.equal(plan.coverage.find((entry) => entry.scope === 'job').status, 'no publisher job');
});

test('a publisher job with only run.invoker gets the executor role before Editor goes', () => {
  const plan = planFor({ compute: COMPUTE, projectBindings: provisioned(), accountBindings: [], jobBindings: [{ role: 'roles/run.invoker', members: [MEMBER] }], permissionsOf });
  assert.deepEqual(plan.add, [
    { resource: 'compute account', role: 'roles/iam.serviceAccountTokenCreator' },
    { resource: 'job site-publisher', role: 'roles/run.jobsExecutorWithOverrides' },
  ]);
  assert.equal(plan.coverage.find((entry) => entry.scope === 'job').status, 'covered');
});

test('a runtime permission that only Editor gave makes the project not ready', () => {
  const lacking = (role) => (role === 'roles/cloudbuild.builds.builder' ? [] : permissionsOf(role));
  const plan = planFor({ compute: COMPUTE, projectBindings: provisioned(), accountBindings: [], jobBindings: null, permissionsOf: lacking });
  assert.equal(plan.ready, false);
  const storage = plan.coverage.find((entry) => entry.call.startsWith('Storage'));
  assert.equal(storage.status, 'not covered');
  assert.ok(storage.missing.includes('storage.objects.create'));
});

test('the plan only reads: no IAM policy is written', async () => {
  const calls = [];
  const policies = {
    [`/v3/projects/${PROJECT}`]: provisioned(),
    [`/v1/projects/${PROJECT}/serviceAccounts/${COMPUTE}`]: [{ role: 'roles/iam.serviceAccountTokenCreator', members: [MEMBER] }],
    [`/v2/projects/${PROJECT}/locations/us-central1/jobs/site-publisher`]: [{ role: 'roles/run.jobsExecutorWithOverrides', members: [MEMBER] }],
  };
  const fetch = async (address, init) => {
    const url = new URL(address);
    calls.push({ method: init.method, path: url.pathname, version: Number(url.searchParams.get('options.requestedPolicyVersion') || JSON.parse(init.body || '{}').options?.requestedPolicyVersion) });
    const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
    if (url.pathname.endsWith(':getIamPolicy')) return json({ bindings: policies[url.pathname.replace(':getIamPolicy', '')] || [] });
    if (url.host === 'run.googleapis.com') return json({ name: 'site-publisher' });
    if (url.host === 'cloudresourcemanager.googleapis.com') return json({ name: `projects/${NUMBER}` });
    if (url.pathname.startsWith('/v1/roles/')) return json({ includedPermissions: permissionsOf(url.pathname.slice(4)) });
    return json({}, 500);
  };
  const lines = [];
  const log = { log: (line) => lines.push(line), error: (line) => lines.push(line) };
  assert.equal(await main(['--project', PROJECT], { fetch, getAccessToken: async () => 't', log }), 0);
  assert.ok(calls.every(({ method, path }) => method === 'GET' || path.endsWith(':getIamPolicy')), JSON.stringify(calls));
  // Version 3, so a conditional binding keeps its condition and is not read as unconditional.
  assert.ok(calls.filter(({ path }) => path.endsWith(':getIamPolicy')).every(({ version }) => version === 3), JSON.stringify(calls));
  assert.ok(lines.includes(`${PROJECT}: ready`));
  assert.ok(lines.some((line) => line.includes('remove  roles/editor on project')));
  assert.equal(calls.filter(({ path }) => path.endsWith(':getIamPolicy')).length, 3);
});

test('bad arguments exit 64', async () => {
  assert.equal(await main([], { log: { log() {}, error() {} } }), 64);
});
