const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readClosesAt } = require('./pitch.cjs');

test('pitch call only accepts real RFC3339 instants with an explicit timezone', () => {
  assert.equal(readClosesAt('2030-11-30T23:59:59-05:00'), '2030-12-01T04:59:59.000Z');
  for (const value of ['2050', '2030-02-30T00:00:00Z', '2030-01-01T00:00:00', null, '2030-01-01T24:01:00Z']) assert.equal(readClosesAt(value), null);
});

test('a pitch call deadline is an RFC3339 instant, or null for no deadline', () => {
  const { readPitchDeadline } = require('./pitch.cjs');
  assert.deepEqual(readPitchDeadline('2030-11-30T23:59:59-05:00'), { ok: true, closesAt: '2030-12-01T04:59:59.000Z' });
  assert.deepEqual(readPitchDeadline(null), { ok: true, closesAt: null });
  // Only an explicit null means "open until I close it". A missing or blank
  // value is a mistake, not a choice.
  for (const value of [undefined, '', '  ', 'next week', '2030-02-30T00:00:00Z', 0, false, {}]) {
    assert.deepEqual(readPitchDeadline(value), { ok: false }, String(value));
  }
});

test('a pitch call is open while it accepts pitches and its deadline, if any, is ahead', () => {
  const { isPitchCallOpen } = require('./pitch.cjs');
  const now = Date.parse('2030-01-01T00:00:00Z');
  assert.equal(isPitchCallOpen({ enabled: true, closesAt: '2030-01-01T00:00:01Z' }, now), true);
  assert.equal(isPitchCallOpen({ enabled: true, closesAt: null }, now), true);
  assert.equal(isPitchCallOpen({ enabled: true, closesAt: null, externalFormUrl: 'https://airtable.com/shr' }, now), true);
  for (const call of [
    null,
    undefined,
    {},
    { enabled: false, closesAt: null },
    { enabled: 'true', closesAt: null },
    { enabled: true },
    { enabled: true, closesAt: '' },
    { enabled: true, closesAt: 'next week' },
    { enabled: true, closesAt: '2030-01-01T00:00:00Z' },
    { enabled: true, closesAt: '2029-12-31T23:59:59Z' },
  ]) assert.equal(isPitchCallOpen(call, now), false, JSON.stringify(call));
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

test('pitch email settings default to automatic receipts and the shipped wording', () => {
  const { readPitchNoticeSettings, PITCH_NOTICE_DEFAULTS, PITCH_NOTICE_TEMPLATE_IDS } = require('./pitch.cjs');
  for (const raw of [undefined, null, [], 'x', { receiptMode: 'sometimes', templates: 'x' }]) {
    const settings = readPitchNoticeSettings(raw);
    assert.equal(settings.receiptMode, 'automatic');
    assert.deepEqual(Object.keys(settings.templates), [...PITCH_NOTICE_TEMPLATE_IDS]);
    for (const id of PITCH_NOTICE_TEMPLATE_IDS) {
      assert.deepEqual(settings.templates[id], { ...PITCH_NOTICE_DEFAULTS[id], custom: false });
    }
  }
});

test('pitch email settings keep usable custom wording and drop unusable fields', () => {
  const { readPitchNoticeSettings, PITCH_NOTICE_DEFAULTS, MAX_NOTICE_WORDING_LENGTH } = require('./pitch.cjs');
  const settings = readPitchNoticeSettings({
    receiptMode: 'manual',
    templates: {
      'pitch.accepted': { subject: 'Accepted: {{pitch_title}}', wording: 'Hi.\n\nWelcome.' },
      'pitch.declined': { subject: '   ', wording: 'x'.repeat(MAX_NOTICE_WORDING_LENGTH + 1) },
    },
  });
  assert.equal(settings.receiptMode, 'manual');
  assert.deepEqual(settings.templates['pitch.accepted'], { subject: 'Accepted: {{pitch_title}}', wording: 'Hi.\n\nWelcome.', custom: true });
  assert.deepEqual(settings.templates['pitch.declined'], { ...PITCH_NOTICE_DEFAULTS['pitch.declined'], custom: false });
});
