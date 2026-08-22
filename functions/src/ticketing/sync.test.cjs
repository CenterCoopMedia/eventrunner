'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { makeFakeDb } = require('../cms/firestoreFake.cjs');
const {
  drainTicketSyncQueue,
  runFullSync,
  createTicketingSyncHandler,
  upsertTickets,
  internals,
} = require('./sync.cjs');
const { createFakeTicketingProvider, fakeTicket } = require('./ticketingFake.cjs');

const QUIET = { warn() {}, error() {}, info() {} };
const T0 = new Date('2026-08-20T10:00:00.000Z');

/** Queue row as the webhook writes it. */
function pendingRow(orderId, overrides = {}) {
  return { orderId, status: 'pending', attempts: 0, readyAt: T0, provider: 'eventbrite', ...overrides };
}

function makeRes() {
  const res = {
    statusCode: null, body: null, headers: {},
    set(n, v) { res.headers[n] = v; return res; },
    status(c) { res.statusCode = c; return res; },
    json(p) { res.body = p; return res; },
  };
  return res;
}

test('a complete order upserts its tickets and removes the queue row', async () => {
  const db = makeFakeDb({ 'ticket_sync_queue/ord-1': pendingRow('ord-1') });
  const provider = createFakeTicketingProvider({
    orders: { 'ord-1': { tickets: [fakeTicket(), fakeTicket({ externalId: 'tkt-2', email: 'B@Example.com' })] } },
  });

  const summary = await drainTicketSyncQueue({ db, provider, now: () => T0, log: QUIET });

  assert.deepEqual(summary, { scanned: 1, completed: 1, retried: 0, exhausted: 0, skipped: 0 });
  assert.equal(db.read('ticket_sync_queue', 'ord-1'), undefined);

  const ticket = db.read('tickets', 'tkt-1');
  assert.equal(ticket.status, 'valid');
  assert.equal(ticket.provider, 'eventbrite');
  assert.equal(ticket.claimedByUid, null);
  assert.equal(ticket.claimPromptSentAt, null);
  assert.deepEqual(ticket.createdAt, T0);
  // Emails are lowercased on the way in (§3.3 TicketRecord).
  assert.equal(db.read('tickets', 'tkt-2').email, 'b@example.com');
});

test('a row that is not ready yet is left alone', async () => {
  const later = new Date(T0.getTime() + 60_000);
  const db = makeFakeDb({ 'ticket_sync_queue/ord-1': pendingRow('ord-1', { readyAt: later }) });
  const provider = createFakeTicketingProvider();

  const summary = await drainTicketSyncQueue({ db, provider, now: () => T0, log: QUIET });

  assert.equal(summary.scanned, 0);
  assert.deepEqual(provider.calls.fetchOrder, []);
});

test('an incomplete order backs off exponentially instead of being dropped', async () => {
  const db = makeFakeDb({ 'ticket_sync_queue/ord-1': pendingRow('ord-1') });
  // Placeholder attendees for the first two reads — the reference
  // implementation's silent-drop case.
  const provider = createFakeTicketingProvider({
    orders: { 'ord-1': { completeAfter: 2, tickets: [fakeTicket()] } },
  });

  let clock = T0;
  const drain = () => drainTicketSyncQueue({ db, provider, now: () => clock, log: QUIET });

  let summary = await drain();
  assert.deepEqual(summary, { scanned: 1, completed: 0, retried: 1, exhausted: 0, skipped: 0 });
  let row = db.read('ticket_sync_queue', 'ord-1');
  assert.equal(row.attempts, 1);
  assert.equal(row.readyAt.getTime() - T0.getTime(), internals.BASE_BACKOFF_MS);

  clock = new Date(row.readyAt.getTime());
  await drain();
  row = db.read('ticket_sync_queue', 'ord-1');
  assert.equal(row.attempts, 2);
  assert.equal(row.readyAt.getTime() - clock.getTime(), internals.BASE_BACKOFF_MS * 2);

  clock = new Date(row.readyAt.getTime());
  summary = await drain();
  assert.equal(summary.completed, 1);
  assert.equal(db.read('ticket_sync_queue', 'ord-1'), undefined);
  assert.ok(db.read('tickets', 'tkt-1'));
});

test('the 6th failed attempt exhausts the row and fires one OperatorEvent', async () => {
  const db = makeFakeDb({ 'ticket_sync_queue/ord-1': pendingRow('ord-1') });
  const provider = createFakeTicketingProvider({
    orders: { 'ord-1': { completeAfter: 99, tickets: [fakeTicket()] } },
  });
  const events = [];
  const notifyOperator = async (event) => { events.push(event); return { delivered: true, sink: 'webhook' }; };

  let clock = T0;
  for (let i = 0; i < internals.MAX_ATTEMPTS; i += 1) {
    await drainTicketSyncQueue({ db, provider, notifyOperator, now: () => clock, log: QUIET });
    const row = db.read('ticket_sync_queue', 'ord-1');
    clock = new Date(row.readyAt.getTime());
  }

  const row = db.read('ticket_sync_queue', 'ord-1');
  assert.equal(row.status, 'exhausted');
  assert.equal(row.attempts, internals.MAX_ATTEMPTS);
  assert.equal(row.lastError, 'order never became complete');
  assert.ok(row.exhaustedAt instanceof Date, 'the row survives as the forensic record');

  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'error');
  assert.match(events[0].title, /ord-1/);
  assert.equal(events[0].dedupeKey, 'ticket-sync-exhausted:ord-1');
  assert.equal(events[0].fields.attempts, '6');

  // Exhausted rows are not re-drained.
  const after = await drainTicketSyncQueue({ db, provider, notifyOperator, now: () => clock, log: QUIET });
  assert.equal(after.scanned, 0);
  assert.equal(events.length, 1);
});

test('a throwing fetchOrder is retried, then exhausted with the provider error', async () => {
  const db = makeFakeDb({ 'ticket_sync_queue/ord-1': pendingRow('ord-1') });
  const provider = createFakeTicketingProvider({ orders: { 'ord-1': { throwTimes: 99 } } });
  const events = [];

  let clock = T0;
  for (let i = 0; i < internals.MAX_ATTEMPTS; i += 1) {
    await drainTicketSyncQueue({
      db, provider, notifyOperator: async (e) => events.push(e), now: () => clock, log: QUIET,
    });
    clock = new Date(db.read('ticket_sync_queue', 'ord-1').readyAt.getTime());
  }

  const row = db.read('ticket_sync_queue', 'ord-1');
  assert.equal(row.status, 'exhausted');
  assert.match(row.lastError, /fetchOrder failed: provider unavailable/);
  assert.equal(events.length, 1);
});

test('the attempt is spent BEFORE the provider is called — a crash cannot loop forever', async () => {
  const db = makeFakeDb({ 'ticket_sync_queue/ord-1': pendingRow('ord-1') });
  const provider = createFakeTicketingProvider();
  let attemptsAtFetch = null;
  provider.fetchOrder = async () => {
    attemptsAtFetch = db.read('ticket_sync_queue', 'ord-1').attempts;
    throw new Error('container died');
  };

  await drainTicketSyncQueue({ db, provider, now: () => T0, log: QUIET });

  assert.equal(attemptsAtFetch, 1);
});

test('the queue row survives until the upsert succeeds', async () => {
  const db = makeFakeDb({ 'ticket_sync_queue/ord-1': pendingRow('ord-1') });
  const provider = createFakeTicketingProvider({ orders: { 'ord-1': { tickets: [fakeTicket()] } } });
  const realRunTransaction = db.runTransaction.bind(db);
  db.runTransaction = async () => { throw new Error('upsert exploded'); };

  await assert.rejects(
    drainTicketSyncQueue({ db, provider, now: () => T0, log: QUIET }),
    /upsert exploded/,
  );
  assert.ok(db.read('ticket_sync_queue', 'ord-1'), 'the order would have been lost');

  db.runTransaction = realRunTransaction;
  const clock = new Date(db.read('ticket_sync_queue', 'ord-1').readyAt.getTime());
  await drainTicketSyncQueue({ db, provider, now: () => clock, log: QUIET });
  assert.ok(db.read('tickets', 'tkt-1'));
  assert.equal(db.read('ticket_sync_queue', 'ord-1'), undefined);
});

test("an order for a different event is dropped, not retried", async () => {
  const db = makeFakeDb({ 'ticket_sync_queue/ord-9': pendingRow('ord-9') });
  const provider = createFakeTicketingProvider({
    orders: { 'ord-9': { externalEventId: 'evt-other', tickets: [fakeTicket()] } },
  });

  const summary = await drainTicketSyncQueue({ db, provider, now: () => T0, log: QUIET });

  assert.equal(summary.skipped, 1);
  assert.equal(db.read('ticket_sync_queue', 'ord-9'), undefined);
  assert.equal(db.read('tickets', 'tkt-1'), undefined);
});

test('the upsert is idempotent and never unclaims a ticket', async () => {
  const db = makeFakeDb();
  const record = fakeTicket();

  await upsertTickets({ db, tickets: [record], providerName: 'eventbrite', now: () => T0, log: QUIET });
  await db.collection('tickets').doc('tkt-1').set(
    { claimedByUid: 'uid-1', claimedAt: T0, claimPromptSentAt: T0 }, { merge: true },
  );

  const later = new Date(T0.getTime() + 3_600_000);
  const counts = await upsertTickets({
    db,
    tickets: [{ ...record, status: 'refunded', ticketClass: 'VIP' }],
    providerName: 'eventbrite',
    now: () => later,
    log: QUIET,
  });

  assert.deepEqual(counts, { created: 0, updated: 1, skipped: 0 });
  assert.equal(db.ids('tickets').length, 1);
  const ticket = db.read('tickets', 'tkt-1');
  assert.equal(ticket.status, 'refunded');
  assert.equal(ticket.ticketClass, 'VIP');
  assert.equal(ticket.claimedByUid, 'uid-1', 'a re-sync unclaimed a ticket');
  assert.deepEqual(ticket.claimPromptSentAt, T0);
  assert.deepEqual(ticket.createdAt, T0);
  assert.deepEqual(ticket.updatedAt, later);
});

test('normalizeTicket refuses an unkeyable record and buckets unknown statuses', () => {
  assert.equal(internals.normalizeTicket({ email: 'a@b.c' }, 'manual'), null);
  assert.equal(internals.normalizeTicket({ externalId: '../x' }, 'manual'), null);

  const normalized = internals.normalizeTicket(
    { externalId: 'tkt-9', status: 'transferred', quantity: 0, email: '  A@B.C ' },
    'manual',
  );
  assert.equal(normalized.status, 'pending_info');
  assert.equal(normalized.quantity, 1);
  assert.equal(normalized.email, 'a@b.c');
  assert.equal(normalized.provider, 'manual');
  assert.equal(normalized.firstName, null);
});

test('unkeyable tickets are counted as skipped, not written under a made-up id', async () => {
  const db = makeFakeDb();
  const counts = await upsertTickets({
    db, tickets: [fakeTicket(), { email: 'x@y.z' }], providerName: 'manual', now: () => T0, log: QUIET,
  });
  assert.deepEqual(counts, { created: 1, updated: 0, skipped: 1 });
  assert.deepEqual(db.ids('tickets'), ['tkt-1']);
});

test('backoff doubles and then clamps', () => {
  assert.equal(internals.backoffMsFor(1), internals.BASE_BACKOFF_MS);
  assert.equal(internals.backoffMsFor(2), internals.BASE_BACKOFF_MS * 2);
  assert.equal(internals.backoffMsFor(60), internals.MAX_BACKOFF_MS);
  assert.equal(internals.backoffMsFor(undefined), internals.BASE_BACKOFF_MS);
});

test('a full sync walks every page', async () => {
  const db = makeFakeDb();
  const provider = createFakeTicketingProvider({
    pages: [
      { tickets: [fakeTicket({ externalId: 'a' })] },
      { tickets: [fakeTicket({ externalId: 'b' })] },
      { tickets: [fakeTicket({ externalId: 'c' })], nextPageToken: null },
    ],
  });

  const totals = await runFullSync({ db, provider, since: '2026-08-01', now: () => T0, log: QUIET });

  assert.equal(totals.pages, 3);
  assert.equal(totals.created, 3);
  assert.equal(totals.truncated, false);
  assert.deepEqual(db.ids('tickets').sort(), ['a', 'b', 'c']);
  assert.equal(provider.calls.listTickets[0].since, '2026-08-01');
});

test('a non-terminating page cursor stops at the page cap', async () => {
  const db = makeFakeDb();
  const provider = createFakeTicketingProvider();
  provider.listTickets = async () => ({ tickets: [fakeTicket()], nextPageToken: 'always-more' });

  const totals = await runFullSync({ db, provider, now: () => T0, log: QUIET });

  assert.equal(totals.pages, internals.MAX_SYNC_PAGES);
  assert.equal(totals.truncated, true);
});

test('ticketingSync is admin-gated and POST-only', async () => {
  const db = makeFakeDb();
  const provider = createFakeTicketingProvider({ pages: [{ tickets: [fakeTicket()] }] });
  const getConfig = async () => ({ bootstrap: { adminEmails: ['admin@example.com'] } });
  const auth = {
    verifyIdToken: async (token) => {
      if (token === 'admin') return { uid: 'u1', email: 'admin@example.com', email_verified: true };
      return { uid: 'u2', email: 'attendee@example.com', email_verified: true };
    },
  };
  const handler = createTicketingSyncHandler({ db, provider, auth, getConfig, now: () => T0, log: QUIET });

  const wrongMethod = makeRes();
  await handler({ method: 'GET', headers: {} }, wrongMethod);
  assert.equal(wrongMethod.statusCode, 405);

  const anon = makeRes();
  await handler({ method: 'POST', headers: {}, body: {} }, anon);
  assert.equal(anon.statusCode, 401);

  const nonAdmin = makeRes();
  await handler({ method: 'POST', headers: { authorization: 'Bearer attendee' }, body: {} }, nonAdmin);
  assert.equal(nonAdmin.statusCode, 403);
  assert.equal(db.ids('tickets').length, 0);

  const admin = makeRes();
  await handler({ method: 'POST', headers: { authorization: 'Bearer admin' }, body: {} }, admin);
  assert.equal(admin.statusCode, 200);
  assert.equal(admin.body.created, 1);
});

test('a provider failure during a full sync is a 502, not a stack trace', async () => {
  const provider = createFakeTicketingProvider();
  provider.listTickets = async () => { throw new Error('rate limited'); };
  const handler = createTicketingSyncHandler({
    db: makeFakeDb(),
    provider,
    auth: { verifyIdToken: async () => ({ uid: 'u1', email: 'admin@example.com', email_verified: true }) },
    getConfig: async () => ({ bootstrap: { adminEmails: ['admin@example.com'] } }),
    log: QUIET,
  });

  const res = makeRes();
  await handler({ method: 'POST', headers: { authorization: 'Bearer admin' }, body: {} }, res);
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.error.code, 'provider-error');
});
