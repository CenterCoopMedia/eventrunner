'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { test } = require('node:test');
const {
  STATE_TTL_MS, chooseEventbriteEvent, completeConnection, connectionSecretId, deleteStoredConnection, disconnectAccount,
  listEventbriteEvents, readStoredConnection, startConnection,
} = require('./connections.cjs');
const { getApplication } = require('./applications.cjs');
const { submitApplication } = require('./applicationStatus.cjs');
const { approveApplication } = require('./reviewDecisions.cjs');
const { getApplicationForReview } = require('./reviewQueue.cjs');
const { connectionsAvailable } = require('./connectors.cjs');
const { makeFakeAuth, makeFakeConnector, makeFakeSecrets, makeReq, makeRes } = require('./fakes.cjs');
const { postEndpoint } = require('./http.cjs');
const { NOW, ana, applicationDoc, ben, cy, fakeMailer, ops, quietLog, seededDb, stripeConnection, validAnswers } = require('./testData.cjs');

const TOKEN = 'sk_test_THEsecretTOKEN';
const EB_TOKEN = 'THEeventbriteTOKEN';
const BASE = { orgId: 'o1', appId: 'a1' };
const PUBLIC_URL = 'https://console.example';

const stripeAnswer = (accountId = 'acct_new') => ({ token: TOKEN, accountId, displayName: 'NC Local', details: { livemode: false } });
const EVENTS = [
  { id: 'e1', name: 'Summit', start: '2027-05-13T09:00:00', organizationId: 'org9' },
  { id: 'e2', name: 'Dinner', start: null, organizationId: 'org9' },
];

function setup({ application = {}, extra = {} } = {}) {
  const db = seededDb({ 'applications/a1': applicationDoc({ connections: {}, ...application }), ...extra });
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
  const { connected, accountId, displayName, livemode, connectedBy } = stored(db).stripe;
  assert.deepEqual({ connected, accountId, displayName, livemode, connectedBy }, {
    connected: true, accountId: 'acct_new', displayName: 'NC Local', livemode: false, connectedBy: 'ana',
  });
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
      assert.match(err.message, /Start again from the tickets step/);
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

test('a failed token write puts the old state back and ends the new connection', async () => {
  const { db, secrets, stripe, deps } = setup({ application: { connections: { stripe: stripeConnection() } } });
  const state = await start(deps);
  secrets.failWrite = true;
  await assert.rejects(complete(deps, { state }), (err) => {
    assert.equal(err.status, 502);
    assert.equal(err.message, 'We could not connect your Stripe account. Try again.');
    return true;
  });
  assert.equal(stored(db).stripe.accountId, 'acct_client1');
  assert.deepEqual(stripe.revoked, ['acct_new']);
});

test('connecting a different account ends the old one, and the same account does not', async () => {
  const { stripe, deps } = setup({ application: { connections: { stripe: stripeConnection({ accountId: 'acct_old' }) } } });
  await complete(deps, { state: await start(deps) });
  assert.deepEqual(stripe.revoked, ['acct_old']);
  stripe.revoked.length = 0;
  await complete(deps, { state: await start(deps), code: 'code2' });
  assert.deepEqual(stripe.revoked, []);
});

test('reconnecting Eventbrite keeps the chosen event for the same account and clears it for another', async () => {
  const event = { id: 'e1', name: 'Summit', start: null, organizationId: 'org9' };
  const connection = { connected: true, accountId: '555', displayName: 'Ana', event };
  const { db, eventbrite, deps } = setup({ application: { connections: { eventbrite: connection } } });
  await complete(deps, { provider: 'eventbrite', state: await start(deps, 'eventbrite') });
  assert.equal(stored(db).eventbrite.event.id, 'e1');
  eventbrite.answer = { token: EB_TOKEN, accountId: '777', displayName: 'Other', details: {} };
  await complete(deps, { provider: 'eventbrite', state: await start(deps, 'eventbrite') });
  assert.equal(stored(db).eventbrite.event, null);
});

test('disconnect deletes the token, ends the connection and clears the state', async () => {
  const { db, secrets, stripe, deps } = setup({ application: { connections: { stripe: stripeConnection() } } });
  secrets.store.set('connection-stripe-a1', TOKEN);
  const { body } = await disconnectAccount(deps, { body: { ...BASE, provider: 'stripe' }, user: ana });
  assert.equal(secrets.store.size, 0);
  assert.deepEqual(stripe.revoked, ['acct_client1']);
  assert.equal(stored(db).stripe, undefined);
  assert.equal(body.revoked, true);
  assert.equal(body.connections.stripe.connected, false);
  assert.equal(body.errors['tickets.connection'], 'Connect your Stripe account.');
});

test('Eventbrite has no way to end a connection, so disconnect says so in its reply', async () => {
  const connection = { connected: true, accountId: '555', event: null };
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

test('a token that cannot be deleted keeps the connection, and says so', async () => {
  const { db, secrets, stripe, deps } = setup({ application: { connections: { stripe: stripeConnection() } } });
  secrets.store.set('connection-stripe-a1', TOKEN);
  secrets.failDelete = true;
  await assert.rejects(disconnectAccount(deps, { body: { ...BASE, provider: 'stripe' }, user: ana }), { status: 502, code: 'disconnect-failed' });
  assert.equal(stored(db).stripe.accountId, 'acct_client1');
  assert.deepEqual(stripe.revoked, []);
});

test('a sent request can change only the account it chose', async () => {
  for (const status of ['submitted', 'awaiting_payment']) {
    const { deps } = setup({ application: { status, frozen: validAnswers() } });
    await assert.rejects(startConnection(deps, { body: { ...BASE, provider: 'eventbrite' }, user: ana }), { status: 409, code: 'locked' });
    assert.ok(await start(deps, 'stripe'), status);
  }
});

test('from approval on, the connection cannot change', async () => {
  for (const status of ['approved', 'building', 'ready', 'launched']) {
    const { secrets, deps } = setup({ application: { status, frozen: validAnswers(), connections: { stripe: stripeConnection() } } });
    secrets.store.set('connection-stripe-a1', TOKEN);
    await assert.rejects(startConnection(deps, { body: { ...BASE, provider: 'stripe' }, user: ana }), { status: 409, code: 'locked' });
    await assert.rejects(disconnectAccount(deps, { body: { ...BASE, provider: 'stripe' }, user: ana }), { status: 409, code: 'locked' });
    assert.equal(secrets.store.size, 1, status);
  }
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
  const parts = setup({ application: { connections: { eventbrite: { connected: true, accountId: '555', displayName: 'Ana', event: null } }, ...application } });
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
  assert.deepEqual(stored(db).eventbrite.event, EVENTS[0]);
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

test('a request cannot be sent until the account it chose is connected', async () => {
  const { db, deps } = setup({
    extra: { 'organizations/o1/members/two': { uid: 'two', email: 'two@example.org', role: 'owner' }, 'site_names/nclocal': { appId: 'a1', orgId: 'o1' } },
  });
  const sending = { ...deps, mailer: fakeMailer(), publicUrl: '' };
  await assert.rejects(submitApplication(sending, { body: BASE, user: ana }), (err) => {
    assert.equal(err.code, 'incomplete');
    assert.equal(err.fields['tickets.connection'], 'Connect your Stripe account.');
    return true;
  });
  await complete(deps, { state: await start(deps) });
  await submitApplication(sending, { body: BASE, user: ana });
  assert.equal(db.read('applications/a1').status, 'submitted');
});

test('an operator cannot approve a request whose account was disconnected', async () => {
  const { db, deps } = setup({
    application: { status: 'submitted', frozen: validAnswers(), connections: {}, history: [{ status: 'submitted', at: new Date(NOW), by: 'ana', note: null }] },
    extra: { 'console_config/settings': { gcpFolder: 'folders/123456789012', billingAccount: '012345-6789AB-CDEF01', region: 'us-central1' } },
  });
  const review = { ...deps, mailer: fakeMailer() };
  await assert.rejects(approveApplication(review, { body: { appId: 'a1', revision: 1 }, user: ops }), { status: 409, code: 'connection-needed' });
  assert.equal(db.read('applications/a1').status, 'submitted');
  const { body } = await getApplicationForReview(deps, { body: { appId: 'a1' }, user: ops });
  assert.deepEqual(body.connection, { state: 'not_connected', label: 'Not connected yet' });
});

test('the review page shows the account and event, and notes test mode', async () => {
  const frozen = { ...validAnswers(), tickets: { choice: 'eventbrite' } };
  const connections = { eventbrite: { connected: true, accountId: '555', displayName: 'Ana', event: { id: 'e1', name: 'Summit' } } };
  const { deps } = setup({ application: { status: 'submitted', frozen, connections } });
  assert.equal((await getApplicationForReview(deps, { body: { appId: 'a1' }, user: ops })).body.connection.label, 'Connected: Ana Event: Summit');
  const { deps: stripeDeps } = setup({ application: { status: 'submitted', frozen: validAnswers(), connections: { stripe: stripeConnection() } } });
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
