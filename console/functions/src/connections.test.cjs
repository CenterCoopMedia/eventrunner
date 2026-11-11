'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { test } = require('node:test');
const {
  STATE_TTL_MS, chooseEventbriteEvent, completeConnection, connectionSecretId, deleteStoredConnection, disconnectAccount,
  listEventbriteEvents, readStoredConnection, startConnection,
} = require('./connections.cjs');
const { getApplication } = require('./applications.cjs');
const { acceptAgreement } = require('./agreementAcceptance.cjs');
const { getApplicationForReview } = require('./reviewQueue.cjs');
const { connectionsForClient, liveConnection } = require('./connectionState.cjs');
const { connectionsAvailable } = require('./connectors.cjs');
const { makeFakeAuth, makeFakeConnector, makeFakeSecrets, makeReq, makeRes } = require('./fakes.cjs');
const { postEndpoint } = require('./http.cjs');
const { NOW, ana, applicationDoc, ben, cy, fakeMailer, ops, quietLog, seededDb, signupTerms, stripeConnection, validAnswers } = require('./testData.cjs');

const TOKEN = 'sk_test_THEsecretTOKEN';
const AFTER_LEASE = 6 * 60 * 1000;
const EB_TOKEN = 'THEeventbriteTOKEN';
const BASE = { orgId: 'o1', appId: 'a1' };
const PUBLIC_URL = 'https://console.example';

const stripeAnswer = (accountId = 'acct_new') => ({ token: TOKEN, accountId, displayName: 'NC Local', details: { livemode: true } });
const EVENTS = [
  { id: 'e1', name: 'Summit', start: '2027-05-13T09:00:00', organizationId: 'org9' },
  { id: 'e2', name: 'Dinner', start: null, organizationId: 'org9' },
];

/** The private row of a request that has these connections. */
function accountsFor(connections = {}) {
  return {
    ...(connections.stripe ? { stripe: { accountId: 'acct_client1', connectedBy: 'ana' } } : {}),
    ...(connections.eventbrite ? { eventbrite: { accountId: '555', connectedBy: 'ana' } } : {}),
  };
}

function setup({ application = {}, accounts = accountsFor(application.connections), extra = {} } = {}) {
  const db = seededDb({
    'applications/a1': applicationDoc({ connections: {}, ...application }),
    'console_connections/a1': accounts,
    ...extra,
  });
  const secrets = makeFakeSecrets();
  const log = quietLog();
  const stripe = makeFakeConnector({ answer: stripeAnswer() });
  const eventbrite = makeFakeConnector({
    answer: { token: EB_TOKEN, accountId: '555', displayName: 'Ana', details: {} },
    events: EVENTS,
    revokes: false,
  });
  const deps = {
    db, secrets, log, publicUrl: PUBLIC_URL, now: () => NOW, connectors: { stripe, eventbrite },
    connectionsAvailable: { stripe: true, eventbrite: true },
  };
  return { db, secrets, log, stripe, eventbrite, deps };
}

/** The state a real start hands out, read from the authorize address. */
async function start(deps, provider = 'stripe', user = ana) {
  const { body } = await startConnection(deps, { body: { ...BASE, provider }, user });
  return new URL(body.url).searchParams.get('state');
}

const complete = (deps, fields, user = ana) => completeConnection(deps, { body: { provider: 'stripe', code: 'code1', ...fields }, user });
const stateRows = (db) => db.paths('console_connection_states/');
const stored = (db) => db.read('applications/a1').connections;
const privateRow = (db) => db.read('console_connections/a1');

test('an Owner gets the provider page, and only the hash of the state is stored', async () => {
  const { db, deps } = setup();
  const state = await start(deps);
  const hash = createHash('sha256').update(state).digest('hex');
  assert.deepEqual(stateRows(db), [`console_connection_states/${hash}`]);
  const row = db.read(`console_connection_states/${hash}`);
  assert.equal(row.uid, 'ana');
  assert.equal(row.appId, 'a1');
  assert.equal(row.provider, 'stripe');
  assert.equal(row.expiresAt.getTime(), NOW + STATE_TTL_MS);
  assert.ok(!JSON.stringify(row).includes(state));
});

test('the redirect address comes from the console setting, whatever the request says', async () => {
  const { deps } = setup();
  const { body } = await startConnection(deps, { body: { ...BASE, provider: 'stripe', redirectUri: 'https://evil.example', publicUrl: 'https://evil.example' }, user: ana });
  assert.equal(new URL(body.url).searchParams.get('redirect_uri'), `${PUBLIC_URL}/connect/stripe/return`);
});

test('only an Owner of this organization can start, disconnect or choose', async () => {
  // An Editor is told no. Someone outside the organization learns nothing.
  const refused = (err) => [403, 404].includes(err.status);
  const { db, deps } = setup();
  for (const user of [ben, cy, ops]) {
    await assert.rejects(startConnection(deps, { body: { ...BASE, provider: 'stripe' }, user }), refused);
    await assert.rejects(disconnectAccount(deps, { body: { ...BASE, provider: 'stripe' }, user }), refused);
    await assert.rejects(chooseEventbriteEvent(deps, { body: { ...BASE, eventId: 'e1' }, user }), refused);
    await assert.rejects(listEventbriteEvents(deps, { body: BASE, user }), refused);
  }
  assert.deepEqual(stateRows(db), []);
});

test('an unknown provider is refused', async () => {
  const { deps } = setup();
  await assert.rejects(startConnection(deps, { body: { ...BASE, provider: 'paypal' }, user: ana }), { status: 400 });
});

test('a provider the console has not set up says it is not available yet', async () => {
  const { deps } = setup();
  deps.connectors.stripe = null;
  await assert.rejects(startConnection(deps, { body: { ...BASE, provider: 'stripe' }, user: ana }), (err) => {
    assert.equal(err.status, 503);
    assert.match(err.message, /not available yet/);
    return true;
  });
});

test('completing stores the state in Firestore and the token only in Secret Manager', async () => {
  const { db, secrets, stripe, deps } = setup();
  const state = await start(deps);
  const { body } = await complete(deps, { state });
  assert.deepEqual(body, { connected: true, provider: 'stripe', orgId: 'o1', appId: 'a1' });
  assert.equal(secrets.store.get('connection-stripe-a1'), TOKEN);
  assert.equal(stripe.exchanged[0].code, 'code1');
  assert.equal(stripe.exchanged[0].redirectUri, `${PUBLIC_URL}/connect/stripe/return`);
  const { connected, displayName, livemode } = stored(db).stripe;
  assert.deepEqual({ connected, displayName, livemode }, { connected: true, displayName: 'NC Local', livemode: true });
  assert.deepEqual(privateRow(db).stripe, { accountId: 'acct_new', connectedBy: 'ana' });
});

test('no token reaches a response, a Firestore write or a log, through the HTTP wrapper', async () => {
  const { db, deps, log, stripe, secrets } = setup();
  const auth = makeFakeAuth({ good: { uid: 'ana', email: 'ana@example.org', email_verified: true } });
  const call = async (action, body) => {
    const res = makeRes();
    await postEndpoint({ auth, log }, (input) => action(deps, input))(makeReq({ body, token: 'good' }), res);
    return res;
  };
  const started = await call(startConnection, { ...BASE, provider: 'stripe' });
  const state = new URL(started.body.url).searchParams.get('state');
  const responses = [started.body];
  responses.push((await call(completeConnection, { provider: 'stripe', state, code: 'code1' })).body);
  responses.push((await call(getApplication, BASE)).body);

  // A failed token write must be just as quiet.
  secrets.failWrite = true;
  stripe.answer = stripeAnswer('acct_second');
  const again = new URL((await call(startConnection, { ...BASE, provider: 'stripe' })).body.url).searchParams.get('state');
  const failed = await call(completeConnection, { provider: 'stripe', state: again, code: 'code2' });
  assert.equal(failed.statusCode, 502);
  responses.push(failed.body);
  secrets.failWrite = false;
  responses.push((await call(disconnectAccount, { ...BASE, provider: 'stripe' })).body);

  const everything = JSON.stringify({ responses, logs: log.errors.map((args) => args.map(String)), docs: db.paths().map((p) => db.read(p)) });
  assert.ok(!everything.includes(TOKEN));
  assert.ok(!everything.includes('code1'));
  assert.ok(!everything.includes('code2'));
});

test('a state works once, and a used code is never sent to the provider again', async () => {
  const { stripe, deps, db } = setup();
  const state = await start(deps);
  await complete(deps, { state });
  await assert.rejects(complete(deps, { state }), { status: 400, code: 'state-mismatch' });
  assert.equal(stripe.exchanged.length, 1);
  assert.deepEqual(stateRows(db), []);
});

test('a state made up by someone else fails safely with plain words', async () => {
  const { stripe, secrets, deps } = setup();
  for (const state of ['made-up', '', undefined, 7, 'x'.repeat(500)]) {
    await assert.rejects(complete(deps, { state }), (err) => {
      assert.equal(err.status, 400);
      assert.equal(err.code, 'state-mismatch');
      assert.match(err.message, /Connect the account again/);
      return true;
    });
  }
  assert.equal(stripe.exchanged.length, 0);
  assert.equal(secrets.store.size, 0);
});

test('a state is bound to the user who started it, and using it wrongly uses it up', async () => {
  const { stripe, db, deps } = setup();
  const state = await start(deps);
  await assert.rejects(complete(deps, { state }, ben), { status: 400, code: 'state-mismatch' });
  assert.equal(stripe.exchanged.length, 0);
  assert.equal(stored(db).stripe, undefined);
  await assert.rejects(complete(deps, { state }), { code: 'state-mismatch' });
});

test('a state is bound to its provider', async () => {
  const { stripe, eventbrite, deps } = setup();
  const state = await start(deps, 'stripe');
  await assert.rejects(complete(deps, { state, provider: 'eventbrite' }), { code: 'state-mismatch' });
  assert.equal(stripe.exchanged.length + eventbrite.exchanged.length, 0);
});

test('a state is bound to the request: the reply names the request it was made for', async () => {
  const { deps } = setup();
  const state = await start(deps);
  const { body } = await complete(deps, { state, orgId: 'o2', appId: 'other' });
  assert.deepEqual([body.orgId, body.appId], ['o1', 'a1']);
});

test('an expired state is refused and not exchanged', async () => {
  const { stripe, deps } = setup();
  const state = await start(deps);
  deps.now = () => NOW + STATE_TTL_MS;
  await assert.rejects(complete(deps, { state }), { code: 'state-mismatch' });
  assert.equal(stripe.exchanged.length, 0);
});

test('a state still needs an Owner when it comes back', async () => {
  const { db, stripe, deps } = setup();
  const state = await start(deps);
  await db.doc('organizations/o1/members/ana').update({ role: 'editor' });
  await assert.rejects(complete(deps, { state }), { status: 403 });
  assert.equal(stripe.exchanged.length, 0);
});

test('a client who says no at the provider is told nothing went wrong, and the state is used up', async () => {
  const { db, stripe, deps } = setup();
  const state = await start(deps);
  const { body } = await complete(deps, { state, denied: true, code: undefined });
  assert.deepEqual(body, { connected: false, provider: 'stripe', orgId: 'o1', appId: 'a1' });
  assert.equal(stripe.exchanged.length, 0);
  assert.deepEqual(stateRows(db), []);
});

test('a failed exchange is a plain message with no provider words', async () => {
  const { stripe, deps } = setup();
  const state = await start(deps);
  stripe.exchangeError = new Error('stripe exchange: HTTP 400 invalid_grant');
  await assert.rejects(complete(deps, { state }), (err) => {
    assert.equal(err.status, 502);
    assert.equal(err.message, 'We could not connect your Stripe account. Try again.');
    return true;
  });
});

test('an exchange that made a connection the console cannot use ends that connection', async () => {
  const { db, secrets, stripe, deps } = setup();
  const state = await start(deps);
  stripe.exchangeError = Object.assign(new Error('stripe exchange: no usable account token'), { accountId: 'acct_half' });
  await assert.rejects(complete(deps, { state }), { status: 502 });
  assert.deepEqual(stripe.revoked, ['acct_half']);
  assert.equal(secrets.store.size, 0);
  assert.equal(stored(db).stripe, undefined);
});

test('a request that moved on during the exchange stores nothing and ends the new connection', async () => {
  const { db, secrets, stripe, deps } = setup();
  const state = await start(deps);
  const exchange = stripe.exchangeCode.bind(stripe);
  stripe.exchangeCode = async (input) => {
    await db.doc('applications/a1').update({ status: 'approved' });
    return exchange(input);
  };
  await assert.rejects(complete(deps, { state }), { status: 409 });
  assert.equal(secrets.store.size, 0);
  assert.deepEqual(stripe.revoked, ['acct_new']);
  assert.equal(stored(db).stripe, undefined);
});

test('a failed token write ends the connection, and connecting again ends the old account', async () => {
  const { db, secrets, stripe, deps } = setup({ application: { connections: { stripe: stripeConnection() } } });
  const state = await start(deps);
  secrets.failWrite = true;
  await assert.rejects(complete(deps, { state }), (err) => {
    assert.equal(err.status, 502);
    assert.equal(err.message, 'We could not connect your Stripe account. Try again in a few minutes.');
    return true;
  });
  assert.equal(liveConnection(stored(db), 'stripe'), null);
  assert.equal(privateRow(db).stripe.accountId, 'acct_client1');
  assert.deepEqual(stripe.revoked, ['acct_new']);
  secrets.failWrite = false;
  // A write that was only slow must not land on the next connection's token.
  await assert.rejects(complete(deps, { state: await start(deps) }), { status: 409, code: 'connection-busy' });
  deps.now = () => NOW + AFTER_LEASE;
  await complete(deps, { state: await start(deps) });
  assert.equal(stored(db).stripe.connected, true);
  // The refused try ended its own new connection, and the last one ended the old account.
  assert.deepEqual(stripe.revoked, ['acct_new', 'acct_new', 'acct_client1']);
});

test('connecting a different account ends the old one, and the same account does not', async () => {
  const { stripe, deps } = setup({
    application: { connections: { stripe: stripeConnection() } },
    accounts: { stripe: { accountId: 'acct_old', connectedBy: 'ana' } },
  });
  await complete(deps, { state: await start(deps) });
  assert.deepEqual(stripe.revoked, ['acct_old']);
  stripe.revoked.length = 0;
  await complete(deps, { state: await start(deps), code: 'code2' });
  assert.deepEqual(stripe.revoked, []);
});

test('reconnecting Eventbrite keeps the chosen event for the same account and clears it for another', async () => {
  const event = { id: 'e1', name: 'Summit', start: null };
  const connection = { connected: true, displayName: 'Ana', event };
  const { db, eventbrite, deps } = setup({
    application: { connections: { eventbrite: connection } },
    accounts: { eventbrite: { accountId: '555', connectedBy: 'ana', eventOrganizationId: 'org9' } },
  });
  await complete(deps, { provider: 'eventbrite', state: await start(deps, 'eventbrite') });
  assert.equal(stored(db).eventbrite.event.id, 'e1');
  assert.equal(privateRow(db).eventbrite.eventOrganizationId, 'org9');
  eventbrite.answer = { token: EB_TOKEN, accountId: '777', displayName: 'Other', details: {} };
  await complete(deps, { provider: 'eventbrite', state: await start(deps, 'eventbrite') });
  assert.equal(stored(db).eventbrite.event, null);
  assert.equal(privateRow(db).eventbrite.eventOrganizationId, undefined);
});

test('disconnect deletes the token, ends the connection and clears the state', async () => {
  const { db, secrets, stripe, deps } = setup({ application: { connections: { stripe: stripeConnection() } } });
  secrets.store.set('connection-stripe-a1', TOKEN);
  const { body } = await disconnectAccount(deps, { body: { ...BASE, provider: 'stripe' }, user: ana });
  assert.equal(secrets.store.size, 0);
  assert.deepEqual(stripe.revoked, ['acct_client1']);
  assert.equal(stored(db).stripe, undefined);
  assert.equal(privateRow(db).stripe, undefined);
  assert.equal(body.revoked, true);
  assert.equal(body.shared, false);
  assert.equal(body.connections.stripe.connected, false);
  assert.equal(body.errors['tickets.connection'], 'Connect your Stripe account.');
});

test('Eventbrite has no way to end a connection, so disconnect says so in its reply', async () => {
  const connection = { connected: true, event: null };
  const { secrets, deps } = setup({ application: { connections: { eventbrite: connection } } });
  secrets.store.set('connection-eventbrite-a1', EB_TOKEN);
  const { body } = await disconnectAccount(deps, { body: { ...BASE, provider: 'eventbrite' }, user: ana });
  assert.equal(secrets.store.size, 0);
  assert.equal(body.revoked, false);
});

test('a failed revoke does not stop a disconnect, and is logged without the token', async () => {
  const { db, secrets, stripe, log, deps } = setup({ application: { connections: { stripe: stripeConnection() } } });
  secrets.store.set('connection-stripe-a1', TOKEN);
  stripe.revokeError = new Error('stripe revoke: HTTP 500');
  const { body } = await disconnectAccount(deps, { body: { ...BASE, provider: 'stripe' }, user: ana });
  assert.equal(body.revoked, false);
  assert.equal(secrets.store.size, 0);
  assert.equal(stored(db).stripe, undefined);
  assert.equal(log.errors.length, 1);
  assert.ok(!JSON.stringify(log.errors).includes(TOKEN));
});

test('a failed token delete ends the connection and says so, and trying again ends the account', async () => {
  const { db, secrets, stripe, deps } = setup({ application: { connections: { stripe: stripeConnection() } } });
  secrets.store.set('connection-stripe-a1', TOKEN);
  secrets.failDelete = true;
  await assert.rejects(disconnectAccount(deps, { body: { ...BASE, provider: 'stripe' }, user: ana }), { status: 502, code: 'disconnect-failed' });
  assert.equal(liveConnection(stored(db), 'stripe'), null);
  assert.equal(privateRow(db).stripe.accountId, 'acct_client1');
  assert.deepEqual(stripe.revoked, []);
  secrets.failDelete = false;
  deps.now = () => NOW + AFTER_LEASE;
  await disconnectAccount(deps, { body: { ...BASE, provider: 'stripe' }, user: ana });
  assert.equal(secrets.store.has('connection-stripe-a1'), false);
  assert.deepEqual(stripe.revoked, ['acct_client1']);
});

test('a failed delete on a closed request still offers the Owner a way to end the account', async () => {
  const connections = { stripe: stripeConnection() };
  const { db, secrets, deps } = setup({ application: { status: 'withdrawn', connections } });
  secrets.store.set('connection-stripe-a1', TOKEN);
  secrets.failDelete = true;
  await assert.rejects(disconnectAccount(deps, { body: { ...BASE, provider: 'stripe' }, user: ana }), { status: 502 });
  const client = connectionsForClient(stored(db), { status: 'withdrawn', role: 'owner' });
  assert.equal(client.canDisconnect, true);
  assert.equal(client.stripe.connected, false);
  assert.equal(client.stripe.unfinished, true);
  assert.equal(client.eventbrite.unfinished, false);
});

test('from acceptance on, the connection cannot change while no build has failed', async () => {
  for (const status of ['approved', 'building', 'ready', 'launched']) {
    const { secrets, deps } = setup({
      application: { status, frozen: validAnswers(), buildStart: { state: 'started', at: new Date(NOW) }, connections: { stripe: stripeConnection() } },
      extra: { 'console_builds/a1': { state: 'running' } },
    });
    secrets.store.set('connection-stripe-a1', TOKEN);
    await assert.rejects(startConnection(deps, { body: { ...BASE, provider: 'stripe' }, user: ana }), { status: 409, code: 'locked' });
    if (!['ready', 'launched'].includes(status)) await assert.rejects(disconnectAccount(deps, { body: { ...BASE, provider: 'stripe' }, user: ana }), { status: 409, code: 'locked' });
    assert.equal(secrets.store.size, 1, status);
  }
});

/** A request whose build stopped at the ticket step. */
function failedBuild({ frozen = validAnswers(), connections = { stripe: stripeConnection() }, status = 'building' } = {}) {
  return setup({
    application: { status, frozen, buildStart: { state: 'started', at: new Date(NOW) }, connections },
    extra: { 'console_builds/a1': { state: 'failed', failedStep: 'tickets' } },
  });
}

test('after a failed build an Owner can reconnect the chosen account, and the answers stay frozen', async () => {
  const { db, secrets, deps } = failedBuild();
  const frozen = db.read('applications/a1').frozen;
  await complete(deps, { state: await start(deps, 'stripe') });
  assert.equal(secrets.store.get('connection-stripe-a1'), TOKEN);
  assert.equal(stored(db).stripe.connected, true);
  assert.deepEqual(db.read('applications/a1').frozen, frozen);
  assert.equal(db.read('applications/a1').status, 'building');
});

test('after a failed build only an Owner can reconnect, only the chosen account, and not disconnect it', async () => {
  const { secrets, deps } = failedBuild();
  secrets.store.set('connection-stripe-a1', TOKEN);
  await assert.rejects(startConnection(deps, { body: { ...BASE, provider: 'eventbrite' }, user: ana }), { status: 409, code: 'locked', message: 'Your request does not use this account.' });
  await assert.rejects(startConnection(deps, { body: { ...BASE, provider: 'stripe' }, user: ben }), { status: 403 });
  await assert.rejects(disconnectAccount(deps, { body: { ...BASE, provider: 'stripe' }, user: ana }), { status: 409, code: 'locked' });
  assert.equal(secrets.store.size, 1);
});

test('a reconnect started before a retry cannot finish after it', async () => {
  const { db, deps } = failedBuild();
  const state = await start(deps, 'stripe');
  await db.collection('console_builds').doc('a1').update({ state: 'queued' });
  await assert.rejects(complete(deps, { state }), { status: 409, code: 'locked' });
});

test('a reconnect to another Eventbrite account can choose its event after a failed build', async () => {
  const frozen = { ...validAnswers(), tickets: { choice: 'eventbrite' } };
  const { db, secrets, deps } = failedBuild({ frozen, connections: { eventbrite: { connected: true, displayName: 'Ana' } } });
  secrets.store.set('connection-eventbrite-a1', EB_TOKEN);
  await chooseEventbriteEvent(deps, { body: { ...BASE, eventId: 'e1' }, user: ana });
  assert.equal(stored(db).eventbrite.event.id, 'e1');
});

test('a closed request cannot connect, but its account can be disconnected without moving its deletion date', async () => {
  const updatedAt = new Date(NOW - 1000);
  const { db, secrets, deps } = setup({ application: { status: 'withdrawn', updatedAt, connections: { stripe: stripeConnection() } } });
  secrets.store.set('connection-stripe-a1', TOKEN);
  await assert.rejects(startConnection(deps, { body: { ...BASE, provider: 'stripe' }, user: ana }), { status: 409, code: 'locked' });
  await disconnectAccount(deps, { body: { ...BASE, provider: 'stripe' }, user: ana });
  assert.equal(secrets.store.size, 0);
  assert.equal(db.read('applications/a1').updatedAt.getTime(), updatedAt.getTime());
});

const eventbriteDeps = (application = {}) => {
  const parts = setup({ application: { connections: { eventbrite: { connected: true, displayName: 'Ana', event: null } }, ...application } });
  parts.secrets.store.set('connection-eventbrite-a1', EB_TOKEN);
  return parts;
};

test('the event list has no organization ids or tokens, and needs a connection', async () => {
  const { deps } = eventbriteDeps();
  const { body } = await listEventbriteEvents(deps, { body: BASE, user: ana });
  assert.deepEqual(body.events, [
    { id: 'e1', name: 'Summit', start: '2027-05-13T09:00:00' },
    { id: 'e2', name: 'Dinner', start: null },
  ]);
  const { deps: none } = setup();
  await assert.rejects(listEventbriteEvents(none, { body: BASE, user: ana }), { status: 409, code: 'not-connected' });
});

test('choosing an event saves what the site needs and clears the field error', async () => {
  const { db, deps } = eventbriteDeps({ answers: { ...validAnswers(), tickets: { choice: 'eventbrite' } } });
  const { body } = await chooseEventbriteEvent(deps, { body: { ...BASE, eventId: 'e1' }, user: ana });
  assert.deepEqual(stored(db).eventbrite.event, { id: 'e1', name: 'Summit', start: '2027-05-13T09:00:00' });
  assert.equal(privateRow(db).eventbrite.eventOrganizationId, 'org9');
  assert.equal(privateRow(db).eventbrite.accountId, '555');
  assert.deepEqual(body.errors, {});
  assert.equal(body.connections.eventbrite.event.name, 'Summit');
  assert.equal(body.connections.eventbrite.event.organizationId, undefined);
});

test('an event the account does not have is refused', async () => {
  const { db, deps } = eventbriteDeps();
  for (const eventId of ['e404', '', undefined, '../x']) {
    await assert.rejects(chooseEventbriteEvent(deps, { body: { ...BASE, eventId }, user: ana }), { status: 400 });
  }
  assert.equal(stored(db).eventbrite.event, null);
});

test('a stored token that is gone gives a plain message when reading events', async () => {
  const { secrets, deps } = eventbriteDeps();
  secrets.store.clear();
  await assert.rejects(listEventbriteEvents(deps, { body: BASE, user: ana }), { status: 502, code: 'events-failed' });
});

test('a new request cannot start its build until the account it chose is connected', async () => {
  const { db, deps } = setup({ extra: { 'site_names/nclocal': { appId: 'a1', orgId: 'o1' }, 'signup_links/paid-o1': { status: 'used', appId: 'a1', orgId: 'o1', usedBy: 'ana' }, ...signupTerms() } });
  const accepting = { ...deps, mailer: fakeMailer(), publicUrl: '', startBuild: async () => {} };
  const accept = { body: { ...BASE, accept: true, name: 'Ana Owner', legalName: 'NC Local Inc.', title: 'Director', version: 1 }, user: ana };
  await assert.rejects(acceptAgreement(accepting, accept), (err) => {
    assert.equal(err.code, 'incomplete');
    assert.equal(err.fields['tickets.connection'], 'Connect your Stripe account.');
    return true;
  });
  await complete(deps, { state: await start(deps) });
  await acceptAgreement(accepting, accept);
  assert.equal(db.read('applications/a1').status, 'approved');
});

test('the review page says when the account was disconnected', async () => {
  const { deps } = setup({ application: { status: 'approved', frozen: validAnswers(), connections: {} } });
  const { body } = await getApplicationForReview(deps, { body: { appId: 'a1' }, user: ops });
  assert.deepEqual(body.connection, { state: 'not_connected', label: 'Not connected yet' });
});

test('the review page shows the account and event, and notes test mode', async () => {
  const frozen = { ...validAnswers(), tickets: { choice: 'eventbrite' } };
  const connections = { eventbrite: { connected: true, displayName: 'Ana', event: { id: 'e1', name: 'Summit' } } };
  const { deps } = setup({ application: { status: 'approved', frozen, connections } });
  assert.equal((await getApplicationForReview(deps, { body: { appId: 'a1' }, user: ops })).body.connection.label, 'Connected: Ana Event: Summit');
  const { deps: stripeDeps } = setup({ application: { status: 'approved', frozen: validAnswers(), connections: { stripe: stripeConnection({ livemode: false }) } } });
  assert.equal((await getApplicationForReview(stripeDeps, { body: { appId: 'a1' }, user: ops })).body.connection.label, 'Connected: NC Local (test mode)');
});

test('the browser sees what it needs: no account id, and the buttons by role and status', async () => {
  const { deps } = setup({ application: { connections: { stripe: stripeConnection() } } });
  const owner = (await getApplication(deps, { body: BASE, user: ana })).body.application.connections;
  assert.equal(owner.canChange, true);
  assert.equal(owner.canDisconnect, true);
  assert.deepEqual(
    { available: owner.stripe.available, connected: owner.stripe.connected, displayName: owner.stripe.displayName },
    { available: true, connected: true, displayName: 'NC Local' },
  );
  assert.ok(!JSON.stringify(owner).includes('acct_'));
  const editor = (await getApplication(deps, { body: BASE, user: ben })).body.application.connections;
  assert.equal(editor.canChange, false);
  assert.equal(editor.canDisconnect, false);
  assert.equal(editor.stripe.connected, true);
});

test('a provider is available only when the console has its client id and address', () => {
  assert.deepEqual(connectionsAvailable({}), { stripe: false, eventbrite: false });
  assert.deepEqual(connectionsAvailable({ CONSOLE_STRIPE_CLIENT_ID: 'ca_1' }), { stripe: false, eventbrite: false });
  assert.deepEqual(connectionsAvailable({ CONSOLE_PUBLIC_URL: PUBLIC_URL, CONSOLE_STRIPE_CLIENT_ID: 'ca_1' }), { stripe: true, eventbrite: false });
});

test('the site builder can read a stored connection and delete the console\'s copy, keeping the state', async () => {
  const { db, secrets, stripe, deps } = setup({ application: { connections: { stripe: stripeConnection() } } });
  secrets.store.set(connectionSecretId('a1', 'stripe'), TOKEN);
  const read = await readStoredConnection(deps, 'a1', 'stripe');
  assert.equal(read.token, TOKEN);
  assert.equal(read.connection.accountId, 'acct_client1');
  assert.equal(await readStoredConnection(deps, 'a1', 'eventbrite'), null);
  assert.equal(await readStoredConnection(deps, 'nope', 'stripe'), null);
  await deleteStoredConnection(deps, 'a1', 'stripe');
  await deleteStoredConnection(deps, 'a1', 'stripe');
  assert.equal(secrets.store.size, 0);
  assert.deepEqual(stripe.revoked, []);
  assert.equal(stored(db).stripe.connected, true);
  assert.equal(await readStoredConnection(deps, 'a1', 'stripe'), null);
});

test('the document any member can read holds no account id, who connected, or organization id', async () => {
  const { db, deps } = setup({ application: { answers: { ...validAnswers(), tickets: { choice: 'eventbrite' } } } });
  await complete(deps, { provider: 'eventbrite', state: await start(deps, 'eventbrite') });
  deps.secrets.store.set('connection-eventbrite-a1', EB_TOKEN);
  await chooseEventbriteEvent(deps, { body: { ...BASE, eventId: 'e1' }, user: ana });
  await complete(deps, { state: await start(deps) });
  const readable = JSON.stringify(db.read('applications/a1').connections);
  for (const hidden of ['acct_new', '555', 'org9', 'connectedBy', 'accountId', 'organizationId']) {
    assert.ok(!readable.includes(hidden), hidden);
  }
  assert.equal(privateRow(db).stripe.accountId, 'acct_new');
  assert.equal(privateRow(db).eventbrite.accountId, '555');
});

/** Two requests on one Stripe account: a1 here, and a2 in another organization. */
function sharing({ a2Status = 'launched', a2Accounts = { stripe: { accountId: 'acct_client1', connectedBy: 'cy' } } } = {}) {
  return setup({
    application: { connections: { stripe: stripeConnection() } },
    extra: {
      'applications/a2': applicationDoc({ orgId: 'o2', status: a2Status, connections: { stripe: stripeConnection() } }),
      'console_connections/a2': a2Accounts,
    },
  });
}

const builtSite = (extra = {}) => setup({ application: { status: 'ready', connections: { stripe: stripeConnection() } }, extra });

test('an Owner can end a built site\'s Stripe connection at Stripe', async () => {
  const { db, stripe, deps } = builtSite();
  const { body } = await disconnectAccount(deps, { body: { ...BASE, provider: 'stripe' }, user: ana });
  assert.deepEqual(stripe.revoked, ['acct_client1']);
  assert.equal(body.revoked, true);
  assert.equal(stored(db).stripe, undefined);
  assert.equal(privateRow(db).stripe, undefined);
});

test('only an Owner can end a built site\'s Stripe connection', async () => {
  const { stripe, deps } = builtSite();
  for (const user of [ben, cy, ops]) {
    await assert.rejects(disconnectAccount(deps, { body: { ...BASE, provider: 'stripe' }, user }), (err) => [403, 404].includes(err.status));
  }
  assert.deepEqual(stripe.revoked, []);
});

test('a built site keeps its connection when Stripe does not end it', async () => {
  const { db, stripe, deps } = builtSite();
  stripe.revokeError = new Error('stripe revoke: no answer');
  await assert.rejects(disconnectAccount(deps, { body: { ...BASE, provider: 'stripe' }, user: ana }), { status: 502, code: 'disconnect-failed' });
  assert.equal(stored(db).stripe.connected, true);
  assert.equal(privateRow(db).stripe.accountId, 'acct_client1');
});

test('a built site cannot end a Stripe connection another site uses', async () => {
  const { db, stripe, deps } = builtSite({
    'applications/a2': applicationDoc({ orgId: 'o2', status: 'launched', connections: { stripe: stripeConnection() } }),
    'console_connections/a2': { stripe: { accountId: 'acct_client1', connectedBy: 'cy' } },
  });
  await assert.rejects(disconnectAccount(deps, { body: { ...BASE, provider: 'stripe' }, user: ana }), { status: 409, code: 'account-shared' });
  assert.deepEqual(stripe.revoked, []);
  assert.equal(stored(db).stripe.connected, true);
  assert.equal(db.read('console_connections/a2').stripe.accountId, 'acct_client1');
});

test('a built site\'s Eventbrite connection stays locked: an operator ends it', async () => {
  const { deps } = setup({ application: { status: 'ready', connections: { eventbrite: { connected: true, displayName: 'Ana', event: null } } } });
  await assert.rejects(disconnectAccount(deps, { body: { ...BASE, provider: 'eventbrite' }, user: ana }), { status: 409, code: 'locked' });
});

test('disconnecting one of two requests on an account keeps the connection for the other', async () => {
  const { db, secrets, stripe, deps } = sharing();
  secrets.store.set('connection-stripe-a1', TOKEN);
  secrets.store.set('connection-stripe-a2', 'sk_test_other');
  const { body } = await disconnectAccount(deps, { body: { ...BASE, provider: 'stripe' }, user: ana });
  assert.deepEqual(stripe.revoked, []);
  assert.equal(body.revoked, false);
  assert.equal(body.shared, true);
  assert.equal(secrets.store.has('connection-stripe-a1'), false, 'this request\'s own token is always deleted');
  assert.equal(secrets.store.get('connection-stripe-a2'), 'sk_test_other');
  assert.equal(privateRow(db).stripe, undefined);
  assert.equal(db.read('console_connections/a2').stripe.accountId, 'acct_client1');
});

test('the last request on an account ends the connection', async () => {
  const { db, stripe, deps } = sharing();
  await db.doc('console_connections/a2').set({});
  const { body } = await disconnectAccount(deps, { body: { ...BASE, provider: 'stripe' }, user: ana });
  assert.deepEqual(stripe.revoked, ['acct_client1']);
  assert.equal(body.shared, false);
});

test('a site whose application is gone still keeps the connection, through its private row', async () => {
  const { db, stripe, deps } = sharing();
  await db.doc('applications/a2').delete();
  await disconnectAccount(deps, { body: { ...BASE, provider: 'stripe' }, user: ana });
  assert.deepEqual(stripe.revoked, []);
});

test('moving a token to a client site leaves the row that keeps the connection', async () => {
  const { db, secrets, stripe, deps } = sharing({ a2Status: 'ready' });
  secrets.store.set('connection-stripe-a2', 'sk_test_other');
  await deleteStoredConnection(deps, 'a2', 'stripe');
  assert.equal(db.read('console_connections/a2').stripe.accountId, 'acct_client1');
  await disconnectAccount(deps, { body: { ...BASE, provider: 'stripe' }, user: ana });
  assert.deepEqual(stripe.revoked, []);
});

test('connecting a different account keeps the old one when another request uses it', async () => {
  // Two live Stripe accounts cannot both be connected (next test), so this runs in test mode.
  const { stripe, deps } = sharing();
  stripe.answer = { ...stripeAnswer(), details: { livemode: false } };
  await complete(deps, { state: await start(deps) });
  assert.deepEqual(stripe.revoked, []);
});

test('the same live Stripe account is refused for a second request', async () => {
  const { stripe, deps } = sharing();
  stripe.answer = stripeAnswer('acct_client1');
  await assert.rejects(complete(deps, { state: await start(deps) }), { status: 409 });
});

test('a disconnected site that still holds a platform endpoint keeps the one live Stripe slot', async () => {
  const { db, deps } = setup();
  await db.doc('console_builds/other').set({ state: 'done', stripeEndpointId: 'we_other', stripeEndpointOwner: 'platform' });
  await assert.rejects(complete(deps, { state: await start(deps) }), (err) => {
    assert.equal(err.status, 409);
    assert.match(err.message, /one live Stripe account/);
    return true;
  });
});

test('a second live Stripe account is refused while another request holds one, and the new account is let go', async () => {
  const { stripe, secrets, deps } = sharing();
  await assert.rejects(complete(deps, { state: await start(deps) }), (err) => {
    assert.equal(err.status, 409);
    assert.match(err.message, /one live Stripe account/);
    return true;
  });
  assert.equal(secrets.store.get('connection-stripe-a1'), undefined);
  assert.deepEqual(stripe.revoked, ['acct_new']);
});

test('a half-made connection, a late refusal and a failed write all keep an account another request uses', async () => {
  const half = sharing();
  half.stripe.exchangeError = Object.assign(new Error('stripe exchange: no usable account token'), { accountId: 'acct_client1' });
  await assert.rejects(complete(half.deps, { state: await start(half.deps) }), { status: 502 });
  assert.deepEqual(half.stripe.revoked, []);

  const late = sharing();
  late.stripe.answer = stripeAnswer('acct_client1');
  const state = await start(late.deps);
  // The status is checked before the exchange too, so move it during the exchange.
  const exchange = late.stripe.exchangeCode.bind(late.stripe);
  late.stripe.exchangeCode = async (input) => {
    await late.db.doc('applications/a1').update({ status: 'approved' });
    return exchange(input);
  };
  await assert.rejects(complete(late.deps, { state }), { status: 409 });
  assert.deepEqual(late.stripe.revoked, []);

  const write = sharing();
  // Test mode: a second request cannot hold a live Stripe account.
  write.stripe.answer = { ...stripeAnswer('acct_client1'), details: { livemode: false } };
  write.secrets.failWrite = true;
  await assert.rejects(complete(write.deps, { state: await start(write.deps) }), { status: 502 });
  assert.deepEqual(write.stripe.revoked, []);
});

test('when the console cannot check who uses an account, it keeps the connection and logs it', async () => {
  const { db, secrets, stripe, log, deps } = setup({ application: { connections: { stripe: stripeConnection() } } });
  secrets.store.set('connection-stripe-a1', TOKEN);
  const collection = db.collection;
  db.collection = (path) => {
    const ref = collection(path);
    if (path !== 'console_connections') return ref;
    return { ...ref, where() { throw new Error('index not ready'); } };
  };
  const { body } = await disconnectAccount(deps, { body: { ...BASE, provider: 'stripe' }, user: ana });
  assert.deepEqual(stripe.revoked, []);
  assert.equal(body.revoked, false);
  assert.equal(secrets.store.size, 0);
  assert.equal(log.errors.length, 1);
  assert.match(log.errors[0][0], /kept a connection/);
});

test('a request cannot go ahead while its token is being stored, and a failed store leaves it a draft', async () => {
  const { db, secrets, deps } = setup({ extra: { 'site_names/nclocal': { appId: 'a1', orgId: 'o1' }, ...signupTerms() } });
  const accepting = { ...deps, mailer: fakeMailer(), publicUrl: '' };
  const accept = { body: { ...BASE, accept: true, name: 'Ana Owner', legalName: 'NC Local Inc.', title: 'Director', version: 1 }, user: ana };
  const state = await start(deps);
  secrets.writeSecret = async () => {
    await assert.rejects(acceptAgreement(accepting, accept), { code: 'incomplete' });
    throw new Error('secret add: HTTP 500');
  };
  await assert.rejects(complete(deps, { state }), { code: 'connection-failed' });
  assert.equal(db.read('applications/a1').status, 'draft');
  assert.equal(liveConnection(stored(db), 'stripe'), null);
});

test('a connection finishing during a disconnect is refused, so no token is deleted from under it', async () => {
  const { db, secrets, stripe, deps } = setup({ application: { connections: { stripe: stripeConnection() } } });
  secrets.store.set('connection-stripe-a1', TOKEN);
  const state = await start(deps);
  const remove = secrets.deleteSecret.bind(secrets);
  secrets.deleteSecret = async (id) => {
    await assert.rejects(complete(deps, { state }), { code: 'connection-busy' });
    await remove(id);
  };
  await disconnectAccount(deps, { body: { ...BASE, provider: 'stripe' }, user: ana });
  assert.equal(stored(db).stripe, undefined);
  assert.equal(privateRow(db).stripe, undefined);
  assert.equal(secrets.store.size, 0);
  assert.ok(stripe.revoked.includes('acct_new'));
});

test('a disconnect during a connection is refused, and the connection finishes with its token', async () => {
  const { db, secrets, deps } = setup();
  const state = await start(deps);
  const write = secrets.writeSecret.bind(secrets);
  secrets.writeSecret = async (id, value) => {
    await assert.rejects(disconnectAccount(deps, { body: { ...BASE, provider: 'stripe' }, user: ana }), { code: 'connection-busy' });
    await write(id, value);
  };
  await complete(deps, { state });
  assert.equal(stored(db).stripe.connected, true);
  assert.equal(stored(db).stripe.change, undefined);
  assert.equal(secrets.store.get('connection-stripe-a1'), TOKEN);
});

test('a change that never finished holds the account only until its time is up', async () => {
  const change = (until) => ({ connections: { stripe: { connected: false, change: { id: 'dead', until: new Date(until) } } } });
  const held = setup({ application: change(NOW + 1000), accounts: {} });
  await assert.rejects(complete(held.deps, { state: await start(held.deps) }), { code: 'connection-busy' });
  const expired = setup({ application: change(NOW - 1), accounts: {} });
  await complete(expired.deps, { state: await start(expired.deps) });
  assert.equal(stored(expired.db).stripe.connected, true);
});

test('an event read from an earlier account is not saved on the new one', async () => {
  const { db, secrets, eventbrite, deps } = setup({ application: { connections: { eventbrite: { connected: true, displayName: 'Ana', event: null } } } });
  secrets.store.set('connection-eventbrite-a1', EB_TOKEN);
  eventbrite.listEvents = async () => {
    await db.collection('console_connections').doc('a1').set({ eventbrite: { accountId: '777', connectedBy: 'ana' } });
    return EVENTS;
  };
  await assert.rejects(chooseEventbriteEvent(deps, { body: { ...BASE, eventId: 'e1' }, user: ana }), { code: 'account-changed' });
  assert.equal(stored(db).eventbrite.event, null);
});
