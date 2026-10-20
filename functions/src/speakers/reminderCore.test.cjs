'use strict';

// reserve()'s optional `also` document (issue #518): the schedule's ledger
// row is created in the same transaction as the speaker_reminders
// reservation, or not at all. The staff endpoint passes no `also`; its
// behaviour is covered by reminders.test.cjs and
// tests/speaker-reminders.rules.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeSpeakersDb } = require('./speakersFake.cjs');
const { REMINDERS, REMINDER_COOLDOWN_MS, reserve } = require('./reminderCore.cjs');

const ACTOR = { uid: 'staff-1', email: 'staff@example.test' };
const NOW = Date.parse('2026-11-13T15:00:00Z');

function ledger(db, id = 'speakers__2026-11-20-7d__sp1') {
  return { ref: db.collection('reminder_ledger').doc(id), data: { speakerId: 'sp1', windowKey: '2026-11-20-7d' } };
}

test('a reservation creates the `also` document with it', async () => {
  const db = makeSpeakersDb();
  const out = await reserve({ db, speakerId: 'sp1', batchId: 'batch-0001', items: ['bio'], actor: ACTOR, nowMs: NOW, also: ledger(db) });
  assert.deepEqual(out, { ok: true, sentCount: 0 });
  assert.equal(db.read(REMINDERS, 'sp1').lastBatchId, 'batch-0001');
  assert.deepEqual(db.read('reminder_ledger', 'speakers__2026-11-20-7d__sp1'), { speakerId: 'sp1', windowKey: '2026-11-20-7d' });
});

test('an existing `also` document refuses the reservation and writes nothing', async () => {
  const db = makeSpeakersDb({ 'reminder_ledger/speakers__2026-11-20-7d__sp1': { speakerId: 'sp1' } });
  const out = await reserve({ db, speakerId: 'sp1', batchId: 'batch-0002', items: ['bio'], actor: ACTOR, nowMs: NOW, also: ledger(db) });
  assert.deepEqual(out, { ok: false, outcome: 'skipped', reason: 'recorded' });
  assert.equal(db.read(REMINDERS, 'sp1'), undefined);
});

test('a refused reservation does not create the `also` document', async () => {
  const db = makeSpeakersDb({
    [`${REMINDERS}/sp1`]: { lastStatus: 'sent', lastBatchId: 'batch-old', lastSentAt: new Date(NOW - REMINDER_COOLDOWN_MS / 2) },
  });
  const out = await reserve({ db, speakerId: 'sp1', batchId: 'batch-0003', items: ['bio'], actor: ACTOR, nowMs: NOW, also: ledger(db) });
  assert.deepEqual(out, { ok: false, outcome: 'skipped', reason: 'recent' });
  assert.equal(db.read('reminder_ledger', 'speakers__2026-11-20-7d__sp1'), undefined);
});

test('without `also`, a reservation writes only the speaker_reminders record', async () => {
  const db = makeSpeakersDb();
  await reserve({ db, speakerId: 'sp1', batchId: 'batch-0004', items: ['bio'], actor: ACTOR, nowMs: NOW });
  assert.deepEqual(db.writes.map((w) => w.path), [`${REMINDERS}/sp1`]);
});
