'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { lifecycleStampErrors } = require('./lifecycleStamps.cjs');

// getEventPhase reads a malformed stamp as null, so a bad value would put a
// public site back in draft with no sign. The save refuses it by name.
test('announcedAt and archivedAt are null, absent, or a naive local datetime', () => {
  for (const stamps of [
    {},
    { announcedAt: null, archivedAt: null },
    { announcedAt: '2027-01-15T09:00' },
    { announcedAt: '2026-01-01T12:00:00', archivedAt: '2026-03-28T00:00:00' },
    { announcedAt: '2027-01-15T09:00', archivedAt: '2027-07-01T00:00' },
    { announcedAt: '2024-02-29T23:59', archivedAt: null },
  ]) {
    assert.deepEqual(lifecycleStampErrors(stamps), [], JSON.stringify(stamps));
  }
});

test('a stamp that is not a real date and clock time is refused by name', () => {
  for (const value of [
    'tomorrow', 5, true, {}, '', '2027-01-15', '2027-01-15 09:00', '2027-01-15T09:00Z',
    '2027-01-15T09:00:00.000Z', '2027-01-15T09:00+01:00', '2027-13-01T09:00', '2027-02-30T09:00',
    '2027-01-15T25:00', '2027-01-15T24:00', '2027-01-15T09:60', '2027-01-15T09:00:61',
  ]) {
    const announced = lifecycleStampErrors({ announcedAt: value });
    assert.ok(announced.some((e) => e.startsWith('announcedAt: must be null or a naive ISO datetime')), JSON.stringify(value));
    const archived = lifecycleStampErrors({ announcedAt: '2027-01-01T00:00', archivedAt: value });
    assert.ok(archived.some((e) => e.startsWith('archivedAt: must be null or a naive ISO datetime')), JSON.stringify(value));
  }
});

test('archivedAt needs an announce date and must not be before it', () => {
  for (const announcedAt of [null, undefined]) {
    assert.deepEqual(lifecycleStampErrors({ announcedAt, archivedAt: '2027-07-01T00:00' }), ['archivedAt: needs an announce date']);
  }
  assert.deepEqual(
    lifecycleStampErrors({ announcedAt: '2027-07-01T00:00', archivedAt: '2027-06-30T23:59' }),
    ['archivedAt: must not be before announcedAt'],
  );
  // Minute precision, the way getEventPhase compares: seconds never order them.
  assert.deepEqual(lifecycleStampErrors({ announcedAt: '2027-07-01T00:00:30', archivedAt: '2027-07-01T00:00' }), []);
  // A malformed announce date is named once, not again through archivedAt.
  const malformed = lifecycleStampErrors({ announcedAt: 'soon', archivedAt: '2027-07-01T00:00' });
  assert.equal(malformed.filter((e) => e.startsWith('archivedAt')).length, 0);
});

test('a payload that is not an object has no stamp errors; the event check names it', () => {
  assert.deepEqual(lifecycleStampErrors(null), []);
});
