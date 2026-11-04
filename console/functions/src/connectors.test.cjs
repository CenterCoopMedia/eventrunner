'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createConnectors, createEventbriteConnector, createStripeConnector } = require('./connectors.cjs');

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const redirectUri = 'https://console.example/connect/stripe/return';

/** A fetch that answers from a list in order and records each call. */
function fakeFetch(...answers) {
  const fetch = async (url, init = {}) => {
    fetch.calls.push({ url, ...init });
    const next = answers.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  fetch.calls = [];
  return fetch;
}

const stripe = (fetch) => createStripeConnector({ clientId: 'ca_1', secretKey: 'sk_test_platform', fetch });
const tokenAnswer = (overrides = {}) => json(200, {
  stripe_user_id: 'acct_abc', access_token: 'sk_test_client', scope: 'read_write', livemode: false, ...overrides,
});
const account = (overrides = {}) => json(200, { id: 'acct_abc', settings: { dashboard: { display_name: 'NC Local' } }, ...overrides });

test('the Stripe page is at Stripe, with the fixed scope and the state', () => {
  const url = new URL(stripe(fakeFetch()).authorizeUrl({ state: 's1', redirectUri }));
  assert.equal(url.origin + url.pathname, 'https://connect.stripe.com/oauth/authorize');
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    response_type: 'code', client_id: 'ca_1', scope: 'read_write', redirect_uri: redirectUri, state: 's1',
  });
});

test('a Stripe exchange posts the code with the platform key and returns the account', async () => {
  const fetch = fakeFetch(tokenAnswer(), account());
  const answer = await stripe(fetch).exchangeCode({ code: 'ac_1' });
  assert.deepEqual(answer, { token: 'sk_test_client', accountId: 'acct_abc', displayName: 'NC Local', details: { livemode: false } });
  const [post, read] = fetch.calls;
  assert.equal(post.url, 'https://connect.stripe.com/oauth/token');
  assert.equal(post.headers.Authorization, `Basic ${Buffer.from('sk_test_platform:').toString('base64')}`);
  assert.equal(post.body, 'grant_type=authorization_code&code=ac_1');
  assert.equal(read.url, 'https://api.stripe.com/v1/account');
  assert.equal(read.headers.Authorization, 'Bearer sk_test_client');
});

test('a Stripe answer with no usable token is refused and names the account to end', async () => {
  const bad = [
    { access_token: undefined },
    { access_token: 'not-a-key' },
    { access_token: 'sk_live_client', livemode: false },
    { access_token: 'sk_test_client', livemode: true },
    { scope: 'read_only' },
  ];
  for (const overrides of bad) {
    await assert.rejects(stripe(fakeFetch(tokenAnswer(overrides))).exchangeCode({ code: 'c' }), (err) => {
      assert.equal(err.accountId, 'acct_abc');
      return true;
    });
  }
});

test('a Stripe token that answers for another account is refused', async () => {
  await assert.rejects(stripe(fakeFetch(tokenAnswer(), account({ id: 'acct_other' }))).exchangeCode({ code: 'c' }), { accountId: 'acct_abc' });
});

test('the display name is a courtesy: a failed account read still connects', async () => {
  const answer = await stripe(fakeFetch(tokenAnswer(), new Error('down'))).exchangeCode({ code: 'c' });
  assert.equal(answer.displayName, null);
  assert.equal(answer.accountId, 'acct_abc');
});

test('a provider error never carries the code, the description or the key', async () => {
  const refused = json(400, { error: 'invalid_grant', error_description: 'Authorization code does not exist: ac_SECRETCODE' });
  await assert.rejects(stripe(fakeFetch(refused)).exchangeCode({ code: 'ac_SECRETCODE' }), (err) => {
    assert.equal(err.message, 'stripe exchange: HTTP 400 invalid_grant');
    assert.ok(!JSON.stringify({ ...err, message: err.message, stack: err.stack }).includes('SECRETCODE'));
    return true;
  });
  const strange = json(500, { error: 'ac_SECRET CODE <b>' });
  await assert.rejects(stripe(fakeFetch(strange)).exchangeCode({ code: 'x' }), { message: 'stripe exchange: HTTP 500' });
  const network = new Error('connect failed for sk_test_platform');
  await assert.rejects(stripe(fakeFetch(network)).exchangeCode({ code: 'x' }), { message: 'stripe exchange: no answer' });
});

test('a Stripe revoke deauthorizes the account', async () => {
  const fetch = fakeFetch(json(200, { stripe_user_id: 'acct_abc' }));
  assert.equal(await stripe(fetch).revoke('acct_abc'), true);
  assert.equal(fetch.calls[0].url, 'https://connect.stripe.com/oauth/deauthorize');
  assert.equal(fetch.calls[0].body, 'client_id=ca_1&stripe_user_id=acct_abc');
});

const eventbrite = (fetch) => createEventbriteConnector({ clientId: 'key1', clientSecret: 'shh', fetch });

test('the Eventbrite page is at Eventbrite, with the state', () => {
  const url = new URL(eventbrite(fakeFetch()).authorizeUrl({ state: 's1', redirectUri }));
  assert.equal(url.origin + url.pathname, 'https://www.eventbrite.com/oauth/authorize');
  assert.deepEqual(Object.fromEntries(url.searchParams), { response_type: 'code', client_id: 'key1', redirect_uri: redirectUri, state: 's1' });
});

test('an Eventbrite exchange posts the form and reads who connected', async () => {
  const fetch = fakeFetch(json(200, { access_token: 'ebtoken' }), json(200, { id: 555, name: 'Ana' }));
  const answer = await eventbrite(fetch).exchangeCode({ code: 'c1', redirectUri });
  assert.deepEqual(answer, { token: 'ebtoken', accountId: '555', displayName: 'Ana', details: {} });
  assert.equal(fetch.calls[0].url, 'https://www.eventbrite.com/oauth/token');
  assert.deepEqual(Object.fromEntries(new URLSearchParams(fetch.calls[0].body)), {
    grant_type: 'authorization_code', client_id: 'key1', client_secret: 'shh', code: 'c1', redirect_uri: redirectUri,
  });
  assert.equal(fetch.calls[1].url, 'https://www.eventbriteapi.com/v3/users/me/');
  assert.equal(fetch.calls[1].headers.Authorization, 'Bearer ebtoken');
});

test('an Eventbrite answer with no token is refused', async () => {
  await assert.rejects(eventbrite(fakeFetch(json(200, {}))).exchangeCode({ code: 'c', redirectUri }), { message: 'eventbrite exchange: no token' });
});

test('Eventbrite has no revoke, so the connector says it did not end the connection', async () => {
  const fetch = fakeFetch();
  assert.equal(await eventbrite(fetch).revoke('555'), false);
  assert.equal(fetch.calls.length, 0);
});

test('the event list covers every organization and follows the pages', async () => {
  const fetch = fakeFetch(
    json(200, { organizations: [{ id: 'o1' }, { id: 'o2' }], pagination: { has_more_items: false } }),
    json(200, { events: [{ id: 1, name: { text: 'One' }, start: { local: '2027-01-01T09:00:00' } }], pagination: { has_more_items: true, continuation: 'next' } }),
    json(200, { events: [{ id: 2, name: { text: '' }, start: { utc: '2027-02-01T09:00:00Z' } }], pagination: { has_more_items: false } }),
    json(200, { events: [{ id: 3, name: { text: 'Three' } }], pagination: { has_more_items: false } }),
  );
  assert.deepEqual(await eventbrite(fetch).listEvents('ebtoken'), [
    { id: '1', name: 'One', start: '2027-01-01T09:00:00', organizationId: 'o1' },
    { id: '2', name: 'Untitled event', start: '2027-02-01T09:00:00Z', organizationId: 'o1' },
    { id: '3', name: 'Three', start: null, organizationId: 'o2' },
  ]);
  const first = new URL(fetch.calls[1].url);
  assert.equal(first.pathname, '/v3/organizations/o1/events/');
  assert.equal(first.searchParams.get('status'), 'draft,live,started');
  assert.equal(new URL(fetch.calls[2].url).searchParams.get('continuation'), 'next');
});

test('a provider without settings has no connector', () => {
  const none = createConnectors({ env: {}, stripeSecretKey: 'sk', eventbriteClientSecret: 'shh', fetch: fakeFetch() });
  assert.deepEqual(none, { stripe: null, eventbrite: null });
  const noKey = createConnectors({ env: { CONSOLE_STRIPE_CLIENT_ID: 'ca_1' }, stripeSecretKey: '', eventbriteClientSecret: '', fetch: fakeFetch() });
  assert.equal(noKey.stripe, null);
  const both = createConnectors({
    env: { CONSOLE_STRIPE_CLIENT_ID: 'ca_1', CONSOLE_EVENTBRITE_CLIENT_ID: 'key1' }, stripeSecretKey: 'sk', eventbriteClientSecret: 'shh', fetch: fakeFetch(),
  });
  assert.ok(both.stripe && both.eventbrite);
});
