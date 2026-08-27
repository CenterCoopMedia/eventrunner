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

// Tracks: the event's concurrent lines (design brief §4.6).

test('validateEventConfig accepts an event with no tracks, and one with tracks', () => {
  assert.equal(validateEventConfig(VALID_EVENT).ok, true);
  const withTracks = validateEventConfig({
    ...VALID_EVENT,
    tracks: [{ letter: 'A', name: 'Practice' }, { letter: 'B', name: 'Sustainability' }],
  });
  assert.deepEqual(withTracks, { ok: true, errors: [] });
});

test('validateEventConfig names every problem with a track', () => {
  const result = validateEventConfig({
    ...VALID_EVENT,
    tracks: [
      { letter: 'AB', name: 'Two letters' },
      { letter: 'a', name: 'Lowercase' },
      { letter: 'B', name: '   ' },
      { letter: 'C', name: 'Fine', colour: 'red' },
      { letter: 'C', name: 'Duplicate letter' },
      'not an object',
    ],
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.startsWith('tracks[0].letter:')));
  assert.ok(result.errors.some((e) => e.startsWith('tracks[1].letter:')));
  assert.ok(result.errors.some((e) => e === 'tracks[2].name: must be a nonempty string'));
  assert.ok(result.errors.some((e) => e === 'tracks[3].colour: unknown track field'));
  assert.ok(result.errors.some((e) => e.includes('duplicate track letter "C"')));
  assert.ok(result.errors.some((e) => e === 'tracks[5]: must be an object'));
});

test('validateEventConfig rejects a tracks value that is not an array', () => {
  const result = validateEventConfig({ ...VALID_EVENT, tracks: { A: 'Practice' } });
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('tracks: must be an array'));
});

// The movement model: venue.places and venue.movements (shared/venue.cjs).

test('validateEventConfig accepts a venue with no recorded movement at all', () => {
  // The starting state of every deployment: a venue nobody has walked yet
  // records nothing, and the schedule then states no movement. That is an
  // honest venue, not an incomplete one.
  assert.equal(validateEventConfig({ ...VALID_EVENT, venue: { name: 'Hall' } }).ok, true);
  assert.equal(
    validateEventConfig({ ...VALID_EVENT, venue: { places: [], movements: [] } }).ok,
    true,
  );
});

test('validateEventConfig accepts places and the one-way movements between them', () => {
  const result = validateEventConfig({
    ...VALID_EVENT,
    venue: {
      name: 'Hall',
      places: [
        { id: 'main-hall', name: 'Main hall', floor: 'Ground floor' },
        { id: 'room-a', name: 'Room A' },
      ],
      movements: [
        { from: 'main-hall', to: 'room-a', walkingMinutes: 4, accessibleRoute: 'Lift, then left.' },
        // The same pair the other way round is a DIFFERENT record, and both
        // are welcome: down two flights is not up two flights.
        { from: 'room-a', to: 'main-hall', walkingMinutes: 3 },
      ],
    },
  });
  assert.deepEqual(result, { ok: true, errors: [] });
});

test('validateEventConfig names every problem with a place', () => {
  const result = validateEventConfig({
    ...VALID_EVENT,
    venue: {
      places: [
        { id: 'Main Hall', name: 'Main hall' },
        { id: 'room-a', name: '   ' },
        { id: 'room-b', name: 'Room B', capacity: 90 },
        { id: 'room-b', name: 'Room B again' },
        { id: 'room-c', name: 'Room C', floor: '' },
        'not an object',
      ],
    },
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.startsWith('venue.places[0].id:')));
  assert.ok(result.errors.some((e) => e === 'venue.places[1].name: must be a nonempty string'));
  assert.ok(result.errors.some((e) => e === 'venue.places[2].capacity: unknown place field'));
  assert.ok(result.errors.some((e) => e.includes('duplicate place id "room-b"')));
  assert.ok(
    result.errors.some((e) => e === 'venue.places[4].floor: must be null or a nonempty string'),
  );
  assert.ok(result.errors.some((e) => e === 'venue.places[5]: must be an object'));
});

test('validateEventConfig refuses a movement naming a place the venue does not define', () => {
  // The error this shape invites: a room is renamed, its id changes, and
  // the routes pointing at it become sentences about a room that no longer
  // exists. A renderer meeting that has nothing to say and no way to say
  // why, so the save is where it has to be caught.
  const result = validateEventConfig({
    ...VALID_EVENT,
    venue: {
      places: [{ id: 'room-a', name: 'Room A' }],
      movements: [{ from: 'room-a', to: 'room-z', walkingMinutes: 2 }],
    },
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('"room-z" is not one of this venue\'s places')));
});

test('validateEventConfig names every problem with a movement', () => {
  const result = validateEventConfig({
    ...VALID_EVENT,
    venue: {
      places: [
        { id: 'room-a', name: 'Room A' },
        { id: 'room-b', name: 'Room B' },
      ],
      movements: [
        { from: 'room-a', to: 'room-a', walkingMinutes: 1 },
        { from: 'room-a', to: 'room-b', walkingMinutes: 600 },
        { from: 'room-a', to: 'room-b', walkingMinutes: 2 },
        { from: 'room-b', to: 'room-a', walkingMinutes: 2.5 },
        { from: 'room-b', to: 'room-a', walkingMinutes: 2, accessibleRoute: '  ' },
        { from: 'room-a', to: 'room-b', walkingMinutes: 1, stairs: true },
        'not an object',
      ],
    },
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('from and to name the same place')));
  assert.ok(result.errors.some((e) => e.startsWith('venue.movements[1].walkingMinutes:')));
  // One direction stated twice is two answers to one question.
  assert.ok(result.errors.some((e) => e.startsWith('venue.movements[2]: a movement from')));
  assert.ok(result.errors.some((e) => e.startsWith('venue.movements[3].walkingMinutes:')));
  assert.ok(
    result.errors.some(
      (e) => e === 'venue.movements[4].accessibleRoute: must be null or a nonempty string',
    ),
  );
  assert.ok(result.errors.some((e) => e === 'venue.movements[5].stairs: unknown movement field'));
  assert.ok(result.errors.some((e) => e === 'venue.movements[6]: must be an object'));
});

test('validateEventConfig accepts a zero-minute walk and refuses a negative one', () => {
  const build = (walkingMinutes) => ({
    ...VALID_EVENT,
    venue: {
      places: [
        { id: 'room-a', name: 'Room A' },
        { id: 'room-b', name: 'Room B' },
      ],
      movements: [{ from: 'room-a', to: 'room-b', walkingMinutes }],
    },
  });
  // Some rooms are across the corridor, and "0 min walk" is a real answer.
  assert.equal(validateEventConfig(build(0)).ok, true);
  assert.equal(validateEventConfig(build(-1)).ok, false);
});

test('validateEventConfig rejects places or movements that are not arrays', () => {
  const result = validateEventConfig({
    ...VALID_EVENT,
    venue: { places: { 'room-a': 'Room A' }, movements: 'none' },
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('venue.places: must be an array'));
  assert.ok(result.errors.includes('venue.movements: must be an array'));
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

test('validateTheme accepts a site navigation placement, and rejects a stranger', () => {
  // Where the navigation sits is a SITE setting: a reader who meets a top
  // nav on one page and a rail on the next has been handed two sites.
  const base = { colors: {} };
  assert.equal(validateTheme({ ...base, navPlacement: 'side' }).ok, true);
  assert.equal(validateTheme({ ...base, navPlacement: 'top' }).ok, true);
  // Absent is a real answer — it leaves the placement to whatever a page
  // document already stored, and then to the top.
  assert.equal(validateTheme(base).ok, true);
  const { ok, errors } = validateTheme({ ...base, navPlacement: 'floating' });
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.startsWith('theme.navPlacement:') && e.includes('"floating"')));
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
