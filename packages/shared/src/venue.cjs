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
 * THE MAP: a picture of the building, and the same rooms in words.
 *
 * `config/event.venue.map` is `{ image, alt, markers[] }`. It is a THIRD
 * fact about the venue, recorded by the same operator as the places and the
 * movements, and it invents nothing the other two do not already say:
 *
 *   image     the Storage object path of an uploaded picture (the media
 *             library's stored identity — see admin ImagePicker; never a
 *             download URL, which changes when an object is replaced).
 *   alt       what the picture shows, in the operator's own words.
 *   markers[] `{ placeId, x, y }` — where one of `places[]` sits on that
 *             picture, as percentages of its width and height.
 *
 * THE MARKERS ARE NOT THE ROOM LIST. A marker is a coordinate; the rooms
 * are `places[]`, which is also what a session points at by `placeId`, so
 * the list beside the map names the same rooms the schedule does and a room
 * is renamed in one place. A marked room carries a number; an unmarked one
 * is still a room of this venue and is still listed, without one. That is
 * why this reader returns rooms rather than markers: the text list is the
 * accessible equal of the image, not a caption on it, and it does not
 * shrink to whatever the operator got round to placing.
 *
 * ALT TEXT IS NOT OPTIONAL. An image with no words for it is an image half
 * the readers cannot use, so this reader answers `null` rather than handing
 * a page an unlabelled picture — the same rule the lead image device
 * follows.
 */
const VENUE_MAP_KEYS = Object.freeze(['image', 'alt', 'markers']);

/** Keys a `config/event.venue.map.markers[]` entry may carry. */
const VENUE_MARKER_KEYS = Object.freeze(['placeId', 'x', 'y']);

/**
 * The seeded travel-page section the public map renders in.
 *
 * Named here rather than in either caller because two of them have to agree
 * on it and they cannot import each other: `scripts/lib/seed.cjs` writes the
 * section into the travel page document, and `apps/web` renders the map
 * where a page states a section with this id.
 */
const VENUE_MAP_SECTION_ID = 'travel_map';

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

/**
 * A Storage object path, trimmed, or `null`.
 *
 * The same shapes `apps/web/src/lib/mediaSource.js` refuses before building
 * a URL — an absolute URL, a leading slash, a parent traversal — because a
 * map whose path can only build a nonsense URL is a map that will render as
 * a broken image. The reader treats one as absent and renders nothing; the
 * validator, which shares this function, refuses it at the save, where
 * somebody can still paste the right thing.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
function storageObjectPath(value) {
  if (typeof value !== 'string') return null;
  const path = value.trim();
  if (path.length === 0) return null;
  if (path.startsWith('/') || path.includes('..') || /^[a-z][a-z0-9+.-]*:/i.test(path)) return null;
  return path;
}

/** A marker coordinate: a finite percentage of the image, 0 to 100. */
function isCoordinate(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
}

/**
 * THE MAP AND ITS ROOMS, or `null`.
 *
 * `null` for a venue with no map, a map with no usable image path, and a map
 * with no alt text — an unlabelled image renders nowhere.
 *
 * Otherwise the picture plus every place this venue records, in the venue's
 * own order, each carrying its marker number and coordinates when the
 * operator placed it and `null` for all three when they did not. Numbers run
 * in the order the markers are recorded, so the number drawn on the image and
 * the number read in the list are one number. A marker naming a place the
 * venue does not define, carrying a coordinate outside the image, or naming
 * a place an earlier marker already placed, is dropped: the validator refuses
 * those at the save, and a page must not white-screen over one that predates
 * it.
 *
 * @param {object|null} eventConfig
 * @returns {{
 *   image: string,
 *   alt: string,
 *   rooms: Array<{
 *     id: string, name: string, floor: string|null,
 *     number: number|null, x: number|null, y: number|null,
 *   }>,
 * } | null}
 */
function resolveVenueMap(eventConfig) {
  const map = venueOf(eventConfig).map;
  if (!map || typeof map !== 'object' || Array.isArray(map)) return null;

  const image = storageObjectPath(map.image);
  if (!image) return null;
  if (!isNonEmptyString(map.alt)) return null;

  const places = resolveVenuePlaces(eventConfig);
  const placeIds = new Set(places.map((place) => place.id));
  // A number is spent only on a marker that ends up drawn, so the numbers a
  // reader sees run 1, 2, 3 with no gap where a dropped marker was.
  const placed = new Map();
  if (Array.isArray(map.markers)) {
    for (const marker of map.markers) {
      if (!marker || typeof marker !== 'object' || Array.isArray(marker)) continue;
      if (typeof marker.placeId !== 'string' || !placeIds.has(marker.placeId)) continue;
      if (placed.has(marker.placeId)) continue;
      if (!isCoordinate(marker.x) || !isCoordinate(marker.y)) continue;
      placed.set(marker.placeId, { number: placed.size + 1, x: marker.x, y: marker.y });
    }
  }

  const rooms = places.map((place) => {
    const marker = placed.get(place.id) ?? null;
    return {
      id: place.id,
      name: place.name,
      floor: place.floor ?? null,
      number: marker ? marker.number : null,
      x: marker ? marker.x : null,
      y: marker ? marker.y : null,
    };
  });

  return { image, alt: map.alt.trim(), rooms };
}

module.exports = {
  VENUE_PLACE_KEYS,
  VENUE_MOVEMENT_KEYS,
  VENUE_MAP_KEYS,
  VENUE_MARKER_KEYS,
  VENUE_MAP_SECTION_ID,
  PLACE_ID_RE,
  MAX_WALKING_MINUTES,
  resolveVenuePlaces,
  venuePlace,
  sessionPlaceId,
  resolveMovement,
  sessionMovement,
  storageObjectPath,
  resolveVenueMap,
};
