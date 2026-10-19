const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readClosesAt } = require('./pitch.cjs');

test('pitch call only accepts real RFC3339 instants with an explicit timezone', () => {
  assert.equal(readClosesAt('2030-11-30T23:59:59-05:00'), '2030-12-01T04:59:59.000Z');
  for (const value of ['2050', '2030-02-30T00:00:00Z', '2030-01-01T00:00:00', null, '2030-01-01T24:01:00Z']) assert.equal(readClosesAt(value), null);
});

test('an external pitch form is an https URL or nothing', () => {
  const { readPitchFormUrl } = require('./pitch.cjs');
  assert.equal(readPitchFormUrl('https://airtable.com/appX/shrY'), 'https://airtable.com/appX/shrY');
  assert.equal(readPitchFormUrl('  https://forms.example.org/pitch  '), 'https://forms.example.org/pitch');
  for (const value of [null, undefined, '', '   ', 'http://airtable.com/shr', 'javascript:alert(1)', '/pitch', 'airtable.com/shr', 42, {}]) {
    assert.equal(readPitchFormUrl(value), null, String(value));
  }
});

test('an external pitch form address has a length limit', () => {
  const { readPitchFormUrl, MAX_FORM_URL_LENGTH } = require('./pitch.cjs');
  const base = 'https://airtable.com/';
  assert.equal(readPitchFormUrl(base + 'a'.repeat(MAX_FORM_URL_LENGTH - base.length)).length, MAX_FORM_URL_LENGTH);
  assert.equal(readPitchFormUrl(base + 'a'.repeat(MAX_FORM_URL_LENGTH)), null);
});
