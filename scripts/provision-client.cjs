#!/usr/bin/env node
'use strict';

/**
 * The site builder (ADR 0007 §6): build one paid request's event site with
 * nobody's help. `.github/workflows/provision-client.yml` runs this as the
 * provisioner service account.
 *
 *   node scripts/provision-client.cjs --application <id> [--test-mode]
 *   node scripts/provision-client.cjs --application <id> --mark-stopped
 *
 * Each step reads the current state and does nothing when it is already right,
 * so a failed run is repaired by running it again. Each step writes to the
 * request's build record, `console_builds/{appId}`, which only operators read
 * (console/functions/src/buildRetry.cjs). A client sees only the status:
 * `approved` -> `building` -> `ready`. A failure leaves the record, emails the
 * operators, and leaves the request where Retry the build can start it again.
 *
 * Every external call goes through `deps`. docs/DEPLOY_RUNBOOK.md §12 has the
 * one-time setup, and says why each grant below is here: the hand-built
 * rehearsal needed each one and the older runbook missed it.
 *
 * Errors name the step, the status and the provider's own short message. The
 * calls to a client's Stripe or Eventbrite account give the status only.
 */

const { createHash, randomBytes } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { toMillis } = require('../console/functions/src/access.cjs');
const { APPROVAL_FIELDS, approvalDefaults, checkSettings, readConsoleSettings } = require('../console/functions/src/consoleSettings.cjs');
const { reviewedAnswers, siteNameOf } = require('../console/functions/src/reviewAccess.cjs');
const { notifyOperators, notifyOwners } = require('../console/functions/src/applicationStatus.cjs');
const { stripeErrorDetails } = require('../functions/src/ticketing/stripeErrors.cjs');
const { historyEntry } = require('../console/functions/src/applications.cjs');
const { CONSOLE_REQUEST_GROUPS } = require('shared/consoleRequest');
const { BUILD_COLLECTION } = require('../console/functions/src/buildRetry.cjs');
const { GITHUB_HEADERS, installationToken } = require('../console/functions/src/buildDispatch.cjs');
const { ACCOUNT_COLLECTION, connectionSecretId, deleteStoredConnection } = require('../console/functions/src/connections.cjs');
const { PROVIDERS, PROVIDER_NAMES, liveConnection } = require('../console/functions/src/connectionState.cjs');
const { senderAddress, toInitAnswers } = require('../console/functions/src/checks.cjs');
const { siteAddress } = require('../console/functions/src/siteNames.cjs');
const { internals: { WEBHOOK_EVENTS } } = require('../functions/src/ticketing/providers/stripe.cjs');
const { internals: { stampVerification } } = require('./verify-sender-domain.cjs');

const CRM = 'https://cloudresourcemanager.googleapis.com/v3';
const BILLING = 'https://cloudbilling.googleapis.com/v1';
const USAGE = 'https://serviceusage.googleapis.com/v1';
const USAGE_BETA = 'https://serviceusage.googleapis.com/v1beta1';
const FIREBASE = 'https://firebase.googleapis.com/v1beta1';
// The custom domain API exists only in v1beta1.
const HOSTING = 'https://firebasehosting.googleapis.com/v1beta1';
const FIREBASE_STORAGE = 'https://firebasestorage.googleapis.com/v1alpha';
const FIRESTORE = 'https://firestore.googleapis.com/v1';
const IDENTITY = 'https://identitytoolkit.googleapis.com';
const IAM = 'https://iam.googleapis.com/v1';
const ARTIFACTS = 'https://artifactregistry.googleapis.com/v1';
const CLOUDFLARE = 'https://api.cloudflare.com/client/v4';
const POSTMARK = 'https://api.postmarkapp.com';
const STRIPE = 'https://api.stripe.com/v1';
const EVENTBRITE = 'https://www.eventbriteapi.com/v3';
const GITHUB = 'https://api.github.com';

// A Firebase REST call needs a quota project, and a call without one fails.
const NEEDS_USER_PROJECT = /^https:\/\/(?:firebase|firebasehosting|firebasestorage|identitytoolkit)\.googleapis\.com\//;

const APP_ID_RE = /^[A-Za-z0-9_-]{1,200}$/;
const BY = 'build';
const TIMEOUT_MS = 60_000;

const MINUTE = 60_000;
const OPERATION_WAIT_MS = 5_000;
const OPERATION_POLLS = 240;
// A new agent or account takes minutes to reach IAM.
const IAM_WAIT_MS = 30_000;
const IAM_ATTEMPTS = 8;
const CERT_WAIT_MS = MINUTE;
const CERT_POLLS = 60;
const COMMAND_TIMEOUT_MS = 15 * 60 * 1000;
const HTTPS_PROBE_MS = 15_000;
const POSTMARK_WAIT_MS = MINUTE;
const POSTMARK_POLLS = 30;
const DEPLOY_WAIT_MS = MINUTE;
const DEPLOY_POLLS = 240;
// A first functions deploy can hit quota 429s, and Eventarc agent propagation
// failures on a few Firestore triggers. Both clear on a rerun.
const DEPLOY_ATTEMPTS = 3;
const DEPLOY_RETRY_WAIT_MS = 5 * MINUTE;

// `services:batchEnable` takes at most 20 (SU_MAX_BATCH_SIZE_EXCEEDED).
const SERVICE_BATCH = 20;
const SERVICES = Object.freeze([
  'artifactregistry', 'cloudbilling', 'cloudbuild', 'cloudfunctions', 'cloudresourcemanager',
  'cloudscheduler', 'compute', 'eventarc', 'fcm', 'firebase', 'firebaseextensions',
  'firebasehosting', 'firebaseinstallations', 'firebaserules', 'firebasestorage', 'firestore',
  'iamcredentials', 'identitytoolkit', 'pubsub', 'run', 'runtimeconfig', 'secretmanager',
  'securetoken', 'serviceusage', 'storage', 'sts',
].map((name) => `${name}.googleapis.com`));

const DEPLOY_ACCOUNT = 'eventrunner-deploy';
const INVOKER_ROLE = 'eventrunnerDeployInvoker';
const INVOKER_PERMISSIONS = Object.freeze([
  'cloudfunctions.functions.setIamPolicy',
  'firebaseextensions.instances.list',
  'firebasestorage.defaultBucket.get',
  'resourcemanager.projects.getIamPolicy',
  'run.services.setIamPolicy',
]);
const DEPLOY_ROLES = Object.freeze([
  'roles/artifactregistry.writer',
  'roles/cloudbuild.builds.editor',
  'roles/cloudfunctions.developer',
  'roles/cloudscheduler.admin',
  'roles/datastore.indexAdmin',
  'roles/datastore.user',
  'roles/firebasehosting.admin',
  'roles/firebaserules.admin',
  'roles/run.developer',
  'roles/secretmanager.secretAccessor',
  'roles/secretmanager.viewer',
  'roles/serviceusage.serviceUsageConsumer',
  'roles/storage.admin',
]);
const COMPUTE_ROLES = Object.freeze([
  // Account lifecycle, OTP challenges, configuration, and application data.
  'roles/datastore.user',
  // OTP sign-in creates and verifies accounts; account deletion removes them.
  'roles/firebaseauth.admin',
  // Settings and the hourly custom-domain check manage Firebase Hosting domains.
  'roles/firebasehosting.admin',
  // The default build account reads source, writes images and build logs.
  // This role also covers the runtime's Storage object reads and writes.
  'roles/cloudbuild.builds.builder',
]);

// Who a project or an Environment was made for, so a build never takes over another's.
const OWNER_LABEL = 'eventrunner-request';
const OWNER_VARIABLE = 'EVENTRUNNER_REQUEST_ID';
const ownerLabel = (appId) => createHash('sha256').update(appId, 'utf8').digest('hex').slice(0, 32);

const POOL = 'github-actions';
const PROVIDER = 'github';
const WIF_MAPPING = Object.freeze({
  'google.subject': 'assertion.sub',
  'attribute.environment': 'assertion.environment',
  'attribute.ref': 'assertion.ref',
  'attribute.repository': 'assertion.repository',
  'attribute.repository_and_ref': "assertion.repository + '#' + assertion.ref",
  'attribute.repository_id': 'assertion.repository_id',
  'attribute.repository_owner': 'assertion.repository_owner',
  'attribute.repository_owner_id': 'assertion.repository_owner_id',
  'attribute.workflow_ref': 'assertion.workflow_ref',
});

const ARTIFACT_REPOSITORY = 'gcf-artifacts';
const CLEANUP_POLICY = 'firebase-functions-cleanup';
const CLEANUP_OLDER_THAN = '86400s';

const ANNOUNCEMENT_STREAM = 'announcements';
const TRANSACTIONAL_STREAM = 'outbound';
const TOKEN_SECRET = 'TICKETING_API_TOKEN';
const WEBHOOK_SECRET = 'TICKETING_WEBHOOK_SECRET';

const REQUIRED_ENV = Object.freeze([
  'CONSOLE_MAIL_FROM', 'CONSOLE_POSTMARK_TOKEN', 'CONSOLE_PROJECT_ID', 'CONSOLE_PUBLIC_URL',
  'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ZONE_ID', 'POSTMARK_ACCOUNT_TOKEN',
  'PROVISIONER_APP_ID', 'PROVISIONER_APP_PRIVATE_KEY', 'PROVISIONER_INSTALLATION_ID',
  'GITHUB_REPOSITORY', 'GITHUB_REPOSITORY_ID', 'GITHUB_REPOSITORY_OWNER_ID', 'GITHUB_TOKEN',
]);
// The auth action exports the provisioner's own project in these. An upload
// that bills another project is refused, and init-event skips it and exits 0.
const QUOTA_VARS = Object.freeze([
  'GOOGLE_CLOUD_QUOTA_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'GCLOUD_PROJECT', 'GCP_PROJECT',
  'CLOUDSDK_CORE_PROJECT', 'CLOUDSDK_PROJECT',
]);
// A child process needs none of these.
const CHILD_DROPS = Object.freeze([
  'CLOUDFLARE_API_TOKEN', 'CONSOLE_POSTMARK_TOKEN', 'GITHUB_TOKEN', 'POSTMARK_ACCOUNT_TOKEN',
  'PROVISIONER_APP_PRIVATE_KEY',
]);

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

/** One JSON call. `allow` statuses answer null. A 429 or 503 is tried again. */
async function call(ctx, label, url, { method = 'GET', headers = {}, json, form, allow = [], quiet = false } = {}) {
  const { fetch, sleep } = ctx.deps;
  const init = {
    method,
    headers: {
      ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      ...headers,
    },
    ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
    ...(form ? { body: form.toString() } : {}),
  };
  for (let attempt = 1; ; attempt += 1) {
    let response;
    try {
      // A signal per attempt: the wait before a retry outlasts the timeout.
      response = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw new Error(`${label}: no answer`);
    }
    if ((response.status === 429 || response.status === 503) && attempt < 4) {
      await sleep(attempt * MINUTE);
      continue;
    }
    if (allow.includes(response.status)) return null;
    const text = await response.text();
    let body = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = {};
    }
    if (response.ok) return body;
    const said = quiet ? '' : body.error?.message || body.errors?.[0]?.message || body.Message || body.message || '';
    const stripeDetails = url.startsWith(`${STRIPE}/`) ? stripeErrorDetails({
      ...body.error, statusCode: response.status, requestId: response.headers?.get?.('request-id'),
    }) : null;
    const diagnostic = stripeDetails ? ` ${JSON.stringify(stripeDetails)}` : '';
    const err = new Error(`${label}: HTTP ${response.status}${diagnostic}${said ? ` ${String(said).slice(0, 300)}` : ''}`);
    err.status = response.status;
    throw err;
  }
}

async function google(ctx, label, url, options = {}) {
  const { access_token: token } = await ctx.deps.getAccessToken();
  return call(ctx, label, url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(NEEDS_USER_PROJECT.test(url) ? { 'x-goog-user-project': ctx.projectId } : {}),
    },
  });
}

/** Wait for a long-running operation. @returns the operation's response */
async function finish(ctx, label, origin, operation) {
  let current = operation;
  for (let poll = 0; !current.done; poll += 1) {
    if (poll >= OPERATION_POLLS) throw new Error(`${label}: the operation did not finish`);
    await ctx.deps.sleep(OPERATION_WAIT_MS);
    current = await google(ctx, `${label}: wait`, `${origin}/${current.name}`);
  }
  if (current.error) throw new Error(`${label}: ${String(current.error.message).slice(0, 300)}`);
  return current.response;
}

/**
 * Add the bindings a policy lacks, and write nothing when it has them all.
 * A new agent or account takes minutes to reach IAM, so a refusal is tried
 * again. `agents` maps a member to the service whose agent must exist first.
 *
 * @returns {Promise<number>} how many bindings it added
 */
async function grant(ctx, label, resource, wanted, { readVia = 'POST', readJson = {}, agents = {} } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    const policy = await google(ctx, `${label}: read`, `${resource}:getIamPolicy`, readVia === 'GET' ? {} : { method: 'POST', json: readJson });
    const bindings = (policy.bindings || []).map((binding) => ({ ...binding, members: [...(binding.members || [])] }));
    const missing = wanted.filter(({ role, member }) => !bindings.some((binding) => (
      binding.role === role && !binding.condition && binding.members.includes(member)
    )));
    if (missing.length === 0) return 0;
    for (const service of new Set(missing.map(({ member }) => agents[member]).filter(Boolean))) {
      const op = await google(ctx, `${label}: make the ${service} agent`, `${USAGE_BETA}/projects/${ctx.projectNumber}/services/${service}:generateServiceIdentity`, { method: 'POST', json: {} });
      await finish(ctx, `${label}: make the ${service} agent`, USAGE_BETA, op);
    }
    for (const { role, member } of missing) {
      const existing = bindings.find((binding) => binding.role === role && !binding.condition);
      if (existing) existing.members.push(member);
      else bindings.push({ role, members: [member] });
    }
    try {
      await google(ctx, `${label}: write`, `${resource}:setIamPolicy`, { method: 'POST', json: { policy: { ...policy, bindings } } });
      return missing.length;
    } catch (err) {
      if (attempt >= IAM_ATTEMPTS || ![400, 409].includes(err.status)) throw err;
      await ctx.deps.sleep(IAM_WAIT_MS);
    }
  }
}

const projectResource = (ctx) => `${CRM}/projects/${ctx.projectId}`;
const accountResource = (ctx, email) => `${IAM}/projects/${ctx.projectId}/serviceAccounts/${email}`;
const serviceAccount = (email) => `serviceAccount:${email}`;
const computeAccount = (ctx) => `${ctx.projectNumber}-compute@developer.gserviceaccount.com`;
const summary = (notes) => (notes.length > 0 ? notes.join('; ') : 'already right');
const functionUrl = (ctx, name) => `https://${ctx.region}-${ctx.projectId}.cloudfunctions.net/${name}`;

// Keep resource identities for deletion, including DNS proof after a provider
// stops returning its pending verification records. Never store credentials.
async function rememberResources(ctx, patch) {
  ctx.resources = { ...ctx.resources, ...patch };
  await ctx.recordRef.update({ resources: ctx.resources });
}

/** Store a value in the client project and let the running functions read it. */
async function putClientSecret(ctx, id, value) {
  const secrets = ctx.clientSecrets;
  const changed = (await secrets.readSecret(id)) !== value;
  if (changed) await secrets.writeSecret(id, value);
  await grant(ctx, `secret ${id}`, `https://secretmanager.googleapis.com/v1/projects/${ctx.projectId}/secrets/${id}`, [
    { role: 'roles/secretmanager.secretAccessor', member: serviceAccount(computeAccount(ctx)) },
  ], { readVia: 'GET' });
  return changed;
}

/** Write one record in CCM's zone, under this site's own name and nowhere else. */
async function dnsRecord(ctx, { type, name, content }) {
  const host = name.replace(/\.$/, '').toLowerCase();
  const value = content.replace(/\.$/, '').replaceAll('"', '');
  if (host !== ctx.domain && !host.endsWith(`.${ctx.domain}`)) {
    throw new Error(`dns: refused a record outside ${ctx.domain}`);
  }
  const { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ZONE_ID: zone } = ctx.deps.env;
  const headers = { Authorization: `Bearer ${token}` };
  const base = `${CLOUDFLARE}/zones/${zone}/dns_records`;
  const query = new URLSearchParams({ type, name: host, per_page: '100' });
  const listed = await call(ctx, `dns: read ${type} ${host}`, `${base}?${query}`, { headers });
  const records = listed.result || [];
  const owned = ctx.resources?.dnsRecords || [];
  const matches = (record) => record.type === type && record.name === host && record.content === value;
  const existing = records.find((record) => record.type === type && record.name === host && record.content.replace(/\.$/, '').replaceAll('"', '') === value);
  if (existing) {
    // An existing value is ours only if a previous call saved its intent.
    if (existing.id && owned.some((record) => matches(record) && !record.id)) {
      await rememberResources(ctx, { dnsRecords: owned.map((record) => matches(record) && !record.id ? { ...record, id: existing.id } : record) });
    }
    return false;
  }
  const json = { type, name: host, content: value, ttl: 300, proxied: false };
  if (!owned.some(matches)) {
    // Save the intent before the call: a lost response must remain removable.
    await rememberResources(ctx, { dnsRecords: [...owned, { type, name: host, content: value }] });
  }
  // A name holds one CNAME, and other types can hold several values.
  const replace = type === 'CNAME' && records[0];
  const result = await call(ctx, `dns: ${replace ? 'replace' : 'add'} ${type} ${host}`, replace ? `${base}/${replace.id}` : base, { method: replace ? 'PUT' : 'POST', headers, json });
  const id = result.result?.id || replace?.id;
  if (id) await rememberResources(ctx, { dnsRecords: ctx.resources.dnsRecords.map((record) => matches(record) ? { ...record, id } : record) });
  return true;
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

/** ADR §6.1: the project, its billing and its APIs. */
async function stepProject(ctx) {
  const { projectId, settings } = ctx;
  const notes = [];
  // A project the caller cannot see answers 403, whether or not it exists.
  let project = await google(ctx, 'read the project', projectResource(ctx), { allow: [403, 404] });
  if (!project) {
    const op = await google(ctx, 'create the project', `${CRM}/projects`, {
      method: 'POST',
      json: { projectId, parent: settings.gcpFolder, displayName: projectId, labels: { [OWNER_LABEL]: ownerLabel(ctx.appId) } },
    });
    await finish(ctx, 'create the project', CRM, op);
    project = await google(ctx, 'read the project', projectResource(ctx));
    notes.push('created the project');
  }
  if (project.parent !== settings.gcpFolder) throw new Error(`project ${projectId} exists outside the client folder`);
  if (project.labels?.[OWNER_LABEL] !== ownerLabel(ctx.appId)) throw new Error(`project ${projectId} was not made for this request`);
  if (project.state && project.state !== 'ACTIVE') throw new Error(`project ${projectId} is ${project.state}`);
  ctx.projectNumber = project.name.split('/')[1];

  const billingName = `billingAccounts/${settings.billingAccount}`;
  const billing = await google(ctx, 'read billing', `${BILLING}/projects/${projectId}/billingInfo`);
  if (billing.billingAccountName !== billingName) {
    await google(ctx, 'link billing', `${BILLING}/projects/${projectId}/billingInfo`, { method: 'PUT', json: { billingAccountName: billingName } });
    notes.push('linked billing');
  }

  const enabled = new Set();
  let pageToken = '';
  do {
    const query = new URLSearchParams({ filter: 'state:ENABLED', pageSize: '200', ...(pageToken ? { pageToken } : {}) });
    const page = await google(ctx, 'read the APIs', `${USAGE}/projects/${projectId}/services?${query}`);
    for (const service of page.services || []) enabled.add(service.config?.name || service.name.split('/').pop());
    pageToken = page.nextPageToken || '';
  } while (pageToken);
  const missing = SERVICES.filter((service) => !enabled.has(service));
  for (let i = 0; i < missing.length; i += SERVICE_BATCH) {
    const op = await google(ctx, 'enable the APIs', `${USAGE}/projects/${projectId}/services:batchEnable`, {
      method: 'POST',
      json: { serviceIds: missing.slice(i, i + SERVICE_BATCH) },
    });
    await finish(ctx, 'enable the APIs', USAGE, op);
  }
  if (missing.length > 0) notes.push(`enabled ${missing.length} APIs`);
  return summary(notes);
}

/** ADR §6.1: Firebase, Firestore, the bucket, the Hosting site, the web app, sign-in. */
async function stepFirebase(ctx) {
  const { projectId, region } = ctx;
  const notes = [];
  if (!(await google(ctx, 'read Firebase', `${FIREBASE}/projects/${projectId}`, { allow: [403, 404] }))) {
    const op = await google(ctx, 'add Firebase', `${FIREBASE}/projects/${projectId}:addFirebase`, { method: 'POST', json: {} });
    await finish(ctx, 'add Firebase', FIREBASE, op);
    notes.push('added Firebase');
  }

  const database = `${FIRESTORE}/projects/${projectId}/databases`;
  if (!(await google(ctx, 'read Firestore', `${database}/(default)`, { allow: [404] }))) {
    const op = await google(ctx, 'create Firestore', `${database}?databaseId=(default)`, {
      method: 'POST',
      // A multi-region that holds us-central1, as on the rehearsed site.
      json: { type: 'FIRESTORE_NATIVE', locationId: region === 'us-central1' ? 'nam5' : region },
    });
    await finish(ctx, 'create Firestore', FIRESTORE, op);
    notes.push('created Firestore');
  }

  const bucketUrl = `${FIREBASE_STORAGE}/projects/${projectId}/defaultBucket`;
  let bucket = await google(ctx, 'read the bucket', bucketUrl, { allow: [404] });
  if (!bucket) {
    bucket = await google(ctx, 'create the bucket', bucketUrl, { method: 'POST', json: { location: region.toUpperCase() } });
    notes.push('created the bucket');
  }
  ctx.bucket = bucket.bucket?.name?.split('/').pop() || `${projectId}.firebasestorage.app`;

  const sites = await google(ctx, 'read the Hosting sites', `${HOSTING}/projects/${projectId}/sites`);
  let site = (sites.sites || []).find((item) => item.type === 'DEFAULT_SITE') || sites.sites?.[0];
  if (!site) {
    site = await google(ctx, 'create the Hosting site', `${HOSTING}/projects/${projectId}/sites?siteId=${projectId}`, { method: 'POST', json: {} });
    notes.push('created the Hosting site');
  }
  ctx.site = site.name.split('/').pop();
  await rememberResources(ctx, { site: ctx.site, buckets: [ctx.bucket] });

  const webApps = `${FIREBASE}/projects/${projectId}/webApps`;
  let app = (await google(ctx, 'read the web apps', webApps)).apps?.[0];
  if (!app) {
    const op = await google(ctx, 'create the web app', webApps, { method: 'POST', json: { displayName: ctx.name } });
    app = await finish(ctx, 'create the web app', FIREBASE, op);
    notes.push('created the web app');
  }
  ctx.web = await google(ctx, 'read the web app config', `${webApps}/${app.appId}/config`);

  const config = `${IDENTITY}/admin/v2/projects/${projectId}/config`;
  if (!(await google(ctx, 'read sign-in', config, { allow: [400, 404] }))) {
    await google(ctx, 'turn on sign-in', `${IDENTITY}/v2/projects/${projectId}/identityPlatform:initializeAuth`, { method: 'POST', json: {} });
    notes.push('turned on sign-in');
  }
  return summary(notes);
}

/** ADR §6.2: the deploy account, its roles, its own pool, and the grants it cannot make itself. */
async function stepDeployIdentity(ctx) {
  const { projectId, projectNumber, region } = ctx;
  const notes = [];
  const compute = computeAccount(ctx);
  ctx.deployEmail = `${DEPLOY_ACCOUNT}@${projectId}.iam.gserviceaccount.com`;

  if (!(await google(ctx, 'read the deploy account', accountResource(ctx, ctx.deployEmail), { allow: [404] }))) {
    await google(ctx, 'create the deploy account', `${IAM}/projects/${projectId}/serviceAccounts`, {
      method: 'POST',
      json: { accountId: DEPLOY_ACCOUNT, serviceAccount: { displayName: `Event Runner deploy (${ctx.settings.environment})` } },
    });
    notes.push('created the deploy account');
  }

  const roles = `${IAM}/projects/${projectId}/roles`;
  const role = await google(ctx, 'read the invoker role', `${roles}/${INVOKER_ROLE}`, { allow: [404] });
  const rolePermissions = role?.includedPermissions || [];
  const definition = { title: 'Event Runner deploy invoker', stage: 'GA', includedPermissions: [...INVOKER_PERMISSIONS] };
  if (!role) {
    await google(ctx, 'create the invoker role', roles, { method: 'POST', json: { roleId: INVOKER_ROLE, role: definition } });
    notes.push('created the invoker role');
  } else if (INVOKER_PERMISSIONS.some((permission) => !rolePermissions.includes(permission))) {
    await google(ctx, 'update the invoker role', `${roles}/${INVOKER_ROLE}?updateMask=includedPermissions`, { method: 'PATCH', json: definition });
    notes.push('updated the invoker role');
  }

  const deployMember = serviceAccount(ctx.deployEmail);
  const storageAgent = serviceAccount(`service-${projectNumber}@gs-project-accounts.iam.gserviceaccount.com`);
  const pubsubAgent = serviceAccount(`service-${projectNumber}@gcp-sa-pubsub.iam.gserviceaccount.com`);
  const rulesAgent = serviceAccount(`service-${projectNumber}@gcp-sa-firebasestorage.iam.gserviceaccount.com`);
  const added = await grant(ctx, 'project roles', projectResource(ctx), [
    ...[...DEPLOY_ROLES, `projects/${projectId}/roles/${INVOKER_ROLE}`].map((name) => ({ role: name, member: deployMember })),
    ...COMPUTE_ROLES.map((role) => ({ role, member: serviceAccount(compute) })),
    { role: 'roles/pubsub.publisher', member: storageAgent },
    { role: 'roles/iam.serviceAccountTokenCreator', member: pubsubAgent },
    { role: 'roles/firebaserules.firestoreServiceAgent', member: rulesAgent },
    { role: 'roles/run.invoker', member: serviceAccount(compute) },
    { role: 'roles/eventarc.eventReceiver', member: serviceAccount(compute) },
  ], {
    readJson: { options: { requestedPolicyVersion: 3 } },
    agents: {
      [storageAgent]: 'storage.googleapis.com',
      [pubsubAgent]: 'pubsub.googleapis.com',
      [rulesAgent]: 'firebasestorage.googleapis.com',
    },
  });
  if (added > 0) notes.push(`added ${added} project roles`);

  // Both function generations use the compute runtime account.
  const actAs = [{ role: 'roles/iam.serviceAccountUser', member: deployMember }];
  if (await grant(ctx, 'act as the compute account', accountResource(ctx, compute), actAs)) notes.push('let deploy act as the compute account');
  // firebase-tools checkServiceAccountIam also requires appspot actAs before every Functions deploy.
  const appspot = `${projectId}@appspot.gserviceaccount.com`;
  if (await google(ctx, 'read the appspot account', accountResource(ctx, appspot), { allow: [404] })) {
    if (await grant(ctx, 'act as the appspot account', accountResource(ctx, appspot), actAs)) notes.push('let deploy act as the appspot account');
  } else {
    notes.push('no appspot account yet');
  }
  // createCustomToken may sign as the runtime account (unconfirmed, granted to be safe).
  if (await grant(ctx, 'compute signs as itself', accountResource(ctx, compute), [
    { role: 'roles/iam.serviceAccountTokenCreator', member: serviceAccount(compute) },
  ])) notes.push('let compute sign as itself');

  await identityPool(ctx, notes);

  // firebase deploy stops without this policy, and the deploy account cannot
  // set it. Set before the first deploy, and repaired if it is missing.
  const repositories = `${ARTIFACTS}/projects/${projectId}/locations/${region}/repositories`;
  const cleanupPolicies = {
    [CLEANUP_POLICY]: { id: CLEANUP_POLICY, action: 'DELETE', condition: { tagState: 'ANY', olderThan: CLEANUP_OLDER_THAN } },
  };
  const repository = await google(ctx, 'read the image repository', `${repositories}/${ARTIFACT_REPOSITORY}`, { allow: [404] });
  if (!repository) {
    const op = await google(ctx, 'create the image repository', `${repositories}?repositoryId=${ARTIFACT_REPOSITORY}`, {
      method: 'POST',
      json: { format: 'DOCKER', cleanupPolicies, cleanupPolicyDryRun: false },
    });
    await finish(ctx, 'create the image repository', ARTIFACTS, op);
    notes.push('created the image repository');
  } else if (repository.cleanupPolicies?.[CLEANUP_POLICY]?.condition?.olderThan !== CLEANUP_OLDER_THAN) {
    await google(ctx, 'set the image cleanup', `${repositories}/${ARTIFACT_REPOSITORY}?updateMask=cleanupPolicies,cleanupPolicyDryRun`, {
      method: 'PATCH',
      json: { cleanupPolicies: { ...repository.cleanupPolicies, ...cleanupPolicies }, cleanupPolicyDryRun: false },
    });
    notes.push('set the image cleanup');
  }
  return summary(notes);
}

/**
 * Each client project gets its own pool. A provider's condition names one
 * environment, so a shared provider could serve only one client.
 */
async function identityPool(ctx, notes) {
  const { projectId, projectNumber, settings, deps: { env } } = ctx;
  const repository = env.GITHUB_REPOSITORY;
  const pools = `${IAM}/projects/${projectId}/locations/global/workloadIdentityPools`;
  if (!(await google(ctx, 'read the identity pool', `${pools}/${POOL}`, { allow: [404] }))) {
    const op = await google(ctx, 'create the identity pool', `${pools}?workloadIdentityPoolId=${POOL}`, {
      method: 'POST',
      json: { displayName: 'GitHub Actions' },
    });
    await finish(ctx, 'create the identity pool', IAM, op);
    notes.push('created the identity pool');
  }
  const providers = `${pools}/${POOL}/providers`;
  const attributeCondition = [
    `assertion.repository_owner_id == '${env.GITHUB_REPOSITORY_OWNER_ID}'`,
    `assertion.repository_id == '${env.GITHUB_REPOSITORY_ID}'`,
    "assertion.ref == 'refs/heads/main'",
    `assertion.environment == '${settings.environment}'`,
    `assertion.workflow_ref == '${repository}/.github/workflows/deploy.yml@refs/heads/main'`,
  ].join(' && ');
  const body = {
    displayName: 'GitHub OIDC',
    attributeMapping: WIF_MAPPING,
    attributeCondition,
    oidc: { issuerUri: 'https://token.actions.githubusercontent.com' },
  };
  const provider = await google(ctx, 'read the identity provider', `${providers}/${PROVIDER}`, { allow: [404] });
  if (!provider) {
    const op = await google(ctx, 'create the identity provider', `${providers}?workloadIdentityPoolProviderId=${PROVIDER}`, { method: 'POST', json: body });
    await finish(ctx, 'create the identity provider', IAM, op);
    notes.push('created the identity provider');
  } else if (provider.attributeCondition !== attributeCondition) {
    const op = await google(ctx, 'correct the identity provider', `${providers}/${PROVIDER}?updateMask=attributeCondition,attributeMapping`, { method: 'PATCH', json: body });
    await finish(ctx, 'correct the identity provider', IAM, op);
    notes.push('corrected the identity provider');
  }
  ctx.wifProvider = `projects/${projectNumber}/locations/global/workloadIdentityPools/${POOL}/providers/${PROVIDER}`;
  const member = `principalSet://iam.googleapis.com/projects/${projectNumber}/locations/global/workloadIdentityPools/${POOL}/attribute.repository_and_ref/${repository}#refs/heads/main`;
  if (await grant(ctx, 'deploy identity binding', accountResource(ctx, ctx.deployEmail), [{ role: 'roles/iam.workloadIdentityUser', member }])) {
    notes.push('bound the deploy identity');
  }
}

/** The DNS records a custom domain still asks for, its certificate's included. */
function requiredRecords(custom) {
  const groups = [...(custom.requiredDnsUpdates?.desired || []), ...(custom.cert?.verification?.dns?.desired || [])];
  return groups
    .flatMap((group) => group.records || [])
    .filter((record) => record.requiredAction === 'ADD')
    .map((record) => ({ type: record.type, name: record.domainName, content: record.rdata }));
}

/** Any answer over HTTPS, a 404 included, means the certificate is being served. */
async function servesHttps(ctx, domain) {
  try {
    await ctx.deps.fetch(`https://${domain}/`, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(HTTPS_PROBE_MS) });
    return true;
  } catch {
    return false;
  }
}

/** ADR §6.3: the web address, its DNS records, and the wait for its certificate. */
async function stepWebAddress(ctx) {
  const { projectId, site, domain } = ctx;
  const notes = [];
  const domains = `${HOSTING}/projects/${projectId}/sites/${site}/customDomains`;
  let custom = await google(ctx, 'read the web address', `${domains}/${domain}`, { allow: [404] });
  if (!custom) {
    await google(ctx, 'add the web address', `${domains}?customDomainId=${domain}`, { method: 'POST', json: {} });
    notes.push('added the web address');
  }
  for (let poll = 0; poll < CERT_POLLS; poll += 1) {
    custom = await google(ctx, 'read the web address', `${domains}/${domain}`, { allow: [404] });
    if (custom) {
      for (const record of requiredRecords(custom)) {
        if (await dnsRecord(ctx, record)) notes.push(`wrote ${record.type} ${record.name}`);
      }
      if (custom.hostState === 'HOST_ACTIVE') {
        if (custom.cert?.state === 'CERT_ACTIVE') return summary(notes);
        // Hosting can report this for an hour or more after it serves the certificate, while the site has no release.
        if (custom.cert?.state === 'CERT_PROPAGATING' && await servesHttps(ctx, domain)) {
          notes.push('the certificate is being served');
          return summary(notes);
        }
      }
    }
    await ctx.deps.sleep(CERT_WAIT_MS);
  }
  throw new Error(`the certificate is not active yet (host ${custom?.hostState || 'unknown'}, certificate ${custom?.cert?.state || 'unknown'}). Retry the build later.`);
}

/** ADR §6.4: emailed sign-in codes work from these addresses. */
async function stepSignIn(ctx) {
  const url = `${IDENTITY}/admin/v2/projects/${ctx.projectId}/config`;
  const config = await google(ctx, 'read sign-in', url);
  const have = config.authorizedDomains || [];
  const want = [ctx.domain, `${ctx.site}.web.app`, `${ctx.site}.firebaseapp.com`];
  const missing = want.filter((domain) => !have.includes(domain));
  if (missing.length === 0) return summary([]);
  await google(ctx, 'write sign-in', `${url}?updateMask=authorizedDomains`, { method: 'PATCH', json: { authorizedDomains: [...have, ...missing] } });
  return `added ${missing.join(', ')}`;
}

function postmarkAccount(ctx, label, pathAndQuery, options = {}) {
  return call(ctx, label, `${POSTMARK}${pathAndQuery}`, {
    ...options,
    headers: { Accept: 'application/json', 'X-Postmark-Account-Token': ctx.deps.env.POSTMARK_ACCOUNT_TOKEN },
  });
}

function postmarkServer(ctx, token, label, pathAndQuery, options = {}) {
  return call(ctx, label, `${POSTMARK}${pathAndQuery}`, {
    ...options,
    headers: { Accept: 'application/json', 'X-Postmark-Server-Token': token },
  });
}

/** ADR §6.5: the mail server, its streams, and the sender domain. */
async function stepEmail(ctx) {
  const { domain, settings: { environment } } = ctx;
  const notes = [];
  const query = new URLSearchParams({ count: '500', offset: '0', name: environment });
  const servers = await postmarkAccount(ctx, 'read the mail servers', `/servers?${query}`);
  let server = (servers.Servers || []).find((item) => item.Name === environment);
  if (!server) {
    server = await postmarkAccount(ctx, 'create the mail server', '/servers', { method: 'POST', json: { Name: environment } });
    notes.push('created the mail server');
  }
  await rememberResources(ctx, { postmarkServerId: server.ID });
  const serverToken = server.ApiTokens?.[0];
  if (!serverToken) throw new Error('the mail server answer held no token');
  if (await putClientSecret(ctx, 'EMAIL_PROVIDER_API_KEY', serverToken)) notes.push('stored the mail token');

  let basicAuth = await ctx.clientSecrets.readSecret('EMAIL_WEBHOOK_BASIC_AUTH');
  if (!basicAuth) {
    basicAuth = `${ctx.projectId}:${randomBytes(20).toString('hex')}`;
    notes.push('made the mail webhook password');
  }
  await putClientSecret(ctx, 'EMAIL_WEBHOOK_BASIC_AUTH', basicAuth);

  const streams = await postmarkServer(ctx, serverToken, 'read the mail streams', '/message-streams?MessageStreamType=All');
  if (!(streams.MessageStreams || []).some((stream) => stream.ID === ANNOUNCEMENT_STREAM)) {
    await postmarkServer(ctx, serverToken, 'create the announcement stream', '/message-streams', {
      method: 'POST',
      json: {
        ID: ANNOUNCEMENT_STREAM,
        Name: 'Announcements',
        MessageStreamType: 'Broadcasts',
        SubscriptionManagementConfiguration: { UnsubscribeHandlingType: 'Postmark' },
      },
    });
    notes.push('created the announcement stream');
  }
  const domains = await postmarkAccount(ctx, 'read the sender domains', '/domains?count=500&offset=0');
  let id = (domains.Domains || []).find((item) => item.Name === domain)?.ID;
  if (!id) {
    id = (await postmarkAccount(ctx, 'add the sender domain', '/domains', {
      method: 'POST',
      json: { Name: domain, ReturnPathDomain: `pm-bounces.${domain}` },
    })).ID;
    notes.push('added the sender domain');
  }
  await rememberResources(ctx, { postmarkDomainId: id });
  for (let poll = 0; poll < POSTMARK_POLLS; poll += 1) {
    const detail = await postmarkAccount(ctx, 'read the sender domain', `/domains/${id}`);
    if (detail.DKIMVerified && detail.ReturnPathDomainVerified) return summary(notes);
    const dkimHost = detail.DKIMPendingHost || detail.DKIMHost;
    const dkimValue = detail.DKIMPendingTextValue || detail.DKIMTextValue;
    if (dkimHost && dkimValue && await dnsRecord(ctx, { type: 'TXT', name: dkimHost, content: dkimValue })) notes.push('wrote the DKIM record');
    if (await dnsRecord(ctx, { type: 'CNAME', name: detail.ReturnPathDomain, content: detail.ReturnPathDomainCNAMEValue })) notes.push('wrote the return-path record');
    await postmarkAccount(ctx, 'check DKIM', `/domains/${id}/verifyDkim`, { method: 'PUT' });
    await postmarkAccount(ctx, 'check the return path', `/domains/${id}/verifyReturnPath`, { method: 'PUT' });
    await ctx.deps.sleep(POSTMARK_WAIT_MS);
  }
  throw new Error(`the mail service has not verified ${domain} yet. Retry the build later.`);
}

/**
 * ADR §6.5: Postmark tests a webhook's address when it is created, and saves
 * nothing if the address does not answer, so this waits for the first deploy.
 */
async function stepMailWebhooks(ctx) {
  const notes = [];
  const serverToken = await ctx.clientSecrets.readSecret('EMAIL_PROVIDER_API_KEY');
  const basicAuth = await ctx.clientSecrets.readSecret('EMAIL_WEBHOOK_BASIC_AUTH');
  if (!serverToken || !basicAuth) throw new Error('the mail secrets are missing');
  const separator = basicAuth.indexOf(':');
  const url = functionUrl(ctx, 'emailDeliveryWebhook');
  const { host, pathname } = new URL(url);
  for (const [stream, subscription] of [[TRANSACTIONAL_STREAM, false], [ANNOUNCEMENT_STREAM, true]]) {
    const hooks = await postmarkServer(ctx, serverToken, 'read the mail webhooks', `/webhooks?MessageStream=${stream}`);
    const present = (hooks.Webhooks || []).some((hook) => {
      const existing = new URL(hook.Url);
      return existing.host === host && existing.pathname === pathname;
    });
    if (!present) {
      await postmarkServer(ctx, serverToken, 'create the mail webhook', '/webhooks', {
        method: 'POST',
        json: {
          Url: url,
          MessageStream: stream,
          HttpAuth: { Username: basicAuth.slice(0, separator), Password: basicAuth.slice(separator + 1) },
          Triggers: {
            Delivery: { Enabled: true },
            Bounce: { Enabled: true },
            SpamComplaint: { Enabled: true },
            ...(subscription ? { SubscriptionChange: { Enabled: true } } : {}),
          },
        },
      });
      notes.push(`added the ${stream} webhook`);
    }
  }
  return summary(notes);
}

function ticketing(ctx, choice, connection) {
  if (choice === 'stripe') {
    return {
      EVENT_TICKETING_PROVIDER: 'stripe',
      EVENT_TICKETING_EVENT_ID: ctx.name,
      EVENT_STRIPE_ACCOUNT_ID: connection.accountId,
      EVENT_STRIPE_MODE: connection.livemode === false ? 'test' : 'live',
    };
  }
  return { EVENT_TICKETING_PROVIDER: 'eventbrite', EVENT_TICKETING_EVENT_ID: String(connection.event.id) };
}

/** The connection without its token, which may already have left the console. */
async function readConnectionDetails(ctx, provider) {
  const accounts = await ctx.deps.db.collection(ACCOUNT_COLLECTION).doc(ctx.appId).get();
  const account = accounts.exists ? accounts.data()[provider] : null;
  const connection = liveConnection(ctx.app.connections, provider);
  return connection && account ? { ...connection, ...account } : null;
}

/** A client may have removed the app. Status only: this is the client's account. */
async function testToken(ctx, choice, token, connection) {
  const headers = { Authorization: `Bearer ${token}` };
  const name = PROVIDER_NAMES[choice];
  try {
    if (choice === 'stripe') {
      const account = await call(ctx, `the ${name} token`, `${STRIPE}/account`, { headers, quiet: true });
      if (account.id !== connection.accountId) throw new Error(`the ${name} token is for another account`);
    } else {
      await call(ctx, `the ${name} token`, `${EVENTBRITE}/users/me/`, { headers, quiet: true });
      await call(ctx, `the ${name} event`, `${EVENTBRITE}/events/${encodeURIComponent(connection.event.id)}/`, { headers, quiet: true });
    }
  } catch (err) {
    throw new Error(`${err.message}. The client must connect the ${name} account again.`);
  }
}

/** Stripe gives a signing secret only on create, so a lost one means a new endpoint. */
async function stripeEndpoint(ctx, token, notes) {
  const headers = { Authorization: `Bearer ${token}` };
  const url = functionUrl(ctx, 'ticketingWebhook');
  const listed = await call(ctx, 'read the payment webhooks', `${STRIPE}/webhook_endpoints?limit=100`, { headers, quiet: true });
  const existing = (listed.data || []).filter((endpoint) => endpoint.url === url);
  const secret = await ctx.clientSecrets.readSecret(WEBHOOK_SECRET);
  // Stripe shows a signing secret once, so only the endpoint recorded with it is known to match.
  const good = secret && existing.find((endpoint) => (
    endpoint.id === ctx.stripeEndpointId && endpoint.status === 'enabled' && WEBHOOK_EVENTS.every((type) => endpoint.enabled_events?.includes(type))
  ));
  if (good) {
    await putClientSecret(ctx, WEBHOOK_SECRET, secret);
    return;
  }
  for (const endpoint of existing) {
    await call(ctx, 'remove the payment webhook', `${STRIPE}/webhook_endpoints/${endpoint.id}`, { method: 'DELETE', headers, quiet: true });
  }
  const form = new URLSearchParams({ url });
  for (const type of WEBHOOK_EVENTS) form.append('enabled_events[]', type);
  const created = await call(ctx, 'create the payment webhook', `${STRIPE}/webhook_endpoints`, { method: 'POST', headers, form, quiet: true });
  if (!created.secret) throw new Error('create the payment webhook: the answer held no signing secret');
  await putClientSecret(ctx, WEBHOOK_SECRET, created.secret);
  ctx.stripeEndpointId = created.id;
  await ctx.recordRef.update({ stripeEndpointId: created.id });
  notes.push('created the payment webhook');
}

/**
 * A deployed function keeps the secret version and the variables it was
 * deployed with, so a deploy from before these details changed no longer
 * counts (`deploy`). This compares with the record, not with what this run
 * moved, so a run that stopped straight after the move still notes it. The
 * details hold no secret value, so they are stored as they are.
 */
async function noteTicketDetails(ctx, details) {
  const key = JSON.stringify(details);
  if (ctx.ticketsKey === key) return;
  ctx.ticketsKey = key;
  ctx.ticketsChangedAt = new Date(ctx.deps.now());
  await ctx.recordRef.update({ ticketsKey: key, ticketsChangedAt: ctx.ticketsChangedAt });
}

/**
 * ADR §6.6: test the chosen account's token, move it to the client project,
 * delete the console's copies and any leftover. The token is read from the
 * console first, so a rerun after the move finds it in the client project.
 */
async function stepTickets(ctx) {
  const { appId, frozen, testMode, clientSecrets, deps: { consoleSecrets } } = ctx;
  const choice = frozen.tickets?.choice;
  const notes = [];
  for (const provider of PROVIDERS) {
    if (provider !== choice) await deleteStoredConnection({ secrets: consoleSecrets }, appId, provider);
  }
  if (choice === 'spreadsheet' || choice === 'none') {
    ctx.ticketVars = { EVENT_TICKETING_PROVIDER: choice === 'spreadsheet' ? 'manual' : 'none' };
    return 'no account to move';
  }
  if (!PROVIDERS.includes(choice)) throw new Error('the request has no ticket choice');

  const name = PROVIDER_NAMES[choice];
  const connection = await readConnectionDetails(ctx, choice);
  if (!connection) throw new Error(`the ${name} connection is gone. The client must connect the account again.`);
  const consoleCopy = await consoleSecrets.readSecret(connectionSecretId(appId, choice));
  const token = consoleCopy || await clientSecrets.readSecret(TOKEN_SECRET);
  if (!token) throw new Error(`the ${name} token is gone. The client must connect the account again.`);

  const isTestToken = connection.livemode === false || /^(?:sk|rk)_test_/.test(token);
  if (isTestToken && !testMode) {
    await deleteStoredConnection({ secrets: consoleSecrets }, appId, choice);
    if (!consoleCopy) await clientSecrets.deleteSecret(TOKEN_SECRET);
    throw new Error(`the ${name} connection is in test mode, and this is a live build. The token is deleted. The client must connect a live account.`);
  }

  await testToken(ctx, choice, token, connection);
  if (await putClientSecret(ctx, TOKEN_SECRET, token)) notes.push('moved the token');
  if (consoleCopy) await deleteStoredConnection({ secrets: consoleSecrets }, appId, choice);

  ctx.ticketVars = ticketing(ctx, choice, connection);
  ctx.ticketOrganization = connection.eventOrganizationId || null;
  if (choice === 'stripe') {
    await stripeEndpoint(ctx, token, notes);
  } else if (!(await clientSecrets.readSecret(WEBHOOK_SECRET))) {
    await putClientSecret(ctx, WEBHOOK_SECRET, randomBytes(32).toString('hex'));
    notes.push('made the ticket webhook secret');
  }
  await noteTicketDetails(ctx, [choice, await clientSecrets.versionStamp(TOKEN_SECRET), await clientSecrets.versionStamp(WEBHOOK_SECRET), ctx.ticketVars, ctx.ticketOrganization]);
  ctx.ticketAccount = [choice, ctx.ticketOrganization || connection.accountId, ctx.ticketVars.EVENT_TICKETING_EVENT_ID].join(':');
  ctx.ticketConfig = {
    externalEventId: ctx.ticketVars.EVENT_TICKETING_EVENT_ID,
    ...(choice === 'stripe' ? { stripeAccountId: connection.accountId, livemode: connection.livemode !== false } : {}),
  };
  return summary(notes);
}

/** The Environment's variables, as docs/DEPLOY_RUNBOOK.md §3 lists them. No secret is needed: deploy-client.yml reads none. */
function deployVariables(ctx) {
  const { domain, name, projectId, region, site, bucket, web } = ctx;
  return {
    [OWNER_VARIABLE]: ctx.appId,
    WIF_PROVIDER: ctx.wifProvider,
    WIF_SERVICE_ACCOUNT: ctx.deployEmail,
    EVENT_SLUG: name,
    EVENT_FIREBASE_PROJECT_ID: projectId,
    EVENT_FIREBASE_REGION: region,
    EVENT_HOSTING_SITE: site,
    EVENT_PUBLIC_URL: `https://${domain}`,
    EVENT_STORAGE_BUCKET: bucket,
    EVENT_ALLOWED_ORIGINS: `https://${domain},https://${site}.web.app`,
    EVENT_EMAIL_PROVIDER: 'postmark',
    EVENT_OPERATOR_NOTIFIER: 'email',
    EVENT_APP_CHECK_ENFORCED: 'false',
    EVENT_OTP_SEND_CEILING_PER_HOUR: '500',
    EVENT_SITE_PUBLISHER_ENABLED: 'false',
    ...ctx.ticketVars,
    VITE_FIREBASE_API_KEY: web.apiKey,
    VITE_FIREBASE_AUTH_DOMAIN: web.authDomain,
    VITE_FIREBASE_PROJECT_ID: web.projectId,
    VITE_FIREBASE_STORAGE_BUCKET: web.storageBucket || bucket,
    VITE_FIREBASE_MESSAGING_SENDER_ID: web.messagingSenderId,
    VITE_FIREBASE_APP_ID: web.appId,
    VITE_EVENT_PUBLIC_URL: `https://${domain}`,
  };
}

/** GITHUB_TOKEN cannot create an Environment, so this uses the provisioner's App. */
async function stepEnvironment(ctx) {
  const { deps: { env, fetch, now }, settings: { environment } } = ctx;
  const repository = env.GITHUB_REPOSITORY;
  const token = await installationToken({
    appId: env.PROVISIONER_APP_ID,
    installationId: env.PROVISIONER_INSTALLATION_ID,
    privateKey: env.PROVISIONER_APP_PRIVATE_KEY,
    repository,
    permissions: { administration: 'write', environments: 'write', actions: 'read' },
    fetch,
    now,
  });
  const headers = { ...GITHUB_HEADERS, Authorization: `Bearer ${token}` };
  const base = `${GITHUB}/repos/${repository}/environments/${encodeURIComponent(environment)}`;
  const notes = [];

  const existing = await call(ctx, 'read the Environment', base, { headers, allow: [404] });
  const stored = new Map();
  for (let page = 1; existing; page += 1) {
    const listed = await call(ctx, 'read the variables', `${base}/variables?per_page=30&page=${page}`, { headers });
    for (const variable of listed.variables || []) stored.set(variable.name, variable.value);
    if ((listed.variables || []).length < 30) break;
  }
  // Nothing else proves whose an unowned Environment is. The claim is written
  // before creating one, so a run lost at any point can be retried.
  const ours = stored.get(OWNER_VARIABLE) === ctx.appId
    || (existing && stored.size === 0 && (await ctx.recordRef.get()).data()?.environmentClaim === environment);
  if (existing && !ours) {
    throw new Error(`the Environment ${environment} was not made for this request`);
  }
  if (!existing) await ctx.recordRef.set({ environmentClaim: environment }, { merge: true });
  await rememberResources(ctx, { githubEnvironment: environment });
  if (existing?.deployment_branch_policy?.custom_branch_policies !== true) {
    await call(ctx, 'create the Environment', base, {
      method: 'PUT',
      headers,
      json: { deployment_branch_policy: { protected_branches: false, custom_branch_policies: true } },
    });
    notes.push('created the Environment');
  }
  // First, and create only: when two requests race for one name, the second is refused here.
  if (!stored.has(OWNER_VARIABLE)) {
    await call(ctx, `create ${OWNER_VARIABLE}`, `${base}/variables`, { method: 'POST', headers, json: { name: OWNER_VARIABLE, value: ctx.appId } });
    stored.set(OWNER_VARIABLE, ctx.appId);
  }
  const policies = await call(ctx, 'read the branch rule', `${base}/deployment-branch-policies`, { headers });
  if (!(policies.branch_policies || []).some((policy) => policy.name === 'main' && policy.type !== 'tag')) {
    await call(ctx, 'write the branch rule', `${base}/deployment-branch-policies`, { method: 'POST', headers, json: { name: 'main', type: 'branch' } });
    notes.push('added the main-only rule');
  }

  ctx.vars = deployVariables(ctx);
  let written = 0;
  for (const [name, value] of Object.entries(ctx.vars)) {
    if (stored.get(name) === value) continue;
    if (stored.has(name)) {
      await call(ctx, `update ${name}`, `${base}/variables/${name}`, { method: 'PATCH', headers, json: { name, value } });
    } else {
      await call(ctx, `create ${name}`, `${base}/variables`, { method: 'POST', headers, json: { name, value } });
    }
    written += 1;
  }
  if (written > 0) notes.push(`wrote ${written} variables`);
  return summary(notes);
}

/** A reused deployment must contain this provisioning run's code revision. */
async function deploymentHasRevision(ctx, run) {
  const { env } = ctx.deps;
  const headers = { ...GITHUB_HEADERS, Authorization: `Bearer ${env.GITHUB_TOKEN}` };
  const base = `${GITHUB}/repos/${env.GITHUB_REPOSITORY}`;
  const validSha = (value) => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
  if (!ctx.codeRevision) {
    const revision = validSha(env.GITHUB_SHA) ? env.GITHUB_SHA
      : (await call(ctx, 'read the current main revision', `${base}/git/ref/heads/main`, { headers })).object?.sha;
    if (!validSha(revision)) throw new Error('the current code revision could not be established');
    ctx.codeRevision = revision;
    ctx.revisionChecks = new Map();
  }
  if (!validSha(run?.head_sha)) return false;
  if (run.head_sha === ctx.codeRevision) return true;
  if (!ctx.revisionChecks.has(run.head_sha)) {
    const compared = await call(ctx, 'check the deployed code revision', `${base}/compare/${ctx.codeRevision}...${run.head_sha}?per_page=1`, { headers, allow: [404], quiet: true });
    ctx.revisionChecks.set(run.head_sha, ['ahead', 'identical'].includes(compared?.status));
  }
  return ctx.revisionChecks.get(run.head_sha);
}

/**
 * One deploy, until it succeeds. deploy.yml names each run after its client
 * and mode, which is how a run is found again. A run that already succeeded
 * counts, a run in progress is waited for, and a failed one is run again a
 * bounded number of times, because a first deploy's failures are often transient.
 * A run older than `after`, or missing this run's code revision, cannot count.
 * New requests and retries therefore inherit the patches on main.
 */
async function deploy(ctx, { bootstrap, after = Number.NaN }) {
  const { deps: { env, sleep }, settings: { environment } } = ctx;
  const headers = { ...GITHUB_HEADERS, Authorization: `Bearer ${env.GITHUB_TOKEN}` };
  const workflow = `${GITHUB}/repos/${env.GITHUB_REPOSITORY}/actions/workflows/deploy.yml`;
  const title = `Deploy ${environment}${bootstrap ? ' (bootstrap)' : ''}`;
  let dispatches = 0;
  let previous = null;
  for (let poll = 0; poll < DEPLOY_POLLS; poll += 1) {
    const listed = await call(ctx, 'read the deploy runs', `${workflow}/runs?event=workflow_dispatch&branch=main&per_page=50`, { headers });
    const latest = (listed.workflow_runs || []).find((run) => run.display_title === title) || null;
    const current = !(Date.parse(latest?.created_at) < after);
    const containsRevision = await deploymentHasRevision(ctx, latest);
    const counts = latest && containsRevision && (dispatches === 0 ? current : latest.id !== previous);
    if (counts && latest.status !== 'completed') {
      await sleep(DEPLOY_WAIT_MS);
    } else if (counts && latest.conclusion === 'success') {
      return dispatches === 0 ? summary([]) : `succeeded on try ${dispatches}`;
    } else if (dispatches > 0 && !counts) {
      await sleep(DEPLOY_WAIT_MS);
    } else {
      if (dispatches >= DEPLOY_ATTEMPTS) throw new Error(`the deploy failed ${dispatches} times. Last run: ${latest.html_url}`);
      if (dispatches > 0) await sleep(DEPLOY_RETRY_WAIT_MS);
      previous = latest?.id ?? null;
      await call(ctx, 'start the deploy', `${workflow}/dispatches`, {
        method: 'POST',
        headers,
        json: { ref: 'main', inputs: { client: environment, ...(bootstrap ? { provision: 'true', bootstrap: 'true' } : {}) } },
      });
      dispatches += 1;
      await sleep(DEPLOY_WAIT_MS);
    }
  }
  throw new Error('the deploy did not finish in time. Retry the build later.');
}

function childEnv(ctx, extra = {}) {
  const env = { ...ctx.deps.env };
  for (const name of [...QUOTA_VARS, ...CHILD_DROPS]) delete env[name];
  return { ...env, ...ctx.vars, ...extra };
}

/** @returns {string|null} what is wrong with init-event's branding line */
function brandingProblem(output) {
  const line = output.split('\n').find((text) => /^\s*branding\/\s/.test(text));
  if (!line) return 'it printed no branding line';
  const errors = Number(line.match(/(\d+) errors/)?.[1] ?? NaN);
  if (errors === 0) return null;
  return `branding uploads failed or their result was missing (${line.trim()})`;
}

/**
 * ADR §6.8, the middle: seed the site. It needs config/event, so it records
 * the sender verification and registers the ticket webhook here, after the
 * order in ADR §6.5 and §6.6. The stamp is the last write, so a site without
 * it is seeded again, and init-event then needs --force.
 */
async function stepSeed(ctx) {
  const { frozen, name, domain, deps: { clientDb, runCommand, writeAnswers } } = ctx;
  const db = clientDb(ctx.projectId);
  const notes = [];
  const event = await db.collection('config').doc('event').get();
  if (event.data()?.sender?.domainVerified !== true) {
    const members = await ctx.deps.db.collection('organizations').doc(ctx.app.orgId).collection('members').get();
    const emailsOf = (role) => members.docs.map((doc) => doc.data()).filter((member) => member.role === role).map((member) => member.email);
    const answers = toInitAnswers(frozen);
    if (answers.event.sender.email !== senderAddress(name)) throw new Error('the sender address does not match the web address');
    // init-event prints its operator checklist into public Actions logs.
    if (ctx.deps.env.GITHUB_ACTIONS === 'true') {
      for (const email of [...emailsOf('owner'), ...emailsOf('editor')]) console.log(`::add-mask::${email}`);
    }
    const file = await writeAnswers({ ...answers, providers: {
      email: { announcementStream: ANNOUNCEMENT_STREAM },
      notifier: { operatorEmail: 'amditisj@montclair.edu' },
    } });
    const args = [
      'scripts/init-event.cjs', '--answers', file,
      ...emailsOf('owner').flatMap((email) => ['--admin', email]),
      ...emailsOf('editor').flatMap((email) => ['--staff', email]),
      ...(event.exists ? ['--force'] : []),
    ];
    const { code, output } = await runCommand('node', args, { env: childEnv(ctx) });
    if (code !== 0) throw new Error(`init-event exited ${code}`);
    const problem = brandingProblem(output);
    if (problem) throw new Error(`init-event: ${problem}`);
    const stamped = await stampVerification({ db, verified: true, method: 'provider-check', domain, now: ctx.deps.now });
    if (stamped === false) throw new Error('the sender domain could not be recorded');
    notes.push('seeded the site');
  }

  const provider = ctx.ticketVars.EVENT_TICKETING_PROVIDER;
  if (PROVIDERS.includes(provider)) {
    const providers = db.collection('config').doc('providers');
    let ticketing = (await providers.get()).data()?.ticketing;
    // A registration covers one account and event, and a client can replace them to recover a failed build.
    if (ticketing?.registeredFor !== ctx.ticketAccount) {
      const reset = { ...ctx.ticketConfig, registeredFor: ctx.ticketAccount, webhookRegisteredAt: null, webhookId: null };
      await providers.set({ ticketing: reset }, { merge: true });
      ticketing = reset;
    }
    if (!ticketing.webhookRegisteredAt) {
      const { code } = await runCommand('node', ['scripts/register-ticketing-webhook.cjs'], {
        env: childEnv(ctx, {
          TICKETING_API_TOKEN: await ctx.clientSecrets.readSecret(TOKEN_SECRET),
          TICKETING_WEBHOOK_SECRET: await ctx.clientSecrets.readSecret(WEBHOOK_SECRET),
          ...(ctx.ticketOrganization ? { EVENT_TICKETING_ORGANIZATION_ID: ctx.ticketOrganization } : {}),
        }),
      });
      if (code !== 0) throw new Error(`register-ticketing-webhook exited ${code}`);
      notes.push('registered the ticket webhook');
    }
  }
  return summary(notes);
}

/** ADR §6.9: the Owners' link, then `ready`. The record keeps a retry from emailing twice. */
async function stepReady(ctx) {
  const notes = [];
  if (!ctx.ownersEmailedAt) {
    const sent = await notifyOwners(consoleDeps(ctx), {
      orgId: ctx.app.orgId,
      appId: ctx.appId,
      status: 'ready',
      eventName: ctx.eventName,
      adminLink: `https://${ctx.domain}/admin`,
      note: 'Automatic ticket approval is off. Review ticket holders in Attendees, or enable Automatic ticket approval in Settings after you review the access policy.',
    });
    if (!sent) throw new Error('we could not email every Owner');
    ctx.ownersEmailedAt = new Date(ctx.deps.now());
    await ctx.recordRef.update({ ownersEmailedAt: ctx.ownersEmailedAt });
    notes.push('emailed the Owners');
  }
  if (!(await moveStatus(ctx, 'building', 'ready'))) throw new Error('the request is no longer building');
  notes.push('the site is ready');
  return summary(notes);
}

const STEPS = Object.freeze([
  { id: 'project', label: 'Project, billing and APIs', run: stepProject },
  { id: 'firebase', label: 'Firebase, database, storage and web app', run: stepFirebase },
  { id: 'deploy-identity', label: 'Deploy account and permissions', run: stepDeployIdentity },
  { id: 'web-address', label: 'Web address and certificate', run: stepWebAddress },
  { id: 'sign-in', label: 'Sign-in addresses', run: stepSignIn },
  { id: 'email', label: 'Email', run: stepEmail },
  { id: 'tickets', label: 'Tickets', run: stepTickets },
  { id: 'environment', label: 'Deploy settings', run: stepEnvironment },
  { id: 'first-deploy', label: 'First deploy', run: (ctx) => deploy(ctx, { bootstrap: true }) },
  { id: 'mail-webhooks', label: 'Email delivery updates', run: stepMailWebhooks },
  { id: 'seed', label: 'Site content and team', run: stepSeed },
  { id: 'full-deploy', label: 'Full deploy', run: (ctx) => deploy(ctx, { bootstrap: false, after: toMillis(ctx.ticketsChangedAt) }) },
  { id: 'ready', label: 'Tell the Owners', run: stepReady },
]);

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

function consoleDeps(ctx) {
  const { db, mailer, log, now, env } = ctx.deps;
  return { db, mailer, log, now, publicUrl: (env.CONSOLE_PUBLIC_URL || '').replace(/\/+$/, '') };
}

/** @returns {Promise<boolean>} false when the request was not at `from` */
async function moveStatus(ctx, from, to) {
  const { db, now } = ctx.deps;
  const ref = db.collection('applications').doc(ctx.appId);
  return db.runTransaction(async (tx) => {
    const data = (await tx.get(ref)).data();
    if (data.status !== from) return false;
    const at = new Date(now());
    tx.update(ref, {
      status: to,
      updatedAt: at,
      updatedBy: BY,
      history: [...(Array.isArray(data.history) ? data.history : []), historyEntry(to, at, BY)],
    });
    return true;
  });
}

async function quietly(ctx, what, work) {
  try {
    return await work();
  } catch (err) {
    ctx.deps.log.error(`provision-client: ${what} failed`, err.message);
    return false;
  }
}

/** A readable record, the queue's flag, an audit row, and notices to the operators and the Owners. */
async function recordFailure(ctx, step, message) {
  const { db, now } = ctx.deps;
  const at = new Date(now());
  const error = step ? `${step.label}: ${message}` : message;
  await quietly(ctx, 'the failure record', () => ctx.recordRef.set({
    state: 'failed', failedStep: step?.id || null, error, steps: ctx.steps, finishedAt: at, updatedAt: at,
  }, { merge: true }));
  await quietly(ctx, 'the failure flag', () => db.collection('applications').doc(ctx.appId).update({ buildStart: { state: 'failed', at } }));
  await quietly(ctx, 'the failure audit', () => db.collection('console_audit').doc().create({
    action: 'build-failed', appId: ctx.appId, by: BY, at,
  }));
  await quietly(ctx, 'the failure notice', () => notifyOperators(consoleDeps(ctx), {
    orgId: ctx.app.orgId, appId: ctx.appId, eventName: ctx.eventName, kind: 'build-run-failed', problem: error,
  }));
  await quietly(ctx, 'the Owner notice', () => notifyOwners(consoleDeps(ctx), {
    orgId: ctx.app.orgId, appId: ctx.appId, status: 'build-failed', eventName: ctx.eventName,
  }));
}

/**
 * The settings an operator approved, or the console's settings. Only a
 * request approved before ADR 0007's 2026-11-04 amendment removed operator
 * approval can hold approved settings; new requests store null. A retry
 * keeps the project, region, folder and environment an earlier run of this
 * request chose and saved in `resources`: the project and its data already
 * live there, so a console setting changed since then must not move them.
 * The billing account is read again, so a retry can use a new one.
 */
async function buildSettings(db, app, saved = {}) {
  const stored = app.review?.settings;
  const defaults = stored || approvalDefaults(await readConsoleSettings(db), siteNameOf(app));
  const chosen = saved?.projectId
    ? Object.fromEntries(['projectId', 'region', 'gcpFolder', 'environment'].filter((field) => saved[field]).map((field) => [field, saved[field]]))
    : {};
  return checkSettings(APPROVAL_FIELDS, defaults, chosen);
}

async function runSteps(ctx) {
  const { now } = ctx.deps;
  const save = () => ctx.recordRef.update({ steps: ctx.steps, updatedAt: new Date(now()) });
  for (const step of STEPS) {
    const row = { id: step.id, label: step.label, state: 'running', at: new Date(now()), detail: null };
    ctx.steps.push(row);
    await save();
    try {
      row.detail = await step.run(ctx);
      row.state = 'done';
      row.at = new Date(now());
      await save();
    } catch (err) {
      row.state = 'failed';
      row.at = new Date(now());
      row.detail = err.message;
      err.step = step;
      throw err;
    }
  }
}

/**
 * Build one request.
 * @param {{ appId: string, testMode?: boolean, deps: object }} input
 * @returns {Promise<number>} the exit code
 */
async function provision({ appId, testMode = false, deps }) {
  const { db, env, log, now } = deps;
  const ref = db.collection('applications').doc(appId);
  const snap = await ref.get();
  if (!snap.exists) {
    log.error(`provision-client: request ${appId} does not exist`);
    return 2;
  }
  const app = snap.data();
  if (CONSOLE_REQUEST_GROUPS.built.includes(app.status)) {
    log.log(`provision-client: request ${appId} is already ${app.status}. Nothing to do.`);
    return 0;
  }
  // No cloud resource exists before a request is approved.
  if (!CONSOLE_REQUEST_GROUPS.building.includes(app.status)) {
    log.error(`provision-client: request ${appId} is ${app.status} and not ready to build`);
    return 2;
  }

  const recordRef = db.collection(BUILD_COLLECTION).doc(appId);
  const previous = await recordRef.get();
  const at = new Date(now());
  const frozen = reviewedAnswers(app);
  const ctx = {
    appId,
    app,
    frozen,
    deps,
    recordRef,
    testMode,
    name: siteNameOf(app),
    eventName: frozen?.event?.name || '',
    steps: [],
    ownersEmailedAt: previous.exists ? previous.data().ownersEmailedAt || null : null,
    ticketsKey: previous.exists ? previous.data().ticketsKey || null : null,
    ticketsChangedAt: previous.exists ? previous.data().ticketsChangedAt || null : null,
    stripeEndpointId: previous.exists ? previous.data().stripeEndpointId || null : null,
    resources: previous.exists ? previous.data().resources || {} : {},
  };
  // One transaction with closeApplication's check: a request closed since the read above stays closed, and one
  // closed after this sees a live run and is refused.
  const claimed = await db.runTransaction(async (tx) => {
    if (!CONSOLE_REQUEST_GROUPS.building.includes((await tx.get(ref)).data()?.status)) return false;
    tx.set(recordRef, {
      appId,
      state: 'running',
      testMode,
      runUrl: env.GITHUB_RUN_ID ? `${env.GITHUB_SERVER_URL || 'https://github.com'}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : null,
      startedAt: at,
      updatedAt: at,
      finishedAt: null,
      failedStep: null,
      error: null,
      steps: [],
      ownersEmailedAt: ctx.ownersEmailedAt,
      ticketsKey: ctx.ticketsKey,
      ticketsChangedAt: ctx.ticketsChangedAt,
      stripeEndpointId: ctx.stripeEndpointId,
      environmentClaim: previous.exists ? previous.data().environmentClaim || null : null,
      resources: ctx.resources,
    });
    tx.update(ref, { buildStart: { state: 'started', at } });
    return true;
  });
  if (!claimed) {
    log.error(`provision-client: request ${appId} changed before the build began, so nothing was built`);
    return 2;
  }

  try {
    const missing = REQUIRED_ENV.filter((name) => !(env[name] || '').trim());
    if (missing.length > 0) throw new Error(`the run has no value for ${missing.join(', ')}`);
    ctx.settings = await buildSettings(db, app, ctx.resources);
    ctx.projectId = ctx.settings.projectId;
    ctx.region = ctx.settings.region;
    ctx.domain = siteAddress(ctx.name);
    await rememberResources(ctx, {
      projectId: ctx.projectId, region: ctx.region, domain: ctx.domain,
      environment: ctx.settings.environment, gcpFolder: ctx.settings.gcpFolder,
      dnsInventoryComplete: ctx.resources.dnsInventoryComplete ?? !previous.exists,
    });
    ctx.clientSecrets = deps.clientSecrets(ctx.projectId);
    // The acceptance email already said we are building, so this move sends none.
    await moveStatus(ctx, 'approved', 'building');
    await runSteps(ctx);
  } catch (err) {
    log.error(`provision-client: ${err.step?.id || 'setup'} failed:`, err.message);
    await recordFailure(ctx, err.step, err.message);
    return 1;
  }
  const finished = new Date(now());
  await recordRef.update({ state: 'done', steps: ctx.steps, finishedAt: finished, updatedAt: finished });
  return 0;
}

/**
 * For the workflow's last step. A run that timed out or was cancelled never
 * reached the catch above, so this leaves the record a run that finishes can't.
 * A `queued` record that still names this run is a retry made after this run
 * recorded its failure, and that retry is waiting for this run to end. A `queued`
 * record naming an earlier run is this run's own retry, which died before writing.
 */
async function markStopped({ appId, runId, deps }) {
  const { db } = deps;
  const [appSnap, recordSnap] = await Promise.all([
    db.collection('applications').doc(appId).get(),
    db.collection(BUILD_COLLECTION).doc(appId).get(),
  ]);
  if (!appSnap.exists || !CONSOLE_REQUEST_GROUPS.building.includes(appSnap.data().status)) return 0;
  const record = recordSnap.exists ? recordSnap.data() : {};
  if (record.state === 'failed') return 0;
  if (record.state === 'queued' && runId && record.runUrl?.endsWith(`/actions/runs/${runId}`)) return 0;
  const app = appSnap.data();
  await recordFailure({
    appId,
    app,
    deps,
    recordRef: db.collection(BUILD_COLLECTION).doc(appId),
    steps: Array.isArray(record.steps) ? record.steps : [],
    eventName: reviewedAnswers(app)?.event?.name || '',
  }, null, 'The run stopped before it finished. Read the run log.');
  return 0;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { appId: '', testMode: false, markStopped: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--application') {
      args.appId = argv[i + 1] || '';
      i += 1;
    } else if (argv[i] === '--test-mode') args.testMode = true;
    else if (argv[i] === '--mark-stopped') args.markStopped = true;
    else return null;
  }
  return APP_ID_RE.test(args.appId) ? args : null;
}

function realDeps(env) {
  const { applicationDefault, getApps, initializeApp } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const { createSecretStore } = require('../console/functions/src/secretStore.cjs');
  const { createPostmarkMailer } = require('../console/functions/src/mailer.cjs');
  const { spawn } = require('node:child_process');

  const credential = applicationDefault();
  const firestoreFor = (projectId) => {
    const app = getApps().find((item) => item.name === projectId) || initializeApp({ credential, projectId }, projectId);
    return getFirestore(app);
  };
  const storeFor = (projectId) => createSecretStore({
    projectId, getAccessToken: () => credential.getAccessToken(), fetch: globalThis.fetch, log: console,
  });
  return {
    env,
    fetch: globalThis.fetch,
    getAccessToken: () => credential.getAccessToken(),
    sleep: (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }),
    now: Date.now,
    log: console,
    db: firestoreFor(env.CONSOLE_PROJECT_ID),
    clientDb: firestoreFor,
    consoleSecrets: storeFor(env.CONSOLE_PROJECT_ID),
    clientSecrets: storeFor,
    mailer: createPostmarkMailer({ token: env.CONSOLE_POSTMARK_TOKEN || 'unset', from: env.CONSOLE_MAIL_FROM || 'unset', fetch: globalThis.fetch }),
    writeAnswers: async (answers) => {
      const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'provision-')), 'answers.json');
      fs.writeFileSync(file, JSON.stringify(answers), { mode: 0o600 });
      return file;
    },
    runCommand: (command, args, options) => new Promise((resolve, reject) => {
      // A hung child fails its step and leaves a retry, instead of holding the build to the job's limit.
      const child = spawn(command, args, { env: options.env, stdio: ['ignore', 'pipe', 'inherit'], timeout: COMMAND_TIMEOUT_MS });
      let output = '';
      child.stdout.on('data', (chunk) => {
        output += chunk;
        process.stdout.write(chunk);
      });
      child.on('error', reject);
      child.on('close', (code) => resolve({ code, output }));
    }),
  };
}

async function main(argv = process.argv.slice(2), env = process.env, makeDeps = realDeps) {
  const args = parseArgs(argv);
  if (!args) {
    console.error('Usage: provision-client.cjs --application <id> [--test-mode | --mark-stopped]');
    return 2;
  }
  const deps = makeDeps(env);
  if (args.markStopped) return markStopped({ appId: args.appId, runId: env.GITHUB_RUN_ID, deps });
  return provision({ appId: args.appId, testMode: args.testMode, deps });
}

if (require.main === module) {
  main().then((code) => {
    // Firestore handles keep the process open.
    process.exit(code);
  }).catch((err) => {
    console.error('provision-client failed:', err.message);
    process.exit(1);
  });
}

module.exports = { INVOKER_PERMISSIONS, SERVICES, STEPS, brandingProblem, deployVariables, main, markStopped, parseArgs, provision, requiredRecords };
