#!/usr/bin/env node
'use strict';

/** The site builder's inverse. All I/O is injected. See runbook §12.6. */
const { createHash } = require('node:crypto');
const { toMillis } = require('../console/functions/src/access.cjs');
const { historyEntry } = require('../console/functions/src/applications.cjs');
const { BUILD_COLLECTION, canRetryBuild } = require('../console/functions/src/buildState.cjs');
const { approvalDefaults, readConsoleSettings, normalizeProjectId } = require('../console/functions/src/consoleSettings.cjs');
const { reviewedAnswers, siteNameOf } = require('../console/functions/src/reviewAccess.cjs');
const { siteAddress, siteNameProblem } = require('../console/functions/src/siteNames.cjs');
const { PROVIDERS, connectionChanging } = require('../console/functions/src/connectionState.cjs');
const { ACCOUNT_COLLECTION, STATE_COLLECTION, DELETION_COLLECTION, connectionSecretId, deleteStoredConnection } = require('../console/functions/src/connections.cjs');
const { GITHUB_HEADERS, installationToken } = require('../console/functions/src/buildDispatch.cjs');
const { requiredRecords } = require('./provision-client.cjs');

const DELETED_COLLECTION = 'console_deleted_sites';
const RECOVERY_MS = 7 * 24 * 60 * 60 * 1000;
const CRM = 'https://cloudresourcemanager.googleapis.com/v3';
const HOSTING = 'https://firebasehosting.googleapis.com/v1beta1';
const STORAGE = 'https://storage.googleapis.com/storage/v1';
const FIRESTORE = 'https://firestore.googleapis.com/v1';
const SECRETS = 'https://secretmanager.googleapis.com/v1';
const POSTMARK = 'https://api.postmarkapp.com';
const STRIPE = 'https://api.stripe.com/v1';
const EVENTBRITE = 'https://www.eventbriteapi.com/v3';
const APP_ID_RE = /^[A-Za-z0-9_-]{1,200}$/;
const encode = encodeURIComponent;
const { CONSOLE_REQUEST_GROUPS } = require('shared/consoleRequest');
const ownerLabel = (id) => createHash('sha256').update(id, 'utf8').digest('hex').slice(0, 32);
const hostName = (name) => String(name || '').replace(/\.$/, '').toLowerCase();
const dnsValue = (value) => String(value || '').replace(/\.$/, '').replaceAll('"', '');
const instant = (deps) => new Date(deps.now());
const appRef = (ctx) => ctx.deps.db.collection('applications').doc(ctx.appId);
const buildRef = (ctx) => ctx.deps.db.collection(BUILD_COLLECTION).doc(ctx.appId);
const tombRef = (ctx) => ctx.deps.db.collection(DELETED_COLLECTION).doc(ctx.appId);
const siteUrl = (ctx) => `${HOSTING}/projects/${ctx.resources.projectId}/sites/${ctx.resources.site}`;
// hosting:disable uses the site's releases API, not the custom-domain parent.
const releasesUrl = (ctx) => `${HOSTING}/sites/${ctx.resources.site}/releases`;
const callback = (ctx, name) => `https://${ctx.resources.region}-${ctx.resources.projectId}.cloudfunctions.net/${name}`;

async function call(ctx, label, url, { method = 'GET', headers = {}, json, allow = [] } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    let response;
    try {
      response = await ctx.deps.fetch(url, {
        method, headers: { ...headers, ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        ...(json !== undefined ? { body: JSON.stringify(json) } : {}), signal: AbortSignal.timeout(60_000),
      });
    } catch {
      throw new Error(`${label}: no answer`);
    }
    if ([429, 503].includes(response.status) && attempt < 4) {
      await ctx.deps.sleep(attempt * 5000);
      continue;
    }
    if (allow.includes(response.status)) return null;
    // Provider bodies can contain tokens or a webhook URL with its password.
    // Only a numeric provider error code is safe to report.
    if (!response.ok) {
      let code = null;
      try { const body = JSON.parse(await response.text()); if (Number.isInteger(body?.ErrorCode)) code = body.ErrorCode; } catch { /* no code */ }
      throw Object.assign(new Error(`${label}: HTTP ${response.status}${code !== null ? ` (error code ${code})` : ''}`), { status: response.status, code });
    }
    const text = await response.text();
    try { return text ? JSON.parse(text) : {}; }
    catch { throw new Error(`${label}: invalid JSON answer`); }
  }
}

async function google(ctx, label, url, options = {}) {
  const { access_token: token } = await ctx.deps.getAccessToken();
  return call(ctx, label, url, {
    ...options, headers: {
      Authorization: `Bearer ${token}`,
      ...(url.startsWith(HOSTING) ? { 'x-goog-user-project': ctx.resources.projectId } : {}),
    },
  });
}

async function finish(ctx, label, origin, operation) {
  if (!operation?.name) return;
  let current = operation;
  for (let poll = 0; !current.done; poll += 1) {
    if (poll >= 240) throw new Error(`${label}: the operation did not finish`);
    await ctx.deps.sleep(5000);
    current = await google(ctx, label, `${origin}/${current.name}`);
  }
  if (current.error) throw new Error(`${label}: operation failed (${current.error.code || 'unknown'})`);
}

async function pages(ctx, label, url, key, request = (u) => google(ctx, label, u)) {
  const rows = [];
  let token = '';
  const seen = new Set();
  do {
    const next = new URL(url);
    if (token) next.searchParams.set('pageToken', token);
    const body = await request(next.toString());
    rows.push(...(body?.[key] || []));
    token = body?.nextPageToken || '';
    if (token && seen.has(token)) throw new Error(`${label}: repeated page token`);
    seen.add(token);
  } while (token);
  return rows;
}

function postmark(ctx, path, options = {}, token = null) {
  return call(ctx, 'Postmark', `${POSTMARK}${path}`, {
    ...options, headers: token ? { 'X-Postmark-Server-Token': token } : { 'X-Postmark-Account-Token': ctx.deps.env.POSTMARK_ACCOUNT_TOKEN },
  });
}

async function postmarkList(ctx, path, key) {
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const body = await postmark(ctx, `${path}?count=500&offset=${offset}`);
    const batch = body[key] || [];
    rows.push(...batch);
    if (batch.length < 500) return rows;
  }
}

async function github(ctx, suffix = '', options = {}) {
  if (!ctx.githubToken) {
    const { env, fetch, now } = ctx.deps;
    ctx.githubToken = await installationToken({
      appId: env.PROVISIONER_APP_ID, installationId: env.PROVISIONER_INSTALLATION_ID,
      privateKey: env.PROVISIONER_APP_PRIVATE_KEY, repository: env.GITHUB_REPOSITORY,
      permissions: { administration: 'write', environments: 'write', actions: 'read' }, fetch, now,
    });
  }
  return call(ctx, 'GitHub environment', `https://api.github.com/repos/${ctx.deps.env.GITHUB_REPOSITORY}/environments/${encode(ctx.resources.environment)}${suffix}`, {
    ...options, headers: { ...GITHUB_HEADERS, Authorization: `Bearer ${ctx.githubToken}` },
  });
}

async function project(ctx) {
  if (!ctx.resources.projectId) return null;
  let item;
  ctx.projectReadPending = false;
  try {
    item = await google(ctx, 'project', `${CRM}/projects/${ctx.resources.projectId}`, { allow: [404] });
  } catch (err) {
    // A successful delete operation (or its saved checkpoint) proves why the
    // project can no longer be read. An unrelated denied read is still a failure.
    if (![400, 403].includes(err.status) || !(ctx.projectDeletionRequested || ctx.completed.includes('project'))) throw err;
    ctx.projectOwned = false;
    ctx.projectDeleting = true;
    ctx.projectReadPending = true;
    return null;
  }
  if (item && (item.labels?.['eventrunner-request'] !== ownerLabel(ctx.appId)
    || (ctx.resources.gcpFolder && item.parent !== ctx.resources.gcpFolder))) {
    throw new Error('project: ownership does not match this application');
  }
  ctx.projectOwned = Boolean(item);
  ctx.projectDeleting = !item || item.state === 'DELETE_REQUESTED';
  return item;
}

async function load(appId, deps) {
  if (!APP_ID_RE.test(appId)) throw new Error('setup: invalid application id');
  const ctx = { appId, deps };
  const [app, build, tomb] = await Promise.all([appRef(ctx).get(), buildRef(ctx).get(), tombRef(ctx).get()]);
  if (!app.exists && !tomb.exists) throw new Error('setup: application or tombstone not found');
  ctx.app = app.data() || null;
  ctx.build = build.data() || {};
  ctx.tomb = tomb.data() || null;
  const saved = ctx.tomb?.resources || ctx.build.resources;
  if (saved?.projectId !== undefined) ctx.resources = { ...saved };
  else {
    const name = siteNameOf(ctx.app);
    if (name && siteNameProblem(name)) throw new Error('setup: invalid site name');
    const settings = ctx.app.review?.settings || approvalDefaults(await readConsoleSettings(deps.db), name);
    // A draft with no build has not created the derived project id.
    ctx.resources = {
      projectId: ctx.app.status === 'draft' && !build.exists ? null : settings.projectId || null,
      region: settings.region, environment: settings.environment, gcpFolder: settings.gcpFolder,
      domain: name ? siteAddress(name) : null,
      ...saved,
    };
    if (!ctx.resources.projectId && ctx.app.status !== 'draft') throw new Error('setup: the client project identity is missing');
  }
  ctx.resources = { site: null, buckets: [], dnsRecords: [], dnsInventoryComplete: Array.isArray(saved?.dnsRecords), ...ctx.resources };
  const { projectId, domain, environment, region } = ctx.resources;
  // The general environment setting is only a derived name. A builder claim
  // or a checked project is needed before it can become a deletion identity.
  if (environment && ctx.build.environmentClaim === environment) ctx.resources.githubEnvironment = environment;
  if (projectId === undefined) throw new Error('setup: the resource inventory has no project identity');
  if (projectId && (!normalizeProjectId(projectId) || projectId === deps.env.CONSOLE_PROJECT_ID)) throw new Error('setup: unsafe client project id');
  if (projectId && (!domain || !environment || !region)) throw new Error('setup: incomplete resource identities');
  if (domain && (siteNameProblem(domain.replace(/\.eventrunner\.org$/, '')) || !domain.endsWith('.eventrunner.org'))) throw new Error('setup: unsafe site address');
  ctx.completed = [...(ctx.tomb?.stepsCompleted || [])];
  return ctx;
}

/** Keep only infrastructure identities, never answers, account ids or tokens. */
async function saveResources(ctx) {
  if (ctx.tomb) {
    ctx.tomb = { ...ctx.tomb, resources: ctx.resources };
    await tombRef(ctx).update({ resources: ctx.resources, updatedAt: instant(ctx.deps) });
  } else await buildRef(ctx).set({ resources: ctx.resources }, { merge: true });
}

async function latestRelease(ctx) {
  if (!ctx.resources.site) return null;
  return (await google(ctx, 'Hosting release', `${releasesUrl(ctx)}?pageSize=1`, { allow: [404] }))?.releases?.[0] || null;
}

async function restorableVersion(ctx, release) {
  if (release?.version?.name) return release.version.name;
  if (!ctx.resources.site) return null;
  const releases = await pages(ctx, 'Hosting versions', `${releasesUrl(ctx)}?pageSize=100`, 'releases');
  return releases.find((r) => r.type !== 'SITE_DISABLE' && r.version?.name)?.version.name || null;
}

async function discoverHosting(ctx) {
  if (ctx.resources.site) return;
  const body = await google(ctx, 'Hosting sites', `${HOSTING}/projects/${ctx.resources.projectId}/sites`, { allow: [404] });
  const sites = body?.sites || [];
  const site = sites.find((item) => item.type === 'DEFAULT_SITE') || sites[0];
  ctx.resources.site = site?.name.split('/').pop() || null;
}

/** Discover before deleting the service that holds its DNS verification data. */
async function discover(ctx) {
  const verificationNames = new Set([`_acme-challenge.${ctx.resources.domain}`]);
  const p = await project(ctx);
  if (p) ctx.resources.githubEnvironment = ctx.resources.environment;
  if (p?.state === 'ACTIVE') {
    await discoverHosting(ctx);
    const buckets = await pages(ctx, 'buckets', `${STORAGE}/b?project=${encode(ctx.resources.projectId)}`, 'items');
    ctx.resources.buckets = [...new Set([...ctx.resources.buckets, ...buckets.map((b) => b.name)])];
    if (ctx.resources.site) {
      const domain = await google(ctx, 'custom domain', `${siteUrl(ctx)}/customDomains/${encode(ctx.resources.domain)}`, { allow: [404] });
      // A required value identifies a verification record to inspect, but does
      // not prove the builder created it. Only the saved manifest proves that.
      for (const record of domain ? requiredRecords(domain) : []) {
        verificationNames.add(hostName(record.name));
      }
    }
  }
  const r = ctx.resources;
  const servers = r.postmarkServerId || ctx.projectOwned ? await postmarkList(ctx, '/servers', 'Servers') : [];
  const server = servers.find((s) => r.postmarkServerId ? String(s.ID) === String(r.postmarkServerId) : s.Name === r.environment);
  if (server) {
    if (server.Name !== r.environment) throw new Error('Postmark: server identity changed');
    ctx.resources.postmarkServerId = server.ID;
  }
  const domains = r.postmarkDomainId || ctx.projectOwned ? await postmarkList(ctx, '/domains', 'Domains') : [];
  const domain = domains.find((d) => r.postmarkDomainId ? String(d.ID) === String(r.postmarkDomainId) : hostName(d.Name) === r.domain);
  if (domain) {
    if (hostName(domain.Name) !== r.domain) throw new Error('Postmark: domain identity changed');
    ctx.resources.postmarkDomainId = domain.ID;
    if (!ctx.resources.dnsInventoryComplete) {
      const detail = await postmark(ctx, `/domains/${encode(domain.ID)}`);
      for (const name of [detail.DKIMHost, detail.DKIMPendingHost, detail.ReturnPathDomain]) if (name) verificationNames.add(hostName(name));
    }
  }
  if (!ctx.resources.dnsInventoryComplete && (ctx.projectOwned || r.postmarkServerId || r.postmarkDomainId || r.dnsRecords.length)) {
    // A completed certificate may no longer expose its original TXT value.
    // Refuse an unproven legacy record; an operator must record its identity.
    const probe = { ...ctx, resources: { ...ctx.resources, dnsRecords: [...verificationNames].map((name) => ({ type: 'TXT', name, content: '' })) } };
    const { all } = await dnsRecords(probe);
    if (all.some((record) => hostName(record.name) !== ctx.resources.domain && !ctx.resources.dnsRecords.some((r) => hostName(r.name) === hostName(record.name) && r.type === record.type && dnsValue(r.content) === dnsValue(record.content)))) {
      throw new Error('DNS inventory: confirm the old verification records in console_builds.resources.dnsRecords before purge');
    }
    ctx.resources.dnsInventoryComplete = true;
  }
}

function failedBuild(app, build, at) {
  return app.status === 'building-failed' || canRetryBuild(app, build, at);
}

function checkIdle(ctx, app, build) {
  if (connectionChanging(app.connections, ctx.deps.now())) throw new Error('guard: a connection is being changed');
  if (CONSOLE_REQUEST_GROUPS.building.includes(app.status) && !failedBuild(app, build, ctx.deps.now())) throw new Error('guard: stop the build and its deploy runs first');
  if (build.state === 'running' && !canRetryBuild({ ...app, status: 'building' }, build, ctx.deps.now())) throw new Error('guard: a build is running');
}

async function writeRun(ctx, mode, state, extra = {}) {
  await buildRef(ctx).set({ decommission: runRecord(ctx, mode, state, extra) }, { merge: true });
}

function runRecord(ctx, mode, state, extra = {}) {
  return {
    mode, state, at: instant(ctx.deps), stepsCompleted: ctx.completed,
    runId: ctx.deps.env.GITHUB_RUN_ID || null, ...extra,
  };
}

async function archive(ctx) {
  if (!ctx.app) throw new Error('archive: the application was purged');
  if (ctx.tomb) throw new Error('archive: purge has started');
  if (ctx.app.status === 'archived' && !ctx.app.archive?.pending) return;
  if (ctx.resources.projectId) {
    const p = await project(ctx);
    if (!p || p.state !== 'ACTIVE') throw new Error('archive: the project is not active');
    await discoverHosting(ctx);
  }
  const release = await latestRelease(ctx);
  const versionName = await restorableVersion(ctx, release);
  if (ctx.resources.site && CONSOLE_REQUEST_GROUPS.built.includes(ctx.app.status) && !versionName) throw new Error('archive: Hosting has no version to restore');
  // Claim the status before touching Hosting. A console retry now sees archived.
  await ctx.deps.db.runTransaction(async (tx) => {
    const [snap, buildSnap, tomb] = await Promise.all([tx.get(appRef(ctx)), tx.get(buildRef(ctx)), tx.get(tombRef(ctx))]);
    const app = snap.data();
    const build = buildSnap.data() || {};
    if (tomb.exists) throw new Error('archive: purge has started');
    checkIdle(ctx, app, build);
    if (app.archive?.restoring) throw new Error('archive: a restore is in progress');
    if (app.status === 'archived') return;
    // 'declined' covers a request the hosting team closed after its build
    // began: it may own a project, and console retention keeps it for this.
    if (![...CONSOLE_REQUEST_GROUPS.built, 'draft', 'declined'].includes(app.status) && !failedBuild(app, build, ctx.deps.now())) throw new Error(`archive: status ${app.status} is not allowed`);
    const at = instant(ctx.deps);
    tx.update(appRef(ctx), {
      status: 'archived', archivedAt: at, purgeAfter: new Date(at.getTime() + RECOVERY_MS),
      archive: { previousStatus: app.status, versionName, pending: true },
      updatedAt: at, updatedBy: 'decommission', history: [...(app.history || []), historyEntry('archived', at, 'decommission')],
    });
  });
  await saveResources(ctx);
  await writeRun(ctx, 'archive', 'running');
  if (ctx.resources.site && release?.type !== 'SITE_DISABLE') {
    await google(ctx, 'disable Hosting', releasesUrl(ctx), { method: 'POST', json: { type: 'SITE_DISABLE' } });
  }
  if (ctx.resources.site && (await latestRelease(ctx))?.type !== 'SITE_DISABLE') throw new Error('archive: Hosting is still serving');
  await ctx.deps.db.runTransaction(async (tx) => {
    const [snap, tomb] = await Promise.all([tx.get(appRef(ctx)), tx.get(tombRef(ctx))]);
    const data = snap.data();
    if (tomb.exists) throw new Error('archive: purge has started');
    if (data.status !== 'archived') throw new Error('archive: the application changed');
    tx.update(appRef(ctx), { archive: { ...data.archive, pending: false } });
    tx.set(buildRef(ctx), { decommission: runRecord(ctx, 'archive', 'done') }, { merge: true });
  });
}

async function restore(ctx) {
  if (ctx.tomb) throw new Error('restore: purge has started');
  if (!ctx.app || ctx.app.status !== 'archived') {
    if (ctx.build.decommission?.mode === 'restore' && ctx.build.decommission.state === 'done') return;
    throw new Error('restore: the application is not archived');
  }
  if (!(toMillis(ctx.app.purgeAfter) > ctx.deps.now()) && !ctx.app.archive?.restoring) throw new Error('restore: the recovery window has ended');
  const previous = ctx.app.archive;
  if (!previous?.previousStatus) throw new Error('restore: the previous status is missing');
  if (ctx.resources.site && CONSOLE_REQUEST_GROUPS.built.includes(previous.previousStatus) && !previous.versionName) throw new Error('restore: the saved Hosting version is missing');
  // A restore claim blocks purge before either mode changes an external service.
  // A failed restore keeps its claim so the same restore can finish safely.
  await ctx.deps.db.runTransaction(async (tx) => {
    const [app, tomb] = await Promise.all([tx.get(appRef(ctx)), tx.get(tombRef(ctx))]);
    if (tomb.exists || app.data()?.status !== 'archived') throw new Error('restore: purge has started or the application changed');
    if (!(toMillis(app.data().purgeAfter) > ctx.deps.now()) && !app.data().archive?.restoring) throw new Error('restore: the recovery window has ended');
    tx.update(appRef(ctx), { archive: { ...app.data().archive, restoring: true } });
  });
  await writeRun(ctx, 'restore', 'running');
  if (ctx.resources.site && previous.versionName) {
    const p = await project(ctx);
    if (!p || p.state !== 'ACTIVE') throw new Error('restore: the project is not active');
    const release = await latestRelease(ctx);
    if (release?.type === 'SITE_DISABLE' || release?.version?.name !== previous.versionName) {
      await google(ctx, 'restore Hosting', `${releasesUrl(ctx)}?versionName=${encode(previous.versionName)}`, { method: 'POST', json: {} });
    }
    const live = await latestRelease(ctx);
    if (live?.type === 'SITE_DISABLE' || live?.version?.name !== previous.versionName) throw new Error('restore: Hosting did not restore the saved version');
  }
  await ctx.deps.db.runTransaction(async (tx) => {
    const [snap, tomb] = await Promise.all([tx.get(appRef(ctx)), tx.get(tombRef(ctx))]);
    const data = snap.data();
    if (tomb.exists) throw new Error('restore: purge has started');
    if (data?.status !== 'archived' || !data.archive?.restoring) throw new Error('restore: the application changed');
    const at = instant(ctx.deps);
    tx.update(appRef(ctx), {
      status: previous.previousStatus, archivedAt: null, purgeAfter: null, archive: null,
      updatedAt: at, updatedBy: 'decommission', history: [...(data.history || []), historyEntry(previous.previousStatus, at, 'decommission', 'Restored the site')],
    });
    tx.set(buildRef(ctx), { decommission: runRecord(ctx, 'restore', 'done') }, { merge: true });
  });
}

async function cancelRestore(ctx) {
  await ctx.deps.db.runTransaction(async (tx) => {
    const [snap, tomb] = await Promise.all([tx.get(appRef(ctx)), tx.get(tombRef(ctx))]);
    const app = snap.data();
    if (tomb.exists) throw new Error('cancel-restore: purge has started');
    if (app?.status !== 'archived') throw new Error('cancel-restore: the application is not archived');
    if (!app.archive?.restoring) return;
    tx.update(appRef(ctx), { archive: { ...app.archive, restoring: false }, updatedAt: instant(ctx.deps), updatedBy: 'decommission' });
    tx.set(buildRef(ctx), { decommission: runRecord(ctx, 'cancel-restore', 'done') }, { merge: true });
  });
}

async function ticketAccess(ctx) {
  if (ctx.ticketAccess) return ctx.ticketAccess;
  const choice = ctx.resources.ticketProvider || reviewedAnswers(ctx.app || {}).tickets?.choice;
  if (!PROVIDERS.includes(choice)) return null;
  // The deployed copy owns the installed webhook; a console reconnect may
  // already hold a different account while a failed build waits for retry.
  // A live Stripe site's endpoint is on CCM's platform account: Stripe refuses
  // webhook endpoint calls made with a Connect OAuth token (see provision-client).
  const token = choice === 'stripe' && !ctx.build?.testMode
    ? await ctx.deps.consoleSecrets.readSecret('CONSOLE_STRIPE_SECRET_KEY')
    : await ctx.deps.clientSecrets(ctx.resources.projectId).readSecret('TICKETING_API_TOKEN')
      || await ctx.deps.consoleSecrets.readSecret(connectionSecretId(ctx.appId, choice));
  if (!token) {
    // A build that never reached tickets cannot have registered a webhook.
    if (ctx.build.stripeEndpointId || ctx.build.steps?.some((s) => ['tickets', 'seed'].includes(s.id) && s.state === 'done')) throw new Error('ticket-webhooks: the account token is missing');
    if (ctx.resources.ticketWebhookIds?.length) throw new Error('ticket-webhooks: cannot verify the deleted endpoints without an account token');
    return null;
  }
  let org = null;
  if (choice === 'eventbrite' && ctx.app) {
    let installed;
    try { installed = JSON.parse(ctx.build.ticketsKey || 'null'); } catch { throw new Error('ticket-webhooks: installed ticket identity is not valid'); }
    org = installed?.[0] === 'eventbrite' ? installed[4] : null;
    if (!org) {
      const accounts = (await ctx.deps.db.collection(ACCOUNT_COLLECTION).doc(ctx.appId).get()).data() || {};
      org = accounts.eventbrite?.eventOrganizationId;
    }
    if (!org) throw new Error('ticket-webhooks: Eventbrite organization is missing');
  }
  ctx.ticketAccess = { choice, token, org };
  return ctx.ticketAccess;
}

async function ticketHooks(ctx) {
  const access = await ticketAccess(ctx);
  if (!access) return [];
  const { choice, token, org } = access;
  const headers = { Authorization: `Bearer ${token}` };
  const target = callback(ctx, 'ticketingWebhook');
  const matching = (url) => {
    try {
      const u = new URL(url);
      u.searchParams.delete('token');
      return u.toString() === target;
    } catch { return false; }
  };
  // A tombstone retains endpoint ids, never tokens, account ids or an
  // Eventbrite URL's secret query. Direct reads need no organization id.
  if (!ctx.app) {
    const hooks = [];
    for (const id of ctx.resources.ticketWebhookIds || []) {
      const url = choice === 'stripe' ? `${STRIPE}/webhook_endpoints/${encode(id)}` : `${EVENTBRITE}/webhooks/${encode(id)}/`;
      const hook = await call(ctx, 'ticket-webhooks: verify endpoint', url, { headers, allow: [404] });
      if (hook) hooks.push(hook);
    }
    return hooks;
  }
  if (choice === 'stripe') {
    const found = [];
    let after = '';
    for (;;) {
      const query = new URLSearchParams({ limit: '100', ...(after ? { starting_after: after } : {}) });
      const page = await call(ctx, 'ticket-webhooks: list Stripe', `${STRIPE}/webhook_endpoints?${query}`, { headers });
      found.push(...(page.data || []));
      if (!page.has_more) return found.filter((h) => matching(h.url));
      const next = page.data?.at(-1)?.id;
      if (!next || next === after) throw new Error('ticket-webhooks: invalid Stripe page');
      after = next;
    }
  }
  const found = [];
  let continuation = '';
  const seen = new Set();
  for (;;) {
    const query = continuation ? `?${new URLSearchParams({ continuation })}` : '';
    const page = await call(ctx, 'ticket-webhooks: list Eventbrite', `${EVENTBRITE}/organizations/${encode(org)}/webhooks/${query}`, { headers });
    found.push(...(page.webhooks || []));
    if (!page.pagination?.has_more_items) return found.filter((h) => matching(h.endpoint_url));
    const next = page.pagination.continuation;
    if (!next || seen.has(next)) throw new Error('ticket-webhooks: invalid Eventbrite page');
    seen.add(next);
    continuation = next;
  }
}

async function ticketWebhooks(ctx) {
  const hooks = await ticketHooks(ctx);
  const choice = ctx.ticketAccess?.choice || reviewedAnswers(ctx.app || {}).tickets?.choice || 'none';
  ctx.resources.ticketProvider = choice;
  ctx.resources.ticketWebhookIds = [...new Set([...(ctx.resources.ticketWebhookIds || []), ...hooks.map((h) => String(h.id))])];
  await saveResources(ctx);
  for (const hook of hooks) {
    const url = choice === 'stripe' ? `${STRIPE}/webhook_endpoints/${encode(hook.id)}` : `${EVENTBRITE}/webhooks/${encode(hook.id)}/`;
    await call(ctx, 'ticket-webhooks: delete', url, { method: 'DELETE', headers: { Authorization: `Bearer ${ctx.ticketAccess.token}` }, allow: [404] });
  }
  if ((await ticketHooks(ctx)).length) throw new Error('ticket-webhooks: a webhook remains');
}

async function mail(ctx) {
  const r = ctx.resources;
  if (!r.postmarkServerId && !r.postmarkDomainId) ctx.deps.log.log('mail: skipped; no build ownership proof');
  if (r.postmarkServerId) {
    const server = (await postmarkList(ctx, '/servers', 'Servers')).find((s) => String(s.ID) === String(r.postmarkServerId));
    if (server) {
      if (server.Name !== r.environment) throw new Error('mail: server belongs to another site');
      const token = server.ApiTokens?.[0];
      if (!token) throw new Error('mail: server token is missing');
      for (const stream of ['outbound', 'announcements']) {
        const path = `/webhooks?MessageStream=${stream}`;
        const ours = (hook) => hook.Url === callback(ctx, 'emailDeliveryWebhook');
        for (const hook of (await postmark(ctx, path, {}, token)).Webhooks || []) {
          if (ours(hook)) await postmark(ctx, `/webhooks/${encode(hook.ID)}`, { method: 'DELETE', allow: [404] }, token);
        }
        if (((await postmark(ctx, path, {}, token)).Webhooks || []).some(ours)) throw new Error('mail: a webhook remains');
      }
      try {
        await postmark(ctx, `/servers/${encode(r.postmarkServerId)}`, { method: 'DELETE', allow: [404] });
        if ((await postmarkList(ctx, '/servers', 'Servers')).some((s) => String(s.ID) === String(r.postmarkServerId))) throw new Error('mail: server remains');
      } catch (err) {
        // Postmark refuses API server deletion until its support enables it.
        // Its webhooks are gone, so continue; verify still lists the server.
        if (err.status !== 422) throw err;
        ctx.deps.log.log(`mail: Postmark refused to delete server ${r.postmarkServerId} (${err.message}); delete it in Postmark`);
      }
    }
  }
  if (r.postmarkDomainId) {
    const path = `/domains/${encode(r.postmarkDomainId)}`;
    const domain = (await postmarkList(ctx, '/domains', 'Domains')).find((d) => String(d.ID) === String(r.postmarkDomainId));
    if (domain) {
      if (hostName(domain.Name) !== r.domain) throw new Error('mail: sender domain belongs to another site');
      await postmark(ctx, path, { method: 'DELETE', allow: [404] });
      if ((await postmarkList(ctx, '/domains', 'Domains')).some((d) => String(d.ID) === String(r.postmarkDomainId))) throw new Error('mail: sender domain remains');
    }
  }
}

async function secretExists(ctx, projectId, id) {
  return Boolean(await google(ctx, 'secret metadata', `${SECRETS}/projects/${projectId}/secrets/${encode(id)}`, { allow: [404] }));
}

async function consoleSecrets(ctx) {
  for (const provider of PROVIDERS) {
    const id = connectionSecretId(ctx.appId, provider);
    if (await secretExists(ctx, ctx.deps.env.CONSOLE_PROJECT_ID, id)) {
      await deleteStoredConnection({ secrets: ctx.deps.consoleSecrets }, ctx.appId, provider);
    }
    if (await secretExists(ctx, ctx.deps.env.CONSOLE_PROJECT_ID, id)) throw new Error('console-secrets: a secret remains');
  }
}

async function buckets(ctx) {
  for (const bucket of ctx.resources.buckets) {
    const base = `${STORAGE}/b/${encode(bucket)}`;
    const item = await google(ctx, 'bucket', base, { allow: [404] });
    if (!item) continue;
    const p = await project(ctx);
    if (!p || String(item.projectNumber) !== p.name.split('/').pop()) throw new Error('buckets: bucket ownership does not match the client project');
    const objects = await pages(ctx, 'bucket objects', `${base}/o?versions=true`, 'items');
    for (const object of objects) {
      const query = new URLSearchParams({ generation: object.generation, ifGenerationMatch: object.generation });
      await google(ctx, 'delete object', `${base}/o/${encode(object.name)}?${query}`, { method: 'DELETE', allow: [404] });
    }
    if ((await pages(ctx, 'verify empty bucket', `${base}/o?versions=true`, 'items')).length) throw new Error('buckets: objects remain');
    await google(ctx, 'delete bucket', base, { method: 'DELETE', allow: [404] });
    if (await google(ctx, 'verify deleted bucket', base, { allow: [404] })) throw new Error('buckets: bucket remains');
  }
}

async function database(ctx) {
  const base = `${FIRESTORE}/projects/${ctx.resources.projectId}/databases/(default)`;
  const data = await google(ctx, 'Firestore database', base, { allow: [404] });
  if (!data) return;
  // Delete protection is deliberate. Report it, rather than silently weakening it.
  if (data.deleteProtectionState === 'DELETE_PROTECTION_ENABLED') throw new Error('database: turn off database delete protection before purge');
  const op = await google(ctx, 'delete Firestore database', base, { method: 'DELETE' });
  await finish(ctx, 'delete Firestore database', FIRESTORE, op);
  if (await google(ctx, 'verify deleted database', base, { allow: [404] })) throw new Error('database: database remains');
}

// Hosting keeps a deleted custom domain for 30 days with a deleteTime, and
// project deletion removes it. Only a domain without one is still live.
async function liveDomain(ctx, label, url) {
  const domain = await google(ctx, label, url, { allow: [404] });
  return domain && !domain.deleteTime ? domain : null;
}

async function customDomain(ctx) {
  if (!ctx.resources.site) return;
  const url = `${siteUrl(ctx)}/customDomains/${encode(ctx.resources.domain)}`;
  if (!await liveDomain(ctx, 'custom domain', url)) return;
  await finish(ctx, 'delete custom domain', HOSTING, await google(ctx, 'delete custom domain', url, { method: 'DELETE' }));
  if (await liveDomain(ctx, 'verify custom domain', url)) throw new Error('custom-domain: domain remains');
}

async function dnsRecords(ctx) {
  const { env } = ctx.deps;
  const base = `https://api.cloudflare.com/client/v4/zones/${env.CLOUDFLARE_ZONE_ID}/dns_records`;
  const headers = { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` };
  const found = [];
  const all = [];
  const names = [...new Set(ctx.resources.dnsRecords.map((r) => hostName(r.name)))].filter(Boolean);
  for (const name of names) {
    if (name !== ctx.resources.domain && !name.endsWith(`.${ctx.resources.domain}`)) throw new Error('DNS: unsafe verification name');
    for (let page = 1; ; page += 1) {
      const query = new URLSearchParams({ name, per_page: '100', page: String(page) });
      const data = await call(ctx, 'DNS: list', `${base}?${query}`, { headers });
      if (data.success === false) throw new Error('DNS: list failed');
      for (const record of data.result || []) {
        if (hostName(record.name) !== name) continue;
        all.push(record);
        if (ctx.resources.dnsRecords.some((r) => (!r.id || r.id === record.id) && hostName(r.name) === name && r.type === record.type && dnsValue(r.content) === dnsValue(record.content))) found.push(record);
      }
      if (page >= (data.result_info?.total_pages || 1)) break;
    }
  }
  return { found, all, base, headers };
}

async function dns(ctx) {
  if (!ctx.resources.dnsRecords.length) ctx.deps.log.log('dns: skipped; no manifest records with build ownership proof');
  const { found, base, headers } = await dnsRecords(ctx);
  for (const record of found) {
    const data = await call(ctx, 'DNS: delete', `${base}/${encode(record.id)}`, { method: 'DELETE', headers });
    if (data.success === false) throw new Error('DNS: delete failed');
  }
  if ((await dnsRecords(ctx)).found.length) throw new Error('DNS: records remain');
}

async function environment(ctx) {
  if (!ctx.resources.environment || (!ctx.projectOwned && ctx.resources.githubEnvironment !== ctx.resources.environment)) {
    ctx.deps.log.log('environment: skipped; no build ownership proof');
    return;
  }
  if (!await github(ctx, '', { allow: [404] })) return;
  const variables = [];
  for (let page = 1; ; page += 1) {
    const body = await github(ctx, `/variables?per_page=30&page=${page}`);
    variables.push(...(body.variables || []));
    if ((body.variables || []).length < 30) break;
  }
  const owner = variables.find((v) => v.name === 'EVENTRUNNER_REQUEST_ID')?.value;
  if (owner !== ctx.appId && !(variables.length === 0 && ctx.build.environmentClaim === ctx.resources.environment)) throw new Error('environment: ownership does not match this application');
  await github(ctx, '', { method: 'DELETE', allow: [404] });
  if (await github(ctx, '', { allow: [404] })) throw new Error('environment: environment remains');
}

async function deleteProject(ctx) {
  const p = await project(ctx);
  if (!p || p.state === 'DELETE_REQUESTED') return;
  if (p.state !== 'ACTIVE') throw new Error(`project: unexpected state ${p.state}`);
  // Immediate purge must also stop serving, even if archive was skipped.
  if (ctx.resources.site && (await latestRelease(ctx))?.type !== 'SITE_DISABLE') {
    await google(ctx, 'disable Hosting', releasesUrl(ctx), { method: 'POST', json: { type: 'SITE_DISABLE' } });
    if ((await latestRelease(ctx))?.type !== 'SITE_DISABLE') throw new Error('project: Hosting is still serving');
  }
  await finish(ctx, 'delete project', CRM, await google(ctx, 'delete project', `${CRM}/projects/${ctx.resources.projectId}`, { method: 'DELETE' }));
  ctx.projectDeletionRequested = true;
  const after = await project(ctx);
  if (after && after.state !== 'DELETE_REQUESTED') throw new Error('project: deletion was not requested');
}

async function consoleRecords(ctx) {
  const { db } = ctx.deps;
  // Remove only records with this exact application id. Legal acceptances and
  // organization memberships have separate retention rules.
  for (const collection of ['signup_links', STATE_COLLECTION]) {
    for (;;) {
      const snap = await db.collection(collection).where('appId', '==', ctx.appId).limit(400).get();
      if (!snap.docs.length) break;
      const batch = db.batch();
      for (const doc of snap.docs) batch.delete(doc.ref);
      await batch.commit();
      if ((await db.collection(collection).where('appId', '==', ctx.appId).limit(1).get()).docs.some((d) => snap.docs.some((s) => s.id === d.id))) throw new Error('console-records: records remain');
    }
  }
  await db.runTransaction(async (tx) => {
    const refs = [appRef(ctx), buildRef(ctx), db.collection(ACCOUNT_COLLECTION).doc(ctx.appId), db.collection(DELETION_COLLECTION).doc(ctx.appId)];
    const snaps = await Promise.all(refs.map((r) => tx.get(r)));
    const held = await tx.get(db.collection('site_names').where('appId', '==', ctx.appId));
    for (let i = 0; i < refs.length; i += 1) if (snaps[i].exists) tx.delete(refs[i]);
    // Built names stay reserved: Google never reuses a project id. Remove the
    // orgId, which is not needed to keep that reservation.
    for (const doc of held.docs) {
      if (ctx.resources.projectId) tx.set(doc.ref, { appId: ctx.appId, deleted: true });
      else tx.delete(doc.ref);
    }
    tx.update(tombRef(ctx), { stepsCompleted: [...ctx.completed, 'console-records'], purgedAt: instant(ctx.deps), updatedAt: instant(ctx.deps) });
  });
}

const STEPS = Object.freeze([
  { id: 'ticket-webhooks', run: ticketWebhooks },
  { id: 'mail', run: mail },
  { id: 'console-secrets', run: consoleSecrets },
  { id: 'buckets', run: buckets },
  { id: 'database', run: database },
  { id: 'custom-domain', run: customDomain },
  { id: 'dns', run: dns },
  { id: 'environment', run: environment },
  { id: 'project', run: deleteProject },
  { id: 'console-records', run: consoleRecords },
]);

/** Unknown is a failure. A deleted project's children follow its lifecycle. */
async function inspect(ctx) {
  const checks = {};
  async function check(id, read) {
    try { checks[id] = await read(); }
    catch (err) { checks[id] = { state: 'unknown', error: err.message }; }
  }
  await check('project', async () => {
    const p = await project(ctx);
    if (ctx.projectReadPending) return { state: 'pending-project-deletion', lifecycle: 'DELETE_REQUESTED', evidence: 'completed-delete' };
    return { state: p ? 'present' : 'absent', lifecycle: p?.state || null };
  });
  const r = ctx.resources;
  const pendingProject = checks.project.state === 'absent' || checks.project.lifecycle === 'DELETE_REQUESTED';
  const skipped = { state: 'skipped', reason: 'no-build-ownership-proof' };
  async function projectCheck(id, read) {
    await check(id, () => pendingProject ? { state: 'pending-project-deletion' } : read());
  }
  if (r.projectId) {
    await check('ticket-webhooks', async () => ctx.tomb && ctx.completed.includes('ticket-webhooks')
      ? { state: 'absent', evidence: 'completed-step' }
      : { state: (await ticketHooks(ctx)).length ? 'present' : 'absent' });
    for (const name of r.buckets) await projectCheck(`bucket:${name}`, async () => ({ state: await google(ctx, 'verify bucket', `${STORAGE}/b/${encode(name)}`, { allow: [404] }) ? 'present' : 'absent' }));
    // Listing catches buckets created after the saved inventory.
    await projectCheck('buckets', async () => ({ state: (await pages(ctx, 'verify buckets', `${STORAGE}/b?project=${encode(r.projectId)}`, 'items')).length ? 'present' : 'absent' }));
    await projectCheck('database', async () => ({ state: await google(ctx, 'verify database', `${FIRESTORE}/projects/${r.projectId}/databases/(default)`, { allow: [404] }) ? 'present' : 'absent' }));
    await projectCheck('hosting', async () => {
      const release = await latestRelease(ctx);
      return { state: release && release.type !== 'SITE_DISABLE' ? 'present' : 'absent', serving: Boolean(release && release.type !== 'SITE_DISABLE') };
    });
    await projectCheck('custom-domain', async () => ({ state: r.site && await liveDomain(ctx, 'verify custom domain', `${siteUrl(ctx)}/customDomains/${encode(r.domain)}`) ? 'present' : 'absent' }));
    // Project secrets disappear with Google's project deletion. This reports
    // their lifecycle rather than claiming immediate physical destruction.
    await projectCheck('client-secrets', async () => {
      const secrets = await pages(ctx, 'verify client secrets', `${SECRETS}/projects/${r.projectId}/secrets`, 'secrets');
      return { state: secrets.length ? 'present' : 'absent' };
    });
  }
  await check('dns', async () => r.dnsRecords.length ? { state: (await dnsRecords(ctx)).found.length ? 'present' : 'absent' } : skipped);
  await check('environment', async () => r.environment && (ctx.projectOwned || r.githubEnvironment === r.environment)
    ? { state: await github(ctx, '', { allow: [404] }) ? 'present' : 'absent' } : skipped);
  for (const [key, path, field] of [['postmarkServerId', 'servers', 'Servers'], ['postmarkDomainId', 'domains', 'Domains']]) {
    await check(`mail:${path}`, async () => r[key]
      ? { state: (await postmarkList(ctx, `/${path}`, field)).some((item) => String(item.ID) === String(r[key])) ? 'present' : 'absent' }
      : skipped);
  }
  for (const provider of PROVIDERS) await check(`console-secret:${provider}`, async () => ({ state: await secretExists(ctx, ctx.deps.env.CONSOLE_PROJECT_ID, connectionSecretId(ctx.appId, provider)) ? 'present' : 'absent' }));
  for (const collection of ['applications', BUILD_COLLECTION, ACCOUNT_COLLECTION, DELETION_COLLECTION]) await check(`console:${collection}`, async () => ({ state: (await ctx.deps.db.collection(collection).doc(ctx.appId).get()).exists ? 'present' : 'absent' }));
  for (const collection of ['signup_links', STATE_COLLECTION]) await check(`console:${collection}`, async () => ({ state: (await ctx.deps.db.collection(collection).where('appId', '==', ctx.appId).limit(1).get()).docs.length ? 'present' : 'absent' }));
  const leftovers = Object.entries(checks).filter(([id, value]) => value.state === 'unknown' || (value.state === 'present' && !(id === 'project' && value.lifecycle === 'DELETE_REQUESTED'))).map(([id]) => id);
  return { appId: ctx.appId, checks, leftovers, ok: leftovers.length === 0 };
}

function checkConfirmation(ctx, app, confirmSite) {
  const name = app ? siteNameOf(app) : ctx.resources.domain?.replace(/\.eventrunner\.org$/, '');
  if (!name || confirmSite !== name) throw new Error('purge: --now requires --confirm-site with the exact application site name as confirmation');
}

function checkPurge(ctx, app, build, now, confirmSite) {
  if (!app) throw new Error('purge: the application is missing');
  if (now) checkConfirmation(ctx, app, confirmSite);
  checkIdle(ctx, app, build);
  if (app.archive?.restoring && !now) throw new Error('purge: finish or cancel the restore before deleting the site');
  if (!now && !(app.status === 'archived' && Number.isFinite(toMillis(app.purgeAfter)) && toMillis(app.purgeAfter) <= ctx.deps.now())) throw new Error('purge: archive the site and wait 7 days, or use --now');
}

async function purge(ctx, now, confirmSite) {
  if (now) checkConfirmation(ctx, ctx.app, confirmSite);
  if (!ctx.tomb) {
    checkPurge(ctx, ctx.app, ctx.build, now, confirmSite);
    // Discover with reads only. An ownership or legacy inventory failure must
    // leave the recovery option available and the build record repairable.
    if (ctx.resources.projectId) await discover(ctx);
    // One transaction checks the window and makes purge irreversible to restore.
    await ctx.deps.db.runTransaction(async (tx) => {
      const [snap, buildSnap, tomb] = await Promise.all([tx.get(appRef(ctx)), tx.get(buildRef(ctx)), tx.get(tombRef(ctx))]);
      const app = snap.data();
      if (tomb.exists) throw new Error('purge: another run has started');
      checkPurge(ctx, app, buildSnap.data() || {}, now, confirmSite);
      ctx.tomb = {
        siteAddress: ctx.resources.domain || null, projectId: ctx.resources.projectId || null,
        createdAt: app.createdAt || null, archivedAt: app.archivedAt || null, purgeAfter: app.purgeAfter || null,
        purgeStartedAt: instant(ctx.deps), updatedAt: instant(ctx.deps), purgedAt: null,
        stepsCompleted: [], resources: ctx.resources,
      };
      tx.create(tombRef(ctx), ctx.tomb);
      // Stop new build retries and connection changes even for --now. A site
      // that was not archived yet gets the same record an archive writes, due
      // at once, so a failed run shows when it started and from what status.
      const at = instant(ctx.deps);
      const archiving = app.status === 'archived' ? {} : {
        archivedAt: at, purgeAfter: at, updatedAt: at, updatedBy: 'decommission',
        archive: { ...(app.archive || {}), previousStatus: app.status, pending: false },
        history: [...(app.history || []), historyEntry('archived', at, 'decommission')],
      };
      tx.update(appRef(ctx), {
        status: 'archived', ...archiving,
        ...(app.archive?.restoring ? { archive: { ...(archiving.archive || app.archive), restoring: false } } : {}),
      });
    });
  } else if (ctx.resources.projectId && !ctx.completed.includes('project')) await project(ctx);
  for (const step of STEPS) {
    if (ctx.completed.includes(step.id)) continue;
    if (!ctx.resources.projectId && ['ticket-webhooks', 'buckets', 'database', 'custom-domain', 'project'].includes(step.id)) continue;
    try {
      await writeRun(ctx, 'purge', 'running', { step: step.id });
      if (ctx.projectDeleting && ['buckets', 'database', 'custom-domain'].includes(step.id)) {
        ctx.deps.log.log(`${step.id}: pending-project-deletion`);
      } else await step.run(ctx);
      ctx.completed.push(step.id);
      if (step.id !== 'console-records') await tombRef(ctx).update({ stepsCompleted: ctx.completed, updatedAt: instant(ctx.deps) });
    } catch (err) {
      throw new Error(`${step.id}: ${err.message}`);
    }
  }
  const report = await inspect(ctx);
  ctx.deps.log.log(JSON.stringify(report));
  if (!report.ok) throw new Error(`verify: resources remain or cannot be checked: ${report.leftovers.join(', ')}`);
  if (!ctx.tomb.verifiedAt) await tombRef(ctx).update({ verifiedAt: instant(ctx.deps) });
}

async function decommission({ appId, mode, now = false, confirmSite = '', deps }) {
  let ctx;
  try {
    ctx = await load(appId, deps);
    if (mode === 'verify') {
      // Discover for reporting without writing either a build or tombstone.
      let discoveryError;
      if (ctx.resources.projectId && !ctx.tomb) {
        try { await discover(ctx); }
        catch (err) { discoveryError = err.message; }
      }
      const report = await inspect(ctx);
      if (discoveryError) {
        report.checks.discovery = { state: 'unknown', error: discoveryError };
        report.leftovers.push('discovery');
        report.ok = false;
      }
      deps.log.log(JSON.stringify(report));
      return report.ok ? 0 : 1;
    }
    if (mode === 'archive') await archive(ctx);
    else if (mode === 'restore') await restore(ctx);
    else if (mode === 'cancel-restore') await cancelRestore(ctx);
    else if (mode === 'purge') await purge(ctx, now, confirmSite);
    else throw new Error('setup: invalid mode');
    return 0;
  } catch (err) {
    deps.log.error(`decommission-client: ${err.message}`);
    // Do not recreate a console build after its final deletion.
    if (mode !== 'verify' && ctx && (await buildRef(ctx).get()).exists) await writeRun(ctx, mode, 'failed', { error: err.message });
    return 1;
  }
}

async function dueApplications(deps) {
  // Single-field query needs no new Firestore composite index.
  const snap = await deps.db.collection('applications').where('status', '==', 'archived').get();
  return snap.docs.filter((doc) => Number.isFinite(toMillis(doc.data().purgeAfter)) && toMillis(doc.data().purgeAfter) <= deps.now()).map((doc) => doc.id);
}

async function purgeDue({ deps, appId = '' }) {
  let code = 0;
  for (const id of await dueApplications(deps)) {
    if (appId && appId !== id) continue;
    code = Math.max(code, await decommission({ appId: id, mode: 'purge', deps }));
  }
  return code;
}

function parseArgs(argv) {
  const args = { appId: '', mode: '', now: false, list: false, confirmSite: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--application' && !args.appId) args.appId = argv[++i] || '';
    else if (['--archive', '--restore', '--cancel-restore', '--purge', '--purge-due', '--verify'].includes(arg) && !args.mode) args.mode = arg.slice(2);
    else if (arg === '--confirm-site' && !args.confirmSite) {
      args.confirmSite = argv[++i];
      if (!args.confirmSite || siteNameProblem(args.confirmSite)) return null;
    } else if (arg === '--now' && !args.now) args.now = true;
    else if (arg === '--list' && !args.list) args.list = true;
    else return null;
  }
  if (!args.mode || (args.mode !== 'purge-due' && !APP_ID_RE.test(args.appId)) || (args.appId && !APP_ID_RE.test(args.appId))) return null;
  if ((args.now && args.mode !== 'purge') || (args.list && args.mode !== 'purge-due')) return null;
  if (args.now !== Boolean(args.confirmSite)) return null;
  return args;
}

function realDeps(env) {
  const { applicationDefault, getApps, initializeApp } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const { createSecretStore } = require('../console/functions/src/secretStore.cjs');
  const credential = applicationDefault();
  const app = getApps().find((a) => a.name === env.CONSOLE_PROJECT_ID) || initializeApp({ credential, projectId: env.CONSOLE_PROJECT_ID }, env.CONSOLE_PROJECT_ID);
  const store = (projectId) => createSecretStore({ projectId, getAccessToken: () => credential.getAccessToken(), fetch: globalThis.fetch });
  return {
    env, db: getFirestore(app), consoleSecrets: store(env.CONSOLE_PROJECT_ID), clientSecrets: store,
    fetch: globalThis.fetch, getAccessToken: () => credential.getAccessToken(), now: Date.now, log: console,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

async function main(argv = process.argv.slice(2), env = process.env, makeDeps = realDeps) {
  const args = parseArgs(argv);
  if (!args) {
    console.error('Usage: decommission-client.cjs --application <id> --archive|--restore|--cancel-restore|--purge [--now --confirm-site <site>]|--verify; or --purge-due [--list]');
    return 2;
  }
  if (!env.CONSOLE_PROJECT_ID) throw new Error('setup: CONSOLE_PROJECT_ID is missing');
  const deps = makeDeps(env);
  if (args.list) { deps.log.log(JSON.stringify(await dueApplications(deps))); return 0; }
  if (args.mode === 'purge-due') return purgeDue({ deps, appId: args.appId });
  return decommission({ ...args, deps });
}

if (require.main === module) main().then((code) => process.exit(code)).catch((err) => {
  console.error(`decommission-client: ${err.message}`);
  process.exit(1);
});

module.exports = { DELETED_COLLECTION, RECOVERY_MS, STEPS, decommission, dueApplications, main, parseArgs, purgeDue };
