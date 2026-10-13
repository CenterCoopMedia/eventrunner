'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { makeFakeDb } = require('../cms/firestoreFake.cjs');
const registry = require('./providers/index.cjs');

// Exercise the deployed wrapper with real provider selection and endpoint
// factories. Only Firebase runtime entry points are replaced here.
function fixture(env, { failDatabase = false } = {}) {
  const db = makeFakeDb({ 'config/event': { historicalDemo: false } });
  const providerCalls = [];
  const errors = [];
  const module = { exports: {} };
  const dependencies = {
    '../core/firestore.cjs': { getDb() {
      if (failDatabase) throw new Error('private configuration failure');
      return db;
    } },
    '../core/config.cjs': { getEventConfig: async () => ({}) },
    'firebase-admin/auth': { getAuth: () => ({ verifyIdToken: async () => null }) },
    'firebase-functions/v2/https': { onRequest: (_options, handler) => handler },
    'firebase-functions/params': { defineSecret: (name) => name },
    './providers/index.cjs': { ...registry, getTicketingProvider(options) {
      providerCalls.push(options.env.EVENT_TICKETING_PROVIDER);
      return registry.getTicketingProvider(options);
    } },
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('./commerceHttp.cjs'), 'utf8'), {
    module, process: { env }, console: { error: (...args) => errors.push(args) },
    require: (name) => dependencies[name] || require(name),
  });
  const res = {
    statusCode: null, body: null, headers: {},
    set(name, value) { this.headers[name] = value; return this; },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; },
    send(value) { this.body = value; return this; },
  };
  return { handlers: module.exports.handlers, invokeCommerceHandler: module.exports.invokeCommerceHandler, res, providerCalls, errors };
}

test('native catalog for legacy providers is closed without constructing their payment adapters', async () => {
  for (const provider of ['none', 'manual', 'eventbrite']) {
    const { handlers, res, providerCalls } = fixture({ EVENT_TICKETING_PROVIDER: provider });
    await handlers.ticketingCatalog({ method: 'GET', headers: {} }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.provider, provider);
    assert.equal(res.body.salesEnabled, false);
    assert.deepEqual(providerCalls, []);
  }
});

test('native endpoint construction failures return a sanitized retryable response', async () => {
  for (const env of [
    {}, { EVENT_TICKETING_PROVIDER: 'unknown' },
    { EVENT_TICKETING_PROVIDER: 'stripe', EVENT_STRIPE_MODE: 'test' },
  ]) {
    const { handlers, res, errors } = fixture(env);
    await assert.doesNotReject(handlers.ticketingCatalog({ method: 'GET', headers: {} }, res));
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.error.code, 'ticketing-unavailable');
    assert.equal(res.headers['Cache-Control'], 'no-store');
    assert.doesNotMatch(JSON.stringify({ body: res.body, errors }), /EVENT_TICKETING|EVENT_STRIPE|Unknown EVENT/);
  }
});

test('dependency failures do not expose private exception details from any native endpoint', async () => {
  for (const [endpoint, method] of [['ticketingCatalog', 'GET'], ['ticketingCheckout', 'POST'], ['ticketingOrderStatus', 'GET']]) {
    const { handlers, res, errors } = fixture({ EVENT_TICKETING_PROVIDER: 'none' }, { failDatabase: true });
    await assert.doesNotReject(handlers[endpoint]({ method, headers: {} }, res));
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.error.code, 'ticketing-unavailable');
    assert.doesNotMatch(JSON.stringify({ body: res.body, errors }), /private configuration failure/);
  }
});

test('native CORS preflight does not need runtime provider configuration', async () => {
  const { handlers, res, providerCalls } = fixture({});
  await handlers.ticketingCheckout({ method: 'OPTIONS', headers: {} }, res);
  assert.equal(res.statusCode, 204);
  assert.deepEqual(providerCalls, []);
});

test('the shared invocation guard redacts an uncaught failure after dependency setup', async () => {
  const { invokeCommerceHandler, res, errors } = fixture({ EVENT_TICKETING_PROVIDER: 'none' });
  await invokeCommerceHandler(() => async () => { throw new Error('private database failure'); }, { method: 'POST', headers: {} }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error.code, 'ticketing-unavailable');
  assert.doesNotMatch(JSON.stringify({ body: res.body, errors }), /private database failure/);
});
