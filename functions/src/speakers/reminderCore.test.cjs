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

test('the shipped wording version is a digest of the shipped copy, so a deploy that changes it changes the version', () => {
  const { getDefaultTemplate } = require('../email/templates.cjs');
  const { wordingVersion } = require('./reminderCore.cjs');
  const shipped = getDefaultTemplate('speaker.reminder');
  const version = wordingVersion(null);
  assert.match(version, /^shipped:[0-9a-f]{32}$/);
  assert.equal(wordingVersion(null, shipped), version);
  // A deploy that edits any of the three shipped fields gives a new version,
  // so a preview made before the deploy cannot approve the new copy.
  for (const key of ['subject', 'html', 'text']) {
    const edited = { ...shipped, [key]: `${shipped[key]} edited` };
    assert.notEqual(wordingVersion(null, edited), version, key);
    assert.match(wordingVersion(null, edited), /^shipped:/);
  }
  // Saved wording keeps its own digest, which never looks like the shipped one.
  const saved = wordingVersion({ subject: shipped.subject, html: shipped.html, text: shipped.text });
  assert.match(saved, /^[0-9a-f]{32}$/);
  assert.notEqual(saved, version);
});

// Note from PR 1 (#518): saved wording that fails its token check is not
// what a speaker gets. The renderer falls back to the shipped copy, so the
// version must name the shipped copy too. A schedule approved on the
// fallback must then pause when a deploy changes the shipped copy.
test('saved wording that fails its token check has the shipped version, because the shipped copy is what is sent', () => {
  const { getDefaultTemplate } = require('../email/templates.cjs');
  const { wordingVersion } = require('./reminderCore.cjs');
  const shipped = getDefaultTemplate('speaker.reminder');
  const broken = { subject: 'Hi', html: '<p>No link here.</p>', text: 'No link here.' };
  assert.equal(wordingVersion(broken), wordingVersion(null));
  assert.match(wordingVersion(broken), /^shipped:[0-9a-f]{32}$/);
  const edited = { ...shipped, text: `${shipped.text} edited` };
  assert.equal(wordingVersion(broken, edited), wordingVersion(null, edited));
  assert.notEqual(wordingVersion(broken, edited), wordingVersion(broken));
});

test('saved wording that sets only some fields has a version that covers the shipped fields it keeps', () => {
  const { getDefaultTemplate } = require('../email/templates.cjs');
  const { wordingVersion } = require('./reminderCore.cjs');
  const shipped = getDefaultTemplate('speaker.reminder');
  const subjectOnly = { subject: 'New subject for {{event_name}}' };
  const version = wordingVersion(subjectOnly);
  assert.match(version, /^[0-9a-f]{32}$/);
  // The html and text bodies still come from the shipped copy, so a deploy
  // that changes them changes what is sent, and the version with it.
  assert.notEqual(wordingVersion(subjectOnly, { ...shipped, html: `${shipped.html} ` }), version);
});

test('the version a render reports is the version of the wording it used', () => {
  const { getDefaultTemplate } = require('../email/templates.cjs');
  const { render } = require('../email/render.cjs');
  const { wordingVersion } = require('./reminderCore.cjs');
  const template = getDefaultTemplate('speaker.reminder');
  const broken = { subject: 'Hi', html: '<p>No link.</p>', text: 'No link.' };
  const out = render({ template, override: broken, tokenValues: {}, config: {} });
  assert.equal(out.usedFallback, true);
  assert.equal(wordingVersion(broken), wordingVersion(null));
});
