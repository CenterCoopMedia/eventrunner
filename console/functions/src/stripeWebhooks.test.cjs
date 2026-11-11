'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { webhooks } = require('stripe');
const { makeFakeDb, makeFakeSecrets, makeRes } = require('./fakes.cjs');
const { deleteStripeRoutes, registerStripeRoute, routeSecretId, stripeConnectWebhook, ticketWebhookUrl } = require('./stripeWebhooks.cjs');

const NOW = Date.parse('2026-11-11T22:00:00Z');
const PLATFORM_SECRET = 'whsec_platform_fixture';
const SITES = [
  { accountId: 'acct_one', appId: 'a1', projectId: 'er-first', region: 'us-central1', secret: 'whsec_first_fixture' },
  { accountId: 'acct_two', appId: 'a2', projectId: 'er-second', region: 'europe-west1', secret: 'whsec_second_fixture' },
];

function request(account = 'acct_one', { secret = PLATFORM_SECRET, timestamp = NOW / 1000, body = {}, raw = true } = {}) {
  const rawBody = Buffer.from(JSON.stringify({ object: 'event', id: 'evt_fixture', type: 'checkout.session.completed', account, livemode: true, ...body }, null, 2));
  return {
    method: 'POST', rawBody: raw ? rawBody : undefined,
    // A parsed or attacker-supplied body never supplies the routing account.
    body: { account: 'acct_two' },
    headers: { 'stripe-signature': webhooks.generateTestHeaderString({ payload: rawBody.toString(), secret, timestamp }) },
  };
}

function setup() {
  const db = makeFakeDb(Object.fromEntries(SITES.map(({ accountId, secret: _secret, ...route }) => [`console_stripe_routes/${accountId}`, route])));
  const secrets = makeFakeSecrets(Object.fromEntries(SITES.map((site) => [routeSecretId(site.appId), site.secret])));
  const calls = [];
  const logs = [];
  const deps = {
    db, secrets, endpointSecret: PLATFORM_SECRET, now: () => NOW,
    log: { warn: (...args) => logs.push(args) },
    fetch: async (url, init) => {
      calls.push({ url, ...init });
      return new Response(null, { status: 204 });
    },
  };
  const deliver = async (req, override = {}) => {
    const res = makeRes();
    await stripeConnectWebhook({ ...deps, ...override })(req, res);
    return res;
  };
  return { db, secrets, calls, logs, deps, deliver };
}

test('two signed connected accounts reach only their own site with the original bytes and the site signature', async () => {
  const { calls, deliver } = setup();
  for (const site of SITES) {
    const req = request(site.accountId);
    assert.equal((await deliver(req)).statusCode, 200);
    const call = calls.at(-1);
    assert.equal(call.url, ticketWebhookUrl(site));
    assert.strictEqual(call.body, req.rawBody);
    assert.equal(call.redirect, 'error');
    const received = webhooks.constructEvent(call.body, call.headers['Stripe-Signature'], site.secret, 300, undefined, NOW);
    assert.equal(received.account, site.accountId);
    const other = SITES.find((s) => s !== site);
    assert.throws(() => webhooks.constructEvent(call.body, call.headers['Stripe-Signature'], other.secret, 300, undefined, NOW));
  }
  assert.equal(calls.length, 2);
});

test('invalid signatures and expired replay timestamps fail before routing or reading site secrets', async () => {
  const { deliver, deps, calls } = setup();
  let reads = 0;
  const db = { collection() { reads += 1; throw new Error('must not read'); } };
  for (const req of [
    request('acct_one', { secret: 'whsec_wrong_fixture' }),
    request('acct_one', { timestamp: NOW / 1000 - 301 }),
    request('acct_one', { raw: false }),
  ]) assert.equal((await deliver(req, { ...deps, db })).statusCode, 400);
  assert.equal(reads, 0);
  assert.equal(calls.length, 0);
});

test('an unknown or missing account and test-mode payload never reach a site', async () => {
  const { deliver, calls } = setup();
  assert.equal((await deliver(request('acct_unknown'))).statusCode, 404);
  assert.equal((await deliver(request(null))).statusCode, 400);
  assert.equal((await deliver(request('acct_one', { body: { livemode: false } }))).statusCode, 400);
  assert.equal(calls.length, 0);
});

test('missing destination secrets, bad identities, timeouts and non-success replies remain retryable without forwarding elsewhere', async () => {
  const { deliver, secrets, db, calls, logs } = setup();
  await secrets.deleteSecret(routeSecretId('a1'));
  assert.equal((await deliver(request())).statusCode, 503);
  assert.equal(calls.length, 0);
  await secrets.writeSecret(routeSecretId('a1'), SITES[0].secret);
  await db.doc('console_stripe_routes/acct_one').update({ projectId: 'outside.invalid/path' });
  assert.equal((await deliver(request())).statusCode, 502);
  assert.equal(calls.length, 0);
  await db.doc('console_stripe_routes/acct_one').update({ projectId: SITES[0].projectId });
  assert.equal((await deliver(request(), { fetch: async () => new Response(null, { status: 503 }) })).statusCode, 502);
  assert.equal((await deliver(request(), { fetch: async () => { throw new Error(SITES[0].secret); } })).statusCode, 502);
  assert.equal(logs.at(-2)[1].destinationStatus, 503);
  assert.equal(logs.at(-1)[1].category, 'destination');
  assert.ok(!JSON.stringify(logs).includes(SITES[0].secret), 'raw errors and signing secrets never reach logs');
});

test('Stripe retries can repeat an event ID; a fresh valid timestamp is signed for the site idempotence check', async () => {
  const { deliver, calls } = setup();
  assert.equal((await deliver(request())).statusCode, 200);
  assert.equal((await deliver(request())).statusCode, 200);
  assert.equal(calls.length, 2);
});

test('route registration is retryable, refuses an account owned by another site, and replaces only its own old route', async () => {
  const db = makeFakeDb({ 'console_builds/a1': {}, 'console_builds/a2': {} });
  const secrets = makeFakeSecrets();
  const input = { db, secrets, ...SITES[0], recordRef: db.doc('console_builds/a1') };
  await registerStripeRoute(input);
  await registerStripeRoute(input);
  assert.deepEqual(db.paths('console_stripe_routes'), ['console_stripe_routes/acct_one']);
  assert.deepEqual(db.read('console_stripe_routes/acct_one'), { appId: 'a1', projectId: 'er-first', region: 'us-central1' });
  await assert.rejects(registerStripeRoute({ ...input, ...SITES[1], accountId: 'acct_one', recordRef: db.doc('console_builds/a2') }), /another site/);
  await registerStripeRoute({ ...input, accountId: 'acct_new' });
  assert.equal(db.read('console_stripe_routes/acct_one'), undefined);
  assert.equal(db.read('console_builds/a1').stripeRouteAccountId, 'acct_new');
  await assert.rejects(deleteStripeRoutes({ db, secrets, appId: 'a1', projectId: 'er-other' }), /another project/);
  secrets.failDelete = true;
  await assert.rejects(deleteStripeRoutes(input), /secret delete/);
  assert.equal(db.read('console_stripe_routes/acct_new'), undefined, 'a failed secret deletion cannot keep forwarding');
  secrets.failDelete = false;
  await deleteStripeRoutes(input);
  assert.equal(secrets.store.has(routeSecretId('a1')), false);
});
