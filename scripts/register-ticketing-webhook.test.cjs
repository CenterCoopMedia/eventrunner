'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { run, internals } = require('./register-ticketing-webhook.cjs');
const { makeFakeDb } = require('../functions/src/cms/firestoreFake.cjs');

function fakeDeps({ provider, db }) {
  return {
    getTicketingProvider: () => provider,
    initFirebase: () => ({ db }),
  };
}

const ENV = {
  EVENT_TICKETING_PROVIDER: 'eventbrite',
  EVENT_FIREBASE_PROJECT_ID: 'demo-event',
  EVENT_FIREBASE_REGION: 'us-central1',
};

test('a webhook-capable provider registers and stamps config/providers.ticketing', async () => {
  const db = makeFakeDb();
  let calledWith = null;
  const provider = {
    name: 'eventbrite',
    registerWebhook: async (opts) => { calledWith = opts; return { webhookId: 'hook-42' }; },
  };
  const code = await run({ args: {}, env: ENV, deps: fakeDeps({ provider, db }) });
  assert.equal(code, 0);
  assert.equal(calledWith.callbackUrl, 'https://us-central1-demo-event.cloudfunctions.net/ticketingWebhook');
  assert.ok(Array.isArray(calledWith.events) && calledWith.events.includes('order.placed'));

  const providers = (await db.collection('config').doc('providers').get()).data();
  assert.equal(providers.ticketing.webhookId, 'hook-42');
  assert.ok(providers.ticketing.webhookRegisteredAt);
});

test('the merge preserves sibling config/providers fields (email, notifier, provider, externalEventId)', async () => {
  const db = makeFakeDb();
  await db.collection('config').doc('providers').set({
    email: { provider: 'postmark', messageStream: null },
    ticketing: { provider: 'eventbrite', externalEventId: 'evt-1', webhookRegisteredAt: null, webhookId: null },
    notifier: { sink: 'webhook', operatorEmail: null },
  });
  const provider = { name: 'eventbrite', registerWebhook: async () => ({ webhookId: 'hook-99' }) };
  const code = await run({ args: {}, env: ENV, deps: fakeDeps({ provider, db }) });
  assert.equal(code, 0);

  const providers = (await db.collection('config').doc('providers').get()).data();
  assert.equal(providers.email.provider, 'postmark', 'sibling top-level doc field untouched');
  assert.equal(providers.ticketing.provider, 'eventbrite', 'sibling ticketing field untouched');
  assert.equal(providers.ticketing.externalEventId, 'evt-1', 'sibling ticketing field untouched');
  assert.equal(providers.notifier.sink, 'webhook', 'sibling top-level doc field untouched');
  assert.equal(providers.ticketing.webhookId, 'hook-99');
});

test('a provider without registerWebhook (manual, none) exits 0 — capability, not enablement (§3.3)', async () => {
  const db = makeFakeDb();
  for (const name of ['manual', 'none']) {
    const code = await run({
      args: {},
      env: ENV,
      deps: fakeDeps({ provider: { name }, db }),
    });
    assert.equal(code, 0);
  }
  assert.equal((await db.collection('config').doc('providers').get()).exists, false);
});

test('--no-write registers with the provider but does not stamp Firestore', async () => {
  const db = makeFakeDb();
  const provider = { name: 'eventbrite', registerWebhook: async () => ({ webhookId: 'hook-1' }) };
  const code = await run({ args: { 'no-write': true }, env: ENV, deps: fakeDeps({ provider, db }) });
  assert.equal(code, 0);
  assert.equal((await db.collection('config').doc('providers').get()).exists, false);
});

test('--callback-url overrides the default', async () => {
  const db = makeFakeDb();
  let calledWith = null;
  const provider = {
    name: 'eventbrite',
    registerWebhook: async (opts) => { calledWith = opts; return { webhookId: 'hook-1' }; },
  };
  await run({
    args: { 'callback-url': 'https://example.org/hooks/ticketing' },
    env: ENV,
    deps: fakeDeps({ provider, db }),
  });
  assert.equal(calledWith.callbackUrl, 'https://example.org/hooks/ticketing');
});

test('no project id and no --callback-url exits 2', async () => {
  const db = makeFakeDb();
  const provider = { name: 'eventbrite', registerWebhook: async () => ({ webhookId: 'hook-1' }) };
  const code = await run({
    args: {},
    env: { EVENT_TICKETING_PROVIDER: 'eventbrite' },
    deps: fakeDeps({ provider, db }),
  });
  assert.equal(code, 2);
});

test('a misconfigured provider exits 2 rather than a raw throw', async () => {
  const code = await run({
    args: {},
    env: {},
    deps: {
      getTicketingProvider: () => { throw new Error('EVENT_TICKETING_PROVIDER is not set'); },
      initFirebase: () => ({ db: makeFakeDb() }),
    },
  });
  assert.equal(code, 2);
});

test('registerWebhook throwing exits 1, and stamps nothing', async () => {
  const db = makeFakeDb();
  const provider = { name: 'eventbrite', registerWebhook: async () => { throw new Error('eventbrite API down'); } };
  const code = await run({ args: {}, env: ENV, deps: fakeDeps({ provider, db }) });
  assert.equal(code, 1);
  assert.equal((await db.collection('config').doc('providers').get()).exists, false);
});

test('a webhookId-less result exits 1', async () => {
  const db = makeFakeDb();
  const provider = { name: 'eventbrite', registerWebhook: async () => ({}) };
  const code = await run({ args: {}, env: ENV, deps: fakeDeps({ provider, db }) });
  assert.equal(code, 1);
});

test('registerWebhook is idempotent from the operator side too — running it twice both times exits 0', async () => {
  const db = makeFakeDb();
  const provider = {
    name: 'eventbrite',
    // Models the adapter's own idempotence: same result whether created or reused.
    registerWebhook: async () => ({ webhookId: 'hook-stable' }),
  };
  const code1 = await run({ args: {}, env: ENV, deps: fakeDeps({ provider, db }) });
  const code2 = await run({ args: {}, env: ENV, deps: fakeDeps({ provider, db }) });
  assert.equal(code1, 0);
  assert.equal(code2, 0);
  const providers = (await db.collection('config').doc('providers').get()).data();
  assert.equal(providers.ticketing.webhookId, 'hook-stable');
});

test('internals.defaultCallbackUrl matches the ADR-shaped email-webhook example (§3.1)', () => {
  assert.equal(
    internals.defaultCallbackUrl({ projectId: 'demo-event', region: 'us-central1' }),
    'https://us-central1-demo-event.cloudfunctions.net/ticketingWebhook',
  );
});
