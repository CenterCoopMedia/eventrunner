'use strict';

/**
 * The site builder against a fake cloud at the fetch level. The fake answers
 * as the rehearsal saw each service answer, so a wrong address, API version or
 * missing header fails the way it would on a real run. docs/DEPLOY_RUNBOOK.md
 * §12 lists what only a live run can prove.
 */

const assert = require('node:assert/strict');
const { generateKeyPairSync } = require('node:crypto');
const test = require('node:test');
const { makeFakeDb, makeFakeSecrets } = require('../console/functions/src/fakes.cjs');
const { fakeMailer, quietLog } = require('../console/functions/src/testData.cjs');
const { application, seeded, NOW } = require('../console/functions/src/fakeReview.cjs');
const { validateDeployEnv } = require('../packages/shared/src/config/deploy.cjs');
const { resolveAdminTier } = require('../functions/src/core/auth.cjs');
const { SERVICES, STEPS, brandingProblem, main, markStopped, parseArgs, provision } = require('./provision-client.cjs');

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const PROJECT = 'er-nclocal';
const NUMBER = '555000111';
const DOMAIN = 'nclocal.eventrunner.org';
const COMPUTE = `${NUMBER}-compute@developer.gserviceaccount.com`;
const DEPLOY = `eventrunner-deploy@${PROJECT}.iam.gserviceaccount.com`;
const STRIPE_TOKEN = 'rk_live_fixture';
const TEST_TOKEN = 'rk_test_fixture';
const EVENTBRITE_TOKEN = 'eventbrite-fixture';
const ENV = {
  EVENT_SUPPORT_ADMIN_EMAILS: 'jamditis@gmail.com,amditisjunk@gmail.com',
  CONSOLE_MAIL_FROM: 'console@example.org',
  CONSOLE_POSTMARK_TOKEN: 'console-mail',
  CONSOLE_PROJECT_ID: 'console-project',
  CONSOLE_PUBLIC_URL: 'https://console.example.org',
  CLOUDFLARE_API_TOKEN: 'cf-token',
  CLOUDFLARE_ZONE_ID: 'zone1',
  POSTMARK_ACCOUNT_TOKEN: 'pm-account',
  PROVISIONER_APP_ID: '7',
  PROVISIONER_APP_PRIVATE_KEY: privateKey,
  PROVISIONER_INSTALLATION_ID: '8',
  GITHUB_REPOSITORY: 'owner/repo',
  GITHUB_REPOSITORY_ID: '100',
  GITHUB_REPOSITORY_OWNER_ID: '200',
  GITHUB_TOKEN: 'gh-run-token',
  GITHUB_RUN_ID: '42',
  GITHUB_SHA: 'a'.repeat(40),
  GOOGLE_CLOUD_QUOTA_PROJECT: 'console-project',
  GOOGLE_CLOUD_PROJECT: 'console-project',
  GCLOUD_PROJECT: 'console-project',
};

const answer = (body, status = 200) => new Response(JSON.stringify(body), { status });
const done = (response = {}) => answer({ name: 'operations/x', done: true, response });

/** One stateful fake of every service the builder calls. */
function fakeCloud(options = {}) {
  const state = {
    clock: NOW,
    project: null,
    billing: '',
    services: new Set(),
    batches: [],
    firebase: false,
    firestore: null,
    bucket: null,
    webApp: null,
    auth: null,
    policies: {},
    identities: [],
    accounts: new Set([COMPUTE, ...(options.noAppspot ? [] : [`${PROJECT}@appspot.gserviceaccount.com`])]),
    role: null,
    pool: false,
    provider: null,
    repository: options.repository || null,
    customDomain: null,
    dns: [],
    servers: [],
    streams: [{ ID: 'outbound', MessageStreamType: 'Transactional' }],
    webhooks: [],
    mailDomain: null,
    endpoints: [...(options.endpoints || [])],
    stripeToken: options.stripeToken ?? STRIPE_TOKEN,
    platformKey: 'sk_live_ccm_platform',
    liveConnect: options.liveConnect ?? !/^(?:sk|rk)_test_/.test(options.stripeToken ?? STRIPE_TOKEN),
    eventbriteToken: options.eventbriteToken ?? EVENTBRITE_TOKEN,
    environment: null,
    branchRules: [],
    variables: {},
    runs: [],
    sourceRevision: ENV.GITHUB_SHA,
    compareStatus: 'behind',
    deployFailures: options.deployFailures || 0,
    policyRefusals: options.policyRefusals || 0,
    certNever: options.certNever || false,
    certPropagating: options.certPropagating || false,
    httpsServing: options.httpsServing ?? true,
  };
  const calls = [];
  const hasDns = (type, name) => state.dns.some((r) => r.type === type && r.name === name);

  function domainView() {
    const need = [
      { type: 'A', domainName: `${DOMAIN}.`, rdata: '192.0.2.1', requiredAction: 'ADD' },
      { type: 'TXT', domainName: `_acme-challenge.${DOMAIN}.`, rdata: '"cert-proof"', requiredAction: 'ADD' },
    ];
    const live = !state.certNever && hasDns('A', DOMAIN) && hasDns('TXT', `_acme-challenge.${DOMAIN}`);
    return {
      hostState: live ? 'HOST_ACTIVE' : 'HOST_PENDING',
      ownershipState: 'OWNERSHIP_ACTIVE',
      cert: {
        state: !live ? 'CERT_PENDING' : state.certPropagating ? 'CERT_PROPAGATING' : 'CERT_ACTIVE',
        verification: { dns: { desired: live ? [] : [{ records: [need[1]] }] } },
      },
      requiredDnsUpdates: { desired: live ? [] : [{ records: [need[0]] }] },
    };
  }

  function googleRoute(url, method, body) {
    const { pathname: p } = url;
    if (p.endsWith(':getIamPolicy')) {
      return answer({ version: 3, etag: 'e', bindings: state.policies[`${url.host}${p.replace(':getIamPolicy', '')}`] || [] });
    }
    if (p.endsWith(':setIamPolicy')) {
      if (state.policyRefusals > 0) {
        state.policyRefusals -= 1;
        return answer({ error: { message: 'Service account does not exist.' } }, 400);
      }
      state.policies[`${url.host}${p.replace(':setIamPolicy', '')}`] = body.policy.bindings;
      return answer(body.policy);
    }
    if (p.endsWith(':generateServiceIdentity')) {
      state.identities.push(p.split('/').at(-1).replace(':generateServiceIdentity', ''));
      return done();
    }
    if (url.host === 'cloudresourcemanager.googleapis.com') {
      if (method === 'POST') {
        state.project = { name: `projects/${NUMBER}`, projectId: body.projectId, parent: body.parent, labels: body.labels, state: 'ACTIVE' };
        return done();
      }
      return state.project ? answer(state.project) : answer({ error: { message: 'denied' } }, 403);
    }
    if (url.host === 'cloudbilling.googleapis.com') {
      if (method === 'PUT') state.billing = body.billingAccountName;
      return answer({ billingAccountName: state.billing });
    }
    if (url.host === 'serviceusage.googleapis.com') {
      if (p.endsWith(':batchEnable')) {
        if (body.serviceIds.length > 20) return answer({ error: { message: 'SU_MAX_BATCH_SIZE_EXCEEDED' } }, 400);
        state.batches.push(body.serviceIds);
        for (const name of body.serviceIds) state.services.add(name);
        return done();
      }
      return answer({ services: [...state.services].map((name) => ({ name: `projects/${NUMBER}/services/${name}`, config: { name } })) });
    }
    if (url.host === 'firebase.googleapis.com') {
      if (p.endsWith(':addFirebase')) {
        state.firebase = true;
        return done();
      }
      if (p.endsWith('/config')) return answer({ apiKey: 'web-key', authDomain: `${PROJECT}.firebaseapp.com`, projectId: PROJECT, storageBucket: `${PROJECT}.firebasestorage.app`, messagingSenderId: '9', appId: 'web-1' });
      if (p.endsWith('/webApps')) {
        if (method === 'POST') {
          state.webApp = { appId: 'web-1' };
          return done(state.webApp);
        }
        return answer({ apps: state.webApp ? [state.webApp] : [] });
      }
      return state.firebase ? answer({ projectId: PROJECT }) : answer({}, 404);
    }
    if (url.host === 'firestore.googleapis.com') {
      if (method === 'POST') {
        state.firestore = body;
        return done();
      }
      return state.firestore ? answer(state.firestore) : answer({}, 404);
    }
    if (url.host === 'firebasestorage.googleapis.com') {
      if (method === 'POST') state.bucket = body.location;
      return state.bucket ? answer({ name: 'b', bucket: { name: `projects/x/buckets/${PROJECT}.firebasestorage.app` } }) : answer({}, 404);
    }
    if (url.host === 'firebasehosting.googleapis.com') {
      // v1beta1 only. The v1beta path answers 404, as it did in the rehearsal.
      if (!p.startsWith('/v1beta1/')) return answer({ error: { message: 'not found' } }, 404);
      if (p.endsWith('/sites')) return answer({ sites: [{ name: `projects/${PROJECT}/sites/${PROJECT}`, type: 'DEFAULT_SITE' }] });
      if (method === 'POST') state.customDomain = true;
      if (method === 'POST') return done();
      return state.customDomain ? answer(domainView()) : answer({}, 404);
    }
    if (url.host === 'identitytoolkit.googleapis.com') {
      if (p.endsWith(':initializeAuth')) {
        state.auth = { authorizedDomains: ['localhost'] };
        return answer({});
      }
      if (!state.auth) return answer({ error: { message: 'CONFIGURATION_NOT_FOUND' } }, 404);
      if (method === 'PATCH') state.auth.authorizedDomains = body.authorizedDomains;
      return answer(state.auth);
    }
    if (url.host === 'iam.googleapis.com') {
      if (p.includes('/workloadIdentityPools')) {
        if (p.endsWith('/providers/github')) {
          if (method === 'PATCH') state.provider = body;
          if (method === 'PATCH') return done();
          return state.provider ? answer(state.provider) : answer({}, 404);
        }
        if (p.endsWith('/providers')) {
          state.provider = body;
          state.providerParent = p;
          return done();
        }
        if (p.endsWith('/github-actions')) return state.pool ? answer({ name: p }) : answer({}, 404);
        state.pool = true;
        return done();
      }
      if (p.includes('/roles')) {
        if (method === 'POST') state.role = { roleId: body.roleId, ...body.role };
        if (method === 'PATCH') state.role = { ...state.role, ...body };
        if (method === 'GET' && !state.role) return answer({}, 404);
        return answer(state.role);
      }
      if (method === 'POST') {
        state.accounts.add(`${body.accountId}@${PROJECT}.iam.gserviceaccount.com`);
        return answer({});
      }
      return state.accounts.has(p.split('/').at(-1)) ? answer({}) : answer({}, 404);
    }
    if (url.host === 'artifactregistry.googleapis.com') {
      if (method === 'GET') return state.repository ? answer(state.repository) : answer({}, 404);
      if (method === 'POST') {
        state.repository = body;
        state.repositoryRegion = p;
        return done();
      }
      state.repository = { ...state.repository, ...body };
      return answer(state.repository);
    }
    return null;
  }

  function cloudflareRoute(url, method, body, headers) {
    if (headers.Authorization !== `Bearer ${ENV.CLOUDFLARE_API_TOKEN}`) return answer({}, 403);
    if (method === 'GET') {
      const type = url.searchParams.get('type');
      const name = url.searchParams.get('name');
      return answer({ result: state.dns.filter((r) => r.type === type && r.name === name) });
    }
    if (method === 'POST') {
      const record = { id: `r${state.dns.length}`, ...body };
      state.dns.push(record);
      return answer({ result: record });
    }
    const record = state.dns.find((r) => url.pathname.endsWith(`/${r.id}`));
    Object.assign(record, body);
    return answer({ result: record });
  }

  function postmarkRoute(url, method, body, headers) {
    const p = url.pathname;
    if (p.startsWith('/message-streams') || p.startsWith('/webhooks')) {
      if (headers['X-Postmark-Server-Token'] !== 'server-token') return answer({ Message: 'bad server token' }, 401);
      if (p.startsWith('/webhooks')) {
        if (method === 'POST') {
          // Postmark tests the address and saves nothing if it does not answer.
          if (state.runs.length === 0) return answer({ Message: 'Webhook verification failed; nothing was saved.' }, 422);
          state.webhooks.push(body);
          return answer({ ID: 1 });
        }
        return answer({ Webhooks: state.webhooks.filter((w) => w.MessageStream === url.searchParams.get('MessageStream')) });
      }
      if (method === 'POST') {
        state.streams.push(body);
        return answer({ ID: body.ID });
      }
      return answer({ MessageStreams: state.streams });
    }
    if (headers['X-Postmark-Account-Token'] !== ENV.POSTMARK_ACCOUNT_TOKEN) return answer({ Message: 'bad account token' }, 401);
    if (p === '/servers') {
      if (method === 'POST') {
        const server = { ID: 3, Name: body.Name, ApiTokens: ['server-token'] };
        state.servers.push(server);
        return answer(server);
      }
      return answer({ Servers: state.servers });
    }
    if (p === '/domains') {
      if (method === 'POST') {
        state.mailDomain = { ID: 5, Name: body.Name, ReturnPathDomain: body.ReturnPathDomain };
        return answer(state.mailDomain);
      }
      return answer({ Domains: state.mailDomain ? [state.mailDomain] : [] });
    }
    if (p.endsWith('/verifyDkim') || p.endsWith('/verifyReturnPath')) return answer({});
    const dkimHost = `pm._domainkey.${DOMAIN}`;
    return answer({
      ...state.mailDomain,
      DKIMVerified: hasDns('TXT', dkimHost),
      DKIMPendingHost: dkimHost,
      DKIMPendingTextValue: 'k=rsa; p=key',
      ReturnPathDomainVerified: hasDns('CNAME', `pm-bounces.${DOMAIN}`),
      ReturnPathDomainCNAMEValue: 'pm.mtasv.net',
    });
  }

  function stripeRoute(url, method, body, headers) {
    const p = url.pathname;
    // Stripe refuses webhook endpoint calls made with a Connect OAuth token.
    if (p.startsWith('/v1/webhook_endpoints') && state.liveConnect && headers.Authorization === `Bearer ${state.stripeToken}`) {
      return answer({ error: { type: 'invalid_request_error', code: 'oauth_not_supported' } }, 403);
    }
    const key = p.startsWith('/v1/webhook_endpoints') && state.liveConnect ? state.platformKey : state.stripeToken;
    if (headers.Authorization !== `Bearer ${key}`) return answer({ error: { message: `bad token ${headers.Authorization}` } }, 401);
    if (p === '/v1/account') return answer({ id: 'acct_1' });
    if (method === 'GET') return answer({ data: state.endpoints });
    if (method === 'DELETE') {
      state.endpoints = state.endpoints.filter((e) => !p.endsWith(`/${e.id}`));
      return answer({});
    }
    const params = new URLSearchParams(body);
    state.endpointsMade = (state.endpointsMade || 0) + 1;
    if (state.liveConnect && params.get('connect') !== 'true') return answer({ error: { message: 'a platform endpoint must listen to connected accounts' } }, 400);
    const created = { id: `we_${state.endpointsMade}`, url: params.get('url'), status: 'enabled', enabled_events: params.getAll('enabled_events[]'), secret: 'whsec_fixture' };
    state.endpoints.push(created);
    return answer(created);
  }

  function githubRoute(url, method, body, headers) {
    const p = url.pathname;
    if (p.endsWith('/access_tokens')) return answer({ token: 'provisioner-token', asked: body }, 201);
    const fromApp = headers.Authorization === 'Bearer provisioner-token';
    if (p.includes('/actions/workflows/deploy.yml')) {
      if (headers.Authorization !== `Bearer ${ENV.GITHUB_TOKEN}`) return answer({}, 403);
      if (method === 'GET') return answer({ workflow_runs: [...state.runs].reverse() });
      const failed = state.deployFailures > 0;
      if (failed) state.deployFailures -= 1;
      state.runs.push({
        id: state.runs.length + 1,
        head_sha: state.sourceRevision,
        display_title: `Deploy ${body.inputs.client}${body.inputs.bootstrap === 'true' ? ' (bootstrap)' : ''}`,
        status: 'completed',
        conclusion: failed ? 'failure' : 'success',
        html_url: `https://github.example/run/${state.runs.length + 1}`,
        created_at: new Date(state.clock).toISOString(),
        inputs: body.inputs,
      });
      return new Response(null, { status: 204 });
    }
    if (method === 'GET' && p.endsWith('/git/ref/heads/main')) {
      return answer({ object: { sha: state.sourceRevision } });
    }
    if (method === 'GET' && p.includes('/compare/')) {
      return answer({ status: state.compareStatus });
    }
    if (!fromApp) return answer({ message: 'needs the App' }, 403);
    if (p.endsWith('/deployment-branch-policies')) {
      if (method === 'POST') state.branchRules.push(body);
      return answer({ branch_policies: state.branchRules });
    }
    if (p.endsWith('/variables')) {
      if (method === 'POST') {
        if (body.name === 'EVENTRUNNER_REQUEST_ID' && state.failOwnerWrite) return answer({ message: 'down' }, 500);
        if (body.name === 'EVENTRUNNER_REQUEST_ID' && state.ownerTaken) return answer({ message: 'taken' }, 409);
        state.variables[body.name] = body.value;
        return answer({}, 201);
      }
      return answer({ variables: Object.entries(state.variables).map(([name, value]) => ({ name, value })) });
    }
    if (p.includes('/variables/')) {
      state.variables[body.name] = body.value;
      return new Response(null, { status: 204 });
    }
    if (method === 'PUT') {
      state.environment = { ...body, name: p.split('/').at(-1) };
      if (state.loseCreateAnswer) throw new Error('no answer');
    }
    return state.environment ? answer(state.environment) : answer({}, 404);
  }

  const fetch = async (address, init = {}) => {
    const url = new URL(address);
    const headers = init.headers || {};
    const method = init.method || 'GET';
    let body = init.body;
    if (typeof body === 'string' && (headers['Content-Type'] || '').includes('json')) body = JSON.parse(body);
    calls.push({ url: address, method, headers, body });
    if (/^(?:firebase|firebasehosting|firebasestorage|identitytoolkit)\.googleapis\.com$/.test(url.host) && headers['x-goog-user-project'] !== PROJECT) {
      return answer({ error: { message: 'requires a quota project' } }, 403);
    }
    if (url.host === DOMAIN) {
      if (!state.httpsServing) throw new TypeError('fetch failed');
      return answer({}, 404);
    }
    let response = null;
    if (url.host.endsWith('.googleapis.com')) response = googleRoute(url, method, body);
    else if (url.host === 'api.cloudflare.com') response = cloudflareRoute(url, method, body, headers);
    else if (url.host === 'api.postmarkapp.com') response = postmarkRoute(url, method, body, headers);
    else if (url.host === 'api.stripe.com') response = stripeRoute(url, method, body, headers);
    else if (url.host === 'www.eventbriteapi.com') {
      response = headers.Authorization === `Bearer ${state.eventbriteToken}` ? answer({ id: 'x' }) : answer({ error_description: 'gone' }, 401);
    } else if (url.host === 'api.github.com') response = githubRoute(url, method, body, headers);
    if (!response) throw new Error(`the fake has no route for ${method} ${address}`);
    return response;
  };
  return { state, calls, fetch };
}

/** One request and everything the builder is handed. */
function setup({ app = {}, cloud = {}, secrets, accounts, branding = '  branding/         4 uploaded, 0 protected, 0 errors', env = {}, initCode = 0 } = {}) {
  const fake = fakeCloud(cloud);
  const db = seeded({
    'applications/a1': application({ status: 'approved', buildStart: { state: 'started', at: new Date(NOW - 1000) }, ...app }),
    'console_connections/a1': accounts || { stripe: { accountId: 'acct_1', connectedBy: 'ana' } },
  });
  const consoleSecrets = makeFakeSecrets(secrets || { 'connection-stripe-a1': STRIPE_TOKEN, 'connection-eventbrite-a1': EVENTBRITE_TOKEN });
  // CCM's platform key lives in the console project beside the connections; it is read, never moved.
  const readConsoleSecret = consoleSecrets.readSecret.bind(consoleSecrets);
  consoleSecrets.readSecret = async (id) => (id === 'CONSOLE_STRIPE_SECRET_KEY' ? fake.state.platformKey : readConsoleSecret(id));
  const clientSecrets = makeFakeSecrets();
  const clientFirestore = makeFakeDb({});
  const mailer = fakeMailer();
  const commands = [];
  const answersWritten = [];
  const deps = {
    env: { ...ENV, ...env },
    fetch: fake.fetch,
    getAccessToken: async () => ({ access_token: 'gcp-token' }),
    sleep: async () => {},
    now: () => fake.state.clock,
    log: { ...quietLog(), log() {} },
    db,
    clientDb: () => clientFirestore,
    consoleSecrets,
    clientSecrets: () => clientSecrets,
    mailer,
    writeAnswers: async (written) => {
      answersWritten.push(written);
      return '/fake/answers.json';
    },
    runCommand: async (command, args, { env: childEnv }) => {
      commands.push({ command, args, env: childEnv });
      if (args[0] === 'scripts/init-event.cjs') {
        if (initCode !== 0) return { code: initCode, output: '' };
        await clientFirestore.collection('config').doc('event').set({ sender: answersWritten.at(-1).event.sender });
        const bootstrap = clientFirestore.collection('config').doc('bootstrap');
        const existing = (await bootstrap.get()).data() || {};
        const flagged = (flag) => args.flatMap((arg, i) => arg === flag ? [args[i + 1]] : []);
        await bootstrap.set({ ...existing,
          adminEmails: [...new Set([...(existing.adminEmails || []), ...flagged('--admin')])],
          staffEmails: [...new Set([...(existing.staffEmails || []), ...flagged('--staff')])],
        });
        return { code: 0, output: `init-event\n${branding}\n` };
      }
      // The real script merges field by field; this fake's merge stops at the top level.
      const providers = clientFirestore.collection('config').doc('providers');
      const ticketing = (await providers.get()).data()?.ticketing;
      await providers.set({ ticketing: { ...ticketing, webhookRegisteredAt: 'now', webhookId: 'wh' } }, { merge: true });
      return { code: 0, output: '' };
    },
  };
  return { ...fake, db, deps, consoleSecrets, clientSecrets, clientFirestore, mailer, commands, answersWritten };
}

const bindingsOf = (fake, resource) => fake.state.policies[resource] || [];
const holds = (bindings, role, member) => bindings.some((b) => b.role === role && b.members.includes(member));
const statusMail = (mailer) => mailer.sent.filter((m) => m.kind === 'status').map((m) => m.status);
const notices = (mailer) => mailer.sent.filter((m) => m.kind === 'operator');

test('one approved request becomes a built site, and the record and the status say so', async () => {
  const fake = setup();
  assert.equal(await provision({ appId: 'a1', deps: fake.deps }), 0);

  const app = fake.db.read('applications/a1');
  assert.equal(app.status, 'ready');
  assert.deepEqual(app.history.slice(-2).map((h) => [h.status, h.by]), [['building', 'build'], ['ready', 'build']]);

  const record = fake.db.read('console_builds/a1');
  assert.equal(record.state, 'done');
  assert.equal(record.runUrl, 'https://github.com/owner/repo/actions/runs/42');
  assert.deepEqual(record.steps.map((s) => [s.id, s.state]), STEPS.map((s) => [s.id, 'done']));

  assert.deepEqual(fake.mailer.sent.filter((m) => m.kind === 'status').map((m) => m.to).sort(), ['ana@example.org', 'bo@example.org']);
  assert.deepEqual([...new Set(statusMail(fake.mailer))], ['ready']);
  const ready = fake.mailer.sent.find((m) => m.status === 'ready');
  assert.equal(ready.adminLink, `https://${DOMAIN}/admin`);
});

test('the project is in the client folder, on the billing account, with every API, in small batches', async () => {
  const fake = setup();
  await provision({ appId: 'a1', deps: fake.deps });
  assert.equal(fake.state.project.projectId, PROJECT);
  assert.equal(fake.state.project.parent, 'folders/123456789012');
  assert.equal(fake.state.billing, 'billingAccounts/012345-6789AB-CDEF01');
  assert.ok(SERVICES.length > 20, 'the batch rule matters only past 20');
  assert.ok(fake.state.batches.length >= 2 && fake.state.batches.every((b) => b.length <= 20));
  for (const service of ['cloudbilling.googleapis.com', 'compute.googleapis.com', 'firebasestorage.googleapis.com']) {
    assert.ok(fake.state.services.has(service), service);
  }
  assert.deepEqual(fake.state.firestore, { type: 'FIRESTORE_NATIVE', locationId: 'nam5' });
});

test('each grant the rehearsal missed is made up front', async () => {
  const fake = setup();
  await provision({ appId: 'a1', deps: fake.deps });
  const iam = `iam.googleapis.com/v1/projects/${PROJECT}/serviceAccounts`;
  const project = bindingsOf(fake, `cloudresourcemanager.googleapis.com/v3/projects/${PROJECT}`);
  const deploy = `serviceAccount:${DEPLOY}`;

  assert.ok(holds(project, `projects/${PROJECT}/roles/eventrunnerDeployInvoker`, deploy), 'the invoker role');
  assert.ok(fake.state.role.includedPermissions.includes('run.services.setIamPolicy'));
  assert.ok(holds(bindingsOf(fake, `${iam}/${COMPUTE}`), 'roles/iam.serviceAccountUser', deploy), 'act as compute');
  assert.ok(holds(bindingsOf(fake, `${iam}/${PROJECT}@appspot.gserviceaccount.com`), 'roles/iam.serviceAccountUser', deploy), 'appspot actAs for the Firebase deploy preflight');

  assert.ok(fake.state.identities.some((service) => service === 'storage.googleapis.com'), 'the storage agent is made first');
  assert.ok(holds(project, 'roles/pubsub.publisher', `serviceAccount:service-${NUMBER}@gs-project-accounts.iam.gserviceaccount.com`));
  assert.ok(holds(project, 'roles/iam.serviceAccountTokenCreator', `serviceAccount:service-${NUMBER}@gcp-sa-pubsub.iam.gserviceaccount.com`));
  assert.ok(holds(project, 'roles/run.invoker', `serviceAccount:${COMPUTE}`));
  assert.ok(holds(project, 'roles/eventarc.eventReceiver', `serviceAccount:${COMPUTE}`));
  for (const role of ['roles/datastore.user', 'roles/firebaseauth.admin', 'roles/firebasehosting.admin', 'roles/cloudbuild.builds.builder']) {
    assert.ok(holds(project, role, `serviceAccount:${COMPUTE}`), role);
  }
  assert.equal(holds(project, 'roles/editor', `serviceAccount:${COMPUTE}`), false);
  assert.ok(holds(bindingsOf(fake, `${iam}/${COMPUTE}`), 'roles/iam.serviceAccountTokenCreator', `serviceAccount:${COMPUTE}`), 'compute signs as itself');
});

test('a new project provisions compute secret access and actAs without an appspot account', async () => {
  const fake = setup({ cloud: { noAppspot: true } });
  assert.equal(await provision({ appId: 'a1', deps: fake.deps }), 0);
  const appspot = `${PROJECT}@appspot.gserviceaccount.com`;
  assert.ok(!fake.calls.some((call) => {
    const url = new URL(call.url);
    const [account, action] = url.pathname.split('/').at(-1).split(':');
    return url.hostname === 'iam.googleapis.com' && account === appspot && action === 'setIamPolicy';
  }));
  const deploy = `serviceAccount:${DEPLOY}`;
  assert.ok(holds(bindingsOf(fake, `iam.googleapis.com/v1/projects/${PROJECT}/serviceAccounts/${COMPUTE}`), 'roles/iam.serviceAccountUser', deploy));
  for (const id of fake.clientSecrets.store.keys()) {
    const policy = bindingsOf(fake, `secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/${id}`);
    assert.ok(holds(policy, 'roles/secretmanager.secretAccessor', `serviceAccount:${COMPUTE}`), id);
    assert.ok(policy.every((binding) => binding.members.every((member) => member !== `serviceAccount:${appspot}`)));
  }
});

test('a new agent that IAM does not know yet is tried again, then the grant lands', async () => {
  const fake = setup({ cloud: { policyRefusals: 3 } });
  assert.equal(await provision({ appId: 'a1', deps: fake.deps }), 0);
  assert.equal(fake.state.policyRefusals, 0);
});

test('the identity pool belongs to this project, and its condition names this environment', async () => {
  const fake = setup();
  await provision({ appId: 'a1', deps: fake.deps });
  assert.match(fake.state.providerParent, new RegExp(`/projects/${PROJECT}/locations/global/workloadIdentityPools/github-actions/providers$`));
  const condition = fake.state.provider.attributeCondition;
  for (const part of ["assertion.environment == 'nclocal'", "assertion.ref == 'refs/heads/main'", "assertion.repository_id == '100'", "assertion.repository_owner_id == '200'", ".github/workflows/deploy.yml@refs/heads/main'"]) {
    assert.ok(condition.includes(part), part);
  }
  const binding = bindingsOf(fake, `iam.googleapis.com/v1/projects/${PROJECT}/serviceAccounts/${DEPLOY}`);
  assert.ok(holds(binding, 'roles/iam.workloadIdentityUser', `principalSet://iam.googleapis.com/projects/${NUMBER}/locations/global/workloadIdentityPools/github-actions/attribute.repository_and_ref/owner/repo#refs/heads/main`));
});

test('the image cleanup policy is set up front, on a new repository or on an existing one', async () => {
  const created = setup();
  await provision({ appId: 'a1', deps: created.deps });
  assert.equal(created.state.repository.cleanupPolicies['firebase-functions-cleanup'].condition.olderThan, '86400s');
  assert.equal(created.state.repository.cleanupPolicyDryRun, false);

  const existing = setup({ cloud: { repository: { format: 'DOCKER' } } });
  await provision({ appId: 'a1', deps: existing.deps });
  assert.equal(existing.state.repository.cleanupPolicies['firebase-functions-cleanup'].condition.olderThan, '86400s');
  assert.ok(existing.calls.some((c) => c.method === 'PATCH' && c.url.includes('/repositories/gcf-artifacts?updateMask=')));
});

test('the web address goes through v1beta1 and the zone, and sign-in allows it', async () => {
  const fake = setup();
  await provision({ appId: 'a1', deps: fake.deps });
  const hosting = fake.calls.filter((c) => c.url.includes('/customDomains'));
  assert.ok(hosting.length > 0 && hosting.every((c) => c.url.includes('/v1beta1/projects/') && c.headers['x-goog-user-project'] === PROJECT));
  assert.deepEqual(
    fake.state.dns.map((r) => [r.type, r.name, r.content]).sort(),
    [
      ['A', DOMAIN, '192.0.2.1'],
      ['CNAME', `pm-bounces.${DOMAIN}`, 'pm.mtasv.net'],
      ['TXT', `_acme-challenge.${DOMAIN}`, 'cert-proof'],
      ['TXT', `pm._domainkey.${DOMAIN}`, 'k=rsa; p=key'],
    ].sort(),
  );
  assert.ok(fake.state.dns.every((r) => r.proxied === false));
  assert.deepEqual(fake.state.auth.authorizedDomains, ['localhost', DOMAIN, `${PROJECT}.web.app`, `${PROJECT}.firebaseapp.com`]);
});

test('a certificate that never arrives fails with a record, and a second run after it arrives finishes', async () => {
  const fake = setup({ cloud: { certNever: true } });
  assert.equal(await provision({ appId: 'a1', deps: fake.deps }), 1);
  assert.match(fake.db.read('console_builds/a1').error, /certificate is not active/);
  assert.equal(fake.db.read('applications/a1').status, 'building');

  fake.state.certNever = false;
  assert.equal(await provision({ appId: 'a1', deps: fake.deps }), 0);
  assert.equal(fake.db.read('applications/a1').status, 'ready');
});

test('a certificate that Hosting still calls propagating does not stop the build once it is served', async () => {
  const fake = setup({ cloud: { certPropagating: true } });
  assert.equal(await provision({ appId: 'a1', deps: fake.deps }), 0);
  assert.equal(fake.db.read('applications/a1').status, 'ready');
});

test('a propagating certificate that is not served yet still fails the step', async () => {
  const fake = setup({ cloud: { certPropagating: true, httpsServing: false } });
  assert.equal(await provision({ appId: 'a1', deps: fake.deps }), 1);
  assert.match(fake.db.read('console_builds/a1').error, /certificate is not active/);
});

test('a record for this site alone: a name outside it is refused', async () => {
  const fake = setup();
  const realFetch = fake.deps.fetch;
  fake.deps.fetch = async (address, init) => {
    const response = await realFetch(address, init);
    if (address.includes('/customDomains/') && (init.method || 'GET') === 'GET' && response.status === 200) {
      const view = await response.json();
      view.requiredDnsUpdates.desired = [{ records: [{ type: 'A', domainName: 'eventrunner.org.', rdata: '192.0.2.9', requiredAction: 'ADD' }] }];
      return answer(view);
    }
    return response;
  };
  assert.equal(await provision({ appId: 'a1', deps: fake.deps }), 1);
  assert.match(fake.db.read('console_builds/a1').error, /refused a record outside/);
  assert.equal(fake.state.dns.length, 0);
});

test('email gets a server, its streams and webhooks, and a verified sender', async () => {
  const fake = setup();
  await provision({ appId: 'a1', deps: fake.deps });
  const serverRequest = fake.calls.find((call) => call.url === 'https://api.postmarkapp.com/servers' && call.method === 'POST');
  assert.deepEqual(serverRequest.body, { Name: 'nclocal', TrackLinks: 'None', TrackOpens: false });
  assert.equal(fake.clientSecrets.store.get('EMAIL_PROVIDER_API_KEY'), 'server-token');
  const basicAuth = fake.clientSecrets.store.get('EMAIL_WEBHOOK_BASIC_AUTH');
  assert.match(basicAuth, new RegExp(`^${PROJECT}:[0-9a-f]{40}$`));
  assert.ok(fake.state.streams.some((s) => s.ID === 'announcements' && s.MessageStreamType === 'Broadcasts'));
  assert.deepEqual(fake.state.webhooks.map((w) => w.MessageStream).sort(), ['announcements', 'outbound']);
  assert.ok(fake.state.webhooks.every((w) => w.Url === `https://us-central1-${PROJECT}.cloudfunctions.net/emailDeliveryWebhook`));
  assert.ok(fake.state.webhooks.every((w) => `${w.HttpAuth.Username}:${w.HttpAuth.Password}` === basicAuth));
  assert.equal(fake.state.webhooks.find((w) => w.MessageStream === 'announcements').Triggers.SubscriptionChange.Enabled, true);
  assert.equal(fake.state.mailDomain.ReturnPathDomain, `pm-bounces.${DOMAIN}`);

  const sender = (await fake.clientFirestore.collection('config').doc('event').get()).data().sender;
  assert.equal(sender.domainVerified, true);
  assert.equal(sender.domainVerifiedBy, 'provider-check');
  assert.equal(sender.domainVerifiedDomain, DOMAIN);
});

test('the token is tested, moved, and deleted from the console, and the leftover goes too', async () => {
  const fake = setup();
  await provision({ appId: 'a1', deps: fake.deps });
  assert.equal(fake.clientSecrets.store.get('TICKETING_API_TOKEN'), STRIPE_TOKEN);
  assert.equal(fake.clientSecrets.store.get('TICKETING_WEBHOOK_SECRET'), 'whsec_fixture');
  // A live Connect token cannot manage webhook endpoints (Stripe 403 oauth_not_supported); CCM's platform key makes a Connect endpoint.
  const made = fake.calls.find((c) => c.method === 'POST' && c.url.endsWith('/v1/webhook_endpoints'));
  assert.equal(made.headers.Authorization, 'Bearer sk_live_ccm_platform');
  assert.equal(new URLSearchParams(made.body).get('connect'), 'true');
  assert.equal(fake.db.read('console_builds/a1').stripeEndpointOwner, 'platform');
  assert.equal(fake.consoleSecrets.store.size, 0);
  const secretPolicy = bindingsOf(fake, `secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/TICKETING_API_TOKEN`);
  assert.ok(holds(secretPolicy, 'roles/secretmanager.secretAccessor', `serviceAccount:${COMPUTE}`));
  assert.ok(fake.calls.some((c) => c.url.endsWith('/v1/account')));
  assert.equal(fake.state.endpoints[0].url, `https://us-central1-${PROJECT}.cloudfunctions.net/ticketingWebhook`);
});

test('fresh provisioning grants both configured CCM support accounts and client Owners operator access', async () => {
  const fake = setup();
  assert.equal(await provision({ appId: 'a1', deps: fake.deps }), 0);
  const bootstrap = fake.clientFirestore.read('config/bootstrap');
  for (const email of ['jamditis@gmail.com', 'amditisjunk@gmail.com', 'ana@example.org', 'bo@example.org']) {
    assert.equal(resolveAdminTier(bootstrap, email), 'operator', email);
  }
  assert.deepEqual(bootstrap.supportAdminEmails, ['jamditis@gmail.com', 'amditisjunk@gmail.com']);
});

test('a provisioning retry preserves client operators and configured support access after seed', async () => {
  const fake = setup();
  assert.equal(await provision({ appId: 'a1', deps: fake.deps }), 0);
  const ref = fake.clientFirestore.doc('config/bootstrap');
  const bootstrap = (await ref.get()).data();
  await ref.update({
    adminEmails: [...bootstrap.adminEmails.filter((email) => email !== 'amditisjunk@gmail.com'), 'Added-by-client@Example.org'],
    supportAdminEmails: ['Jamditis@Gmail.com', 'jamditis@gmail.com'],
    staffExpiry: { 'temp@example.org': 'preserved' },
  });
  await fake.db.doc('applications/a1').update({ status: 'building' });
  assert.equal(await provision({ appId: 'a1', deps: fake.deps }), 0);
  const after = (await ref.get()).data();
  for (const email of ['jamditis@gmail.com', 'amditisjunk@gmail.com', 'ana@example.org', 'added-by-client@example.org']) {
    assert.equal(resolveAdminTier(after, email), 'operator', email);
  }
  assert.deepEqual(after.supportAdminEmails, ['jamditis@gmail.com', 'amditisjunk@gmail.com']);
  assert.equal(after.adminEmails.includes('Added-by-client@Example.org'), false);
  assert.deepEqual(after.staffExpiry, { 'temp@example.org': 'preserved' });
});

test('a dead token fails clearly, keeps the console copy, and says nothing the provider said', async () => {
  const fake = setup({ cloud: { stripeToken: 'someone-else' } });
  assert.equal(await provision({ appId: 'a1', deps: fake.deps }), 1);
  const record = fake.db.read('console_builds/a1');
  assert.equal(record.failedStep, 'tickets');
  assert.match(record.error, /HTTP 401.*connect the Stripe account again/);
  assert.ok(!JSON.stringify(record).includes(STRIPE_TOKEN));
  assert.equal(fake.clientSecrets.store.has('TICKETING_API_TOKEN'), false);
  assert.equal(fake.consoleSecrets.store.get('connection-stripe-a1'), STRIPE_TOKEN);
});

test('a token for another account fails', async () => {
  const fake = setup({ accounts: { stripe: { accountId: 'acct_other', connectedBy: 'ana' } } });
  assert.equal(await provision({ appId: 'a1', deps: fake.deps }), 1);
  assert.match(fake.db.read('console_builds/a1').error, /another account/);
});

test('a test-mode connection fails a live build and its token is deleted', async () => {
  const fake = setup({
    app: { connections: { stripe: { connected: true, displayName: 'NC Local', livemode: false } } },
    secrets: { 'connection-stripe-a1': TEST_TOKEN },
    cloud: { stripeToken: TEST_TOKEN },
  });
  assert.equal(await provision({ appId: 'a1', deps: fake.deps }), 1);
  assert.match(fake.db.read('console_builds/a1').error, /test mode, and this is a live build/);
  assert.equal(fake.consoleSecrets.store.size, 0);
  assert.equal(fake.clientSecrets.store.has('TICKETING_API_TOKEN'), false);
  assert.ok(!fake.calls.some((c) => new URL(c.url).host === 'api.stripe.com'), 'a test token is not used');
  assert.ok(notices(fake.mailer).some((n) => n.noticeKind === 'build-run-failed'));
});

test('a test token with a live label still fails a live build', async () => {
  const fake = setup({ secrets: { 'connection-stripe-a1': TEST_TOKEN } });
  assert.equal(await provision({ appId: 'a1', deps: fake.deps }), 1);
  assert.match(fake.db.read('console_builds/a1').error, /test mode/);
});

test('a test-mode run builds with a test-mode connection, and records that it did', async () => {
  const fake = setup({
    app: { connections: { stripe: { connected: true, displayName: 'NC Local', livemode: false } } },
    secrets: { 'connection-stripe-a1': TEST_TOKEN },
    cloud: { stripeToken: TEST_TOKEN },
  });
  assert.equal(await provision({ appId: 'a1', testMode: true, deps: fake.deps }), 0);
  assert.equal(fake.db.read('console_builds/a1').testMode, true);
  assert.equal(fake.state.variables.EVENT_STRIPE_MODE, 'test');
});

test('a Stripe endpoint whose signing secret is lost is replaced', async () => {
  const url = `https://us-central1-${PROJECT}.cloudfunctions.net/ticketingWebhook`;
  const fake = setup({ cloud: { endpoints: [{ id: 'we_old', url, status: 'enabled', enabled_events: [] }] } });
  await provision({ appId: 'a1', deps: fake.deps });
  assert.deepEqual(fake.state.endpoints.map((e) => e.id), ['we_1']);
  assert.ok(fake.state.endpoints[0].enabled_events.includes('checkout.session.completed'));
  assert.equal(fake.clientSecrets.store.get('TICKETING_WEBHOOK_SECRET'), 'whsec_fixture');
});

test('a second live Stripe site is refused while another site holds a platform Connect endpoint', async () => {
  // A platform Connect endpoint receives every connected account's events, so two would cross clients.
  const other = { id: 'we_other', url: 'https://us-central1-er-other.cloudfunctions.net/ticketingWebhook', status: 'enabled', enabled_events: [] };
  const fake = setup({ cloud: { endpoints: [other] } });
  assert.equal(await provision({ appId: 'a1', deps: fake.deps }), 1);
  const record = fake.db.read('console_builds/a1');
  assert.equal(record.failedStep, 'tickets');
  assert.match(record.error, /shared receiver/);
  assert.deepEqual(fake.state.endpoints.map((e) => e.id), ['we_other']);
});

function eventbriteRequest() {
  const frozen = { ...application().frozen, tickets: { choice: 'eventbrite' } };
  return {
    app: {
      frozen,
      answers: frozen,
      connections: { eventbrite: { connected: true, displayName: 'NC Local', event: { id: '555', name: 'Summit' } } },
    },
    accounts: { eventbrite: { accountId: 'u1', connectedBy: 'ana', eventOrganizationId: 'org-holding-the-event' } },
    secrets: { 'connection-eventbrite-a1': EVENTBRITE_TOKEN, 'connection-stripe-a1': STRIPE_TOKEN },
  };
}

test('Eventbrite: registering the webhook uses the organization that holds the event', async () => {
  const fake = setup(eventbriteRequest());
  assert.equal(await provision({ appId: 'a1', deps: fake.deps }), 0);
  const register = fake.commands.find((c) => c.args[0] === 'scripts/register-ticketing-webhook.cjs');
  assert.equal(register.env.EVENT_TICKETING_ORGANIZATION_ID, 'org-holding-the-event');
  assert.equal(register.env.TICKETING_API_TOKEN, EVENTBRITE_TOKEN);
  assert.equal(register.env.TICKETING_WEBHOOK_SECRET, fake.clientSecrets.store.get('TICKETING_WEBHOOK_SECRET'));
  assert.equal(register.env.EVENT_TICKETING_EVENT_ID, '555');
  assert.equal(fake.consoleSecrets.store.size, 0);
  assert.ok(fake.calls.some((c) => c.url.endsWith('/v3/events/555/')));
});

test('with no ticket account nothing moves, and any leftover is deleted', async () => {
  const frozen = { ...application().frozen, tickets: { choice: 'spreadsheet' } };
  const fake = setup({ app: { frozen, answers: frozen, connections: {} }, accounts: {} });
  assert.equal(await provision({ appId: 'a1', deps: fake.deps }), 0);
  assert.equal(fake.state.variables.EVENT_TICKETING_PROVIDER, 'manual');
  assert.equal(fake.consoleSecrets.store.size, 0);
  assert.equal(fake.clientSecrets.store.has('TICKETING_API_TOKEN'), false);
  assert.ok(!fake.commands.some((c) => c.args[0].includes('register-ticketing')));
});

test('the Environment allows main only, needs the App, and holds variables the deploy accepts', async () => {
  const fake = setup();
  await provision({ appId: 'a1', deps: fake.deps });
  assert.equal(fake.state.environment.name, 'nclocal');
  assert.deepEqual(fake.state.environment.deployment_branch_policy, { protected_branches: false, custom_branch_policies: true });
  assert.deepEqual(fake.state.branchRules, [{ name: 'main', type: 'branch' }]);
  const asked = fake.calls.find((c) => c.url.endsWith('/access_tokens')).body;
  assert.deepEqual(asked, { repositories: ['repo'], permissions: { administration: 'write', environments: 'write', actions: 'read' } });

  const { variables } = fake.state;
  const checked = validateDeployEnv(variables);
  assert.deepEqual([checked.ok, checked.missing, checked.errors], [true, [], []]);
  assert.equal(variables.WIF_SERVICE_ACCOUNT, DEPLOY);
  assert.equal(variables.WIF_PROVIDER, `projects/${NUMBER}/locations/global/workloadIdentityPools/github-actions/providers/github`);
  assert.equal(variables.EVENT_PUBLIC_URL, `https://${DOMAIN}`);
  assert.equal(variables.EVENT_STRIPE_ACCOUNT_ID, 'acct_1');
  assert.equal(variables.EVENT_STRIPE_MODE, 'live');
  assert.equal(variables.EVENT_OPERATOR_NOTIFIER, 'email');
});

test('it deploys in the bootstrap order, and seeds between the two deploys', async () => {
  const fake = setup();
  await provision({ appId: 'a1', deps: fake.deps });
  assert.deepEqual(fake.state.runs.map((r) => [r.display_title, r.inputs.bootstrap]), [
    ['Deploy nclocal (bootstrap)', 'true'],
    ['Deploy nclocal', undefined],
  ]);
  const init = fake.commands.find((c) => c.args[0] === 'scripts/init-event.cjs');
  assert.deepEqual(init.args, [
    'scripts/init-event.cjs', '--answers', '/fake/answers.json',
    '--admin', 'ana@example.org', '--admin', 'bo@example.org', '--staff', 'ben@example.org',
  ]);
  assert.equal(fake.answersWritten[0].providers.email.announcementStream, 'announcements');
  assert.deepEqual(fake.answersWritten[0].providers.notifier, {
    operatorEmail: 'amditisj@montclair.edu',
  });
  assert.equal(fake.answersWritten[0].event.sender.email.endsWith(`@${DOMAIN}`), true);
});

test('a retry after a code update redeploys bootstrap and full site instead of reusing older successful runs', async () => {
  const fake = setup();
  assert.equal(await provision({ appId: 'a1', deps: fake.deps }), 0);
  assert.equal(fake.state.runs.length, 2);
  const patched = 'b'.repeat(40);
  fake.deps.env.GITHUB_SHA = patched;
  fake.state.sourceRevision = patched;
  fake.state.clock += 3600000;
  await fake.db.doc('applications/a1').update({ status: 'building' });
  assert.equal(await provision({ appId: 'a1', deps: fake.deps }), 0);
  assert.equal(fake.state.runs.length, 4);
  assert.ok(fake.state.runs.slice(2).every((run) => run.head_sha === patched));
  assert.ok(fake.calls.filter((c) => c.url.endsWith('/dispatches')).every((c) => c.body.ref === 'main'));
});

test('a deployment from a newer main revision is accepted only with proven ancestry', async () => {
  const fake = setup();
  fake.state.sourceRevision = 'b'.repeat(40);
  fake.state.compareStatus = 'ahead';
  assert.equal(await provision({ appId: 'a1', deps: fake.deps }), 0);
  assert.equal(fake.state.runs.length, 2);
  assert.equal(fake.calls.filter((c) => c.url.includes('/compare/')).length, 1, 'one cached ancestry proof covers both deployments');
});

test('a local operator invocation resolves main when no Actions revision is present', async () => {
  const fake = setup({ env: { GITHUB_SHA: '' } });
  assert.equal(await provision({ appId: 'a1', deps: fake.deps }), 0);
  assert.equal(fake.calls.filter((c) => c.url.endsWith('/git/ref/heads/main')).length, 1);
});

test('a failed first deploy is run again, because its failures are usually transient', async () => {
  const fake = setup({ cloud: { deployFailures: 2 } });
  assert.equal(await provision({ appId: 'a1', deps: fake.deps }), 0);
  const titles = fake.state.runs.map((r) => r.display_title);
  assert.deepEqual(titles.slice(0, 3), Array(3).fill('Deploy nclocal (bootstrap)'));
  assert.match(fake.db.read('console_builds/a1').steps.find((s) => s.id === 'first-deploy').detail, /try 3/);
});

test('a deploy that keeps failing leaves a readable record and tells operators, and a second run repairs it', async () => {
  const fake = setup({ cloud: { deployFailures: 3 } });
  assert.equal(await provision({ appId: 'a1', deps: fake.deps }), 1);
  const app = fake.db.read('applications/a1');
  assert.equal(app.status, 'building');
  assert.equal(app.buildStart.state, 'failed');
  const record = fake.db.read('console_builds/a1');
  assert.equal(record.state, 'failed');
  assert.equal(record.failedStep, 'first-deploy');
  assert.match(record.error, /First deploy: the deploy failed 3 times\. Last run: https:\/\/github\.example\/run\/3/);
  assert.equal(record.steps.at(-1).state, 'failed');
  const [notice] = notices(fake.mailer);
  assert.equal(notice.noticeKind, 'build-run-failed');
  assert.match(notice.problem, /the deploy failed 3 times/);
  assert.ok(fake.db.paths('console_audit/').map((p) => fake.db.read(p).action).includes('build-failed'));
  assert.ok(!fake.mailer.sent.some((m) => m.kind === 'status' && m.problem), 'a client sees only the status');
  assert.deepEqual([...new Set(statusMail(fake.mailer))], ['build-failed']);
  const owners = fake.mailer.sent.filter((m) => m.status === 'build-failed');
  assert.deepEqual(owners.map((m) => m.to).sort(), ['ana@example.org', 'bo@example.org']);
  assert.match(owners[0].link, /\/organizations\/o1\/applications\/a1$/);
  assert.ok(!JSON.stringify(owners).includes('github.example'), 'the Owners get no run address');

  assert.equal(await provision({ appId: 'a1', deps: fake.deps }), 0);
  assert.equal(fake.db.read('applications/a1').status, 'ready');
  assert.equal(fake.db.read('console_builds/a1').error, null);
  assert.equal(statusMail(fake.mailer).filter((s) => s === 'ready').length, 2, 'one email per Owner, once');
});

for (const allFail of [false, true]) {
  test(`a completed site stays ready when ${allFail ? 'all Owner emails fail' : 'one Owner email fails'}`, async () => {
    const fake = setup();
    const send = fake.mailer.sendStatusChange.bind(fake.mailer);
    const attempts = [];
    fake.mailer.sendStatusChange = async (message) => {
      if (message.status === 'ready') {
        attempts.push(message.to);
        if (allFail || message.to === 'ana@example.org') throw new Error(`mail refused for ${message.to}`);
      }
      return send(message);
    };
    assert.equal(await provision({ appId: 'a1', deps: fake.deps }), 0);
    assert.equal(fake.db.read('applications/a1').status, 'ready');
    const record = fake.db.read('console_builds/a1');
    assert.equal(record.state, 'done');
    assert.equal(record.error, null);
    assert.ok(record.ownersEmailedAt);
    assert.match(record.steps.find((step) => step.id === 'ready').detail, /some Owner emails could not be sent/);
    assert.deepEqual(attempts.sort(), ['ana@example.org', 'bo@example.org']);
    assert.ok(!statusMail(fake.mailer).includes('build-failed'));
    assert.equal(await provision({ appId: 'a1', deps: fake.deps }), 0);
    assert.equal(attempts.length, 2, 'no repeat notice attempt after the completed build');
  });
}

test('a second run after a finished build changes nothing and emails nobody', async () => {
  const fake = setup();
  await provision({ appId: 'a1', deps: fake.deps });
  await fake.db.collection('applications').doc('a1').update({ status: 'building' });
  fake.calls.length = 0;
  fake.commands.length = 0;
  const mailed = fake.mailer.sent.length;

  assert.equal(await provision({ appId: 'a1', deps: fake.deps }), 0);
  const writes = fake.calls.filter((c) => c.method !== 'GET' && !c.url.endsWith(':getIamPolicy') && !c.url.endsWith('/access_tokens'));
  assert.deepEqual(writes.map((c) => `${c.method} ${c.url}`), []);
  assert.deepEqual(fake.commands, []);
  assert.equal(fake.mailer.sent.length, mailed);
  const steps = fake.db.read('console_builds/a1').steps;
  assert.ok(steps.slice(0, 2).every((s) => s.detail === 'already right'), JSON.stringify(steps));
  assert.equal(fake.db.read('applications/a1').status, 'ready');
});

test('a retry after the token moved finds it in the client project', async () => {
  const fake = setup({ cloud: { deployFailures: 3 } });
  await provision({ appId: 'a1', deps: fake.deps });
  assert.equal(fake.consoleSecrets.store.size, 0);
  assert.equal(await provision({ appId: 'a1', deps: fake.deps }), 0);
  assert.equal(fake.clientSecrets.store.get('TICKETING_API_TOKEN'), STRIPE_TOKEN);
});

test('a retry after the endpoint was made keeps its platform ownership on the record', async () => {
  const fake = setup({ cloud: { deployFailures: 3 } });
  await provision({ appId: 'a1', deps: fake.deps });
  assert.equal(fake.db.read('console_builds/a1').stripeEndpointOwner, 'platform');
  assert.equal(await provision({ appId: 'a1', deps: fake.deps }), 0);
  assert.equal(fake.state.endpoints.length, 1, 'the retry reuses the endpoint');
  assert.equal(fake.db.read('console_builds/a1').stripeEndpointOwner, 'platform');
});

test('a signing secret that did not save is not paired with the new account\'s endpoint', async () => {
  const fake = setup();
  const stored = () => fake.clientSecrets.store.get('TICKETING_WEBHOOK_SECRET');
  assert.equal(await provision({ appId: 'a1', deps: fake.deps }), 0);
  await fake.clientSecrets.writeSecret('TICKETING_WEBHOOK_SECRET', 'whsec_account_a');
  await fake.db.doc('applications/a1').update({ status: 'building' });
  fake.state.endpoints = [];
  fake.state.stripeToken = `${STRIPE_TOKEN}2`;
  fake.consoleSecrets.store.set('connection-stripe-a1', fake.state.stripeToken);
  const writeSecret = fake.clientSecrets.writeSecret.bind(fake.clientSecrets);
  fake.clientSecrets.writeSecret = async (id, value) => {
    if (id === 'TICKETING_WEBHOOK_SECRET') throw new Error('no answer');
    return writeSecret(id, value);
  };
  assert.equal(await provision({ appId: 'a1', deps: fake.deps }), 1);
  assert.equal(stored(), 'whsec_account_a');
  assert.equal(fake.state.endpoints.length, 1, 'the new account has its endpoint, and the old secret');
  fake.clientSecrets.writeSecret = writeSecret;
  assert.equal(await provision({ appId: 'a1', deps: fake.deps }), 0);
  assert.equal(stored(), 'whsec_fixture');
  assert.equal(fake.state.endpoints.length, 1);
});

test('a retry on a replaced token deploys again, or the site keeps the old one', async () => {
  const fake = setup();
  const again = async () => {
    await fake.db.doc('applications/a1').update({ status: 'building' });
    fake.state.clock += 3600000;
    return provision({ appId: 'a1', deps: fake.deps });
  };
  const fullDeploys = () => fake.state.runs.filter((r) => r.display_title === 'Deploy nclocal').length;
  assert.equal(await provision({ appId: 'a1', deps: fake.deps }), 0);
  assert.equal(fullDeploys(), 1);
  assert.equal(await again(), 0);
  assert.equal(fullDeploys(), 1, 'nothing changed, so the earlier deploy counts');
  fake.state.stripeToken = `${STRIPE_TOKEN}2`;
  fake.consoleSecrets.store.set('connection-stripe-a1', fake.state.stripeToken);
  assert.equal(await again(), 0);
  assert.equal(fullDeploys(), 2);
  assert.equal(fake.state.runs.filter((r) => r.display_title.includes('bootstrap')).length, 1);
  assert.equal(await again(), 0);
  assert.equal(fullDeploys(), 2, 'the new deploy counts for the next retry');
});

test('a retry on another Eventbrite event registers its webhook and records the event', async () => {
  const request = eventbriteRequest();
  const fake = setup(request);
  const registrations = () => fake.commands.filter((c) => c.args[0] === 'scripts/register-ticketing-webhook.cjs');
  assert.equal(await provision({ appId: 'a1', deps: fake.deps }), 0);
  assert.equal(registrations().length, 1);
  const connections = { eventbrite: { ...request.app.connections.eventbrite, event: { id: '666', name: 'B' } } };
  await fake.db.doc('applications/a1').update({ status: 'building', connections });
  await fake.db.doc('console_connections/a1').set({ eventbrite: { ...request.accounts.eventbrite, eventOrganizationId: 'org-b' } });
  fake.state.clock += 3600000;
  assert.equal(await provision({ appId: 'a1', deps: fake.deps }), 0);
  assert.equal(registrations().length, 2);
  assert.equal(registrations()[1].env.EVENT_TICKETING_EVENT_ID, '666');
  assert.equal(registrations()[1].env.EVENT_TICKETING_ORGANIZATION_ID, 'org-b');
  const { ticketing } = (await fake.clientFirestore.collection('config').doc('providers').get()).data();
  assert.equal(ticketing.externalEventId, '666');
  assert.ok(ticketing.webhookRegisteredAt);
  assert.equal(fake.state.runs.filter((r) => r.display_title === 'Deploy nclocal').length, 2);
});

test('init-event gets no foreign quota project, and no credential it does not need', async () => {
  const fake = setup();
  await provision({ appId: 'a1', deps: fake.deps });
  const { env } = fake.commands.find((c) => c.args[0] === 'scripts/init-event.cjs');
  for (const name of ['GOOGLE_CLOUD_QUOTA_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'GCLOUD_PROJECT', 'GITHUB_TOKEN', 'CLOUDFLARE_API_TOKEN', 'POSTMARK_ACCOUNT_TOKEN', 'PROVISIONER_APP_PRIVATE_KEY', 'CONSOLE_POSTMARK_TOKEN']) {
    assert.equal(env[name], undefined, name);
  }
  assert.equal(env.EVENT_FIREBASE_PROJECT_ID, PROJECT);
  assert.equal(env.EVENT_STORAGE_BUCKET, `${PROJECT}.firebasestorage.app`);
});

test('a branding error is a failure, though init-event exits 0', async () => {
  const fake = setup({ branding: '  branding/         1 uploaded, 1 protected, 2 errors\n    warning: branding/logo.svg: User project specified in the request is invalid' });
  assert.equal(await provision({ appId: 'a1', deps: fake.deps }), 1);
  const record = fake.db.read('console_builds/a1');
  assert.equal(record.failedStep, 'seed');
  assert.match(record.error, /branding uploads failed/);
  const stored = (await fake.clientFirestore.collection('config').doc('event').get()).data();
  assert.notEqual(stored.sender.domainVerified, true, 'an unstamped site is seeded again');
});

test('a retry after a seed failure seeds again with --force', async () => {
  const fake = setup({ branding: '  branding/         0 uploaded, 0 protected, 4 errors' });
  await provision({ appId: 'a1', deps: fake.deps });
  fake.commands.length = 0;
  await provision({ appId: 'a1', deps: fake.deps }).catch(() => {});
  assert.ok(fake.commands[0].args.includes('--force'));
});

test('a retry builds in the region and folder the first run chose, even after the settings change', async () => {
  const fake = setup({ initCode: 1 });
  assert.equal(await provision({ appId: 'a1', deps: fake.deps }), 1);
  const first = fake.db.read('console_builds/a1').resources;
  assert.ok(first.region && first.gcpFolder);
  // An operator changes the console's default region and folder before the retry.
  const settings = fake.db.read('console_config/settings');
  await fake.db.collection('console_config').doc('settings').set({ ...settings, region: 'europe-west1', gcpFolder: 'folders/999999999999' });
  await provision({ appId: 'a1', deps: fake.deps }).catch(() => {});
  const retried = fake.db.read('console_builds/a1').resources;
  assert.equal(retried.region, first.region, 'the project and its data stay where the first run put them');
  assert.equal(retried.gcpFolder, first.gcpFolder);
});

test('brandingProblem reads the line init-event prints', () => {
  assert.equal(brandingProblem('  branding/         4 uploaded, 0 protected, 0 errors\n'), null);
  assert.equal(brandingProblem('  branding/         3 uploaded, 1 protected, 0 errors\n'), null);
  assert.match(brandingProblem('  branding/         skipped (--skip-branding)\n'), /result was missing/);
  assert.match(brandingProblem('nothing here'), /no branding line/);
});

test('a preserved client logo does not fail a build retry', async () => {
  const fake = setup({ branding: '  branding/         3 uploaded, 1 protected, 0 errors' });
  assert.equal(await provision({ appId: 'a1', deps: fake.deps }), 0);
  assert.equal(fake.db.read('applications/a1').status, 'ready');
});

test('init-event exiting with an error fails the step', async () => {
  const fake = setup({ initCode: 1 });
  assert.equal(await provision({ appId: 'a1', deps: fake.deps }), 1);
  assert.match(fake.db.read('console_builds/a1').error, /init-event exited 1/);
});

test('an unset input is a failed record, not a half-built site', async () => {
  const fake = setup({ env: { CLOUDFLARE_ZONE_ID: '', POSTMARK_ACCOUNT_TOKEN: ' ' } });
  assert.equal(await provision({ appId: 'a1', deps: fake.deps }), 1);
  assert.match(fake.db.read('console_builds/a1').error, /no value for CLOUDFLARE_ZONE_ID, POSTMARK_ACCOUNT_TOKEN/);
  assert.equal(fake.calls.length, 0);
  assert.equal(fake.db.read('applications/a1').status, 'approved');
  assert.ok(notices(fake.mailer).length > 0);
});

test('a project in another folder stops the build rather than taking it over', async () => {
  const fake = setup();
  fake.state.project = { name: `projects/${NUMBER}`, projectId: PROJECT, parent: 'folders/999', state: 'ACTIVE' };
  assert.equal(await provision({ appId: 'a1', deps: fake.deps }), 1);
  assert.match(fake.db.read('console_builds/a1').error, /outside the client folder/);
  assert.equal(fake.state.billing, '');
});

test('a project made for another request stops the build rather than sharing it', async () => {
  const fake = setup();
  fake.state.project = { name: `projects/${NUMBER}`, projectId: PROJECT, parent: 'folders/123456789012', labels: { 'eventrunner-request': 'someone-else' }, state: 'ACTIVE' };
  assert.equal(await provision({ appId: 'a1', deps: fake.deps }), 1);
  assert.match(fake.db.read('console_builds/a1').error, /was not made for this request/);
  assert.equal(fake.state.billing, '');
});

test('an Environment holding another owner\'s variables stops the build and is left alone', async () => {
  const fake = setup();
  const theirs = { deployment_branch_policy: { protected_branches: false, custom_branch_policies: false }, name: 'nclocal' };
  fake.state.environment = theirs;
  fake.state.variables = { WIF_PROVIDER: 'theirs' };
  assert.equal(await provision({ appId: 'a1', deps: fake.deps }), 1);
  assert.match(fake.db.read('console_builds/a1').error, /was not made for this request/);
  assert.deepEqual(fake.state.variables, { WIF_PROVIDER: 'theirs' });
  assert.equal(fake.state.environment, theirs);
});

test('a run that stops after creating an Environment can be retried, whatever it lost', async () => {
  for (const lost of ['failOwnerWrite', 'loseCreateAnswer']) {
    const fake = setup();
    fake.state[lost] = true;
    assert.equal(await provision({ appId: 'a1', deps: fake.deps }), 1, lost);
    assert.ok(fake.state.environment, lost);
    assert.deepEqual(fake.state.variables, {}, lost);
    fake.state[lost] = false;
    assert.equal(await provision({ appId: 'a1', deps: fake.deps }), 0, lost);
    assert.equal(fake.state.variables.EVENTRUNNER_REQUEST_ID, 'a1', lost);
  }
});

test('a request losing the race for an Environment name stops and removes nothing', async () => {
  const fake = setup();
  fake.state.ownerTaken = true;
  assert.equal(await provision({ appId: 'a1', deps: fake.deps }), 1);
  assert.match(fake.db.read('console_builds/a1').error, /EVENTRUNNER_REQUEST_ID/);
  assert.ok(fake.state.environment);
});

test('an existing Environment with no variables has no owner, so it stops the build', async () => {
  const fake = setup();
  const theirs = { deployment_branch_policy: { protected_branches: false, custom_branch_policies: false }, name: 'nclocal' };
  fake.state.environment = theirs;
  assert.equal(await provision({ appId: 'a1', deps: fake.deps }), 1);
  assert.match(fake.db.read('console_builds/a1').error, /was not made for this request/);
  assert.deepEqual(fake.state.variables, {});
  assert.equal(fake.state.environment, theirs);
});

test('settings an operator approved win over the console settings', async () => {
  const settings = { gcpFolder: 'folders/222222', billingAccount: 'AAAAAA-BBBBBB-CCCCCC', region: 'us-central1', projectId: PROJECT, environment: 'nclocal' };
  const reviewed = setup({ app: { review: { settings } } });
  assert.equal(await provision({ appId: 'a1', deps: reviewed.deps }), 0);
  assert.equal(reviewed.state.project.parent, 'folders/222222');
  assert.equal(reviewed.state.billing, 'billingAccounts/AAAAAA-BBBBBB-CCCCCC');
});

for (const [name, status, code] of [
  ['a site that is already ready', 'ready', 0],
  ['a launched site', 'launched', 0],
  ['a draft', 'draft', 2],
  ['a request waiting for review', 'submitted', 2],
  ['a declined request', 'declined', 2],
]) {
  test(`${name} starts nothing`, async () => {
    const fake = setup({ app: { status } });
    assert.equal(await provision({ appId: 'a1', deps: fake.deps }), code);
    assert.equal(fake.calls.length, 0);
    assert.equal(fake.db.read('console_builds/a1'), undefined);
    assert.equal(fake.db.read('applications/a1').status, status);
  });
}

test('a request that does not exist is an error', async () => {
  const fake = setup();
  assert.equal(await provision({ appId: 'gone', deps: fake.deps }), 2);
});

test('the workflow\'s last step records a run that stopped, once', async () => {
  const fake = setup({ app: { status: 'building' } });
  await fake.db.collection('console_builds').doc('a1').set({ state: 'running', steps: [{ id: 'project', state: 'running' }] });
  assert.equal(await markStopped({ appId: 'a1', deps: fake.deps }), 0);
  const record = fake.db.read('console_builds/a1');
  assert.equal(record.state, 'failed');
  assert.match(record.error, /stopped before it finished/);
  assert.equal(record.steps.length, 1);
  assert.equal(fake.db.read('applications/a1').buildStart.state, 'failed');
  assert.equal(notices(fake.mailer).length, 2);

  await markStopped({ appId: 'a1', deps: fake.deps });
  assert.equal(notices(fake.mailer).length, 2);
});

test('a retry made before the failed run\'s last step is not undone by that step', async () => {
  const fake = setup({ app: { status: 'building', buildStart: { state: 'pending', at: new Date() } } });
  const runUrl = 'https://github.com/o/r/actions/runs/77';
  await fake.db.collection('console_builds').doc('a1').set({ state: 'queued', runUrl, error: 'the first failure', steps: [] });
  await markStopped({ appId: 'a1', runId: '77', deps: fake.deps });
  assert.equal(fake.db.read('console_builds/a1').state, 'queued');
  assert.equal(fake.db.read('applications/a1').buildStart.state, 'pending');
  assert.equal(notices(fake.mailer).length, 0);

  // The retry's own run, dying before it writes, still gets recorded.
  await markStopped({ appId: 'a1', runId: '78', deps: fake.deps });
  assert.equal(fake.db.read('console_builds/a1').state, 'failed');
  assert.equal(fake.db.read('applications/a1').buildStart.state, 'failed');
});

test('--mark-stopped leaves a finished request alone', async () => {
  const fake = setup({ app: { status: 'ready' } });
  assert.equal(await main(['--application', 'a1', '--mark-stopped'], ENV, () => fake.deps), 0);
  assert.equal(fake.db.read('console_builds/a1'), undefined);
});

test('the id is checked before anything reads it', async () => {
  assert.deepEqual(parseArgs(['--application', 'app_1-A', '--test-mode']), { appId: 'app_1-A', testMode: true, markStopped: false });
  for (const argv of [[], ['--application'], ['--application', 'a;rm -rf /'], ['--application', '../x'], ['--application', 'a', '--nope']]) {
    assert.equal(parseArgs(argv), null, argv.join(' '));
  }
  const original = console.error;
  console.error = () => {};
  try {
    assert.equal(await main(['--application', 'a b'], ENV, () => { throw new Error('not reached'); }), 2);
  } finally {
    console.error = original;
  }
});

test('a run stops when the request closed after its first read', async () => {
  const fake = setup();
  const realTransaction = fake.db.runTransaction.bind(fake.db);
  let closed = false;
  fake.db.runTransaction = async (work) => {
    if (!closed) {
      closed = true;
      await fake.db.collection('applications').doc('a1').update({ status: 'declined' });
    }
    return realTransaction(work);
  };
  assert.equal(await provision({ appId: 'a1', deps: fake.deps }), 2);
  assert.equal(fake.db.read('console_builds/a1'), undefined, 'no run was recorded');
  assert.equal(fake.db.read('applications/a1').status, 'declined');
});

test('the private resource inventory retains deletion identities and DNS proof across retries', async () => {
  const fake = setup({ initCode: 1 });
  assert.equal(await provision({ appId: 'a1', deps: fake.deps }), 1);
  const resources = fake.db.read('console_builds/a1').resources;
  assert.equal(resources.projectId, PROJECT);
  assert.equal(resources.site, PROJECT);
  assert.deepEqual(resources.buckets, [`${PROJECT}.firebasestorage.app`]);
  assert.equal(resources.postmarkServerId, 3);
  assert.equal(resources.postmarkDomainId, 5);
  assert.equal(resources.githubEnvironment, 'nclocal');
  assert.equal(resources.dnsInventoryComplete, true);
  assert.ok(resources.dnsRecords.some((r) => r.name === `_acme-challenge.${DOMAIN}` && r.content === 'cert-proof'));
  assert.ok(resources.dnsRecords.some((r) => r.name === `pm._domainkey.${DOMAIN}` && r.content === 'k=rsa; p=key'));
  assert.ok(resources.dnsRecords.some((r) => r.name === `pm-bounces.${DOMAIN}`));
  assert.ok(resources.dnsRecords.every((r) => r.id && fake.state.dns.some((record) => record.id === r.id && record.type === r.type && record.name === r.name && record.content === r.content)));
  assert.ok(!JSON.stringify(resources).includes('server-token'));
  assert.equal(await provision({ appId: 'a1', deps: fake.deps }), 1);
  assert.deepEqual(fake.db.read('console_builds/a1').resources, resources, 'completed verification no longer exposes its original proof, so the inventory must persist');
});

test('a DNS write with a lost response retains its intent and records its id on retry', async () => {
  const fake = setup({ initCode: 1 });
  const fetch = fake.deps.fetch;
  let loseResponse = true;
  fake.deps.fetch = async (url, init) => {
    const response = await fetch(url, init);
    if (loseResponse && new URL(url).host === 'api.cloudflare.com' && init.method === 'POST') {
      loseResponse = false;
      throw new Error('lost response');
    }
    return response;
  };
  assert.equal(await provision({ appId: 'a1', deps: fake.deps }), 1);
  const intent = fake.db.read('console_builds/a1').resources.dnsRecords[0];
  assert.equal(intent.id, undefined);
  assert.equal(await provision({ appId: 'a1', deps: fake.deps }), 1, 'the retry reaches the later seed failure');
  const saved = fake.db.read('console_builds/a1').resources.dnsRecords.find((r) => r.type === intent.type && r.name === intent.name && r.content === intent.content);
  assert.equal(saved.id, fake.state.dns.find((r) => r.type === intent.type && r.name === intent.name && r.content === intent.content).id);
  assert.equal(fake.db.read('console_builds/a1').failedStep, 'seed');
});
