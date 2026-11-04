'use strict';

// The custom web address (ADR 0007 §8, P9a): the operator types a domain,
// the page shows the records to add, and checks run until the domain is live.
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
function fakeIdentity(domains = ['localhost', 'example-event.web.app']) {
  const calls = [];
  return { calls, domains, async addAuthorizedDomain(domain) { calls.push(domain); if (!this.domains.includes(domain)) this.domains.push(domain); } };
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

test('only an operator sees or changes the web address', async () => {
  const { call } = setup();
  assert.equal((await call({ action: 'status' }, 'staff')).statusCode, 403);
  const status = await call({ action: 'status' });
  assert.equal(status.statusCode, 200);
  assert.deepEqual(status.body, { domain: null, state: 'none', records: [], currentAddress: 'https://example-event.eventrunner.org', lastCheckedAt: null });
});

test('adding a domain asks hosting for it and shows the records to add', async () => {
  const { call, db, hosting } = setup();
  const res = await call({ action: 'add', domain: 'Summit.Example.org' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.domain, 'summit.example.org');
  assert.equal(res.body.state, 'records');
  assert.deepEqual(res.body.records, RECORDS);
  assert.deepEqual(hosting.calls, [['add', 'summit.example.org']]);
  const stored = db.read('web_address', 'current');
  assert.equal(stored.requestedBy, 'operator@example.org');
  assert.ok(db.ids('admin_logs').some((id) => db.read('admin_logs', id).action === 'webAddress.add'));
  // One custom address at a time.
  const second = await call({ action: 'add', domain: 'other.example.org' });
  assert.equal(second.statusCode, 409);
});

test('a bad domain is refused before hosting is asked', async () => {
  const { call, hosting } = setup();
  const res = await call({ action: 'add', domain: 'https://summit.example.org' });
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error.message, /domain/);
  assert.deepEqual(hosting.calls, []);
});

test('a check that finds the domain live adds it to sign-in and asks for the switch', async () => {
  const { call, hosting, identity, db } = setup();
  await call({ action: 'add', domain: 'summit.example.org' });
  const waiting = await call({ action: 'check' });
  assert.equal(waiting.body.state, 'records');
  assert.equal(waiting.body.lastCheckedAt, NOW.toISOString());
  assert.deepEqual(identity.calls, []);

  hosting.state.live = true;
  const live = await call({ action: 'check' });
  assert.equal(live.body.state, 'switch');
  assert.deepEqual(identity.calls, ['summit.example.org']);
  assert.ok(db.read('web_address', 'current').liveAt);
});

test('the address is done once the site runs on it', async () => {
  const { call } = setup({ hosting: fakeHosting({ live: true }), env: { EVENT_PUBLIC_URL: 'https://summit.example.org' } });
  await call({ action: 'add', domain: 'summit.example.org' });
  const res = await call({ action: 'check' });
  assert.equal(res.body.state, 'done');
});

test('removing the address asks hosting to drop it and clears the record', async () => {
  const { call, hosting, db } = setup();
  await call({ action: 'add', domain: 'summit.example.org' });
  const res = await call({ action: 'remove' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.state, 'none');
  assert.deepEqual(hosting.calls.at(-1), ['remove', 'summit.example.org']);
  assert.equal(db.read('web_address', 'current'), undefined);
});

test('a hosting failure is a plain retry message and keeps the stored state', async () => {
  const hosting = fakeHosting();
  hosting.addDomain = async () => { throw new Error('PERMISSION_DENIED firebasehosting'); };
  const { call, db } = setup({ hosting });
  const res = await call({ action: 'add', domain: 'summit.example.org' });
  assert.equal(res.statusCode, 503);
  assert.doesNotMatch(res.body.error.message, /PERMISSION|firebase/i);
  assert.equal(db.read('web_address', 'current'), undefined);
});

test('the scheduled check runs only while a domain waits', async () => {
  const { db, hosting, identity, call, env } = setup();
  assert.deepEqual(await runWebAddressCheck({ db, hosting, identity, env, now: () => NOW }), { checked: false });
  await call({ action: 'add', domain: 'summit.example.org' });
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
  const { db, hosting, identity, call, env } = setup();
  await call({ action: 'add', domain: 'summit.example.org' });
  await db.collection('config').doc('event').set({ historicalDemo: true });
  hosting.state.live = true;
  const result = await runWebAddressCheck({ db, hosting, identity, env, now: () => NOW });
  assert.equal(result.checked, false);
  assert.deepEqual(identity.calls, []);
  assert.equal(db.read('web_address', 'current').state, 'records');
});

test('a check still running when the address is removed does not bring it back', async () => {
  const { db, hosting, identity, call, env } = setup();
  await call({ action: 'add', domain: 'summit.example.org' });
  let release;
  hosting.readDomain = async () => { await new Promise((resolve) => { release = resolve; }); return { live: false, records: RECORDS }; };
  const check = runWebAddressCheck({ db, hosting, identity, env, now: () => NOW });
  await new Promise((resolve) => setImmediate(resolve));
  hosting.removeDomain = async () => {};
  await call({ action: 'remove' });
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
