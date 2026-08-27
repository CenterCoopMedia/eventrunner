'use strict';

/**
 * The movement model's readers (shared/venue.cjs).
 *
 * Every test here is a variation on one question: does this module ever
 * produce a movement nobody recorded? The transfer line was removed once
 * already for answering yes.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_WALKING_MINUTES,
  resolveVenuePlaces,
  venuePlace,
  sessionPlaceId,
  resolveMovement,
  sessionMovement,
} = require('./venue.cjs');

/** A venue with three places and two one-way moves between two of them. */
const CONFIG = Object.freeze({
  venue: {
    name: '[Fixture] Hall',
    places: [
      { id: 'main-hall', name: 'Main hall', floor: 'Ground floor' },
      { id: 'room-a', name: 'Room A', floor: 'First floor' },
      { id: 'room-b', name: 'Room B' },
    ],
    movements: [
      {
        from: 'main-hall',
        to: 'room-a',
        walkingMinutes: 4,
        accessibleRoute: 'Lift beside the north stair.',
      },
      { from: 'room-a', to: 'main-hall', walkingMinutes: 3 },
      { from: 'room-a', to: 'room-b', walkingMinutes: 0 },
    ],
  },
});

test('resolveVenuePlaces reads the places in the order the config states them', () => {
  assert.deepEqual(resolveVenuePlaces(CONFIG), [
    { id: 'main-hall', name: 'Main hall', floor: 'Ground floor' },
    { id: 'room-a', name: 'Room A', floor: 'First floor' },
    { id: 'room-b', name: 'Room B' },
  ]);
});

test('a venue that records nothing has no places and no movements', () => {
  for (const config of [null, {}, { venue: null }, { venue: {} }, { venue: 'a hall' }]) {
    assert.deepEqual(resolveVenuePlaces(config), []);
    assert.equal(resolveMovement(config, 'main-hall', 'room-a'), null);
  }
});

test('resolveVenuePlaces skips a malformed entry rather than throwing', () => {
  // The renderer meets whatever is stored, including documents written
  // before this schema existed. The validator is what stops one being
  // written; a page must not white-screen over one bad row.
  const places = resolveVenuePlaces({
    venue: {
      places: [
        null,
        'Room A',
        { id: 'Room A', name: 'Room A' }, // not a place id
        { id: 'room-a', name: '   ' }, // no name to tell a reader
        { id: 'room-a', name: 'Room A' },
        { id: 'room-a', name: 'Room A again' }, // duplicate: the first wins
      ],
    },
  });
  assert.deepEqual(places, [{ id: 'room-a', name: 'Room A' }]);
});

test('venuePlace answers by id and never by name', () => {
  assert.deepEqual(venuePlace(CONFIG, 'room-b'), { id: 'room-b', name: 'Room B' });
  assert.equal(venuePlace(CONFIG, 'Room B'), null);
  assert.equal(venuePlace(CONFIG, 'room-c'), null);
  assert.equal(venuePlace(CONFIG, null), null);
});

test('sessionPlaceId reads the stated reference and never the location string', () => {
  assert.equal(sessionPlaceId({ placeId: 'room-a', location: 'Room B' }), 'room-a');
  // A session that only writes a room label for a reader states no place.
  // Matching the label against place names would put the string comparison
  // this whole model exists to remove back in, one layer down.
  assert.equal(sessionPlaceId({ location: 'Main hall' }), null);
  assert.equal(sessionPlaceId({ placeId: 'Main Hall' }), null);
  assert.equal(sessionPlaceId(null), null);
});

test('resolveMovement returns the recorded move, resolved to both places', () => {
  assert.deepEqual(resolveMovement(CONFIG, 'main-hall', 'room-a'), {
    from: { id: 'main-hall', name: 'Main hall', floor: 'Ground floor' },
    to: { id: 'room-a', name: 'Room A', floor: 'First floor' },
    walkingMinutes: 4,
    accessibleRoute: 'Lift beside the north stair.',
  });
});

test('a movement with no surveyed step-free route says nothing about one', () => {
  // Absent must read as silence, never as "there isn't one".
  assert.equal(resolveMovement(CONFIG, 'room-a', 'main-hall').accessibleRoute, null);
});

test('zero minutes is a recorded answer, not a missing one', () => {
  // Some rooms are across the corridor. "0 min walk" is useful and true;
  // collapsing it into "no record" would lose a fact somebody walked.
  const across = resolveMovement(CONFIG, 'room-a', 'room-b');
  assert.equal(across.walkingMinutes, 0);
});

test('A MOVEMENT IS ONE-WAY AND IS NEVER REVERSED', () => {
  // Down two flights is not up two flights. The fixture records both
  // directions with different numbers, and each answers only for itself.
  assert.equal(resolveMovement(CONFIG, 'main-hall', 'room-a').walkingMinutes, 4);
  assert.equal(resolveMovement(CONFIG, 'room-a', 'main-hall').walkingMinutes, 3);
  // room-a → room-b is recorded; the way back is not, and stays unanswered.
  assert.equal(resolveMovement(CONFIG, 'room-b', 'room-a'), null);
});

test('nothing is chained', () => {
  // main-hall → room-a and room-a → room-b are both recorded. main-hall →
  // room-b is not, and it is not four-plus-zero either: it is unrecorded.
  assert.equal(resolveMovement(CONFIG, 'main-hall', 'room-b'), null);
});

test('a place cannot be a movement from itself', () => {
  assert.equal(resolveMovement(CONFIG, 'room-a', 'room-a'), null);
});

test('a movement naming a place the venue does not define resolves to nothing', () => {
  const config = {
    venue: {
      places: [{ id: 'room-a', name: 'Room A' }],
      movements: [{ from: 'room-a', to: 'room-z', walkingMinutes: 2 }],
    },
  };
  assert.equal(resolveMovement(config, 'room-a', 'room-z'), null);
});

test('an out-of-range or non-integer walk is not a movement', () => {
  const build = (walkingMinutes) => ({
    venue: {
      places: [
        { id: 'room-a', name: 'Room A' },
        { id: 'room-b', name: 'Room B' },
      ],
      movements: [{ from: 'room-a', to: 'room-b', walkingMinutes }],
    },
  });
  for (const bad of [-1, 4.5, MAX_WALKING_MINUTES + 1, '4', null, undefined, NaN]) {
    assert.equal(resolveMovement(build(bad), 'room-a', 'room-b'), null, `walk ${bad}`);
  }
  assert.equal(resolveMovement(build(MAX_WALKING_MINUTES), 'room-a', 'room-b').walkingMinutes,
    MAX_WALKING_MINUTES);
});

test('sessionMovement asks the same question about two sessions', () => {
  const inHall = { id: 's1', placeId: 'main-hall' };
  const inRoomA = { id: 's2', placeId: 'room-a' };
  const unplaced = { id: 's3', location: 'Rooms A and B' };

  assert.equal(sessionMovement(CONFIG, inHall, inRoomA).walkingMinutes, 4);
  // A session that states no place is not somewhere the reader can be
  // routed to. The demo's unconference runs in two rooms at once, and the
  // schedule says nothing about getting there — because there is no one
  // place to get to.
  assert.equal(sessionMovement(CONFIG, inHall, unplaced), null);
  assert.equal(sessionMovement(CONFIG, unplaced, inRoomA), null);
  assert.equal(sessionMovement(CONFIG, inHall, inHall), null);
});
