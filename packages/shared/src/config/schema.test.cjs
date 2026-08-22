'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateEventConfig,
  validateTheme,
  validateBadgesConfig,
  validateFeatures,
} = require('./schema.cjs');
const { MAX_TOTAL_BADGES } = require('../badges.cjs');

const VALID_EVENT = {
  name: 'Demo Summit',
  shortName: 'DEMO27',
  timezone: 'America/Chicago',
  days: [
    { id: 'day-1', date: '2027-06-10', startTime: '09:00', endTime: '17:00' },
    { id: 'day-2', date: '2027-06-11', startTime: '09:00', endTime: '16:00' },
  ],
  registration: { opensAt: '2027-02-01T09:00', closesAt: '2027-06-01T00:00:00' },
  sender: { email: 'hello@demo-summit.org', name: 'Demo Summit', replyTo: null },
};

test('validateEventConfig accepts a valid config', () => {
  const result = validateEventConfig(VALID_EVENT);
  assert.deepEqual(result, { ok: true, errors: [] });
});

test('validateEventConfig rejects per-field problems with named errors', () => {
  const result = validateEventConfig({
    name: '',
    shortName: 42,
    timezone: 'Not/AZone',
    days: [
      { id: 'day-1', date: '2027-6-10', startTime: '09:00', endTime: '17:00' },
      { id: 'day-1', date: '2027-06-11', startTime: '17:00', endTime: '09:00' },
    ],
    registration: { opensAt: '2027-06-01', closesAt: 'soon' },
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.startsWith('name:')));
  assert.ok(result.errors.some((e) => e.startsWith('shortName:')));
  assert.ok(result.errors.some((e) => e.startsWith('timezone:')));
  assert.ok(result.errors.some((e) => e.includes('days[0].date')));
  assert.ok(result.errors.some((e) => e.includes('duplicate day id')));
  assert.ok(result.errors.some((e) => e.includes('startTime must be before endTime')));
  assert.ok(result.errors.some((e) => e.includes('registration.opensAt')));
  assert.ok(result.errors.some((e) => e.includes('registration.closesAt')));
});

test('validateEventConfig: opensAt must precede closesAt; nulls allowed', () => {
  const bad = validateEventConfig({
    ...VALID_EVENT,
    registration: { opensAt: '2027-06-01T00:00', closesAt: '2027-02-01T09:00' },
  });
  assert.ok(bad.errors.some((e) => e.includes('opensAt must be before closesAt')));
  const nulls = validateEventConfig({
    ...VALID_EVENT,
    registration: { opensAt: null, closesAt: null },
  });
  assert.equal(nulls.ok, true);
});

test('validateEventConfig rejects days[] dates that are not strictly ascending', () => {
  const outOfOrder = validateEventConfig({
    ...VALID_EVENT,
    days: [
      { id: 'day-2', date: '2027-06-11', startTime: '09:00', endTime: '16:00' },
      { id: 'day-1', date: '2027-06-10', startTime: '09:00', endTime: '17:00' },
    ],
  });
  assert.equal(outOfOrder.ok, false);
  assert.ok(outOfOrder.errors.some((e) => e.includes('strictly ascending')));

  const duplicateDate = validateEventConfig({
    ...VALID_EVENT,
    days: [
      { id: 'day-1', date: '2027-06-10', startTime: '09:00', endTime: '12:00' },
      { id: 'day-2', date: '2027-06-10', startTime: '13:00', endTime: '17:00' },
    ],
  });
  assert.equal(duplicateDate.ok, false);
  assert.ok(duplicateDate.errors.some((e) => e.includes('strictly ascending')));
});

test('validateEventConfig rejects calendar dates Date.UTC would silently normalize', () => {
  // 2027-02-30 does not exist; Date.UTC(2027, 1, 30) rolls it forward into
  // March instead of throwing, so the schema must round-trip the components
  // itself rather than trust the format regex alone.
  const result = validateEventConfig({
    ...VALID_EVENT,
    days: [{ id: 'day-1', date: '2027-02-30', startTime: '09:00', endTime: '17:00' }],
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('days[0].date')));

  // A real leap day is still accepted.
  const leapDay = validateEventConfig({
    ...VALID_EVENT,
    days: [{ id: 'day-1', date: '2028-02-29', startTime: '09:00', endTime: '17:00' }],
  });
  assert.equal(leapDay.ok, true);

  // Feb 29 in a non-leap year does not exist.
  const nonLeapDay = validateEventConfig({
    ...VALID_EVENT,
    days: [{ id: 'day-1', date: '2027-02-29', startTime: '09:00', endTime: '17:00' }],
  });
  assert.equal(nonLeapDay.ok, false);
});

test('validateEventConfig: tagline must be a string when present, but is optional', () => {
  assert.equal(validateEventConfig({ ...VALID_EVENT, tagline: 'A gathering' }).ok, true);
  assert.equal(validateEventConfig({ ...VALID_EVENT, tagline: undefined }).ok, true);

  for (const tagline of [{ unexpected: 'object' }, 42, ['a'], false]) {
    const result = validateEventConfig({ ...VALID_EVENT, tagline });
    assert.equal(result.ok, false, JSON.stringify(tagline));
    assert.ok(result.errors.some((e) => e.startsWith('tagline:')));
  }
});

test('validateEventConfig requires a usable sender (the OTP From address)', () => {
  for (const sender of [undefined, null, 'x', []]) {
    const result = validateEventConfig({ ...VALID_EVENT, sender });
    assert.equal(result.ok, false, JSON.stringify(sender));
    assert.ok(result.errors.some((e) => e.startsWith('sender: must be an object')));
  }
  for (const email of [undefined, '', 'not-an-email', 'a@b']) {
    const result = validateEventConfig({ ...VALID_EVENT, sender: { email } });
    assert.equal(result.ok, false, JSON.stringify(email));
    assert.ok(result.errors.some((e) => e.startsWith('sender.email:')));
  }
  const bad = validateEventConfig({
    ...VALID_EVENT,
    sender: { email: 'a@b.org', name: '', replyTo: 'nope' },
  });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.startsWith('sender.name:')));
  assert.ok(bad.errors.some((e) => e.startsWith('sender.replyTo:')));

  // name/replyTo are optional; the stored verification pair is tolerated
  // (the panel path rejects it earlier, but stored docs carry it).
  const minimal = validateEventConfig({
    ...VALID_EVENT,
    sender: { email: 'a@b.org', domainVerified: true, domainVerifiedAt: null },
  });
  assert.deepEqual(minimal, { ok: true, errors: [] });
});

test('validateEventConfig never throws on garbage', () => {
  assert.equal(validateEventConfig(null).ok, false);
  assert.equal(validateEventConfig('x').ok, false);
  assert.equal(validateEventConfig({}).ok, false);
});

test('validateTheme enforces hex colors', () => {
  // The theme validator's own test is the one place hex strings are data.
  /* eslint-disable no-restricted-syntax */
  assert.equal(validateTheme({ colors: { primary: '#336699', ink: '#123' } }).ok, true);
  const bad = validateTheme({ colors: { primary: 'teal', accent: '#12345' } });
  /* eslint-enable no-restricted-syntax */
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.includes('theme.colors.primary')));
  assert.ok(bad.errors.some((e) => e.includes('theme.colors.accent')));
  assert.equal(validateTheme(null).ok, false);
  assert.equal(validateTheme({}).ok, false);
});

test('validateBadgesConfig enforces unique ids and positive maxPicks', () => {
  const good = validateBadgesConfig({
    categories: [
      { id: 'craft', label: 'Craft', maxPicks: 3, badges: [{ id: 'b1' }, { id: 'b2' }] },
      { id: 'fun', label: 'Fun', maxPicks: 1, badges: [{ id: 'b3' }] },
    ],
  });
  assert.deepEqual(good, { ok: true, errors: [] });

  const bad = validateBadgesConfig({
    categories: [
      { id: 'craft', maxPicks: 0, badges: [{ id: 'b1' }, { id: 'b1' }] },
      { id: 'craft', maxPicks: 1.5, badges: [{ id: 'b1' }] },
    ],
  });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.includes('duplicate category id')));
  assert.ok(bad.errors.some((e) => e.includes('duplicate badge id')));
  assert.ok(bad.errors.filter((e) => e.includes('maxPicks')).length >= 2);
  assert.equal(validateBadgesConfig(null).ok, false);
});

test('validateBadgesConfig rejects a config whose maximum selectable total exceeds MAX_TOTAL_BADGES', () => {
  // One category alone over the cap.
  const oneCategoryOver = validateBadgesConfig({
    categories: [
      {
        id: 'craft',
        label: 'Craft',
        maxPicks: MAX_TOTAL_BADGES + 1,
        badges: Array.from({ length: MAX_TOTAL_BADGES + 1 }, (_, i) => ({ id: `b${i}` })),
      },
    ],
  });
  assert.equal(oneCategoryOver.ok, false);
  assert.ok(oneCategoryOver.errors.some((e) => e.startsWith('badges:') && e.includes('platform limit')));

  // Several categories individually fine, but summing past the cap.
  const summedOver = validateBadgesConfig({
    categories: [
      {
        id: 'craft',
        maxPicks: MAX_TOTAL_BADGES - 5,
        badges: Array.from({ length: MAX_TOTAL_BADGES - 5 }, (_, i) => ({ id: `craft-${i}` })),
      },
      {
        id: 'fun',
        maxPicks: 10,
        badges: Array.from({ length: 10 }, (_, i) => ({ id: `fun-${i}` })),
      },
    ],
  });
  assert.equal(summedOver.ok, false);
  assert.ok(summedOver.errors.some((e) => e.startsWith('badges:')));

  // Exactly at the cap is allowed.
  const atCap = validateBadgesConfig({
    categories: [
      {
        id: 'craft',
        maxPicks: MAX_TOTAL_BADGES,
        badges: Array.from({ length: MAX_TOTAL_BADGES }, (_, i) => ({ id: `b${i}` })),
      },
    ],
  });
  assert.equal(atCap.ok, true);

  // A generous maxPicks bounded by a small badge list does not count against
  // the cap at its face value — only the number an attendee could actually
  // select does.
  const generousCapSmallList = validateBadgesConfig({
    categories: [
      { id: 'craft', maxPicks: 1000, badges: [{ id: 'b1' }, { id: 'b2' }] },
    ],
  });
  assert.equal(generousCapSmallList.ok, true);
});

test('validateFeatures: booleans only, unknown keys rejected', () => {
  assert.equal(validateFeatures({ schedule: true, badges: false }).ok, true);
  const bad = validateFeatures({ schedule: 'yes', broadcasts: true });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.includes('features.schedule')));
  assert.ok(bad.errors.some((e) => e.includes('features.broadcasts: unknown feature key')));
  assert.equal(validateFeatures(null).ok, false);
  assert.equal(validateFeatures([]).ok, false);
});
