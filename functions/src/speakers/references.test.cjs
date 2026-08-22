'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateSpeakerIdsShape,
  findMissingSpeakerIds,
  validateSpeakerReferences,
  internals,
} = require('./references.cjs');
const { makeSpeakersDb } = require('./speakersFake.cjs');

const WORLD = {
  'speakers/s1': { firstName: 'Rae', lastName: 'Okonkwo', slug: 'rae-okonkwo' },
  'speakers/s2': { firstName: 'Sam', lastName: 'Example', slug: 'sam-example' },
};

test('an absent value is an empty reference set, not an error', () => {
  assert.deepEqual(validateSpeakerIdsShape(undefined), { ok: true, speakerIds: [] });
  assert.deepEqual(validateSpeakerIdsShape(null), { ok: true, speakerIds: [] });
  assert.deepEqual(validateSpeakerIdsShape([]), { ok: true, speakerIds: [] });
});

test('non-array and non-string entries are rejected by name', () => {
  assert.deepEqual(validateSpeakerIdsShape('s1').errors, [
    'speakerIds: must be an array of speaker ids',
  ]);
  assert.deepEqual(validateSpeakerIdsShape([42]).errors, [
    'speakerIds: "42" is not a speaker document id',
  ]);
  assert.deepEqual(validateSpeakerIdsShape(['a/b']).errors, [
    'speakerIds: "a/b" is not a speaker document id',
  ]);
  assert.deepEqual(validateSpeakerIdsShape(['  ']).errors, [
    'speakerIds: "  " is not a speaker document id',
  ]);
});

test('a duplicate reference is rejected rather than silently collapsed', () => {
  assert.deepEqual(validateSpeakerIdsShape(['s1', 's1']).errors, [
    'speakerIds: "s1" is listed twice',
  ]);
});

test('an over-long list is refused before any read', () => {
  const many = Array.from({ length: internals.MAX_SPEAKER_IDS_PER_SESSION + 1 }, (_v, i) => `s${i}`);
  assert.match(validateSpeakerIdsShape(many).errors[0], /at most \d+ entries/);
});

test('findMissingSpeakerIds reports the ids with no document, in order', async () => {
  const db = makeSpeakersDb(WORLD);
  assert.deepEqual(await findMissingSpeakerIds({ db, speakerIds: ['s1', 's2'] }), []);
  assert.deepEqual(await findMissingSpeakerIds({ db, speakerIds: ['ghost', 's1', 'other'] }), [
    'ghost',
    'other',
  ]);
});

test('an empty list costs no reads', async () => {
  const db = makeSpeakersDb(WORLD);
  await findMissingSpeakerIds({ db, speakerIds: [] });
  assert.deepEqual(db.reads, []);
});

test('the seam rejects a dangling reference and names the id', async () => {
  const db = makeSpeakersDb(WORLD);
  const verdict = await validateSpeakerReferences({ db, value: ['s1', 'ghost'] });
  assert.equal(verdict.ok, false);
  assert.deepEqual(verdict.errors, ['speakerIds: no speaker exists with id "ghost"']);
});

test('the seam accepts references that all resolve', async () => {
  const db = makeSpeakersDb(WORLD);
  assert.deepEqual(await validateSpeakerReferences({ db, value: ['s2', 's1'] }), {
    ok: true,
    speakerIds: ['s2', 's1'],
  });
});

test('a shape failure short-circuits before any existence read', async () => {
  const db = makeSpeakersDb(WORLD);
  const verdict = await validateSpeakerReferences({ db, value: 'not-an-array' });
  assert.equal(verdict.ok, false);
  assert.deepEqual(db.reads, []);
});
