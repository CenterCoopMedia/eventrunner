'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { makeFakeDb } = require('../cms/firestoreFake.cjs');
const {
  createTicketingImportCsvHandler,
  createTicketingListTicketsHandler,
  buildImportPreview,
  validateImportRequest,
  mapRow,
  internals,
} = require('./csvImport.cjs');

const QUIET = { warn() {}, error() {}, info() {} };
const T0 = new Date('2026-08-22T10:00:00.000Z');
const MAPPING = { email: 'Email', id: 'Order ID', name: 'Name', ticketClass: 'Type', status: 'Status' };

function makeRes() {
  const res = {
    statusCode: null, body: null, headers: {},
    set(n, v) { res.headers[n] = v; return res; },
    status(c) { res.statusCode = c; return res; },
    json(p) { res.body = p; return res; },
  };
  return res;
}

const ADMIN_EMAIL = 'admin@example.com';
function makeAuthDeps({ admin = true } = {}) {
  const auth = { async verifyIdToken() { return { uid: 'admin-1', email: ADMIN_EMAIL, email_verified: true }; } };
  const getConfig = async () => ({ bootstrap: { adminEmails: admin ? [ADMIN_EMAIL] : [] } });
  return { auth, getConfig };
}

function req({ body = {}, headers = { authorization: 'Bearer tok' }, method = 'POST' } = {}) {
  return { method, body, headers };
}

/* ---------------------------------------------------------------- */
/* mapRow / validateImportRequest                                    */
/* ---------------------------------------------------------------- */

test('mapRow: id doubles as orderId when no separate order column is mapped', () => {
  const mapped = mapRow({ row: { Email: 'a@example.com', 'Order ID': 'ord-1' }, mapping: { email: 'Email', id: 'Order ID' } });
  assert.equal(mapped.ok, true);
  assert.equal(mapped.ticket.externalId, 'ord-1');
  assert.equal(mapped.ticket.orderId, 'ord-1');
  assert.equal(mapped.ticket.status, 'valid'); // unmapped status defaults to valid — an admin roster is asserted good
});

test('mapRow: a distinct order column overrides the id-as-orderId default', () => {
  const mapped = mapRow({
    row: { Email: 'a@example.com', 'Ticket ID': 'tkt-1', 'Order #': 'ord-9' },
    mapping: { email: 'Email', id: 'Ticket ID', orderId: 'Order #' },
  });
  assert.equal(mapped.ticket.externalId, 'tkt-1');
  assert.equal(mapped.ticket.orderId, 'ord-9');
});

test('mapRow: missing email and missing id are both reported', () => {
  const mapped = mapRow({ row: {}, mapping: MAPPING });
  assert.equal(mapped.ok, false);
  assert.deepEqual(mapped.reasons, ['missing email', 'missing order/ticket id']);
});

test('mapRow: an invalid email shape is rejected', () => {
  const mapped = mapRow({ row: { Email: 'not-an-email', 'Order ID': 'ord-1' }, mapping: MAPPING });
  assert.equal(mapped.ok, false);
  assert.deepEqual(mapped.reasons, ['invalid email address']);
});

test('mapRow: an id containing a slash is not usable as a document id', () => {
  const mapped = mapRow({ row: { Email: 'a@example.com', 'Order ID': 'a/b' }, mapping: MAPPING });
  assert.equal(mapped.ok, false);
  assert.ok(mapped.reasons[0].includes('not usable'));
});

test('mapRow: a name column splits into first/last when firstName/lastName are not mapped', () => {
  const mapped = mapRow({
    row: { Email: 'a@example.com', 'Order ID': 'ord-1', Name: 'Ada Lovelace' },
    mapping: MAPPING,
  });
  assert.equal(mapped.ticket.firstName, 'Ada');
  assert.equal(mapped.ticket.lastName, 'Lovelace');
});

test('mapRow: status aliases normalize the way the manual sheet actually spells them', () => {
  for (const [raw, expect] of Object.entries({ Paid: 'valid', REFUND: 'refunded', Canceled: 'cancelled', pending: 'pending_info' })) {
    const mapped = mapRow({
      row: { Email: 'a@example.com', 'Order ID': 'ord-1', Status: raw },
      mapping: MAPPING,
    });
    assert.equal(mapped.ticket.status, expect, `${raw} -> ${expect}`);
  }
});

test('validateImportRequest: requires mapping.email and mapping.id', () => {
  assert.equal(validateImportRequest({ mapping: {}, rows: [{}] }).ok, false);
  assert.equal(validateImportRequest({ mapping: { email: 'E' }, rows: [{}] }).ok, false);
  assert.equal(validateImportRequest({ mapping: { email: 'E', id: 'I' }, rows: [{}] }).ok, true);
});

test('validateImportRequest: rejects too many rows and non-array rows', () => {
  const mapping = { email: 'E', id: 'I' };
  assert.equal(validateImportRequest({ mapping, rows: 'nope' }).ok, false);
  assert.equal(validateImportRequest({ mapping, rows: [] }).ok, false);
  const tooMany = Array.from({ length: internals.MAX_IMPORT_ROWS + 1 }, () => ({}));
  assert.equal(validateImportRequest({ mapping, rows: tooMany }).ok, false);
});

test('validateImportRequest: dryRun defaults true, only an explicit false commits', () => {
  const mapping = { email: 'E', id: 'I' };
  assert.equal(validateImportRequest({ mapping, rows: [{}] }).dryRun, true);
  assert.equal(validateImportRequest({ mapping, rows: [{}], dryRun: false }).dryRun, false);
  assert.equal(validateImportRequest({ mapping, rows: [{}], dryRun: 'no' }).dryRun, true);
});

/* ---------------------------------------------------------------- */
/* buildImportPreview                                                */
/* ---------------------------------------------------------------- */

test('buildImportPreview: classifies create, update, duplicate, and invalid rows', async () => {
  const db = makeFakeDb({
    'tickets/ord-existing': { email: 'existing@example.com', provider: 'manual', status: 'valid' },
  });
  const rows = [
    { Email: 'a@example.com', 'Order ID': 'ord-new' }, // create
    { Email: 'b@example.com', 'Order ID': 'ord-existing' }, // update
    { Email: 'c@example.com', 'Order ID': 'ord-new' }, // duplicate of row 0
    { Email: 'not-an-email', 'Order ID': 'ord-bad' }, // invalid
  ];
  const preview = await buildImportPreview({ db, mapping: MAPPING, rows });
  assert.deepEqual(preview.summary, { create: 1, update: 1, duplicate: 1, invalid: 1 });
  assert.equal(preview.results.length, 4);
  assert.equal(preview.results[0].verdict, 'create');
  assert.equal(preview.results[1].verdict, 'update');
  assert.equal(preview.results[2].verdict, 'duplicate');
  assert.equal(preview.results[3].verdict, 'invalid');
  // Only the surviving (non-duplicate, non-invalid) rows are candidates to write.
  assert.equal(preview.validTickets.length, 2);
});

/* ---------------------------------------------------------------- */
/* ticketingImportCsv handler                                        */
/* ---------------------------------------------------------------- */

test('ticketingImportCsv: non-admin is refused before anything is read', async () => {
  const db = makeFakeDb();
  const { auth, getConfig } = makeAuthDeps({ admin: false });
  const handler = createTicketingImportCsvHandler({ db, auth, getConfig, now: () => T0, log: QUIET });
  const res = makeRes();
  await handler(req({ body: { mapping: MAPPING, rows: [{ Email: 'a@example.com', 'Order ID': 'ord-1' }] } }), res);
  assert.equal(res.statusCode, 403);
});

test('ticketingImportCsv: GET is refused', async () => {
  const { auth, getConfig } = makeAuthDeps();
  const handler = createTicketingImportCsvHandler({ db: makeFakeDb(), auth, getConfig, now: () => T0, log: QUIET });
  const res = makeRes();
  await handler(req({ method: 'GET' }), res);
  assert.equal(res.statusCode, 405);
});

test('ticketingImportCsv: a bad mapping is a 400, not a 500', async () => {
  const { auth, getConfig } = makeAuthDeps();
  const handler = createTicketingImportCsvHandler({ db: makeFakeDb(), auth, getConfig, now: () => T0, log: QUIET });
  const res = makeRes();
  await handler(req({ body: { mapping: {}, rows: [{}] } }), res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error.message, /mapping\.email/);
});

test('ticketingImportCsv: dry run writes nothing', async () => {
  const db = makeFakeDb();
  const { auth, getConfig } = makeAuthDeps();
  const handler = createTicketingImportCsvHandler({ db, auth, getConfig, now: () => T0, log: QUIET });
  const res = makeRes();
  await handler(req({
    body: {
      mapping: MAPPING,
      dryRun: true,
      rows: [
        { Email: 'a@example.com', 'Order ID': 'ord-1' },
        { Email: 'not-an-email', 'Order ID': 'ord-2' },
      ],
    },
  }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.dryRun, true);
  assert.deepEqual(res.body.summary, { create: 1, update: 0, duplicate: 0, invalid: 1 });
  assert.deepEqual(db.ids('tickets'), []);
});

test('ticketingImportCsv: commit upserts through sync.cjs semantics and logs an admin action', async () => {
  const db = makeFakeDb();
  const { auth, getConfig } = makeAuthDeps();
  const handler = createTicketingImportCsvHandler({ db, auth, getConfig, now: () => T0, log: QUIET });
  const res = makeRes();
  await handler(req({
    body: {
      mapping: MAPPING,
      dryRun: false,
      rows: [{ Email: 'A@Example.com', 'Order ID': 'ord-1', Name: 'Ada Lovelace' }],
    },
  }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.created, 1);
  assert.equal(res.body.updated, 0);

  const ticket = db.read('tickets', 'ord-1');
  assert.equal(ticket.email, 'a@example.com'); // lowercased by sync.cjs's normalizeTicket
  assert.equal(ticket.provider, 'manual');
  assert.equal(ticket.firstName, 'Ada');
  assert.equal(ticket.claimedByUid, null); // server-owned field, initialized on create
  assert.deepEqual(ticket.createdAt, T0);

  const logs = db.ids('admin_logs');
  assert.equal(logs.length, 1);
});

test('ticketingImportCsv: commit idempotence — re-importing the same file is a no-op update, not a duplicate write', async () => {
  const db = makeFakeDb();
  const { auth, getConfig } = makeAuthDeps();
  const handler = createTicketingImportCsvHandler({ db, auth, getConfig, now: () => T0, log: QUIET });
  const body = {
    mapping: MAPPING,
    dryRun: false,
    rows: [{ Email: 'a@example.com', 'Order ID': 'ord-1' }],
  };

  await handler(req({ body }), makeRes());
  const firstCreatedAt = db.read('tickets', 'ord-1').createdAt;

  // Simulate the ticket having since been claimed — a re-import must not
  // unclaim it (§4.2 claim-preserving upsert, via sync.cjs).
  await db.collection('tickets').doc('ord-1').set({ claimedByUid: 'uid-1', claimedAt: T0 }, { merge: true });

  const res2 = makeRes();
  await handler(req({ body }), res2);
  assert.equal(res2.body.created, 0);
  assert.equal(res2.body.updated, 1);

  const after = db.read('tickets', 'ord-1');
  assert.equal(after.claimedByUid, 'uid-1'); // survived the re-import
  assert.deepEqual(after.createdAt, firstCreatedAt); // createdAt survives too
  assert.equal(db.ids('tickets').length, 1); // no duplicate document
});

test('ticketingImportCsv: too many rows is refused with a clear cap message', async () => {
  const { auth, getConfig } = makeAuthDeps();
  const handler = createTicketingImportCsvHandler({ db: makeFakeDb(), auth, getConfig, now: () => T0, log: QUIET });
  const res = makeRes();
  const rows = Array.from({ length: internals.MAX_IMPORT_ROWS + 1 }, (_, i) => ({ Email: `a${i}@example.com`, 'Order ID': `ord-${i}` }));
  await handler(req({ body: { mapping: MAPPING, rows } }), res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error.message, /rows/);
});

/* ---------------------------------------------------------------- */
/* ticketingListTickets handler                                      */
/* ---------------------------------------------------------------- */

function ticket(overrides = {}) {
  return {
    orderId: 'ord-1', email: 'a@example.com', firstName: 'Ada', lastName: 'Lovelace',
    ticketClass: 'General', quantity: 1, status: 'valid', provider: 'manual',
    claimedByUid: null, claimedAt: null, createdAt: T0, updatedAt: T0,
    ...overrides,
  };
}

test('ticketingListTickets: non-admin refused', async () => {
  const { auth, getConfig } = makeAuthDeps({ admin: false });
  const handler = createTicketingListTicketsHandler({ db: makeFakeDb(), auth, getConfig, log: QUIET });
  const res = makeRes();
  await handler(req({ body: {} }), res);
  assert.equal(res.statusCode, 403);
});

test('ticketingListTickets: exact externalId lookup short-circuits filters', async () => {
  const db = makeFakeDb({ 'tickets/tkt-1': ticket() });
  const { auth, getConfig } = makeAuthDeps();
  const handler = createTicketingListTicketsHandler({ db, auth, getConfig, log: QUIET });
  const res = makeRes();
  await handler(req({ body: { externalId: 'tkt-1' } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.tickets.length, 1);
  assert.equal(res.body.tickets[0].id, 'tkt-1');

  const miss = makeRes();
  await handler(req({ body: { externalId: 'nope' } }), miss);
  assert.deepEqual(miss.body.tickets, []);
});

test('ticketingListTickets: filters by email and status, newest first', async () => {
  const later = new Date(T0.getTime() + 60_000);
  const db = makeFakeDb({
    'tickets/tkt-1': ticket({ email: 'a@example.com', status: 'valid', createdAt: T0 }),
    'tickets/tkt-2': ticket({ email: 'a@example.com', status: 'refunded', createdAt: later }),
    'tickets/tkt-3': ticket({ email: 'b@example.com', status: 'valid', createdAt: T0 }),
  });
  const { auth, getConfig } = makeAuthDeps();
  const handler = createTicketingListTicketsHandler({ db, auth, getConfig, log: QUIET });

  const byEmail = makeRes();
  await handler(req({ body: { email: 'A@Example.com' } }), byEmail);
  assert.equal(byEmail.body.tickets.length, 2);
  assert.equal(byEmail.body.tickets[0].id, 'tkt-2'); // newest first

  const byStatus = makeRes();
  await handler(req({ body: { status: 'valid' } }), byStatus);
  assert.equal(byStatus.body.tickets.length, 2);
  assert.ok(byStatus.body.tickets.every((t) => t.status === 'valid'));
});

test('ticketingListTickets: an invalid status is a 400', async () => {
  const { auth, getConfig } = makeAuthDeps();
  const handler = createTicketingListTicketsHandler({ db: makeFakeDb(), auth, getConfig, log: QUIET });
  const res = makeRes();
  await handler(req({ body: { status: 'bogus' } }), res);
  assert.equal(res.statusCode, 400);
});
