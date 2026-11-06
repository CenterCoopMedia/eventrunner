'use strict';

// The team sets up domains. Admins can read status and check connections.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeFakeDb } = require('../cms/firestoreFake.cjs');
const {
  normalizeDomain, createWebAddressHandler, runWebAddressCheck, createHostingClient, createIdentityClient,
} = require('./webAddress.cjs');

const NOW = new Date('2026-11-04T15:00:00Z');
const auth = { async verifyIdToken(token) { return { uid: token, email: `${token}@example.org`, email_verified: true }; } };
const RECORDS = [
  { action: 'add', type: 'A', host: 'summit.example.org', value: '199.36.158.100' },
  { action: 'add', type: 'TXT', host: 'summit.example.org', value: 'hosting-site=example-event' },
  { action: 'remove', type: 'A', host: 'summit.example.org', value: '10.0.0.1' },
];

const CONNECTED = { 'web_address/current': { domain: 'summit.example.org', state: 'records', records: RECORDS, lastCheckedAt: null } };

function fakeHosting(state = {}) {
  const calls = [];
  return {
    calls,
    state: { live: false, records: RECORDS, ...state },
    async addDomain(domain) { calls.push(['add', domain]); return { records: this.state.records }; },
    async readDomain(domain) { calls.push(['read', domain]); return { live: this.state.live, records: this.state.live ? [] : this.state.records }; },
    async removeDomain(domain) { calls.push(['remove', domain]); },
  };
}
function fakeIdentity(domains = ['localhost', 'example-event.web.app', 'summit.example.org']) {
  const calls = [];
  return { calls, domains, async hasAuthorizedDomain(domain) { return this.domains.includes(domain); }, async removeAuthorizedDomain(domain) { this.domains = this.domains.filter((entry) => entry !== domain); }, async addAuthorizedDomain(domain) { calls.push(domain); if (!this.domains.includes(domain)) this.domains.push(domain); } };
}
function setup({ hosting = fakeHosting(), identity = fakeIdentity(), env = { EVENT_PUBLIC_URL: 'https://example-event.eventrunner.org' }, seed = {} } = {}) {
  const db = makeFakeDb({
    'config/bootstrap': { adminEmails: ['operator@example.org'], staffEmails: ['staff@example.org'] },
    'config/event': { historicalDemo: false },
    ...seed,
  });
  const handler = createWebAddressHandler({ db, auth, getConfig: async () => ({}), hosting, identity, env, now: () => NOW, log: { error() {} } });
  async function call(body, user = 'operator') {
    const res = { statusCode: 0, body: null, headers: {}, set(k, v) { this.headers[k] = v; return this; }, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
    await handler({ method: 'POST', body, headers: { authorization: `Bearer ${user}` } }, res);
    return res;
  }
  return { db, hosting, identity, call, env };
}

test('normalizeDomain takes a plain domain and refuses what cannot be one', () => {
  assert.equal(normalizeDomain(' Summit.Example.ORG. '), 'summit.example.org');
  assert.equal(normalizeDomain('https://summit.example.org/path'), null);
  for (const bad of ['localhost', 'example', '-bad.example.org', 'a..b.org', 'x'.repeat(64) + '.org', 'site.web.app', 'site.firebaseapp.com', 'event.eventrunner.org', 42]) {
    assert.equal(normalizeDomain(bad), null, String(bad));
  }
});

test('only an operator reads web address status', async () => {
  const { call } = setup();
  assert.equal((await call({ action: 'status' }, 'staff')).statusCode, 403);
  const status = await call({ action: 'status' });
  assert.equal(status.statusCode, 200);
  assert.deepEqual(status.body, { domain: null, state: 'none', records: [], currentAddress: 'https://example-event.eventrunner.org', lastCheckedAt: null });
});

test('all admin roles are refused add and remove calls without service calls or writes', async () => {
  for (const seed of [{}, CONNECTED]) {
    for (const user of ['operator', 'staff']) {
      for (const action of ['add', 'remove']) {
        const { call, hosting, identity, db } = setup({ seed });
        const before = db.read('web_address', 'current');
        const res = await call({ action, domain: 'summit.example.org' }, user);
        assert.equal(res.statusCode, 403);
        assert.equal(res.body.error.message, 'To add or remove a custom domain, contact us.');
        assert.deepEqual(hosting.calls, []);
        assert.deepEqual(identity.calls, []);
        assert.deepEqual(db.read('web_address', 'current'), before);
        assert.deepEqual(db.ids('admin_logs'), []);
      }
    }
  }
});

test('a check observes an already authorized live domain without granting sign-in', async () => {
  const { call, hosting, identity, db } = setup({ seed: CONNECTED });
  const waiting = await call({ action: 'check' });
  assert.equal(waiting.body.state, 'records');
  assert.equal(waiting.body.lastCheckedAt, NOW.toISOString());
  assert.deepEqual(identity.calls, []);

  hosting.state.live = true;
  const live = await call({ action: 'check' });
  assert.equal(live.body.state, 'switch');
  assert.deepEqual(identity.calls, []);
  assert.ok(db.read('web_address', 'current').liveAt);
});

test('the address is done once the site runs on it', async () => {
  const { call } = setup({ hosting: fakeHosting({ live: true }), env: { EVENT_PUBLIC_URL: 'https://summit.example.org' }, seed: CONNECTED });
  const res = await call({ action: 'check' });
  assert.equal(res.body.state, 'done');
});

test('a hosting failure is a plain retry message and keeps the stored state', async () => {
  const hosting = fakeHosting();
  hosting.readDomain = async () => { throw new Error('PERMISSION_DENIED firebasehosting'); };
  const { call, db } = setup({ hosting, seed: CONNECTED });
  const res = await call({ action: 'check' });
  assert.equal(res.statusCode, 503);
  assert.doesNotMatch(res.body.error.message, /PERMISSION|firebase/i);
  assert.deepEqual(db.read('web_address', 'current'), CONNECTED['web_address/current']);
});

test('the scheduled check runs only while a domain waits', async () => {
  const { db, hosting, identity, env } = setup();
  assert.deepEqual(await runWebAddressCheck({ db, hosting, identity, env, now: () => NOW }), { checked: false });
  await db.collection('web_address').doc('current').set(CONNECTED['web_address/current']);
  hosting.state.live = true;
  const result = await runWebAddressCheck({ db, hosting, identity, env, now: () => NOW });
  assert.equal(result.checked, true);
  assert.equal(db.read('web_address', 'current').state, 'switch');
});

test('the hosting client calls the Hosting API for this site and reads its records', async () => {
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    requests.push([init.method || 'GET', url]);
    return {
      ok: true, status: 200,
      async json() {
        return {
          hostState: 'HOST_ACTIVE', ownershipState: 'OWNERSHIP_ACTIVE', cert: { state: 'CERT_ACTIVE' },
          requiredDnsUpdates: { desired: [{ domainName: 'summit.example.org', records: [
            { domainName: 'summit.example.org', type: 'A', rdata: '199.36.158.100', requiredAction: 'ADD' },
            { domainName: 'summit.example.org', type: 'A', rdata: '10.0.0.1', requiredAction: 'NONE' },
            { domainName: 'summit.example.org', type: 'A', rdata: '10.0.0.2', requiredAction: 'REMOVE' },
          ] }] },
        };
      },
    };
  };
  const client = createHostingClient({ projectId: 'example-event', site: 'example-site', fetchImpl, getAccessToken: async () => 'token' });
  const read = await client.readDomain('summit.example.org');
  assert.equal(read.live, true);
  // Conflicting records Hosting wants removed are shown too, marked as such.
  assert.deepEqual(read.records, [
    { action: 'add', type: 'A', host: 'summit.example.org', value: '199.36.158.100' },
    { action: 'remove', type: 'A', host: 'summit.example.org', value: '10.0.0.2' },
  ]);
  assert.deepEqual(requests[0], ['GET', 'https://firebasehosting.googleapis.com/v1beta1/projects/example-event/sites/example-site/customDomains/summit.example.org']);
});

function hostingFetch(answers) {
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    const method = init.method || 'GET';
    requests.push([method, url]);
    const answer = answers.shift() || { status: 200, body: {} };
    return { ok: answer.status < 300, status: answer.status, async json() { return answer.body; } };
  };
  return { requests, client: createHostingClient({ projectId: 'example-event', site: 'example-site', fetchImpl, getAccessToken: async () => 'token' }) };
}
const BASE = 'https://firebasehosting.googleapis.com/v1beta1/projects/example-event/sites/example-site/customDomains';

test('adding a new domain creates it, and a slow operation still gives a record to check later', async () => {
  const { requests, client } = hostingFetch([
    { status: 404, body: {} },                       // not there yet
    { status: 200, body: { name: 'operations/1', done: false } },
    { status: 404, body: {} },                       // creation not finished
  ]);
  const added = await client.addDomain('summit.example.org');
  assert.deepEqual(added, { records: [] });
  assert.deepEqual(requests.map(([method, url]) => [method, url.replace(BASE, '')]), [
    ['GET', '/summit.example.org'], ['POST', '?customDomainId=summit.example.org'], ['GET', '/summit.example.org'],
  ]);
});

test('adding a domain Hosting already has reuses it, and a removed one is restored', async () => {
  const live = { hostState: 'HOST_ACTIVE', requiredDnsUpdates: { desired: [] } };
  const existing = hostingFetch([{ status: 200, body: live }]);
  await existing.client.addDomain('summit.example.org');
  assert.deepEqual(existing.requests.map(([method]) => method), ['GET']);

  const removed = hostingFetch([
    { status: 200, body: { ...live, deleteTime: '2026-11-01T00:00:00Z' } },
    { status: 200, body: { name: 'operations/2' } },
    { status: 200, body: live },
  ]);
  await removed.client.addDomain('summit.example.org');
  assert.deepEqual(removed.requests.map(([method, url]) => [method, url.replace(BASE, '')]), [
    ['GET', '/summit.example.org'], ['POST', '/summit.example.org:undelete'], ['GET', '/summit.example.org'],
  ]);
});

test('the scheduled check changes nothing on a read-only historical demo', async () => {
  const { db, hosting, identity, env } = setup();
  await db.collection('web_address').doc('current').set(CONNECTED['web_address/current']);
  await db.collection('config').doc('event').set({ historicalDemo: true });
  hosting.state.live = true;
  const result = await runWebAddressCheck({ db, hosting, identity, env, now: () => NOW });
  assert.equal(result.checked, false);
  assert.deepEqual(identity.calls, []);
  assert.equal(db.read('web_address', 'current').state, 'records');
});

test('a check still running when the address is removed does not bring it back', async () => {
  const { db, hosting, identity, env } = setup();
  await db.collection('web_address').doc('current').set(CONNECTED['web_address/current']);
  let release;
  hosting.readDomain = async () => { await new Promise((resolve) => { release = resolve; }); return { live: true, records: [] }; };
  const check = runWebAddressCheck({ db, hosting, identity, env, now: () => NOW });
  await new Promise((resolve) => setImmediate(resolve));
  await db.collection('web_address').doc('current').delete();
  release();
  await check;
  assert.equal(db.read('web_address', 'current'), undefined);
});

test('the identity client adds the domain to the authorized domains once', async () => {
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    requests.push([init.method || 'GET', url, init.body ? JSON.parse(init.body) : null]);
    return { ok: true, status: 200, async json() { return { authorizedDomains: ['localhost', 'example-event.web.app'] }; } };
  };
  const client = createIdentityClient({ projectId: 'example-event', fetchImpl, getAccessToken: async () => 'token' });
  await client.addAuthorizedDomain('summit.example.org');
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1], [
    'PATCH', 'https://identitytoolkit.googleapis.com/admin/v2/projects/example-event/config?updateMask=authorizedDomains',
    { authorizedDomains: ['localhost', 'example-event.web.app', 'summit.example.org'] },
  ]);
});

test('domain removal revokes sign-in before deleting Hosting and the stored record', async () => {
  const { removeWebAddress } = require('./webAddress.cjs');
  const { db, identity } = setup({ seed: CONNECTED });
  const hosting = { async removeDomain(domain) {
    assert.equal(identity.domains.includes(domain), false);
    assert.equal(db.read('web_address', 'current').state, 'removing');
  } };
  await removeWebAddress({ db, identity, hosting, domain: 'summit.example.org' });
  assert.equal(db.read('web_address', 'current'), undefined);
  assert.deepEqual(identity.domains, ['localhost', 'example-event.web.app']);
});

test('a failed sign-in revocation keeps a retryable domain record and never removes Hosting', async () => {
  const { removeWebAddress } = require('./webAddress.cjs');
  const { db } = setup({ seed: CONNECTED });
  let hostingCalled = false;
  await assert.rejects(removeWebAddress({ db, domain: 'summit.example.org',
    identity: { async removeAuthorizedDomain() { throw new Error('unavailable'); } },
    hosting: { async removeDomain() { hostingCalled = true; } },
  }));
  assert.equal(hostingCalled, false);
  assert.equal(db.read('web_address', 'current').state, 'removing');
});

test('Identity revocation preserves every unrelated authorized domain', async () => {
  const calls = [];
  const client = createIdentityClient({ projectId: 'example-event', getAccessToken: async () => 'token',
    fetchImpl: async (_url, init = {}) => {
      if (init.method === 'PATCH') calls.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: async () => ({ authorizedDomains: ['localhost', 'example-event.web.app', 'summit.example.org', 'other.example.org'] }) };
    },
  });
  await client.removeAuthorizedDomain('summit.example.org');
  assert.deepEqual(calls, [{ authorizedDomains: ['localhost', 'example-event.web.app', 'other.example.org'] }]);
});
