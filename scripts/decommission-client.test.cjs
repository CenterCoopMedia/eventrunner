'use strict';

const assert = require('node:assert/strict');
const { createHash, generateKeyPairSync } = require('node:crypto');
const test = require('node:test');
const { makeFakeDb, makeFakeSecrets } = require('../console/functions/src/fakes.cjs');
const { RECOVERY_MS, STEPS, decommission, dueApplications, main, parseArgs, purgeDue } = require('./decommission-client.cjs');

const NOW = Date.parse('2026-11-05T12:00:00Z');
const DOMAIN = 'show.eventrunner.org';
const PROJECT = 'er-show';
const BUCKET = `${PROJECT}.firebasestorage.app`;
const SITE = 'show-hosting';
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const ENV = {
  CONSOLE_PROJECT_ID: 'console-project', GITHUB_REPOSITORY: 'owner/repo', GITHUB_RUN_ID: '1',
  PROVISIONER_APP_ID: '7', PROVISIONER_INSTALLATION_ID: '8', PROVISIONER_APP_PRIVATE_KEY: privateKey,
  POSTMARK_ACCOUNT_TOKEN: 'account-fixture', CLOUDFLARE_API_TOKEN: 'cf-fixture', CLOUDFLARE_ZONE_ID: 'zone-fixture',
};
const VERSION = `sites/${SITE}/versions/v1`;
const TICKET_URL = `https://us-central1-${PROJECT}.cloudfunctions.net/ticketingWebhook`;
const MAIL_URL = `https://us-central1-${PROJECT}.cloudfunctions.net/emailDeliveryWebhook`;
const RESOURCES = {
  projectId: PROJECT, gcpFolder: 'folders/123456', region: 'us-central1', environment: 'show', domain: DOMAIN,
  site: SITE, buckets: [BUCKET], postmarkServerId: 10, postmarkDomainId: 20,
  githubEnvironment: 'show',
  dnsRecords: [
    { id: 'address', type: 'A', name: DOMAIN, content: '192.0.2.1' },
    { type: 'TXT', name: `_acme-challenge.${DOMAIN}`, content: 'cert-proof' },
    { type: 'TXT', name: `fixture._domainkey.${DOMAIN}`, content: 'mail-proof' },
    { type: 'CNAME', name: `pm-bounces.${DOMAIN}`, content: 'pm.mtasv.net' },
  ],
};
const answer = (body, status = 200) => new Response(JSON.stringify(body), { status });
const done = () => answer({ name: 'operations/delete', done: true });

function setup(options = {}) {
  const app = {
    orgId: 'o1', status: 'ready', createdAt: new Date(NOW - 1000), history: [],
    answers: { webAddress: { name: 'show' }, tickets: { choice: options.provider || 'stripe' } },
    connections: {}, ...options.app,
  };
  const db = makeFakeDb({
    'applications/a1': app,
    ...(!options.noBuild ? { 'console_builds/a1': { state: 'done', resources: RESOURCES, stripeEndpointId: 'we_own', stripeEndpointOwner: 'platform', environmentClaim: 'show', ...options.build } } : {}),
    'console_connections/a1': { eventbrite: { eventOrganizationId: 'org-fixture' } },
    'console_connection_states/s1': { appId: 'a1' },
    'console_connection_states/s2': { appId: 'other' },
    'signup_links/l1': { appId: 'a1', usedEmail: 'person@example.org' },
    'signup_links/l2': { appId: 'other' },
    'console_token_deletions/a1': { connected: [] },
    'site_names/show': { appId: 'a1', orgId: 'o1' },
    'agreement_acceptances/legal': { appId: 'a1' },
    'organizations/o1': { name: 'Keep this organization' },
    ...options.seed,
  });
  const secrets = makeFakeSecrets({ 'connection-stripe-a1': 'stripe-fixture', 'connection-eventbrite-a1': 'eventbrite-fixture', unrelated: 'keep', CONSOLE_STRIPE_SECRET_KEY: 'platform-fixture' });
  const clientSecrets = makeFakeSecrets({ TICKETING_API_TOKEN: 'client-fixture', EMAIL_PROVIDER_API_KEY: 'mail-fixture' });
  const state = {
    clock: NOW, project: { name: 'projects/123', projectId: PROJECT, parent: 'folders/123456', state: 'ACTIVE', labels: { 'eventrunner-request': createHash('sha256').update('a1').digest('hex').slice(0, 32) } },
    release: { type: 'DEPLOY', version: { name: VERSION } },
    site: true, database: true, customDomain: true, environment: true,
    buckets: new Map([[BUCKET, [{ name: 'folder/one ü.txt', generation: '1' }, { name: 'folder/one ü.txt', generation: '2' }]]]),
    dns: [
      ...RESOURCES.dnsRecords.map((r, i) => ({ id: `proof${i}`, ...r })),
      { id: 'other', type: 'A', name: 'other.eventrunner.org', content: '192.0.2.2' },
      { id: 'child', type: 'TXT', name: `unrelated.${DOMAIN}`, content: 'keep' },
      { id: 'other-proof', type: 'TXT', name: `_acme-challenge.${DOMAIN}`, content: 'not-our-proof' },
    ],
    server: { ID: 10, Name: 'show', ApiTokens: ['mail-fixture'] }, domain: { ID: 20, Name: DOMAIN },
    mailHooks: [{ ID: 1, Url: MAIL_URL, MessageStream: 'outbound' }, { ID: 2, Url: MAIL_URL, MessageStream: 'announcements' }],
    endpoints: [{ id: 'we_own', url: TICKET_URL }, { id: 'we_other', url: 'https://other.example.org/hook' }],
    ebHooks: [{ id: 'eb_own', endpoint_url: `${TICKET_URL}?token=never-log-this` }, { id: 'eb_other', endpoint_url: 'https://other.example.org/hook' }],
    variables: [{ name: 'EVENTRUNNER_REQUEST_ID', value: 'a1' }],
    ...options.state,
  };
  const calls = [];
  const logs = [];
  const failures = new Map();
  const deps = {
    env: ENV, db, consoleSecrets: secrets, clientSecrets: () => clientSecrets,
    now: () => state.clock, sleep: async () => {}, getAccessToken: async () => ({ access_token: 'google-fixture' }),
    log: { log: (line) => logs.push(line), error: (...args) => logs.push(args.join(' ')) },
    fetch: async (raw, init = {}) => {
      const url = new URL(raw);
      const p = decodeURIComponent(url.pathname);
      const method = init.method || 'GET';
      const body = init.body ? JSON.parse(init.body) : null;
      calls.push({ host: url.host, p, method, query: url.searchParams, body });
      const key = `${method} ${url.host}${p}`;
      if (failures.has(key)) return answer({}, failures.get(key));
      if (url.host === 'cloudresourcemanager.googleapis.com') {
        assert.equal(p, `/v3/projects/${PROJECT}`);
        if (method === 'DELETE') {
          state.project.state = 'DELETE_REQUESTED';
          if (options.lateBucket) state.buckets.set('late-bucket', []);
          return done();
        }
        return state.project ? answer(state.project) : answer({}, 404);
      }
      if (url.host === 'firebasehosting.googleapis.com') {
        assert.equal(init.headers['x-goog-user-project'], PROJECT);
        assert.ok(p.startsWith(`/v1beta1/projects/${PROJECT}/sites`) || p === `/v1beta1/sites/${SITE}/releases`);
        if (p.endsWith('/sites')) return answer({ sites: state.site ? [{ name: `projects/${PROJECT}/sites/${SITE}`, type: 'DEFAULT_SITE' }] : [] });
        if (p.endsWith('/releases')) {
          assert.equal(p, `/v1beta1/sites/${SITE}/releases`);
          if (method === 'POST') {
            state.release = body.type === 'SITE_DISABLE' ? { type: 'SITE_DISABLE' } : { type: 'DEPLOY', version: { name: url.searchParams.get('versionName') } };
            return answer(state.release);
          }
          return answer({ releases: state.release ? [state.release, ...(state.oldReleases || [])].slice(0, Number(url.searchParams.get('pageSize') || 100)) : [] });
        }
        if (p.endsWith(`/customDomains/${DOMAIN}`)) {
          // Hosting soft-deletes: the domain stays readable with a deleteTime.
          if (method === 'DELETE') { state.customDomain = 'deleted'; return done(); }
          if (state.customDomain === 'deleted') return answer({ deleteTime: '2026-11-06T00:00:00Z', purgeTime: '2026-12-06T00:00:00Z' });
          return state.customDomain ? answer({ requiredDnsUpdates: { desired: [] } }) : answer({}, 404);
        }
      }
      if (url.host === 'storage.googleapis.com') {
        if (p === '/storage/v1/b') return answer({ items: [...state.buckets.keys()].map((name) => ({ name })) });
        const encoded = url.pathname.slice('/storage/v1/b/'.length).split('/o');
        const bucket = decodeURIComponent(encoded[0]);
        if (!state.buckets.has(bucket)) return answer({}, 404);
        if (p.endsWith('/o')) {
          assert.equal(url.searchParams.get('versions'), 'true');
          const objects = state.buckets.get(bucket);
          if (options.paginate) {
            const offset = Number(url.searchParams.get('pageToken') || 0);
            return answer({ items: objects.slice(offset, offset + 1), ...(offset + 1 < objects.length ? { nextPageToken: String(offset + 1) } : {}) });
          }
          return answer({ items: objects });
        }
        if (encoded.length > 1) {
          assert.equal(method, 'DELETE');
          const name = decodeURIComponent(encoded[1].slice(1));
          assert.equal(url.searchParams.get('ifGenerationMatch'), url.searchParams.get('generation'));
          state.buckets.set(bucket, state.buckets.get(bucket).filter((o) => o.name !== name || o.generation !== url.searchParams.get('generation')));
          return answer({});
        }
        if (method === 'DELETE') { assert.equal(state.buckets.get(bucket).length, 0); state.buckets.delete(bucket); return answer({}); }
        return answer({ name: bucket, projectNumber: options.bucketProjectNumber || '123' });
      }
      if (url.host === 'firestore.googleapis.com') {
        assert.equal(p, `/v1/projects/${PROJECT}/databases/(default)`);
        if (method === 'DELETE') { state.database = false; return done(); }
        return state.database ? answer({ deleteProtectionState: options.protectedDatabase ? 'DELETE_PROTECTION_ENABLED' : 'DELETE_PROTECTION_DISABLED' }) : answer({}, 404);
      }
      if (url.host === 'secretmanager.googleapis.com') {
        const client = p.startsWith(`/v1/projects/${PROJECT}/`);
        const store = client ? clientSecrets : secrets;
        if (p.endsWith('/secrets')) return answer({ secrets: [...store.store.keys()].map((name) => ({ name })) });
        const id = p.split('/').pop();
        return store.store.has(id) ? answer({ name: p }) : answer({}, 404);
      }
      if (url.host === 'api.postmarkapp.com') {
        if (p === '/servers') return answer({ Servers: state.server ? [state.server] : [] });
        if (p === '/domains') return answer({ Domains: state.domain ? [state.domain] : [] });
        if (p === '/servers/10') {
          if (method === 'DELETE') { state.server = null; state.mailHooks = []; return answer({}); }
          return state.server ? answer(state.server) : answer({}, 404);
        }
        if (p === '/domains/20') {
          if (method === 'DELETE') { state.domain = null; return answer({}); }
          return state.domain ? answer(state.domain) : answer({}, 404);
        }
        if (p === '/webhooks') return answer({ Webhooks: state.mailHooks.filter((h) => h.MessageStream === url.searchParams.get('MessageStream')) });
        if (p.startsWith('/webhooks/') && method === 'DELETE') { state.mailHooks = state.mailHooks.filter((h) => String(h.ID) !== p.split('/').pop()); return answer({}); }
      }
      if (url.host === 'api.stripe.com') {
        if (p === '/v1/webhook_endpoints') {
          assert.equal(init.headers.Authorization, (options.build?.stripeEndpointOwner ?? 'platform') === 'platform' ? 'Bearer platform-fixture' : 'Bearer client-fixture', 'a platform-owned endpoint uses the platform key; an account-owned one the deployed token');
          const offset = url.searchParams.has('starting_after') ? state.endpoints.findIndex((h) => h.id === url.searchParams.get('starting_after')) + 1 : 0;
          const data = options.paginate ? state.endpoints.slice(offset, offset + 1) : state.endpoints;
          return answer({ data, has_more: options.paginate && offset + data.length < state.endpoints.length });
        }
        if (p.startsWith('/v1/webhook_endpoints/') && method === 'DELETE') { state.endpoints = state.endpoints.filter((e) => e.id !== p.split('/').pop()); return answer({}); }
        if (p.startsWith('/v1/webhook_endpoints/') && method === 'GET') {
          const hook = state.endpoints.find((h) => h.id === p.split('/').pop());
          return hook ? answer(hook) : answer({}, 404);
        }
      }
      if (url.host === 'www.eventbriteapi.com') {
        if (p === '/v3/organizations/org-fixture/webhooks/') return answer({ webhooks: state.ebHooks, pagination: { has_more_items: false } });
        if (p.startsWith('/v3/webhooks/') && method === 'DELETE') { state.ebHooks = state.ebHooks.filter((h) => h.id !== p.split('/').at(-2)); return answer({}); }
        if (p.startsWith('/v3/webhooks/') && method === 'GET') {
          const hook = state.ebHooks.find((h) => h.id === p.split('/').at(-2));
          return hook ? answer(hook) : answer({}, 404);
        }
      }
      if (url.host === 'api.cloudflare.com') {
        if (method === 'GET') return answer({ success: true, result: state.dns, result_info: { total_pages: 1 } }); // Deliberately ignores filter.
        if (method === 'DELETE') { state.dns = state.dns.filter((r) => r.id !== p.split('/').pop()); return answer({ success: true }); }
      }
      if (url.host === 'api.github.com') {
        if (p === '/app/installations/8/access_tokens') return answer({ token: 'installation-fixture', expires_at: new Date(NOW + 3600000).toISOString(), permissions: { administration: 'write', environments: 'write', actions: 'read' }, repository_selection: 'selected', repositories: [{ full_name: ENV.GITHUB_REPOSITORY }] });
        if (p.endsWith('/variables')) {
          const offset = (Number(url.searchParams.get('page') || 1) - 1) * 30;
          return answer({ variables: state.variables.slice(offset, offset + 30) });
        }
        if (p === '/repos/owner/repo/environments/show') {
          if (method === 'DELETE') { state.environment = false; return answer({}); }
          return state.environment ? answer({ name: 'show' }) : answer({}, 404);
        }
      }
      throw new Error(`Unexpected fake request: ${method} ${url.host}${p}`);
    },
  };
  const run = (mode, now = false, confirmSite = now ? 'show' : '') => decommission({ appId: 'a1', mode, now, confirmSite, deps });
  return { db, deps, state, calls, logs, failures, secrets, clientSecrets, run };
}

function archived(options = {}) {
  return setup({ ...options, app: { status: 'archived', archivedAt: new Date(NOW - RECOVERY_MS - 1000), purgeAfter: new Date(NOW - 1000), archive: { previousStatus: 'ready', versionName: VERSION, pending: false }, ...options.app }, state: { release: { type: 'SITE_DISABLE' }, ...options.state } });
}
const mutations = (s) => s.calls.filter((c) => c.method !== 'GET' && !c.p.endsWith('/access_tokens'));
const report = (s) => JSON.parse(s.logs.findLast((line) => line.startsWith('{')));

test('archive disables Hosting, preserves resources, and sets a seven-day deadline once', async () => {
  const s = setup();
  assert.equal(await s.run('archive'), 0);
  const app = s.db.read('applications/a1');
  assert.equal(app.status, 'archived');
  assert.equal(app.archivedAt.getTime(), NOW);
  assert.equal(app.purgeAfter.getTime(), NOW + RECOVERY_MS);
  assert.equal(app.archive.previousStatus, 'ready');
  assert.equal(app.archive.versionName, VERSION);
  assert.equal(app.history.at(-1).status, 'archived');
  assert.equal(s.state.release.type, 'SITE_DISABLE');
  assert.equal(s.db.read('console_builds/a1').decommission.state, 'done');
  assert.equal(mutations(s).length, 1);
  assert.equal(s.state.buckets.size, 1);
  assert.equal(s.secrets.store.size, 4);
  const writes = s.db.writes.length;
  s.state.clock += 1000;
  assert.equal(await s.run('archive'), 0);
  assert.equal(s.db.writes.length, writes);
  assert.equal(mutations(s).length, 1);
});

test('restore re-releases the saved version and restores the previous status', async () => {
  const s = setup({ app: { status: 'launched' } });
  assert.equal(await s.run('archive'), 0);
  assert.equal(await s.run('restore'), 0);
  assert.equal(s.db.read('applications/a1').status, 'launched');
  assert.equal(s.db.read('applications/a1').purgeAfter, null);
  assert.equal(s.state.release.type, 'DEPLOY');
  assert.equal(s.state.release.version.name, VERSION);
  const writes = s.db.writes.length;
  assert.equal(await s.run('restore'), 0);
  assert.equal(s.db.writes.length, writes);
});

test('archive accepts failed builds and closed requests whose build began, and refuses active builds', async () => {
  const failed = setup({ app: { status: 'building', buildStart: { state: 'failed', at: new Date(NOW) } }, build: { state: 'failed' } });
  assert.equal(await failed.run('archive'), 0);
  assert.equal(failed.db.read('applications/a1').archive.previousStatus, 'building');
  // A request closed after its build began may own a project. Console
  // retention keeps it, and archive is the way to its 7-day purge.
  const closed = setup({ app: { status: 'declined' }, build: { state: 'failed', startedAt: new Date(NOW) } });
  assert.equal(await closed.run('archive'), 0);
  assert.equal(closed.db.read('applications/a1').status, 'archived');
  assert.equal(closed.db.read('applications/a1').archive.previousStatus, 'declined');
  for (const status of ['approved', 'building']) {
    const s = setup({ app: { status }, build: { state: 'running', startedAt: new Date(NOW) } });
    assert.equal(await s.run('archive'), 1);
    assert.equal(mutations(s).length, 0);
  }
});

test('purge refuses the recovery window without --now, and restore refuses after it', async () => {
  const s = archived({ app: { purgeAfter: new Date(NOW + 1) } });
  assert.equal(await s.run('purge'), 1);
  assert.equal(mutations(s).length, 0);
  assert.equal(s.db.read('console_deleted_sites/a1'), undefined);
  s.state.clock += 1;
  assert.equal(await s.run('restore'), 1);
  assert.equal(mutations(s).length, 0);
});

test('purge verifies steps in order, preserves unrelated resources, and a second run makes no changes', async () => {
  const s = archived();
  assert.equal(await s.run('purge'), 0, s.logs.join('\n'));
  const tomb = s.db.read('console_deleted_sites/a1');
  assert.deepEqual(tomb.stepsCompleted, STEPS.map((step) => step.id));
  const paths = mutations(s).map((c) => c.p);
  const ordered = ['/v1/webhook_endpoints/we_own', '/servers/10', `/storage/v1/b/${BUCKET}`, `/v1/projects/${PROJECT}/databases/(default)`, `/v1beta1/projects/${PROJECT}/sites/${SITE}/customDomains/${DOMAIN}`, '/client/v4/zones/zone-fixture/dns_records/address', '/repos/owner/repo/environments/show', `/v3/projects/${PROJECT}`];
  let last = -1;
  for (const path of ordered) {
    const i = paths.indexOf(path);
    assert.ok(i > last, `${path} must follow the previous step`);
    last = i;
  }
  assert.equal(s.calls.filter((c) => c.host === 'storage.googleapis.com' && c.method === 'DELETE' && c.p.includes('/o/')).length, 2, 'both object generations removed');
  assert.deepEqual(s.state.endpoints.map((e) => e.id), ['we_other']);
  assert.deepEqual(s.state.dns.map((r) => r.id), ['other', 'child', 'other-proof']);
  assert.equal(s.secrets.store.has('unrelated'), true);
  for (const path of ['applications/a1', 'console_builds/a1', 'signup_links/l1', 'console_connections/a1', 'console_connection_states/s1', 'console_token_deletions/a1']) assert.equal(s.db.read(path), undefined, path);
  assert.ok(s.db.read('signup_links/l2'));
  assert.ok(s.db.read('console_connection_states/s2'));
  assert.ok(s.db.read('organizations/o1'));
  assert.ok(s.db.read('agreement_acceptances/legal'));
  assert.deepEqual(s.db.read('site_names/show'), { appId: 'a1', deleted: true });
  assert.equal(s.state.project.state, 'DELETE_REQUESTED');
  assert.ok(tomb.verifiedAt);
  const text = JSON.stringify(tomb);
  for (const forbidden of ['person@', 'org-fixture', 'client-fixture', 'stripe-fixture', 'mail-fixture', 'ApiTokens']) assert.ok(!text.includes(forbidden));
  const writeCount = s.db.writes.length;
  const mutationCount = mutations(s).length;
  assert.equal(await s.run('purge'), 0, s.logs.join('\n'));
  assert.equal(s.db.writes.length, writeCount);
  assert.equal(mutations(s).length, mutationCount);
});

test('immediate purge disables a live site and removes only its Eventbrite webhooks', async () => {
  const s = setup({ provider: 'eventbrite' });
  assert.equal(await s.run('purge', true), 0, s.logs.join('\n'));
  assert.deepEqual(s.state.ebHooks.map((h) => h.id), ['eb_other']);
  assert.equal(s.state.release.type, 'SITE_DISABLE');
  assert.ok(!s.logs.join('\n').includes('never-log-this'));
});

test('a partial purge resumes from verified checkpoints after a database failure', async () => {
  const s = archived();
  const key = `DELETE firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)`;
  s.failures.set(key, 500);
  assert.equal(await s.run('purge'), 1);
  assert.match(s.logs.at(-1), /database:.*HTTP 500/);
  assert.deepEqual(s.db.read('console_deleted_sites/a1').stepsCompleted, ['ticket-webhooks', 'mail', 'console-secrets', 'buckets']);
  const firstDeletes = mutations(s).length;
  s.failures.delete(key);
  assert.equal(await s.run('purge'), 0, s.logs.join('\n'));
  assert.equal(mutations(s).filter((c) => c.p === '/v1/webhook_endpoints/we_own').length, 1);
  assert.ok(mutations(s).length > firstDeletes);
});

test('purge --now on a live site records the archive, so a failed run shows when and why', async () => {
  const s = setup({ app: { status: 'ready' } });
  const key = `DELETE firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)`;
  s.failures.set(key, 500);
  assert.equal(await s.run('purge', true), 1);
  const app = s.db.read('applications/a1');
  assert.equal(app.status, 'archived');
  assert.ok(app.archivedAt, 'archivedAt is set');
  assert.ok(app.purgeAfter && app.purgeAfter.getTime() <= app.archivedAt.getTime(), 'purge is due at once');
  assert.deepEqual([app.history.at(-1).status, app.history.at(-1).by], ['archived', 'decommission']);
  assert.equal(app.archive.previousStatus, 'ready');
  // A manual retry with the same id resumes from the tombstone.
  s.failures.delete(key);
  assert.equal(await s.run('purge', true), 0, s.logs.join('\n'));
});

test('a refused Postmark server deletion is reported and the rest of the purge continues', async () => {
  const s = archived();
  s.failures.set('DELETE api.postmarkapp.com/servers/10', 422);
  const code = await s.run('purge');
  const log = s.logs.join('\n');
  assert.match(log, /mail: Postmark refused to delete server 10 \(Postmark: HTTP 422\); delete it in Postmark/);
  assert.equal(s.state.project.state, 'DELETE_REQUESTED');
  assert.ok(s.state.server, 'the server is left for the operator');
  assert.equal(code, 1, 'the leftover server keeps the run from passing');
  assert.match(s.logs.at(-1), /resources remain or cannot be checked: mail:servers$/);
});

test('draft without a project deletes console data and tokens without client or provider calls', async () => {
  const s = setup({ noBuild: true, app: { status: 'draft' } });
  assert.equal(await s.run('purge', true), 0, s.logs.join('\n'));
  assert.equal(s.db.read('applications/a1'), undefined);
  assert.equal(s.db.read('site_names/show'), undefined);
  assert.equal(s.db.read('console_deleted_sites/a1').projectId, null);
  assert.ok(s.calls.every((c) => c.host === 'secretmanager.googleapis.com' && c.p.includes('/console-project/')));
  assert.equal(s.state.project.state, 'ACTIVE');
});

test('draft archive and restore do not create a client project', async () => {
  const s = setup({ noBuild: true, app: { status: 'draft' } });
  assert.equal(await s.run('archive'), 0);
  assert.equal(await s.run('restore'), 0);
  assert.equal(s.db.read('applications/a1').status, 'draft');
  assert.equal(s.calls.length, 0);
});

test('verify reports live resources and uses no database or provider writes', async () => {
  const s = setup();
  assert.equal(await s.run('verify'), 1);
  assert.ok(report(s).leftovers.includes('database'));
  assert.ok(report(s).leftovers.includes('hosting'));
  assert.equal(s.db.writes.length, 0);
  assert.equal(mutations(s).length, 0);
});

test('verify treats denied reads as unknown and remains read-only', async () => {
  const s = setup();
  s.failures.set(`GET cloudresourcemanager.googleapis.com/v3/projects/${PROJECT}`, 403);
  assert.equal(await s.run('verify'), 1);
  assert.equal(report(s).checks.project.state, 'unknown');
  assert.equal(s.db.writes.length, 0);
  assert.equal(mutations(s).length, 0);
});

test('purge reports all project resources as pending when project deletion starts', async () => {
  const s = archived({ lateBucket: true });
  assert.equal(await s.run('purge'), 0, s.logs.join('\n'));
  for (const id of [`bucket:${BUCKET}`, 'buckets', 'database', 'hosting', 'custom-domain', 'client-secrets']) {
    assert.equal(report(s).checks[id].state, 'pending-project-deletion', id);
  }
  assert.ok(s.db.read('console_deleted_sites/a1').verifiedAt);
  assert.equal(s.db.read('console_builds/a1'), undefined);
});

test('purge refuses a different project owner or environment owner', async () => {
  const wrongProject = archived();
  wrongProject.state.project.labels = {};
  assert.equal(await wrongProject.run('purge'), 1);
  assert.equal(mutations(wrongProject).length, 0);
  const wrongEnv = archived({ state: { variables: [{ name: 'EVENTRUNNER_REQUEST_ID', value: 'other' }] } });
  assert.equal(await wrongEnv.run('purge'), 1);
  assert.equal(wrongEnv.state.environment, true);
  assert.equal(wrongEnv.state.project.state, 'ACTIVE');
});

test('purge respects database delete protection', async () => {
  const s = archived({ protectedDatabase: true });
  assert.equal(await s.run('purge'), 1);
  assert.ok(s.logs.some((line) => line.includes('delete protection')));
  assert.equal(s.state.database, true);
});

test('purge-due selects only expired archives and continues after a failed application', async () => {
  const s = archived({ seed: {
    'applications/not-due': { status: 'archived', purgeAfter: new Date(NOW + 1000) },
    'applications/bad': { status: 'archived', purgeAfter: new Date(NOW - 1), answers: {} },
    'applications/draft': { status: 'draft', purgeAfter: new Date(NOW - 1) },
  } });
  assert.deepEqual((await dueApplications(s.deps)).sort(), ['a1', 'bad']);
  assert.equal(await purgeDue({ deps: s.deps }), 1);
  assert.equal(s.db.read('applications/a1'), undefined);
  assert.ok(s.db.read('applications/not-due'));
  assert.ok(s.db.read('applications/draft'));
});

test('CLI validates ids, exactly one mode, and the --now restriction before constructing dependencies', async () => {
  for (const argv of [[], ['--purge'], ['--application', '../x', '--purge'], ['--application', 'a1', '--archive', '--now'], ['--application', 'a1', '--archive', '--purge'], ['--verify', '--application', 'a1', '--list']]) {
    assert.equal(parseArgs(argv), null);
    assert.equal(await main(argv, ENV, () => { throw new Error('must not construct dependencies'); }), 2);
  }
  assert.equal(parseArgs(['--application', 'a1', '--purge', '--now']), null);
  assert.equal(parseArgs(['--application', 'a1', '--purge', '--now', '--confirm-site', 'show']).confirmSite, 'show');
  const s = archived();
  assert.equal(await main(['--purge-due', '--list'], ENV, () => s.deps), 0);
  assert.deepEqual(JSON.parse(s.logs.at(-1)), ['a1']);
  assert.equal(s.db.writes.length, 0);
});

test('archive resumes after a lost disable response without losing its recovery version or extending the deadline', async () => {
  const s = setup();
  const fetch = s.deps.fetch;
  let loseResponse = true;
  s.deps.fetch = async (url, init) => {
    const response = await fetch(url, init);
    if (loseResponse && init.method === 'POST' && new URL(url).pathname.endsWith('/releases')) { loseResponse = false; throw new Error('lost response'); }
    return response;
  };
  assert.equal(await s.run('archive'), 1);
  assert.equal(s.state.release.type, 'SITE_DISABLE');
  assert.equal(s.db.read('applications/a1').archive.pending, true);
  s.state.clock += 60000;
  assert.equal(await s.run('archive'), 0);
  assert.equal(s.db.read('applications/a1').purgeAfter.getTime(), NOW + RECOVERY_MS);
  assert.equal(s.db.read('applications/a1').archive.versionName, VERSION);
  assert.equal(mutations(s).length, 1);
  assert.equal(await s.run('restore'), 0);
  assert.equal(s.state.release.version.name, VERSION);
});

test('a restore started in time blocks purge and can finish after a lost response and the deadline', async () => {
  const s = archived({ app: { purgeAfter: new Date(NOW + 1000) } });
  const fetch = s.deps.fetch;
  let loseResponse = true;
  s.deps.fetch = async (url, init) => {
    const response = await fetch(url, init);
    if (loseResponse && init.method === 'POST' && new URL(url).pathname.endsWith('/releases')) { loseResponse = false; throw new Error('lost response'); }
    return response;
  };
  assert.equal(await s.run('restore'), 1);
  assert.equal(s.db.read('applications/a1').archive.restoring, true);
  s.state.clock += 2000;
  const count = mutations(s).length;
  assert.equal(await s.run('purge'), 1);
  assert.equal(mutations(s).length, count);
  assert.equal(await s.run('restore'), 0);
  assert.equal(s.db.read('applications/a1').status, 'ready');
  assert.equal(mutations(s).length, count);
});

test('archive finds the last serving version when the latest release already disabled Hosting', async () => {
  const s = setup({ state: { release: { type: 'SITE_DISABLE' }, oldReleases: [{ type: 'DEPLOY', version: { name: VERSION } }] } });
  assert.equal(await s.run('archive'), 0);
  assert.equal(s.db.read('applications/a1').archive.versionName, VERSION);
  assert.equal(await s.run('restore'), 0);
  assert.equal(s.state.release.version.name, VERSION);
});

test('a tombstone created after restore loads the application still blocks its Hosting call', async () => {
  const s = archived({ app: { purgeAfter: new Date(NOW + 1000) } });
  const transaction = s.db.runTransaction;
  s.db.runTransaction = async (work) => {
    await s.db.collection('console_deleted_sites').doc('a1').set({ resources: RESOURCES, stepsCompleted: [] });
    return transaction(work);
  };
  assert.equal(await s.run('restore'), 1);
  assert.equal(s.state.release.type, 'SITE_DISABLE');
  assert.equal(mutations(s).length, 0);
});

test('purge follows paginated object and Stripe lists and finds an environment owner on page two', async () => {
  const variables = Array.from({ length: 30 }, (_, i) => ({ name: `SETTING_${i}`, value: 'fixture' }));
  const s = archived({ paginate: true, state: { variables: [...variables, { name: 'EVENTRUNNER_REQUEST_ID', value: 'a1' }] } });
  assert.equal(await s.run('purge'), 0, s.logs.join('\n'));
  assert.ok(s.calls.some((c) => c.query.get('pageToken') === '1'));
  assert.ok(s.calls.some((c) => c.query.get('starting_after') === 'we_own'));
  assert.ok(s.calls.some((c) => c.host === 'api.github.com' && c.query.get('page') === '2'));
  assert.deepEqual(s.state.endpoints.map((h) => h.id), ['we_other']);
});

test('purge refuses a saved bucket from another project', async () => {
  const s = archived({ bucketProjectNumber: '999' });
  assert.equal(await s.run('purge'), 1);
  assert.equal(s.state.buckets.size, 1);
  assert.ok(s.logs.some((line) => line.includes('bucket ownership')));
});

test('a failed secret deletion stops before data deletion and can be retried', async () => {
  const s = archived();
  s.secrets.failDelete = true;
  assert.equal(await s.run('purge'), 1);
  assert.equal(s.state.buckets.size, 1);
  assert.equal(s.state.database, true);
  assert.ok(s.db.read('applications/a1'));
  s.secrets.failDelete = false;
  assert.equal(await s.run('purge'), 0, s.logs.join('\n'));
});

test('verification discovers old Postmark resources without writing an inventory', async () => {
  const s = setup({ build: { resources: undefined }, app: { review: { settings: { projectId: PROJECT, region: 'us-central1', environment: 'show', gcpFolder: 'folders/123456' } } } });
  assert.equal(await s.run('verify'), 1);
  assert.equal(report(s).checks['mail:servers'].state, 'present');
  assert.equal(report(s).checks['mail:domains'].state, 'present');
  assert.equal(report(s).checks.discovery.state, 'unknown', 'unknown legacy certificate proof is reported');
  assert.equal(s.db.writes.length, 0);
  assert.equal(mutations(s).length, 0);
});

test('an unproven old certificate record stops purge before any provider deletion and leaves the inventory repairable', async () => {
  const s = archived({ build: { resources: { ...RESOURCES, dnsRecords: [], dnsInventoryComplete: false } } });
  assert.equal(await s.run('purge'), 1);
  assert.equal(mutations(s).length, 0);
  assert.equal(s.db.read('console_deleted_sites/a1'), undefined);
  assert.ok(s.logs.some((line) => line.includes('DNS inventory')));
  await s.db.collection('console_builds').doc('a1').update({ resources: { ...RESOURCES, dnsInventoryComplete: true } });
  assert.equal(await s.run('purge'), 0, s.logs.join('\n'));
});

test('scoped purge-due rechecks the selected application after waiting for its concurrency group', async () => {
  const s = archived();
  assert.equal(await purgeDue({ deps: s.deps, appId: 'other' }), 0);
  assert.equal(mutations(s).length, 0);
  await s.db.collection('applications').doc('a1').update({ purgeAfter: new Date(NOW + 1000) });
  assert.equal(await purgeDue({ deps: s.deps, appId: 'a1' }), 0);
  assert.equal(mutations(s).length, 0);
});

test('Eventbrite cleanup pairs the deployed token with its installed organization after a console reconnect', async () => {
  const s = archived({
    provider: 'eventbrite',
    build: { ticketsKey: JSON.stringify(['eventbrite', 'token-version', 'hook-version', {}, 'org-fixture']) },
    seed: { 'console_connections/a1': { eventbrite: { eventOrganizationId: 'new-org' } } },
  });
  assert.equal(await s.run('purge'), 0, s.logs.join('\n'));
  assert.deepEqual(s.state.ebHooks.map((h) => h.id), ['eb_other']);
  assert.ok(!s.calls.some((c) => c.p.includes('/organizations/new-org/')));
  assert.equal(await s.run('verify'), 0, s.logs.join('\n'));
  assert.equal(report(s).checks['ticket-webhooks'].state, 'absent');
  assert.ok(!JSON.stringify(s.db.read('console_deleted_sites/a1')).includes('org-fixture'));
});

test('tombstone verification uses the completed ticket checkpoint after tokens are deleted', async () => {
  const s = archived();
  assert.equal(await s.run('purge'), 0);
  s.clientSecrets.store.clear();
  s.deps.clientSecrets = () => { throw new Error('deleted project cannot read secrets'); };
  const count = s.calls.length;
  const writes = s.db.writes.length;
  assert.equal(await s.run('verify'), 0, s.logs.join('\n'));
  assert.equal(report(s).checks['ticket-webhooks'].state, 'absent');
  assert.equal(report(s).checks['ticket-webhooks'].evidence, 'completed-step');
  assert.ok(!s.calls.slice(count).some((c) => c.host === 'api.stripe.com'));
  assert.equal(s.db.writes.length, writes);
});

test('legacy Postmark verification records need builder ownership proof before deletion', async () => {
  const s = archived({
    build: { resources: { ...RESOURCES, dnsRecords: [], dnsInventoryComplete: false } },
    state: { domain: { ID: 20, Name: DOMAIN, DKIMHost: `fixture._domainkey.${DOMAIN}`, ReturnPathDomain: `pm-bounces.${DOMAIN}` } },
  });
  s.state.dns = s.state.dns.filter((r) => !r.name.startsWith('_acme-challenge.'));
  assert.equal(await s.run('purge'), 1);
  assert.equal(mutations(s).length, 0);
  assert.equal(s.state.server.ID, 10);
  assert.ok(s.state.dns.some((r) => r.id === 'proof2'));
});

test('malformed successful provider responses do not expose their text in logs or records', async () => {
  const s = archived();
  const fetch = s.deps.fetch;
  s.deps.fetch = (url, init) => new URL(url).host === 'api.postmarkapp.com'
    ? Promise.resolve(new Response('private-response-fixture', { status: 200 })) : fetch(url, init);
  assert.equal(await s.run('purge'), 1);
  assert.ok(s.logs.some((line) => line.includes('invalid JSON answer')));
  assert.ok(!s.logs.join('\n').includes('private-response-fixture'));
  assert.ok(!JSON.stringify(s.db.read('console_builds/a1')).includes('private-response-fixture'));
});

test('purge-now requires the exact application site name on every status and on tombstone retries', async () => {
  for (const status of ['draft', 'ready', 'launched', 'archived', 'declined', 'withdrawn', 'building-failed']) {
    for (const confirmation of ['', 'other', 'Show', DOMAIN]) {
      const s = archived({ app: { status } });
      assert.equal(await s.run('purge', true, confirmation), 1, `${status}: ${confirmation}`);
      assert.match(s.logs.at(-1), /confirmation/);
      assert.equal(mutations(s).length, 0);
      assert.equal(s.db.read('console_deleted_sites/a1'), undefined);
    }
  }
  for (const status of ['approved', 'building']) {
    const s = setup({ app: { status }, build: { state: 'running', startedAt: new Date(NOW) } });
    assert.equal(await s.run('purge', true), 1);
    assert.equal(mutations(s).length, 0);
  }
  const s = archived();
  assert.equal(await s.run('purge'), 0);
  assert.equal(await s.run('purge', true, 'other'), 1);
  assert.equal(await s.run('purge', true), 0);
});

test('confirmed purge-now accepts a closed unbuilt application without touching a same-name hand-built site', async () => {
  for (const [noBuild, resources] of [[true, undefined], [false, undefined], [false, {}]]) {
    const s = setup({
      noBuild,
      app: { status: 'withdrawn', answers: { webAddress: { name: 'nclocal' } } },
      build: { state: 'failed', resources, stripeEndpointId: null, environmentClaim: null },
      seed: { 'console_config/settings': { region: 'us-central1', gcpFolder: 'folders/123456' } },
      state: { project: null, server: { ID: 10, Name: 'nclocal' }, domain: { ID: 20, Name: 'nclocal.eventrunner.org' } },
    });
    const fetch = s.deps.fetch;
    s.state.dns = s.state.dns.map((record) => ({ ...record, name: record.name.replace(DOMAIN, 'nclocal.eventrunner.org') }));
    s.deps.fetch = (url, init) => new URL(url).host === 'cloudresourcemanager.googleapis.com'
      ? Promise.resolve(answer({}, 404)) : fetch(url, init);
    assert.equal(await s.run('verify'), 1, 'only console records remain in scope');
    assert.equal(report(s).checks['mail:servers'].state, 'skipped');
    assert.equal(s.db.writes.length, 0);
    assert.equal(await s.run('purge', true, 'nclocal'), 0, s.logs.join('\n'));
    assert.equal(s.state.server.ID, 10);
    assert.equal(s.state.domain.ID, 20);
    assert.equal(s.state.environment, true);
    assert.equal(s.state.dns.length, 7);
    assert.ok(!s.calls.some((c) => ['api.postmarkapp.com', 'api.cloudflare.com', 'api.github.com'].includes(c.host)));
    for (const id of ['mail:servers', 'mail:domains', 'dns', 'environment']) {
      assert.equal(report(s).checks[id].state, 'skipped', id);
    }
    assert.ok(s.logs.some((line) => /skip.*ownership proof/.test(line)));
    assert.ok(s.db.read('console_deleted_sites/a1').verifiedAt);
    assert.equal(await s.run('purge'), 0, 'a retry must not promote a derived name into proof');
    assert.ok(!s.calls.some((c) => ['api.postmarkapp.com', 'api.cloudflare.com', 'api.github.com'].includes(c.host)));
  }
});

test('empty resources derive the site identity and require a matching project owner before adoption', async () => {
  for (const wrongOwner of [false, true]) {
    const s = archived({
      build: { resources: {} },
      seed: { 'console_config/settings': { region: 'us-central1', gcpFolder: 'folders/123456' } },
      state: { dns: [] },
    });
    if (wrongOwner) s.state.project.labels = {};
    assert.equal(await s.run('purge'), wrongOwner ? 1 : 0, s.logs.join('\n'));
    if (wrongOwner) {
      assert.match(s.logs.at(-1), /ownership/);
      assert.equal(mutations(s).length, 0);
    } else {
      assert.equal(s.state.server, null);
      assert.equal(s.state.domain, null);
      assert.equal(s.db.read('console_deleted_sites/a1').resources.projectId, PROJECT);
    }
  }
});

test('saved mail and Environment identities remain usable after the project is gone without adopting replacements', async () => {
  const s = archived({ state: { project: null, server: { ID: 11, Name: 'show' }, domain: { ID: 21, Name: DOMAIN } } });
  assert.equal(await s.run('purge'), 0, s.logs.join('\n'));
  assert.equal(s.state.server.ID, 11);
  assert.equal(s.state.domain.ID, 21);
  assert.equal(s.state.environment, false);
  assert.ok(!mutations(s).some((c) => c.host === 'api.postmarkapp.com'));
});

test('a saved server id does not authorize a same-name sender domain or Environment', async () => {
  const s = archived({
    build: { environmentClaim: null, resources: { ...RESOURCES, postmarkDomainId: null, githubEnvironment: null, dnsRecords: [] } },
    state: { project: null },
  });
  assert.equal(await s.run('purge'), 0, s.logs.join('\n'));
  assert.equal(s.state.server, null);
  assert.equal(s.state.domain.ID, 20);
  assert.equal(s.state.environment, true);
  assert.equal(s.state.dns.length, 7);
  assert.ok(!s.calls.some((c) => c.host === 'api.postmarkapp.com' && c.p.startsWith('/domains')));
  assert.ok(!s.calls.some((c) => ['api.github.com', 'api.cloudflare.com'].includes(c.host)));
});

test('DNS deletion matches saved id, type, name and content and preserves other records at the same name', async () => {
  const s = archived();
  s.state.dns.push(
    { id: 'extra-a', type: 'A', name: DOMAIN, content: '192.0.2.99' },
    { id: 'extra-mx', type: 'MX', name: DOMAIN, content: 'mail.example.org' },
    { id: 'replacement', type: 'A', name: DOMAIN, content: '192.0.2.1' },
    { id: 'other-type', type: 'TXT', name: DOMAIN, content: '192.0.2.1' },
  );
  assert.equal(await s.run('purge'), 0, s.logs.join('\n'));
  assert.deepEqual(s.state.dns.map((r) => r.id), ['other', 'child', 'other-proof', 'extra-a', 'extra-mx', 'replacement', 'other-type']);
  assert.ok(!s.state.dns.some((r) => r.id === 'address'));
});

test('DNS deletion preserves a saved id when its name, type or content changed', async () => {
  for (const patch of [{ name: 'other.eventrunner.org' }, { type: 'TXT' }, { content: '192.0.2.99' }]) {
    const s = archived();
    Object.assign(s.state.dns.find((r) => r.id === 'address'), patch);
    assert.equal(await s.run('purge'), 0, s.logs.join('\n'));
    assert.ok(s.state.dns.some((r) => r.id === 'address'));
  }
});

test('deleted-project verification accepts child API 400 and 403 without requiring a ticket token', async () => {
  for (const projectState of ['DELETE_REQUESTED', 'gone']) {
    for (const status of [400, 403]) {
      const s = archived();
      const fetch = s.deps.fetch;
      s.deps.fetch = async (url, init) => {
        const u = new URL(url);
        const deleting = !s.state.project || s.state.project.state === 'DELETE_REQUESTED';
        if (deleting && /^(?:firebasehosting|storage|firestore|secretmanager)\.googleapis\.com$/.test(u.host) && !u.pathname.includes('/console-project/')) return answer({}, status);
        const response = await fetch(url, init);
        if (u.host === 'cloudresourcemanager.googleapis.com' && init.method === 'DELETE') {
          s.clientSecrets.store.clear();
          s.deps.clientSecrets = () => { throw new Error('deleted project cannot read secrets'); };
          if (projectState === 'gone') s.state.project = null;
        }
        return response;
      };
      assert.equal(await s.run('purge'), 0, s.logs.join('\n'));
      assert.ok(s.db.read('console_deleted_sites/a1').verifiedAt, 'the first purge finishes with denied child APIs and no token');
      assert.equal(await s.run('verify'), 0, s.logs.join('\n'));
      for (const id of [`bucket:${BUCKET}`, 'buckets', 'database', 'hosting', 'custom-domain', 'client-secrets']) {
        assert.equal(report(s).checks[id].state, 'pending-project-deletion', `${projectState} ${status} ${id}`);
      }
      assert.ok(s.db.read('console_deleted_sites/a1').verifiedAt);
    }
  }
});

test('active-project 400 and 403 reads remain unknown during verification', async () => {
  for (const status of [400, 403]) {
    const s = archived();
    s.failures.set(`GET firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)`, status);
    assert.equal(await s.run('verify'), 1);
    assert.equal(report(s).checks.database.state, 'unknown');
    assert.equal(s.db.writes.length, 0);
  }
});

test('a completed project delete permits 400 and 403 project reads and persists verifiedAt', async () => {
  for (const status of [400, 403]) {
    const s = archived();
    const fetch = s.deps.fetch;
    s.deps.fetch = (url, init) => new URL(url).host === 'cloudresourcemanager.googleapis.com'
      && init.method === 'GET' && s.state.project.state === 'DELETE_REQUESTED'
      ? Promise.resolve(answer({}, status)) : fetch(url, init);
    assert.equal(await s.run('purge'), 0, s.logs.join('\n'));
    assert.ok(s.db.read('console_deleted_sites/a1').verifiedAt);
    assert.equal(report(s).checks.project.state, 'pending-project-deletion');
    assert.equal(await s.run('verify'), 0, s.logs.join('\n'));
    assert.equal(report(s).checks.buckets.state, 'pending-project-deletion');
  }
});

test('a denied project read without a completed deletion is unknown and blocks purge', async () => {
  for (const status of [400, 403]) {
    const s = archived();
    s.failures.set(`GET cloudresourcemanager.googleapis.com/v3/projects/${PROJECT}`, status);
    assert.equal(await s.run('verify'), 1);
    assert.equal(report(s).checks.project.state, 'unknown');
    assert.equal(await s.run('purge'), 1);
    assert.equal(s.db.read('console_deleted_sites/a1'), undefined);
    assert.equal(mutations(s).length, 0);
  }
});

test('an incomplete ticket checkpoint still requires its account token', async () => {
  const s = archived({
    build: { stripeEndpointId: null },
    seed: { 'console_deleted_sites/a1': { resources: { ...RESOURCES, ticketProvider: 'stripe', ticketWebhookIds: ['we_own'] }, stepsCompleted: [] } },
  });
  s.clientSecrets.store.clear();
  s.secrets.store.clear();
  assert.equal(await s.run('verify'), 1);
  assert.equal(report(s).checks['ticket-webhooks'].state, 'unknown');
});

test('cancel-restore clears the claim on an archived app without extending the deadline or calling providers', async () => {
  const s = archived({ app: { archive: { previousStatus: 'ready', versionName: VERSION, pending: false, restoring: true } } });
  const before = s.db.read('applications/a1');
  assert.equal(await s.run('cancel-restore'), 0, s.logs.join('\n'));
  const after = s.db.read('applications/a1');
  assert.equal(after.status, 'archived');
  assert.equal(after.archive.restoring, false);
  assert.equal(after.archive.versionName, VERSION);
  assert.equal(after.purgeAfter.getTime(), before.purgeAfter.getTime());
  assert.equal(s.calls.length, 0);
  assert.equal(await s.run('cancel-restore'), 0);
  assert.equal(await s.run('purge'), 0, s.logs.join('\n'));
});

test('cancel-restore refuses non-archived applications and a purge claim made after load', async () => {
  const live = setup();
  assert.equal(await live.run('cancel-restore'), 1);
  assert.equal(live.calls.length, 0);
  const s = archived({ app: { archive: { restoring: true } } });
  const transaction = s.db.runTransaction;
  s.db.runTransaction = async (work) => {
    await s.db.collection('console_deleted_sites').doc('a1').set({ resources: RESOURCES, stepsCompleted: [] });
    return transaction(work);
  };
  assert.equal(await s.run('cancel-restore'), 1);
  assert.equal(s.db.read('applications/a1').archive.restoring, true);
  assert.equal(s.calls.length, 0);
});

test('confirmed purge-now clears a stuck restore while unconfirmed purge keeps it', async () => {
  const s = archived({ app: { purgeAfter: new Date(NOW + 1000), archive: { previousStatus: 'ready', versionName: VERSION, restoring: true } } });
  assert.equal(await s.run('purge'), 1);
  assert.equal(await s.run('purge', true, ''), 1);
  assert.equal(s.db.read('applications/a1').archive.restoring, true);
  const fetch = s.deps.fetch;
  s.deps.fetch = (url, init) => {
    if (init.method === 'DELETE') assert.equal(s.db.read('applications/a1').archive.restoring, false);
    return fetch(url, init);
  };
  assert.equal(await s.run('purge', true), 0, s.logs.join('\n'));
  assert.equal(s.db.read('applications/a1'), undefined);
});

test('CLI accepts cancel-restore and refuses missing or misplaced site confirmations', async () => {
  assert.equal(parseArgs(['--application', 'a1', '--cancel-restore']).mode, 'cancel-restore');
  for (const argv of [
    ['--application', 'a1', '--purge', '--now'],
    ['--application', 'a1', '--purge', '--now', '--confirm-site'],
    ['--application', 'a1', '--archive', '--confirm-site', 'show'],
    ['--application', 'a1', '--purge', '--confirm-site', 'show'],
    ['--application', 'a1', '--purge', '--now', '--confirm-site', 'show', '--confirm-site', 'show'],
  ]) {
    assert.equal(parseArgs(argv), null);
    assert.equal(await main(argv, ENV, () => { throw new Error('must not construct dependencies'); }), 2);
  }
});
