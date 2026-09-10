// The book's own example content, for a configuration that states none.
//
// Every specimen draws from the snapshot first, because a reviewer should
// see the event's own rooms, lines and sessions wherever the event has
// stated them. But `tracks`, `venue.places` and `venue.movements` are all
// OPTIONAL in config/event (packages/shared/src/config/schema.cjs), `days`
// may be an empty array, and every deployment made before one of those
// fields existed carries no key at all. A specimen that read one of them
// straight through threw while the module was being imported, and the book
// is one lazy chunk, so one throw took the whole route down rather than one
// figure.
//
// The words below are written for the book, the same way a control's label,
// hint and refusal are: a control needs something to draw, and the snapshot
// has no field for it. Nothing here is placeholder copy, and nothing here
// is used while the configuration has its own.
//
// ONE MODULE RATHER THAN A FALLBACK BESIDE EACH SPECIMEN. Nine files read
// the same three lists, and nine copies of an example track list is nine
// places for them to disagree about what the book draws.

/** Two lines, which is what makes a grid a grid. */
export const EXAMPLE_TRACKS = Object.freeze([
  Object.freeze({ letter: 'A', name: 'Practice' }),
  Object.freeze({ letter: 'B', name: 'Sustainability' }),
]);

/** Three rooms on two floors, so a movement between them is worth stating. */
export const EXAMPLE_PLACES = Object.freeze([
  Object.freeze({ id: 'main-hall', name: 'Main hall', floor: 'Ground floor' }),
  Object.freeze({ id: 'room-a', name: 'Room A', floor: 'First floor' }),
  Object.freeze({ id: 'room-b', name: 'Room B', floor: 'First floor' }),
]);

/** One recorded, one-way move, with the step-free way in words. */
export const EXAMPLE_MOVEMENTS = Object.freeze([
  Object.freeze({
    from: 'main-hall',
    to: 'room-a',
    walkingMinutes: 4,
    accessibleRoute: 'Lift beside the north stair to the first floor, then left along the gallery.',
  }),
]);

/** One day, long enough for the grid to have a shape. */
export const EXAMPLE_DAY = Object.freeze({
  id: 'specimen-day',
  label: 'Day one',
  date: '2026-10-15',
  startTime: '09:00',
  endTime: '17:00',
});

/**
 * Four sessions on that day: a plenary across the width, two workshops
 * sharing one time on the two lines, and a calling point inside one of
 * them. That is the smallest set the row, the grid, the calling points and
 * the transfer can all be drawn from.
 */
export const EXAMPLE_SESSIONS = Object.freeze([
  Object.freeze({
    id: 'specimen-session-plenary',
    dayId: EXAMPLE_DAY.id,
    startTime: '09:30',
    endTime: '10:45',
    title: 'Panel: Sustaining local partnerships',
    description: 'Three newsroom leaders explain how they fund shared coverage after its first year.',
    location: 'Main hall',
    placeId: 'main-hall',
    type: 'panel',
    speakerIds: Object.freeze([]),
    visible: true,
    order: 0,
  }),
  Object.freeze({
    id: 'specimen-session-budgets',
    dayId: EXAMPLE_DAY.id,
    startTime: '13:30',
    endTime: '15:00',
    title: 'Workshop: budgets that survive a thin year',
    description: 'Build a newsroom budget that can absorb the loss of one grant.',
    location: 'Room A',
    placeId: 'room-a',
    type: 'workshop',
    track: 'A',
    speakerIds: Object.freeze([]),
    visible: true,
    order: 1,
  }),
  Object.freeze({
    id: 'specimen-session-clinic',
    parentId: 'specimen-session-budgets',
    dayId: EXAMPLE_DAY.id,
    startTime: '14:15',
    endTime: '15:00',
    title: 'Clinic: bring your own budget',
    description: 'The second half of the workshop, in the room next door.',
    location: 'Room B',
    placeId: 'room-b',
    type: 'workshop',
    track: 'A',
    speakerIds: Object.freeze([]),
    visible: true,
    order: 2,
  }),
  Object.freeze({
    id: 'specimen-session-audience',
    dayId: EXAMPLE_DAY.id,
    startTime: '13:30',
    endTime: '15:00',
    title: 'Workshop: audience research on a small budget',
    description: 'Survey and interview methods for a newsroom with no research team.',
    location: 'Room B',
    placeId: 'room-b',
    type: 'workshop',
    track: 'B',
    speakerIds: Object.freeze([]),
    visible: true,
    order: 3,
  }),
]);

/** A non-empty array, or the authored one. */
function orExample(value, example) {
  return Array.isArray(value) && value.length > 0 ? value : example;
}

/**
 * The event's lines, or the authored two.
 *
 * @param {object} config config/event, as the snapshot holds it
 * @returns {object[]}
 */
export function specimenTracks(config) {
  return orExample(config?.tracks, EXAMPLE_TRACKS);
}

/**
 * The event's rooms, or the authored three.
 *
 * @param {object} config config/event, as the snapshot holds it
 * @returns {object[]}
 */
export function specimenPlaces(config) {
  return orExample(config?.venue?.places, EXAMPLE_PLACES);
}

/**
 * The event's days, or the authored one.
 *
 * @param {object} config config/event, as the snapshot holds it
 * @returns {object[]}
 */
export function specimenDays(config) {
  return orExample(config?.days, [EXAMPLE_DAY]);
}

/**
 * The configuration the book draws: the snapshot wherever the snapshot
 * states something, and the authored example wherever it states nothing.
 *
 * Built once at module scope, because every reader wants the same answer
 * and a device that resolved its own copy would draw a different room from
 * the one beside it.
 *
 * @param {object} config config/event, as the snapshot holds it
 * @returns {object}
 */
export function specimenEventConfig(config) {
  const stated = Array.isArray(config?.venue?.places) && config.venue.places.length > 0;
  const places = stated ? config.venue.places : EXAMPLE_PLACES;
  // The recorded moves go with the rooms they name. The event's own
  // movements beside the authored rooms would state a walk between two
  // places this configuration does not have.
  const movements = stated ? (config?.venue?.movements ?? []) : EXAMPLE_MOVEMENTS;
  return {
    ...config,
    days: specimenDays(config),
    tracks: specimenTracks(config),
    venue: { ...(config?.venue ?? {}), places, movements },
  };
}

/**
 * The day the schedule devices draw, and the sessions on it.
 *
 * The event's SECOND day where it has one with sessions, because a middle
 * day is the fullest picture of a programme. A configuration with no days,
 * or a snapshot whose sessions are on none of them, gets the authored day
 * and the four authored sessions instead.
 *
 * @param {object} config config/event, as the snapshot holds it
 * @param {object[]} sessions the snapshot's sessions
 * @returns {{ day: object, sessions: object[] }}
 */
export function specimenSchedule(config, sessions) {
  const list = Array.isArray(sessions) ? sessions : [];
  const days = Array.isArray(config?.days) ? config.days : [];
  for (const day of [days[1], days[0]]) {
    if (!day) continue;
    const onDay = list.filter((session) => session.dayId === day.id);
    if (onDay.length > 0) return { day, sessions: onDay };
  }
  return { day: EXAMPLE_DAY, sessions: [...EXAMPLE_SESSIONS] };
}
