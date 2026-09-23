'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { makeFakeDb: makeBareFakeDb } = require('../cms/firestoreFake.cjs');

// requireAdmin reads config/bootstrap LIVE from the db it is handed (issue
// #186 review: it fails closed on an absent document), so every fake this
// file builds carries the document the file's getConfig describes.
const BOOTSTRAP_DOC = { adminEmails: ['admin@example.com'] };
const makeFakeDb = (seed = {}) => makeBareFakeDb({ 'config/bootstrap': BOOTSTRAP_DOC, ...seed });
const {
  readTicketingStatus,
  createGetTicketingStatusHandler,
  getTicketingProvider,
  internals,
} = require('./index.cjs');
const { createFakeTicketingProvider } = require('./ticketingFake.cjs');
const { evaluateReadiness } = require('../../../scripts/lib/readiness.cjs');

const T0 = new Date('2026-08-20T10:00:00.000Z');
const ADMIN = 'admin@example.com';

function makeRes() {
  const res = {
    statusCode: null, body: null, headers: {},
    set(n, v) { res.headers[n] = v; return res; },
    status(c) { res.statusCode = c; return res; },
    json(p) { res.body = p; return res; },
  };
  return res;
}

const auth = {
  async verifyIdToken(token) {
    if (token === 'admin') return { uid: 'admin-1', email: ADMIN, email_verified: true };
    if (token === 'ada') return { uid: 'uid-ada', email: 'ada@example.com', email_verified: true };
    throw new Error('invalid token');
  },
};

test('isSafeDocId rejects everything that could escape a collection', () => {
  const { isSafeDocId, safeDocId } = internals;
  assert.equal(isSafeDocId('ord-1'), true);
  assert.equal(isSafeDocId(' ord-1 '), true);
  assert.equal(safeDocId(' ord-1 '), 'ord-1');
  for (const bad of ['', '   ', '.', '..', 'a/b', '../config/bootstrap', 'x'.repeat(201), 'a\u0000b', 'a\u007fb', null, 42, {}]) {
    assert.equal(isSafeDocId(bad), false, `${JSON.stringify(bad)} should be rejected`);
    assert.equal(safeDocId(bad), null);
  }
});

test('status reports capability, not enablement (§3.3)', async () => {
  const db = makeFakeDb();
  const getConfig = async () => ({ providers: { ticketing: {} } });

  const manualish = await readTicketingStatus({
    db,
    provider: createFakeTicketingProvider({ name: 'manual', externalEventId: null }),
    getConfig,
    now: () => T0,
  });
  assert.equal(manualish.webhookSupported, false);
  assert.equal(manualish.webhookRegisteredAt, null);
  assert.equal(manualish.externalEventId, null);

  const eventbriteish = await readTicketingStatus({
    db,
    provider: createFakeTicketingProvider({ withRegisterWebhook: true }),
    getConfig,
    now: () => T0,
  });
  assert.equal(eventbriteish.webhookSupported, true);
});

test('status reports the registration config readiness.cjs reads, and the queue', async () => {
  const db = makeFakeDb({
    'ticket_sync_queue/ord-1': { orderId: 'ord-1', status: 'pending', readyAt: new Date('2026-08-20T09:00:00.000Z') },
    'ticket_sync_queue/ord-2': { orderId: 'ord-2', status: 'pending', readyAt: new Date('2026-08-20T09:30:00.000Z') },
    'ticket_sync_queue/ord-3': { orderId: 'ord-3', status: 'exhausted', attempts: 6 },
    'ticket_webhook_deliveries/del-1': { deliveryId: 'del-1', receivedAt: new Date('2026-08-19T00:00:00.000Z') },
    'ticket_webhook_deliveries/del-2': { deliveryId: 'del-2', receivedAt: new Date('2026-08-20T08:00:00.000Z') },
  });
  const status = await readTicketingStatus({
    db,
    provider: createFakeTicketingProvider({ withRegisterWebhook: true }),
    getConfig: async () => ({
      providers: {
        ticketing: {
          provider: 'eventbrite',
          webhookRegisteredAt: '2026-08-01T00:00:00.000Z',
          webhookId: 'hook-1',
        },
      },
    }),
    now: () => T0,
  });

  assert.equal(status.provider, 'eventbrite');
  assert.equal(status.externalEventId, 'evt-1');
  assert.equal(status.webhookRegisteredAt, '2026-08-01T00:00:00.000Z');
  assert.equal(status.webhookId, 'hook-1');
  assert.equal(status.lastDeliveryAt, '2026-08-20T08:00:00.000Z');
  assert.deepEqual(status.queue, {
    pending: 2,
    pendingCapped: false,
    exhausted: 1,
    exhaustedCapped: false,
    oldestReadyAt: '2026-08-20T09:00:00.000Z',
  });
  assert.equal(status.checkedAt, T0.toISOString());
});

test('the status queue counts say so when they are capped', async () => {
  const seed = {};
  for (let i = 0; i < internals.STATUS_SCAN_LIMIT + 5; i += 1) {
    seed[`ticket_sync_queue/ord-${i}`] = { orderId: `ord-${i}`, status: 'pending', readyAt: T0 };
  }
  const status = await readTicketingStatus({
    db: makeFakeDb(seed),
    provider: createFakeTicketingProvider(),
    getConfig: async () => ({}),
    now: () => T0,
  });
  assert.equal(status.queue.pending, internals.STATUS_SCAN_LIMIT);
  assert.equal(status.queue.pendingCapped, true);
});

test('the same config drives readiness.cjs, so the two agree about "no webhook to register"', async () => {
  const providersDoc = { ticketing: { provider: 'none' } };
  const status = await readTicketingStatus({
    db: makeFakeDb(),
    provider: getTicketingProvider({ env: { EVENT_TICKETING_PROVIDER: 'none' } }),
    getConfig: async () => ({ providers: providersDoc }),
    now: () => T0,
  });
  const row = evaluateReadiness({
    event: null, providers: providersDoc, theme: null, bootstrap: null, seededContentCount: 0,
  }).find((r) => r.id === 'ticketing');

  assert.equal(status.webhookSupported, false);
  assert.equal(row.ok, true);
  assert.match(row.detail, /no webhook to register/);
});

test('getTicketingStatus is admin-gated', async () => {
  const deps = {
    db: makeFakeDb(),
    provider: createFakeTicketingProvider(),
    auth,
    getConfig: async () => ({ bootstrap: { adminEmails: [ADMIN] }, providers: {} }),
    now: () => T0,
  };
  const handler = createGetTicketingStatusHandler(deps);

  const anon = makeRes();
  await handler({ method: 'GET', headers: {} }, anon);
  assert.equal(anon.statusCode, 401);

  const attendee = makeRes();
  await handler({ method: 'GET', headers: { authorization: 'Bearer ada' } }, attendee);
  assert.equal(attendee.statusCode, 403);

  const wrongMethod = makeRes();
  await handler({ method: 'DELETE', headers: { authorization: 'Bearer admin' } }, wrongMethod);
  assert.equal(wrongMethod.statusCode, 405);

  const admin = makeRes();
  await handler({ method: 'GET', headers: { authorization: 'Bearer admin' } }, admin);
  assert.equal(admin.statusCode, 200);
  assert.equal(admin.body.provider, 'eventbrite');
});
