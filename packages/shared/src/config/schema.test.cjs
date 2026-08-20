'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateEventConfig,
  validateTheme,
  validateBadgesConfig,
  validateFeatures,
} = require('./schema.cjs');

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

test('validateFeatures: booleans only, unknown keys rejected', () => {
  assert.equal(validateFeatures({ schedule: true, badges: false }).ok, true);
  const bad = validateFeatures({ schedule: 'yes', broadcasts: true });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.includes('features.schedule')));
  assert.ok(bad.errors.some((e) => e.includes('features.broadcasts: unknown feature key')));
  assert.equal(validateFeatures(null).ok, false);
  assert.equal(validateFeatures([]).ok, false);
});
