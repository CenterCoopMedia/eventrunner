'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeFakeDb } = require('../functions/src/cms/firestoreFake.cjs');
const { runCli, sweepOrphanSpeakerInvites } = require('./sweep-orphan-speaker-invites.cjs');

const MARKER_ID = 'speaker-invite-orphans-2026-11-19';
const NOW = new Date('2026-11-20T02:30:00Z');

function world() {
  return {
    'speaker_invites/orphan': { speakerId: 'gone', status: 'accepted', email: 'gone@example.test' },
    'speaker_invites/accepted': { speakerId: 'current', status: 'accepted' },
    'speaker_invites/pending': { speakerId: 'current', status: 'pending' },
    'speaker_invites/removed': { speakerId: 'removed', status: 'accepted' },
    'speaker_invites/unknown': { status: 'accepted' },
    'speaker_invites/malformed': { speakerId: 'gone/child', status: 'accepted' },
    'speakers/current': { status: 'approved' },
    'speakers/removed': { status: 'removed' },
  };
}

test('the dry-run command prints only the orphan count and writes nothing', async () => {
  const db = makeFakeDb(world());
  const output = [];
  const log = { log: (line) => output.push(line), error: (line) => assert.fail(line) };
  assert.equal(await runCli({ args: ['--dry-run'], init: () => ({ db }), log }), 0);
  assert.deepEqual(output, ['{"orphans":1}']);
  assert.deepEqual(db.writes, []);
});

test('apply deletes only the confirmed orphan and records a count once', async () => {
  const seed = world();
  const db = makeFakeDb(seed);
  const apply = () => sweepOrphanSpeakerInvites({ db, dryRun: false, now: () => NOW });
  assert.deepEqual(await apply(), { deleted: 1 });
  assert.equal(db.read('speaker_invites', 'orphan'), undefined);
  for (const id of ['accepted', 'pending', 'removed', 'unknown', 'malformed']) {
    assert.deepEqual(db.read('speaker_invites', id), seed[`speaker_invites/${id}`]);
  }
  assert.deepEqual(db.read('data_migrations', MARKER_ID), {
    complete: true, totals: { deleted: 1 }, completedAt: NOW,
  });
  assert.deepEqual(db.writes, [
    { type: 'delete', path: 'speaker_invites/orphan' }, { type: 'set', path: `data_migrations/${MARKER_ID}` },
  ]);
  assert.deepEqual(await apply(), { skipped: true });
  assert.deepEqual(await sweepOrphanSpeakerInvites({ db }), { orphans: 0 });
  assert.equal(db.writes.length, 2);
});

test('apply retries and keeps an invite if its speaker appears before the commit', async () => {
  const db = makeFakeDb({ 'speaker_invites/a': { speakerId: 'speaker' } });
  db.beforeCommit = () => db.collection('speakers').doc('speaker').set({ status: 'draft' });
  assert.deepEqual(await sweepOrphanSpeakerInvites({ db, dryRun: false }), { deleted: 0 });
  assert.deepEqual(db.read('speaker_invites', 'a'), { speakerId: 'speaker' });
});

test('a retry after an interrupted page retains the count of committed deletions', async () => {
  const db = makeFakeDb(Object.fromEntries(Array.from({ length: 201 }, (_, i) => [
    `speaker_invites/${String(i).padStart(3, '0')}`, { speakerId: 'missing' },
  ])));
  assert.deepEqual(await sweepOrphanSpeakerInvites({ db }), { orphans: 201 });
  assert.deepEqual(db.writes, []);
  const runTransaction = db.runTransaction.bind(db);
  let transactions = 0;
  db.runTransaction = (fn) => {
    transactions += 1;
    if (transactions === 2) throw new Error('interrupted');
    return runTransaction(fn);
  };
  const apply = () => sweepOrphanSpeakerInvites({ db, dryRun: false, now: () => NOW });
  await assert.rejects(apply(), /interrupted/);
  assert.deepEqual(db.read('data_migrations', MARKER_ID), { complete: false, totals: { deleted: 200 } });
  assert.deepEqual(await sweepOrphanSpeakerInvites({ db }), { orphans: 1 });
  assert.deepEqual(await apply(), { deleted: 201 });
  assert.deepEqual(db.read('data_migrations', MARKER_ID), {
    complete: true, totals: { deleted: 201 }, completedAt: NOW,
  });
});

test('the command requires exactly one mode before opening Firestore', async () => {
  const init = () => assert.fail('unexpected init');
  const log = { log: (line) => assert.fail(line), error: (line) => assert.match(line, /^Usage:/) };
  for (const args of [[], ['--apply', '--dry-run'], ['--unknown']]) {
    assert.equal(await runCli({ args, init, log }), 2);
  }
});
