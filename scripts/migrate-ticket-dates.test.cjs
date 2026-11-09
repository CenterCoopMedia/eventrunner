'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeFakeDb } = require('../console/functions/src/fakes.cjs');
const { migrateTicketDates } = require('./migrate-ticket-dates.cjs');

const CREATED = Date.UTC(2026, 9, 1, 14, 30);
const UPDATED = Date.UTC(2026, 9, 2, 9, 15);

test('rewrites numeric ticket dates as the same instant, leaves the rest, once', async () => {
  const db = makeFakeDb({
    'tickets/imported': { source: 'csv', email: 'a@example.org', createdAt: CREATED, updatedAt: UPDATED },
    'tickets/half': { createdAt: new Date(CREATED), updatedAt: UPDATED },
    'tickets/synced': { createdAt: new Date(CREATED), updatedAt: new Date(UPDATED) },
    // Not a number: a string or a missing field stays as it is.
    'tickets/odd': { createdAt: '2026-10-01', status: 'valid' },
    'orders/o1': { createdAt: CREATED },
  });
  assert.deepEqual(await migrateTicketDates({ db }), { ticketsRewritten: 2, createdAtRewritten: 1, updatedAtRewritten: 2 });
  assert.deepEqual(db.read('tickets/imported'), { source: 'csv', email: 'a@example.org', createdAt: new Date(CREATED), updatedAt: new Date(UPDATED) });
  assert.deepEqual(db.read('tickets/half'), { createdAt: new Date(CREATED), updatedAt: new Date(UPDATED) });
  assert.deepEqual(db.read('tickets/synced'), { createdAt: new Date(CREATED), updatedAt: new Date(UPDATED) });
  assert.deepEqual(db.read('tickets/odd'), { createdAt: '2026-10-01', status: 'valid' });
  assert.deepEqual(db.read('orders/o1'), { createdAt: CREATED });

  const marker = db.read('data_migrations/ticket-dates-2026-11-09');
  assert.equal(marker.complete, true);
  assert.deepEqual(marker.totals, { ticketsRewritten: 2, createdAtRewritten: 1, updatedAtRewritten: 2 });
  assert.deepEqual(await migrateTicketDates({ db }), { skipped: true });
});

test('a dry run counts and writes nothing, marker included', async () => {
  const seed = { 'tickets/imported': { createdAt: CREATED, updatedAt: UPDATED } };
  const db = makeFakeDb(seed);
  assert.deepEqual(await migrateTicketDates({ db, dryRun: true }), { ticketsRewritten: 1, createdAtRewritten: 1, updatedAtRewritten: 1, dryRun: true });
  assert.deepEqual(db.writes, []);
  assert.deepEqual(db.read('tickets/imported'), seed['tickets/imported']);
});

test('a number that is not a real instant is left alone', async () => {
  const db = makeFakeDb({ 'tickets/t1': { createdAt: Number.NaN, updatedAt: 1e20 } });
  assert.deepEqual(await migrateTicketDates({ db }), { ticketsRewritten: 0, createdAtRewritten: 0, updatedAtRewritten: 0 });
  assert.ok(Number.isNaN(db.read('tickets/t1').createdAt));
  assert.equal(db.read('tickets/t1').updatedAt, 1e20);
});
