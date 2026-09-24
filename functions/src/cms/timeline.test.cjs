'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  TIMELINE_COLLECTION,
  TIMELINE_FIELDS,
  TIMELINE_LIMITS,
  validateTimelineFields,
} = require('./timeline.cjs');

const VALID = Object.freeze({
  year: 2024,
  title: 'The first meeting',
  description: 'Teams compared shared reporting projects.',
});

function refused(fields, sent = fields) {
  const verdict = validateTimelineFields(fields, sent);
  assert.equal(verdict.ok, false, `expected a refusal for ${JSON.stringify(fields)}`);
  return verdict.errors;
}

function accepted(fields, sent = fields) {
  const verdict = validateTimelineFields(fields, sent);
  assert.equal(verdict.ok, true, JSON.stringify(verdict.errors));
  return verdict.fields;
}

const YEAR = 'year: enter a year from 1900 to 2100 as four digits';

test('the collection, the field set and the limits are the ones the seam names', () => {
  assert.equal(TIMELINE_COLLECTION, 'cmsTimeline');
  assert.deepEqual(TIMELINE_FIELDS, ['year', 'title', 'description', 'seeded', 'seededAt']);
  assert.deepEqual(TIMELINE_LIMITS, { yearMin: 1900, yearMax: 2100, titleMax: 120, descriptionMax: 600 });
});

test('a complete entry passes with every field kept', () => {
  assert.deepEqual(accepted({ ...VALID }), { ...VALID });
});

test('the year is a whole number from 1900 to 2100', () => {
  assert.equal(accepted({ ...VALID, year: 1900 }).year, 1900);
  assert.equal(accepted({ ...VALID, year: 2100 }).year, 2100);
  assert.deepEqual(refused({ ...VALID, year: 1899 }), [YEAR]);
  assert.deepEqual(refused({ ...VALID, year: 2101 }), [YEAR]);
  assert.deepEqual(refused({ ...VALID, year: 2024.5 }), [YEAR]);
  // A string is refused, not coerced.
  assert.deepEqual(refused({ ...VALID, year: '2024' }), [YEAR]);
  assert.deepEqual(refused({ ...VALID, year: null }), [YEAR]);
  const { year, ...withoutYear } = VALID;
  assert.equal(year, VALID.year);
  assert.deepEqual(refused(withoutYear), [YEAR]);
});

test('the title is required text on one line, trimmed, at most 120 characters', () => {
  assert.deepEqual(refused({ ...VALID, title: 42 }), ['title: must be text']);
  assert.deepEqual(refused({ ...VALID, title: { text: 'x' } }), ['title: must be text']);
  assert.deepEqual(refused({ ...VALID, title: '   ' }), ['title: enter a title']);
  assert.deepEqual(refused({ ...VALID, title: null }), ['title: enter a title']);
  assert.equal(accepted({ ...VALID, title: '  The first meeting ' }).title, 'The first meeting');
  assert.equal(accepted({ ...VALID, title: 't'.repeat(120) }).title.length, 120);
  assert.deepEqual(refused({ ...VALID, title: 't'.repeat(121) }), ['title: use 120 characters or fewer on one line']);
  assert.deepEqual(refused({ ...VALID, title: 'a\nb' }), ['title: use 120 characters or fewer on one line']);
  assert.deepEqual(refused({ ...VALID, title: 'a\tb' }), ['title: use 120 characters or fewer on one line']);
});

test('the description is optional text, trimmed, blank as null, at most 600 characters', () => {
  assert.deepEqual(refused({ ...VALID, description: ['a'] }), ['description: must be text']);
  assert.deepEqual(refused({ ...VALID, description: 7 }), ['description: must be text']);
  assert.equal(accepted({ ...VALID, description: '  Two tracks. ' }).description, 'Two tracks.');
  assert.equal(accepted({ ...VALID, description: '   ' }).description, null);
  assert.equal(accepted({ ...VALID, description: null }).description, null);
  const { description, ...withoutDescription } = VALID;
  assert.equal(description, VALID.description);
  assert.equal(accepted(withoutDescription).description, null);
  assert.equal(accepted({ ...VALID, description: 'd'.repeat(600) }).description.length, 600);
  assert.deepEqual(refused({ ...VALID, description: 'd'.repeat(601) }), ['description: use 600 characters or fewer']);
});

test('a line break is the one control character a description keeps', () => {
  assert.equal(accepted({ ...VALID, description: 'One.\nTwo.' }).description, 'One.\nTwo.');
  assert.equal(accepted({ ...VALID, description: 'One.\r\nTwo.' }).description, 'One.\nTwo.');
  assert.deepEqual(refused({ ...VALID, description: 'One.\tTwo.' }), [
    'description: use plain text; a line break is the only control character allowed',
  ]);
  assert.deepEqual(refused({ ...VALID, description: 'One.\u0007' }), [
    'description: use plain text; a line break is the only control character allowed',
  ]);
});

test('the seed flags are kept when the merged entry carries them', () => {
  const fields = accepted({ ...VALID, seeded: true, seededAt: '2026-01-01T00:00:00.000Z' });
  assert.equal(fields.seeded, true);
  assert.equal(fields.seededAt, '2026-01-01T00:00:00.000Z');
});

test('a key the request sends outside the field set is refused by name', () => {
  assert.deepEqual(refused({ ...VALID, colour: 'x' }, { colour: 'x' }), ['colour: unknown field']);
  // Every message at once, so the editor can mark each field.
  assert.deepEqual(refused({ year: '1', title: '', colour: 'x' }, { year: '1', title: '', colour: 'x' }), [
    'colour: unknown field',
    YEAR,
    'title: enter a title',
  ]);
});

test('a key only the stored entry carries is dropped, so the save cleans it', () => {
  const fields = accepted({ ...VALID, location: 'Hall A' }, { title: VALID.title });
  assert.deepEqual(fields, { ...VALID });
  assert.equal(Object.prototype.hasOwnProperty.call(fields, 'location'), false);
});
