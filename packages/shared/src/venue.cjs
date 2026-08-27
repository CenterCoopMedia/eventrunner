'use strict';

/**
 * THE MOVEMENT MODEL: what the building is, and what it costs to cross it
 * (design brief §4.6 — "moving between sessions is a transfer, and the site
 * states it plainly: where you are, where it is, how long it takes").
 *
 * WHY THIS FILE EXISTS. The schedule used to print "Transfer to Room B"
 * whenever one session's room string differed from the previous row's. That
 * was a guess wearing the voice of a fact: two rooms with different names
 * may be the same door under two labels, a reader who skipped the earlier
 * session is not moving from anywhere, and a reader following one track out
 * of five is not walking the list in order at all. The inference was
 * removed, which left the right sentence with nothing true to say.
 *
 * This is the data that makes it true. A movement is RECORDED by whoever
 * knows the building — the operator — and the site renders exactly what they
 * recorded and nothing else. Two structures, both under `config/event.venue`
 * beside the address, because a route is a fact about a venue rather than
 * about a session:
 *
 *   places[]      the named rooms and halls the schedule can point at.
 *                 `{ id, name, floor? }`. A session names one by `placeId`
 *                 (functions/src/schedule/sessions.cjs validates the
 *                 reference the same way it validates a track letter), and
 *                 the name lives here once so renaming a room is one edit
 *                 rather than a sweep of every session.
 *
 *   movements[]   one recorded move from one place to another.
 *                 `{ from, to, walkingMinutes, accessibleRoute? }`.
 *
 * FIVE RULES, AND EVERY ONE OF THEM IS ABOUT NOT INVENTING A FACT:
 *
 *  1. A movement renders only where a record states that exact pair. No
 *     record, no line. There is no default walking time, and "unknown"
 *     never becomes a number.
 *
 *  2. A MOVEMENT IS ONE-WAY. `from` → `to` says nothing about `to` →
 *     `from`, and this module never reverses one. Down two flights is not
 *     up two flights, a one-way corridor is one-way, and a lift queue at
 *     the top of the hour is not the same queue at half past. An operator
 *     who knows the reverse is the same records the reverse.
 *
 *  3. Nothing is chained. If A→B and B→C are recorded, A→C is not six
 *     minutes; it is unrecorded, and unrecorded reads as silence.
 *
 *  4. Two places are told apart by their ID, never by their name. Two rooms
 *     may share a name across floors; one room may be renamed mid-event.
 *
 *  5. `walkingMinutes` is a whole number of minutes and may be `0` — some
 *     rooms are across the corridor, and "0 min walk" is a real, useful
 *     answer that must not collapse into "no record".
 *
 * `accessibleRoute` is the step-free way between the same two places, in
 * the operator's own words. Optional, because a venue that has not surveyed
 * one must not have an assurance invented on its behalf: absent means the
 * site says nothing, never "there isn't one".
 *
 * THE READERS BELOW ARE FORGIVING; THE VALIDATOR IS STRICT. Writes go
 * through shared/config validateEventConfig, which rejects a malformed
 * place or a movement naming an undefined place BY NAME. These readers meet
 * whatever is already stored, including documents written before this
 * schema existed, so a malformed entry is skipped rather than thrown.
 */

/** Keys a `config/event.venue.places[]` entry may carry. */
const VENUE_PLACE_KEYS = Object.freeze(['id', 'name', 'floor']);

/** Keys a `config/event.venue.movements[]` entry may carry. */
const VENUE_MOVEMENT_KEYS = Object.freeze([
  'from',
  'to',
  'walkingMinutes',
  'accessibleRoute',
]);

/**
 * A place id: lowercase, digits, single hyphens. The same slug shape the
 * rest of the system uses for a stable identifier that appears in stored
 * references — a session's `placeId` points at one, so it has to survive a
 * room being renamed.
 */
const PLACE_ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * The longest walk this schema will record, in minutes.
 *
 * Not a guess at a building's size — an upper bound that catches the typo.
 * A recorded 600-minute walk between two rooms is a `600` that was meant to
 * be `6`, or seconds entered as minutes, and either way it is better
 * refused at the save than printed to a reader deciding whether they can
 * make the next session.
 */
const MAX_WALKING_MINUTES = 120;

/** @param {unknown} v */
function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

/** The `venue` map on an event config, or `{}`. */
function venueOf(eventConfig) {
  const venue = eventConfig?.venue;
  return venue && typeof venue === 'object' && !Array.isArray(venue) ? venue : {};
}

/** True when `place` has the two parts every place must have. */
function isWellFormedPlace(place) {
  return (
    !!place &&
    typeof place === 'object' &&
    !Array.isArray(place) &&
    typeof place.id === 'string' &&
    PLACE_ID_RE.test(place.id) &&
    isNonEmptyString(place.name)
  );
}

/**
 * The places the venue defines, in the order the config states them.
 *
 * Malformed entries are skipped rather than thrown: this is the renderer's
 * side of the contract, and a page must not white-screen over one bad row
 * in an admin write. The validator is what stops one being written.
 *
 * @param {object|null} eventConfig
 * @returns {Array<{ id: string, name: string, floor?: string }>}
 */
function resolveVenuePlaces(eventConfig) {
  const places = venueOf(eventConfig).places;
  if (!Array.isArray(places)) return [];
  const seen = new Set();
  const out = [];
  for (const place of places) {
    if (!isWellFormedPlace(place)) continue;
    // A duplicate id would make `venuePlace` answer with whichever copy
    // came first, which is a coin toss dressed as a lookup. The validator
    // refuses one; here the first wins and the rest are dropped, so the
    // lookup at least stays consistent with the list.
    if (seen.has(place.id)) continue;
    seen.add(place.id);
    out.push(
      isNonEmptyString(place.floor)
        ? { id: place.id, name: place.name, floor: place.floor }
        : { id: place.id, name: place.name },
    );
  }
  return out;
}

/**
 * One place by id, or `null`.
 *
 * @param {object|null} eventConfig
 * @param {unknown} placeId
 * @returns {{ id: string, name: string, floor?: string } | null}
 */
function venuePlace(eventConfig, placeId) {
  if (typeof placeId !== 'string' || placeId.length === 0) return null;
  return resolveVenuePlaces(eventConfig).find((place) => place.id === placeId) ?? null;
}

/**
 * The place a session states, or `null` for a session that names none.
 *
 * A session's free-text `location` is NOT consulted. It is a label an
 * operator writes for a reader ("Room A", "Rooms A and B", "the courtyard,
 * weather permitting"), and matching it against place names would put the
 * string comparison this whole model exists to remove back in, one layer
 * down. A session is in a recorded place because it says so.
 *
 * @param {object|null} session
 * @returns {string|null}
 */
function sessionPlaceId(session) {
  const placeId = session?.placeId;
  return typeof placeId === 'string' && PLACE_ID_RE.test(placeId) ? placeId : null;
}

/** True when `movement` states its two ends and a usable number of minutes. */
function isWellFormedMovement(movement) {
  return (
    !!movement &&
    typeof movement === 'object' &&
    !Array.isArray(movement) &&
    typeof movement.from === 'string' &&
    typeof movement.to === 'string' &&
    movement.from !== movement.to &&
    Number.isInteger(movement.walkingMinutes) &&
    movement.walkingMinutes >= 0 &&
    movement.walkingMinutes <= MAX_WALKING_MINUTES
  );
}

/**
 * THE ONE WAY A TRANSFER IS PRODUCED.
 *
 * Given two place ids, the recorded move between them — resolved to the
 * two place records, so a caller renders names rather than ids — or `null`.
 *
 * `null` for every one of: either id absent, either id naming no place, the
 * two ids being the same place, or no record stating that ordered pair.
 * Nothing here computes, estimates, reverses, or chains. A caller that gets
 * `null` renders nothing, which is the honest thing to render about a
 * movement nobody wrote down.
 *
 * @param {object|null} eventConfig
 * @param {unknown} fromPlaceId
 * @param {unknown} toPlaceId
 * @returns {{
 *   from: { id: string, name: string, floor?: string },
 *   to: { id: string, name: string, floor?: string },
 *   walkingMinutes: number,
 *   accessibleRoute: string|null,
 * } | null}
 */
function resolveMovement(eventConfig, fromPlaceId, toPlaceId) {
  if (typeof fromPlaceId !== 'string' || typeof toPlaceId !== 'string') return null;
  if (fromPlaceId === toPlaceId) return null;

  const from = venuePlace(eventConfig, fromPlaceId);
  const to = venuePlace(eventConfig, toPlaceId);
  if (!from || !to) return null;

  const movements = venueOf(eventConfig).movements;
  if (!Array.isArray(movements)) return null;

  const record = movements.find(
    (movement) =>
      isWellFormedMovement(movement) &&
      movement.from === fromPlaceId &&
      movement.to === toPlaceId,
  );
  if (!record) return null;

  return {
    from,
    to,
    walkingMinutes: record.walkingMinutes,
    accessibleRoute: isNonEmptyString(record.accessibleRoute) ? record.accessibleRoute : null,
  };
}

/**
 * The movement between two SESSIONS, where both state a place.
 *
 * This is a convenience over resolveMovement and it makes no extra claim:
 * the caller is the one asserting that a reader goes from the first session
 * to the second (they bookmarked both; the second is a calling point inside
 * the first). This only answers what that move costs, if anyone recorded
 * it.
 *
 * @param {object|null} eventConfig
 * @param {object|null} fromSession
 * @param {object|null} toSession
 */
function sessionMovement(eventConfig, fromSession, toSession) {
  return resolveMovement(eventConfig, sessionPlaceId(fromSession), sessionPlaceId(toSession));
}

module.exports = {
  VENUE_PLACE_KEYS,
  VENUE_MOVEMENT_KEYS,
  PLACE_ID_RE,
  MAX_WALKING_MINUTES,
  resolveVenuePlaces,
  venuePlace,
  sessionPlaceId,
  resolveMovement,
  sessionMovement,
};
