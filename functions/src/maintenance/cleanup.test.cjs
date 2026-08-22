'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { sweepStrandedPublishRows, internals } = require('./cleanup.cjs');
const { makeFakeDb } = require('../cms/firestoreFake.cjs');

const { strandedParts, strandedPatch, toMillis, STRANDED_AFTER_MS } = internals;

const NOW = 1_750_000_000_000;
const now = () => NOW;
const quiet = { warn() {}, error() {} };

/** A timestamp `minutes` before NOW. */
const ago = (minutes) => new Date(NOW - minutes * 60_000);

const OLD = ago(120);
const RECENT = ago(5);

function sweep(seed, extra = {}) {
  const db = makeFakeDb(seed);
  return sweepStrandedPublishRows({ db, now, log: quiet, ...extra }).then((result) => ({ db, result }));
}

// --- the timeout decision (pure) ----------------------------------------------

test('a row is stranded only once it is past the timeout', () => {
  const running = { status: 'running', updatedAt: RECENT };
  assert.deepEqual(strandedParts(running, NOW, STRANDED_AFTER_MS), { publish: false, publisher: false });
  assert.deepEqual(
    strandedParts({ status: 'running', updatedAt: OLD }, NOW, STRANDED_AFTER_MS),
    { publish: true, publisher: false },
  );
});

test('a terminal row is never touched, however old', () => {
  for (const status of ['done', 'failed']) {
    assert.deepEqual(
      strandedParts({ status, updatedAt: ago(10_000) }, NOW, STRANDED_AFTER_MS),
      { publish: false, publisher: false },
    );
  }
});

test('a publisher that started and never finished is stranded', () => {
  const row = { status: 'done', updatedAt: OLD, publisher: { status: 'running', startedAt: OLD } };
  assert.deepEqual(strandedParts(row, NOW, STRANDED_AFTER_MS), { publish: false, publisher: true });
});

test('an accepted execution whose container never claimed the row is stranded', () => {
  const row = { status: 'done', updatedAt: OLD, publisher: { invoke: { status: 'invoked', at: OLD } } };
  assert.deepEqual(strandedParts(row, NOW, STRANDED_AFTER_MS), { publish: false, publisher: true });
});

test('an invoke that failed outright is not stranded — it already reported', () => {
  const row = { status: 'done', updatedAt: OLD, publisher: { invoke: { status: 'failed', at: OLD } } };
  assert.deepEqual(strandedParts(row, NOW, STRANDED_AFTER_MS), { publish: false, publisher: false });
});

test('a publisher that reached a terminal status is not stranded even with an old invoke', () => {
  for (const status of ['done', 'failed']) {
    const row = {
      status: 'done',
      updatedAt: OLD,
      publisher: { status, invoke: { status: 'invoked', at: OLD } },
    };
    assert.equal(strandedParts(row, NOW, STRANDED_AFTER_MS).publisher, false, status);
  }
});

test('a row with no timestamps at all reads as ancient, not as immortal', () => {
  assert.deepEqual(strandedParts({ status: 'running' }, NOW, STRANDED_AFTER_MS), {
    publish: true, publisher: false,
  });
});

test('requestedAt stands in when a row never got an updatedAt', () => {
  assert.equal(strandedParts({ status: 'running', requestedAt: RECENT }, NOW, STRANDED_AFTER_MS).publish, false);
  assert.equal(strandedParts({ status: 'running', requestedAt: OLD }, NOW, STRANDED_AFTER_MS).publish, true);
});

test('the timeout clears both a function request and the job task timeout', () => {
  // 60 minutes is the Cloud Functions v2 ceiling; 30 is the job's task
  // timeout as deploy-client.yml creates it.
  assert.ok(STRANDED_AFTER_MS > 60 * 60 * 1000);
});

test('toMillis accepts Dates, Firestore Timestamps, and numbers', () => {
  assert.equal(toMillis(new Date(NOW)), NOW);
  assert.equal(toMillis({ toMillis: () => NOW }), NOW);
  assert.equal(toMillis({ toDate: () => new Date(NOW) }), NOW);
  assert.equal(toMillis(NOW), NOW);
  assert.equal(toMillis(null), null);
  assert.equal(toMillis(undefined), null);
});

// --- the patch ----------------------------------------------------------------

test('the publish patch says the row is resumable, because only a failed row is', () => {
  const patch = strandedPatch({ publish: true, publisher: false, at: new Date(NOW), timeoutMs: STRANDED_AFTER_MS });
  assert.equal(patch.status, 'failed');
  assert.match(patch.error, /resume/);
  assert.equal(patch.publisher, undefined);
});

test('the publisher patch never touches the publish status field', () => {
  const patch = strandedPatch({ publish: false, publisher: true, at: new Date(NOW), timeoutMs: STRANDED_AFTER_MS });
  assert.equal(patch.status, undefined);
  assert.equal(patch.publisher.status, 'failed');
  assert.equal(patch.publisher.failedStage, 'timeout');
});

// --- the sweep ----------------------------------------------------------------

test('the sweep retires stranded rows and leaves live ones alone', async () => {
  const { db, result } = await sweep({
    'cmsPublishQueue/stranded': { status: 'running', updatedAt: OLD, request: { cmsContent: ['a'] } },
    'cmsPublishQueue/live': { status: 'running', updatedAt: RECENT },
    'cmsPublishQueue/finished': { status: 'done', updatedAt: OLD },
  });
  assert.deepEqual(result, { scanned: 2, publishFailed: 1, publisherFailed: 0 });

  const stranded = await db.collection('cmsPublishQueue').doc('stranded').get();
  assert.equal(stranded.data().status, 'failed');
  // The stored request survives, so the row is still resumable.
  assert.deepEqual(stranded.data().request, { cmsContent: ['a'] });

  const live = await db.collection('cmsPublishQueue').doc('live').get();
  assert.equal(live.data().status, 'running');
});

test('a stranded publisher is retired without disturbing the publish that succeeded', async () => {
  const { db, result } = await sweep({
    'cmsPublishQueue/q1': {
      status: 'done',
      updatedAt: OLD,
      progress: { cmsContent: { published: ['a'] } },
      publisher: { status: 'running', startedAt: OLD, invoke: { status: 'invoked', at: OLD } },
    },
  });
  assert.deepEqual(result, { scanned: 1, publishFailed: 0, publisherFailed: 1 });

  const row = (await db.collection('cmsPublishQueue').doc('q1').get()).data();
  assert.equal(row.status, 'done');
  assert.equal(row.publisher.status, 'failed');
  assert.equal(row.publisher.failedStage, 'timeout');
  // The merge keeps the invoke record that explains how the row got here.
  assert.equal(row.publisher.invoke.status, 'invoked');
});

test('a row matching more than one query is swept once', async () => {
  const { db, result } = await sweep({
    'cmsPublishQueue/q1': {
      status: 'running',
      updatedAt: OLD,
      publisher: { status: 'running', startedAt: OLD, invoke: { status: 'invoked', at: OLD } },
    },
  });
  assert.deepEqual(result, { scanned: 1, publishFailed: 1, publisherFailed: 1 });
  assert.equal(db.writes.filter((w) => w.path === 'cmsPublishQueue/q1').length, 1);
});

test('the sweep is idempotent — a second run writes nothing', async () => {
  const db = makeFakeDb({
    'cmsPublishQueue/q1': { status: 'running', updatedAt: OLD },
  });
  await sweepStrandedPublishRows({ db, now, log: quiet });
  const after = db.writes.length;
  const second = await sweepStrandedPublishRows({ db, now, log: quiet });
  assert.deepEqual(second, { scanned: 0, publishFailed: 0, publisherFailed: 0 });
  assert.equal(db.writes.length, after);
});

test('an empty queue writes nothing and alerts nobody', async () => {
  const events = [];
  const { db, result } = await sweep({}, { notifyOperator: async (e) => events.push(e) });
  assert.deepEqual(result, { scanned: 0, publishFailed: 0, publisherFailed: 0 });
  assert.deepEqual(db.writes, []);
  assert.deepEqual(events, []);
});

test('one operator event per sweep, not one per row', async () => {
  const events = [];
  const { result } = await sweep({
    'cmsPublishQueue/a': { status: 'running', updatedAt: OLD },
    'cmsPublishQueue/b': { status: 'running', updatedAt: OLD },
    'cmsPublishQueue/c': { status: 'done', updatedAt: OLD, publisher: { status: 'running', startedAt: OLD } },
  }, { notifyOperator: async (e) => events.push(e) });
  assert.equal(result.publishFailed, 2);
  assert.equal(result.publisherFailed, 1);
  assert.equal(events.length, 1);
  assert.equal(events[0].fields.publishFailed, 2);
  assert.equal(events[0].fields.publisherFailed, 1);
  assert.equal(events[0].dedupeKey, 'publish-queue-stranded');
});

test('a notifier that throws never fails the sweep', async () => {
  const { result } = await sweep(
    { 'cmsPublishQueue/a': { status: 'running', updatedAt: OLD } },
    { notifyOperator: async () => { throw new Error('sink exploded'); } },
  );
  assert.equal(result.publishFailed, 1);
});

test('a caller-supplied timeout is honoured', async () => {
  const { result } = await sweep(
    { 'cmsPublishQueue/a': { status: 'running', updatedAt: ago(10) } },
    { timeoutMs: 5 * 60_000 },
  );
  assert.equal(result.publishFailed, 1);
});
