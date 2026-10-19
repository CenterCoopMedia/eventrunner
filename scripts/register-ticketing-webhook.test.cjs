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
    webhookEventTypes: ['order.placed', 'order.refunded'],
    registerWebhook: async (opts) => { calledWith = opts; return { webhookId: 'hook-42' }; },
  };
  const code = await run({ args: {}, env: ENV, deps: fakeDeps({ provider, db }) });
  assert.equal(code, 0);
  assert.equal(calledWith.callbackUrl, 'https://us-central1-demo-event.cloudfunctions.net/ticketingWebhook');
  assert.deepEqual(calledWith.events, ['order.placed', 'order.refunded'], 'the provider\'s own list is passed through');

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

test('the real Eventbrite adapter registers order.refunded, with the URL secret, through the operator script (issues 356, 357)', async () => {
  const { createEventbriteProvider, internals: eb } = require('../functions/src/ticketing/providers/eventbrite.cjs');
  const SECRET = 'fixture-url-secret-0123456789abcdef0123';
  const posts = [];
  const fetchImpl = async (url, opts = {}) => {
    const route = `${opts.method || 'GET'} ${url.replace(eb.API_BASE, '')}`;
    const routes = {
      'GET /users/me/organizations/': { organizations: [{ id: 'org-1' }] },
      'GET /organizations/org-1/webhooks/': { webhooks: [] },
      'POST /organizations/org-1/webhooks/': { id: 'hook-new' },
    };
    if (!(route in routes)) throw new Error(`no route for ${route}`);
    if (opts.method === 'POST') posts.push(JSON.parse(opts.body));
    return { status: 200, json: async () => routes[route] };
  };
  const provider = createEventbriteProvider({
    env: {
      TICKETING_API_TOKEN: 'fixture-api-token',
      TICKETING_WEBHOOK_SECRET: SECRET,
      EVENT_TICKETING_EVENT_ID: 'evt-1',
    },
    fetchImpl,
  });
  const db = makeFakeDb();
  const printed = [];
  const { log, error } = console;
  console.log = (...a) => printed.push(a.join(' '));
  console.error = (...a) => printed.push(a.join(' '));
  let code;
  try {
    code = await run({ args: {}, env: ENV, deps: fakeDeps({ provider, db }) });
  } finally {
    Object.assign(console, { log, error });
  }
  assert.equal(code, 0);
  assert.equal(posts.length, 1);
  const actions = posts[0].actions.split(',');
  for (const action of ['order.placed', 'order.updated', 'order.refunded', 'attendee.updated']) {
    assert.ok(actions.includes(action), `${action} is registered`);
  }
  // Issue 356: the registered URL carries the shared secret; the terminal never shows it.
  assert.equal(new URL(posts[0].endpoint_url).searchParams.get(eb.URL_SECRET_PARAM), SECRET);
  assert.equal(printed.join('\n').includes(SECRET), false);
});

test('internals.defaultCallbackUrl matches the ADR-shaped email-webhook example (§3.1)', () => {
  assert.equal(
    internals.defaultCallbackUrl({ projectId: 'demo-event', region: 'us-central1' }),
    'https://us-central1-demo-event.cloudfunctions.net/ticketingWebhook',
  );
});
