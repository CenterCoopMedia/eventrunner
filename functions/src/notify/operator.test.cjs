'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createOperatorNotifier, internals } = require('./operator.cjs');

// --- Fakes -----------------------------------------------------------------

const WEBHOOK_ENV = {
  EVENT_OPERATOR_NOTIFIER: 'webhook',
  EVENT_SLUG: 'ex27',
  EVENT_FIREBASE_PROJECT_ID: 'proj-1',
  OPERATOR_WEBHOOK_URL: 'https://ops.example/notify',
  OPERATOR_WEBHOOK_SECRET: 'op-secret',
};

const EMAIL_ENV = {
  EVENT_OPERATOR_NOTIFIER: 'email',
  EVENT_SLUG: 'ex27',
  EVENT_FIREBASE_PROJECT_ID: 'proj-1',
};

const CONFIG = {
  event: { shortName: 'EX27' },
  providers: { notifier: { operatorEmail: 'ops@example.com' } },
};

function fakeGetConfig(config = CONFIG) {
  return async () => config;
}

/** fetch fake capturing calls and returning 200s. */
function fakeFetch({ status = 200 } = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return { status, text: async () => '' };
  };
  impl.calls = calls;
  return impl;
}

function fakeSendEmail(result = { providerMessageId: 'pm-1', status: 'sent', retries: 0 }) {
  const calls = [];
  const impl = async (message) => {
    calls.push(message);
    return result;
  };
  impl.calls = calls;
  return impl;
}

/** log.warn capture. */
function fakeLog() {
  const warns = [];
  return { warn: (...args) => warns.push(args), warns };
}

const EVENT = { kind: 'error', title: 'db down', summary: 'primary unreachable' };

test.beforeEach(() => internals.resetDedupeForTest());

// --- Sink dispatch -----------------------------------------------------------

test('dispatches to the webhook sink with the enriched payload', async () => {
  const fetchImpl = fakeFetch();
  const notifier = createOperatorNotifier({
    env: WEBHOOK_ENV,
    getConfig: fakeGetConfig(),
    fetchImpl,
    now: () => Date.parse('2026-08-19T12:00:00.000Z'),
  });

  assert.equal(notifier.name, 'webhook');
  const result = await notifier.notify(EVENT);

  assert.deepEqual(result, { delivered: true, sink: 'webhook' });
  assert.equal(fetchImpl.calls.length, 1);
  const payload = JSON.parse(fetchImpl.calls[0].init.body);
  assert.equal(payload.title, '[EX27] db down');
  assert.equal(payload.kind, 'error');
  assert.equal(payload.summary, 'primary unreachable');
  assert.equal(payload.deployment, 'ex27');
  assert.equal(payload.projectId, 'proj-1');
  assert.equal(payload.timestamp, '2026-08-19T12:00:00.000Z');
});

test('dispatches to the email sink with operatorEmail from config/providers', async () => {
  const sendEmail = fakeSendEmail();
  const notifier = createOperatorNotifier({
    env: EMAIL_ENV,
    getConfig: fakeGetConfig(),
    sendEmail,
  });

  assert.equal(notifier.name, 'email');
  const result = await notifier.notify(EVENT);

  assert.deepEqual(result, { delivered: true, sink: 'email' });
  assert.equal(sendEmail.calls.length, 1);
  assert.equal(sendEmail.calls[0].to, 'ops@example.com');
  assert.equal(sendEmail.calls[0].subject, '[ex27] ERROR: [EX27] db down');
});

test("'none' (and unset) short-circuits without loading config", async () => {
  let configLoads = 0;
  const getConfig = async () => {
    configLoads += 1;
    return CONFIG;
  };
  for (const env of [{ EVENT_OPERATOR_NOTIFIER: 'none' }, {}]) {
    const notifier = createOperatorNotifier({ env, getConfig });
    assert.equal(notifier.name, 'none');
    assert.deepEqual(await notifier.notify(EVENT), { delivered: false, sink: 'none' });
  }
  assert.equal(configLoads, 0);
});

// --- Title prefixing ---------------------------------------------------------

test('title is not prefixed when config/event.shortName is absent', async () => {
  const fetchImpl = fakeFetch();
  const notifier = createOperatorNotifier({
    env: WEBHOOK_ENV,
    getConfig: fakeGetConfig({ event: null }),
    fetchImpl,
  });
  await notifier.notify(EVENT);
  const payload = JSON.parse(fetchImpl.calls[0].init.body);
  assert.equal(payload.title, 'db down');
});

// --- Dedupe window -----------------------------------------------------------

test('a repeat within 5 minutes is suppressed without calling the sink', async () => {
  let nowMs = 1_000_000;
  const fetchImpl = fakeFetch();
  const notifier = createOperatorNotifier({
    env: WEBHOOK_ENV,
    getConfig: fakeGetConfig(),
    fetchImpl,
    now: () => nowMs,
  });

  const event = { ...EVENT, dedupeKey: 'db-down' };
  assert.equal((await notifier.notify(event)).delivered, true);

  nowMs += internals.DEDUPE_WINDOW_MS - 1;
  assert.deepEqual(await notifier.notify(event), {
    delivered: false, sink: 'webhook', error: 'suppressed-duplicate',
  });
  assert.equal(fetchImpl.calls.length, 1);

  // After the window the key is pruned and the event delivers again.
  nowMs += 2;
  assert.equal((await notifier.notify(event)).delivered, true);
  assert.equal(fetchImpl.calls.length, 2);
});

test('distinct dedupeKeys (and no key) are never suppressed', async () => {
  const fetchImpl = fakeFetch();
  const notifier = createOperatorNotifier({
    env: WEBHOOK_ENV, getConfig: fakeGetConfig(), fetchImpl, now: () => 5,
  });
  assert.equal((await notifier.notify({ ...EVENT, dedupeKey: 'a' })).delivered, true);
  assert.equal((await notifier.notify({ ...EVENT, dedupeKey: 'b' })).delivered, true);
  assert.equal((await notifier.notify(EVENT)).delivered, true);
  assert.equal((await notifier.notify(EVENT)).delivered, true);
  assert.equal(fetchImpl.calls.length, 4);
});

// --- Never throws ------------------------------------------------------------

test('a rejecting getConfig is logged and returned, never thrown', async () => {
  const log = fakeLog();
  const notifier = createOperatorNotifier({
    env: WEBHOOK_ENV,
    getConfig: async () => { throw new Error('firestore unavailable'); },
    fetchImpl: fakeFetch(),
    log,
  });
  const result = await notifier.notify(EVENT);
  assert.deepEqual(result, {
    delivered: false, sink: 'webhook', error: 'firestore unavailable',
  });
  assert.equal(log.warns.length, 1);
});

test('a sink construction failure (missing env) is caught and returned', async () => {
  const log = fakeLog();
  const notifier = createOperatorNotifier({
    env: { EVENT_OPERATOR_NOTIFIER: 'webhook' }, // no URL/secret
    getConfig: fakeGetConfig(),
    fetchImpl: fakeFetch(),
    log,
  });
  const result = await notifier.notify(EVENT);
  assert.equal(result.delivered, false);
  assert.equal(result.sink, 'webhook');
  assert.match(result.error, /OPERATOR_WEBHOOK_URL/);
  assert.equal(log.warns.length, 1);
});

test('a synchronously-throwing fetch never escapes notify', async () => {
  const notifier = createOperatorNotifier({
    env: WEBHOOK_ENV,
    getConfig: fakeGetConfig(),
    fetchImpl: () => { throw new Error('sync boom'); },
    log: fakeLog(),
  });
  const result = await notifier.notify(EVENT);
  assert.equal(result.delivered, false);
  assert.equal(result.error, 'sync boom');
});

test('email sink without operatorEmail configured returns cleanly', async () => {
  const sendEmail = fakeSendEmail();
  const notifier = createOperatorNotifier({
    env: EMAIL_ENV,
    getConfig: fakeGetConfig({ event: { shortName: 'EX27' }, providers: null }),
    sendEmail,
  });
  const result = await notifier.notify(EVENT);
  assert.deepEqual(result, {
    delivered: false, sink: 'email', error: 'no operatorEmail configured',
  });
  assert.equal(sendEmail.calls.length, 0);
});
