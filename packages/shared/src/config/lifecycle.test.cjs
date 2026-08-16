'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getEventPhase } = require('./lifecycle.cjs');

// Fixture event in America/Chicago (UTC-6 winter / UTC-5 summer). All
// config timestamps are event-local naive ISO.
const FIXTURE = {
  name: 'Demo Summit',
  timezone: 'America/Chicago',
  announcedAt: '2027-01-01T00:00',
  archivedAt: null,
  registration: {
    opensAt: '2027-02-01T09:00',
    closesAt: '2027-06-01T00:00',
  },
  days: [
    { id: 'day-1', date: '2027-06-10', startTime: '09:00', endTime: '17:00' },
    { id: 'day-2', date: '2027-06-11', startTime: '09:00', endTime: '16:00' },
  ],
};

function withOverrides(overrides) {
  return { ...FIXTURE, ...overrides };
}

test('getEventPhase full table against fixture instants', () => {
  const cases = [
    // [UTC instant, expected phase]
    ['2026-12-31T12:00:00Z', 'draft'],            // local Dec 31 06:00, before announcedAt
    ['2027-01-01T05:59:00Z', 'draft'],            // local 2026-12-31T23:59, one minute before
    ['2027-01-01T06:00:00Z', 'announced'],        // local exactly 2027-01-01T00:00; reg not open yet
    ['2027-01-15T12:00:00Z', 'announced'],        // announced, before opensAt
    ['2027-02-01T15:00:00Z', 'registration_open'],// local Feb 1 09:00, exact open boundary
    ['2027-03-15T12:00:00Z', 'registration_open'],
    ['2027-06-05T12:00:00Z', 'registration_closed'], // after closesAt, before day 1
    ['2027-06-10T13:59:00Z', 'registration_closed'], // local 08:59, one minute before doors
    ['2027-06-10T14:00:00Z', 'in_progress'],      // local Jun 10 09:00 exact start
    ['2027-06-11T20:00:00Z', 'in_progress'],      // local Jun 11 15:00
    ['2027-06-11T21:00:00Z', 'in_progress'],      // local exactly 16:00 = last endTime (not yet past)
    ['2027-06-11T21:01:00Z', 'ended'],            // one minute after last endTime
    ['2027-07-01T00:00:00Z', 'ended'],
  ];
  for (const [instant, expected] of cases) {
    assert.equal(getEventPhase(FIXTURE, new Date(instant)), expected, instant);
  }
});

test('archived wins over everything once archivedAt passes', () => {
  const config = withOverrides({ archivedAt: '2027-07-01T00:00' });
  assert.equal(getEventPhase(config, new Date('2027-08-01T12:00:00Z')), 'archived');
  // before archivedAt the normal table applies
  assert.equal(getEventPhase(config, new Date('2027-06-20T12:00:00Z')), 'ended');
  // archived beats draft too (order matters — archived is row 1)
  const archivedDraft = withOverrides({ archivedAt: '2027-07-01T00:00', announcedAt: null });
  assert.equal(getEventPhase(archivedDraft, new Date('2027-08-01T12:00:00Z')), 'archived');
});

test('announcedAt null means draft even during the event days', () => {
  const config = withOverrides({ announcedAt: null });
  assert.equal(getEventPhase(config, new Date('2027-06-10T15:00:00Z')), 'draft');
});

test('archivedAt null means never archived', () => {
  assert.equal(getEventPhase(FIXTURE, new Date('2099-01-01T00:00:00Z')), 'ended');
});

test('opensAt null means registration is open from announcement', () => {
  const config = withOverrides({ registration: { opensAt: null, closesAt: '2027-06-01T00:00' } });
  assert.equal(getEventPhase(config, new Date('2027-01-15T12:00:00Z')), 'registration_open');
});

test('closesAt null means registration never closes on a clock', () => {
  const config = withOverrides({ registration: { opensAt: '2027-02-01T09:00', closesAt: null } });
  assert.equal(getEventPhase(config, new Date('2027-06-09T12:00:00Z')), 'registration_open');
  // but the event days still take precedence once they start
  assert.equal(getEventPhase(config, new Date('2027-06-10T15:00:00Z')), 'in_progress');
  assert.equal(getEventPhase(config, new Date('2027-07-01T12:00:00Z')), 'ended');
});

test('empty days[] can never be ended or in_progress', () => {
  const config = withOverrides({ days: [] });
  // during what would have been the event, registration already closed
  assert.equal(getEventPhase(config, new Date('2027-06-10T15:00:00Z')), 'registration_closed');
  const openForever = withOverrides({ days: [], registration: { opensAt: null, closesAt: null } });
  assert.equal(getEventPhase(openForever, new Date('2099-01-01T00:00:00Z')), 'registration_open');
});

test('out-of-order days[] still yields correct in_progress/ended boundaries', () => {
  const config = withOverrides({
    days: [
      { id: 'day-2', date: '2027-06-11', startTime: '09:00', endTime: '16:00' },
      { id: 'day-1', date: '2027-06-10', startTime: '09:00', endTime: '17:00' },
    ],
  });
  // Local Jun 10 09:00 — event start, even though day-1 is listed last.
  assert.equal(getEventPhase(config, new Date('2027-06-10T14:00:00Z')), 'in_progress');
  // Local Jun 11 16:01 — past the chronologically-last endTime.
  assert.equal(getEventPhase(config, new Date('2027-06-11T21:01:00Z')), 'ended');
  // Local Jun 10 15:00 — mid-event, must not read as ended.
  assert.equal(getEventPhase(config, new Date('2027-06-10T20:00:00Z')), 'in_progress');
});

test('malformed days are treated as empty (degrade, never throw)', () => {
  const config = withOverrides({
    days: [{ id: 'day-1', date: '2027-06-10', startTime: '9am', endTime: '17:00' }],
  });
  assert.equal(getEventPhase(config, new Date('2027-06-10T15:00:00Z')), 'registration_closed');
  const dateOnly = withOverrides({ days: 'not-an-array' });
  assert.equal(getEventPhase(dateOnly, new Date('2027-06-10T15:00:00Z')), 'registration_closed');
});

test('missing or invalid timezone fails closed into draft', () => {
  assert.equal(getEventPhase(withOverrides({ timezone: undefined }), new Date()), 'draft');
  assert.equal(getEventPhase(withOverrides({ timezone: 'Not/AZone' }), new Date()), 'draft');
  assert.equal(getEventPhase(null), 'draft');
  assert.equal(getEventPhase(undefined), 'draft');
  assert.equal(getEventPhase({}), 'draft');
});

test('mixed precision timestamps are truncated to the minute on both sides', () => {
  // announcedAt carries seconds; comparison must not let ":30" skew the
  // minute boundary (truncated, the phase flips at 00:00 local exactly).
  const config = withOverrides({ announcedAt: '2027-01-01T00:00:30' });
  assert.equal(getEventPhase(config, new Date('2027-01-01T06:00:10Z')), 'announced');
  // malformed timestamp is treated as null (draft)
  const malformed = withOverrides({ announcedAt: '2027-01-01' });
  assert.equal(getEventPhase(malformed, new Date('2027-06-01T00:00:00Z')), 'draft');
});
