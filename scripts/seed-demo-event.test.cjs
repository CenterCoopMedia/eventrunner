'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { isDemoProject, seedDemo } = require('./seed-demo-event.cjs');
const { makeFakeDb } = require('../functions/src/cms/firestoreFake.cjs');

/** Run seedDemo with its progress output swallowed. */
async function runSeed(db, args = {}, now = () => Date.parse('2026-01-01T00:00:00Z')) {
  const store = require('../functions/src/cms/store.cjs');
  const log = console.log;
  console.log = () => {};
  try {
    return await seedDemo({ db, store, args, now });
  } finally {
    console.log = log;
  }
}

test('a delimited demo component identifies a demo project', () => {
  for (const id of ['demo-run-of-show', 'run_of_show_demo', 'demo', 'client.demo.site', 'DEMO-Run']) {
    assert.equal(isDemoProject(id), true, `${id} should count as a demo project`);
  }
});

test('a project that merely contains the letters "demo" does not', () => {
  // The guard exists to stop placeholder speakers being published on a
  // live site; a substring test would have waved this one through.
  for (const id of ['democratic-media-prod', 'demography-summit', 'moderndemo1']) {
    assert.equal(isDemoProject(id), false, `${id} must not count as a demo project`);
  }
});

test('an explicitly configured demo project id is matched exactly', () => {
  assert.equal(isDemoProject('showcase-instance', 'showcase-instance'), true);
  assert.equal(isDemoProject('demo-run-of-show', 'showcase-instance'), false,
    'a configured id replaces the heuristic rather than adding to it');
});

test('every seeded speaker gets a matching slug reservation', async () => {
  // The reservation collection is the lock createSpeaker takes to keep
  // slugs unique (functions/src/speakers/profile.cjs). A seeded speaker
  // with no reservation leaves its slug apparently free, so the demo would
  // accept a second speaker claiming the same public URL.
  const db = makeFakeDb();
  await runSeed(db);

  const speakerIds = db.ids('speakers');
  assert.ok(speakerIds.length >= 3);
  for (const id of speakerIds) {
    const { slug } = db.read('speakers', id);
    assert.ok(slug, `${id} has no slug`);
    assert.equal(db.read('speaker_slugs', slug)?.speakerId, id, `no slug reservation for ${id}`);
  }
  assert.equal(db.ids('speaker_slugs').length, speakerIds.length);
});

test('a dry run writes no speakers and no reservations', async () => {
  const db = makeFakeDb();
  await runSeed(db, { 'dry-run': true });
  assert.deepEqual(db.ids('speakers'), []);
  assert.deepEqual(db.ids('speaker_slugs'), []);
});

test('a missing or blank project id is never a demo project', () => {
  assert.equal(isDemoProject(''), false);
  assert.equal(isDemoProject(undefined), false);
});
