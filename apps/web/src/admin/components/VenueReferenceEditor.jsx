import { useMemo, useRef, useState } from 'react';
import { MEDIA_LIBRARY_PREFIXES, isMediaLibraryPath, storageObjectPath } from 'shared/venue';
import {
  Panel,
  SelectField,
  TextField,
  dangerButtonClass,
  secondaryButtonClass,
} from './formControls.jsx';
import ImagePicker from './media/ImagePicker.jsx';

const PLACE_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EMPTY_REFERENCES = Object.freeze([]);
const EMPTY_MAP = Object.freeze({ image: '', alt: '', markers: EMPTY_REFERENCES });

export const blankPlace = () => ({ id: '', name: '', floor: '', persisted: false });
export const blankMovement = () => ({
  from: '',
  to: '',
  walkingMinutes: '0',
  accessibleRoute: '',
});
export const blankMarker = () => ({ placeId: '', x: '50', y: '50' });

export function placeIdFromName(name) {
  return String(name ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
}

/** A stored number as a form string; '' for one that was never recorded. */
const numberField = (value) =>
  value === undefined || value === null || value === '' ? '' : String(value);

export function normalizeVenueReferences(venue) {
  const map = venue?.map && typeof venue.map === 'object' && !Array.isArray(venue.map)
    ? venue.map
    : null;
  return {
    map: {
      image: map?.image ?? '',
      alt: map?.alt ?? '',
      markers: Array.isArray(map?.markers)
        ? map.markers.map((marker) => ({
            placeId: marker?.placeId ?? '',
            x: numberField(marker?.x),
            y: numberField(marker?.y),
          }))
        : [],
    },
    places: Array.isArray(venue?.places)
      ? venue.places.map((place) => ({
          id: place?.id ?? '',
          name: place?.name ?? '',
          floor: place?.floor ?? '',
          persisted: true,
        }))
      : [],
    movements: Array.isArray(venue?.movements)
      ? venue.movements.map((movement) => ({
          from: movement?.from ?? '',
          to: movement?.to ?? '',
          walkingMinutes:
            movement?.walkingMinutes === undefined || movement?.walkingMinutes === null
              ? ''
              : String(movement.walkingMinutes),
          accessibleRoute: movement?.accessibleRoute ?? '',
        }))
      : [],
  };
}

const optional = (value) => {
  const trimmed = String(value ?? '').trim();
  return trimmed || null;
};

/**
 * A typed coordinate as a number, or `null` for one nobody typed.
 *
 * NOT `Number('')`, WHICH IS 0. Zero is the left or top edge of the picture
 * — a real answer an operator can mean — so coercing an empty field to it
 * silently places a marker in a corner and calls that the operator's
 * decision. `null` is refused by the shared validator, and submit refuses it
 * before that, so a blank stays a blank all the way down.
 */
function coordinate(value) {
  const raw = String(value ?? '').trim();
  if (raw === '') return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The map, or null.
 *
 * No image is no map, and null is the server's "clear this" — so an operator
 * who clears the picker removes the stored map rather than leaving a record
 * of an image that is no longer there.
 */
function venueMapPayload(map) {
  const image = String(map?.image ?? '').trim();
  if (!image) return null;
  return {
    image,
    alt: String(map?.alt ?? '').trim(),
    markers: (map?.markers ?? []).map((marker) => ({
      placeId: marker.placeId,
      x: coordinate(marker.x),
      y: coordinate(marker.y),
    })),
  };
}

export function venueReferencesPayload(venue) {
  return {
    map: venueMapPayload(venue?.map),
    places: (venue?.places ?? []).map((place) => ({
      id: String(place.id ?? '').trim(),
      name: String(place.name ?? '').trim(),
      floor: optional(place.floor),
    })),
    movements: (venue?.movements ?? []).map((movement) => ({
      from: movement.from,
      to: movement.to,
      walkingMinutes: Number(movement.walkingMinutes),
      accessibleRoute: optional(movement.accessibleRoute),
    })),
  };
}

export function validateVenueReferences(venue) {
  const errors = new Map();
  const ids = new Set();
  for (const [index, place] of (venue?.places ?? []).entries()) {
    const idField = `venue.places[${index}].id`;
    const nameField = `venue.places[${index}].name`;
    const id = String(place.id ?? '').trim();
    if (!PLACE_ID_RE.test(id)) {
      errors.set(idField, 'Use lowercase letters, digits, and single hyphens.');
    } else if (ids.has(id)) {
      errors.set(idField, `Place id “${id}” is already used.`);
    } else {
      ids.add(id);
    }
    if (!String(place.name ?? '').trim()) errors.set(nameField, 'Enter a place name.');
  }

  const pairs = new Set();
  for (const [index, movement] of (venue?.movements ?? []).entries()) {
    const at = `venue.movements[${index}]`;
    if (!ids.has(movement.from)) errors.set(`${at}.from`, 'Select a defined place.');
    if (!ids.has(movement.to)) errors.set(`${at}.to`, 'Select a defined place.');
    if (movement.from && movement.from === movement.to) {
      errors.set(`${at}.to`, 'Choose a different destination.');
    }
    const pair = `${movement.from}\u0000${movement.to}`;
    if (movement.from && movement.to) {
      if (pairs.has(pair)) errors.set(`${at}.to`, 'This one-way route is already recorded.');
      pairs.add(pair);
    }
    const rawMinutes = String(movement.walkingMinutes ?? '').trim();
    const minutes = Number(rawMinutes);
    if (!/^\d+$/.test(rawMinutes) || !Number.isInteger(minutes) || minutes < 0 || minutes > 120) {
      errors.set(`${at}.walkingMinutes`, 'Enter a whole number from 0 to 120.');
    }
  }
  return errors;
}

/**
 * The map's own problems, SEPARATE FROM validateVenueReferences ABOVE.
 *
 * Two validators because they are used at two different moments, and issue
 * #219 is why. The places and movements above disable the save button while
 * they are wrong; growing that set is how a form ends up with a dead button
 * and no way for the person in front of it to find out which field did it.
 * The map's fields are checked at SUBMIT instead: the button stays live, the
 * offending field is marked, focus moves there, and nothing is sent.
 *
 * Nothing is checked until an image is chosen, because until then there is
 * no map to be wrong about.
 *
 * @param {object} venue the form's venue slice
 * @returns {Map<string, string>} field path → message
 */
export function validateVenueMap(venue) {
  const errors = new Map();
  const map = venue?.map;
  if (!String(map?.image ?? '').trim()) return errors;

  const ids = new Set(
    (venue?.places ?? []).map((place) => String(place.id ?? '').trim()).filter(Boolean),
  );

  // The picker's path stays editable as text, so a URL can be typed into it
  // — and a URL cannot be resolved against the bucket.
  const path = storageObjectPath(map.image);
  if (!path || !isMediaLibraryPath(path)) {
    errors.set(
      'venue.map.image',
      `Choose an image from the media library. The path starts with ${MEDIA_LIBRARY_PREFIXES.join(' or ')}.`,
    );
  }
  if (!String(map.alt ?? '').trim()) {
    errors.set('venue.map.alt', 'Enter alt text saying what the map shows.');
  }
  const marked = new Set();
  for (const [index, marker] of (map.markers ?? []).entries()) {
    const at = `venue.map.markers[${index}]`;
    if (!ids.has(marker.placeId)) {
      errors.set(`${at}.placeId`, 'Select a defined place.');
    } else if (marked.has(marker.placeId)) {
      errors.set(`${at}.placeId`, 'This room is already marked on the map.');
    } else {
      marked.add(marker.placeId);
    }
    for (const axis of ['x', 'y']) {
      const value = coordinate(marker[axis]);
      if (value === null || value < 0 || value > 100) {
        errors.set(`${at}.${axis}`, 'Enter a number from 0 to 100.');
      }
    }
  }
  return errors;
}

function afterRender(callback) {
  setTimeout(callback, 0);
}

export default function VenueReferenceEditor({ venue, onChange, errorFor, placeUsage }) {
  const [notice, setNotice] = useState('');
  const addPlaceRef = useRef(null);
  const addMovementRef = useRef(null);
  const addMarkerRef = useRef(null);
  const placeRemoveRefs = useRef([]);
  const movementRemoveRefs = useRef([]);
  const markerRemoveRefs = useRef([]);
  const places = venue.places ?? EMPTY_REFERENCES;
  const movements = venue.movements ?? EMPTY_REFERENCES;
  const map = venue.map ?? EMPTY_MAP;
  const markers = map.markers ?? EMPTY_REFERENCES;
  const options = useMemo(
    () => [
      { value: '', label: 'Select a place' },
      ...places.map((place) => ({
        value: place.id,
        label: place.name ? `${place.name} (${place.id || 'no id'})` : place.id || 'Unnamed place',
      })),
    ],
    [places],
  );

  const changePlace = (index, patch) =>
    onChange({
      places: places.map((place, placeIndex) =>
        placeIndex === index ? { ...place, ...patch } : place,
      ),
    });
  const changeMovement = (index, patch) =>
    onChange({
      movements: movements.map((movement, movementIndex) =>
        movementIndex === index ? { ...movement, ...patch } : movement,
      ),
    });

  const removePlace = (index) => {
    const place = places[index];
    const uses = placeUsage.get(place.id) ?? [];
    if (uses.length > 0) return;
    const removedMovements = movements.filter(
      (movement) => movement.from === place.id || movement.to === place.id,
    ).length;
    onChange({
      places: places.filter((_, placeIndex) => placeIndex !== index),
      movements: movements.filter(
        (movement) => movement.from !== place.id && movement.to !== place.id,
      ),
      // A marker for a room that is going leaves a coordinate pointing at
      // nothing, which the server refuses by name. It goes with the room.
      map: { ...map, markers: markers.filter((marker) => marker.placeId !== place.id) },
    });
    const removedMarker = markers.some((marker) => marker.placeId === place.id);
    const alsoGoing = [
      removedMovements > 0
        ? `${removedMovements} unsaved route${removedMovements === 1 ? '' : 's'}`
        : null,
      removedMarker ? 'its map marker' : null,
    ].filter(Boolean);
    setNotice(
      alsoGoing.length > 0
        ? `${place.name || place.id} and ${alsoGoing.join(' and ')} will be removed when you save.`
        : `${place.name || place.id} will be removed when you save.`,
    );
    afterRender(() =>
      (placeRemoveRefs.current[index]
        || placeRemoveRefs.current[index - 1]
        || addPlaceRef.current)?.focus(),
    );
  };

  const removeMovement = (index) => {
    onChange({ movements: movements.filter((_, movementIndex) => movementIndex !== index) });
    setNotice('The route will be removed when you save.');
    afterRender(() =>
      (movementRemoveRefs.current[index]
        || movementRemoveRefs.current[index - 1]
        || addMovementRef.current)?.focus(),
    );
  };

  const changeMap = (patch) => onChange({ map: { ...map, ...patch } });
  const changeMarker = (index, patch) =>
    changeMap({
      markers: markers.map((marker, markerIndex) =>
        markerIndex === index ? { ...marker, ...patch } : marker,
      ),
    });

  const removeMarker = (index) => {
    changeMap({ markers: markers.filter((_, markerIndex) => markerIndex !== index) });
    setNotice('The marker will be removed when you save.');
    afterRender(() =>
      (markerRemoveRefs.current[index]
        || markerRemoveRefs.current[index - 1]
        || addMarkerRef.current)?.focus(),
    );
  };

  return (
    <>
      {notice ? <p role="status" className="text-caption text-admin-ink-secondary">{notice}</p> : null}
      <Panel
        title="Places"
        description="Stable room references for sessions and transfer routes. Names and floors can change without changing an id."
        actions={
          <button
            ref={addPlaceRef}
            type="button"
            className={secondaryButtonClass}
            onClick={() => onChange({ places: [...places, blankPlace()] })}
          >
            Add place
          </button>
        }
      >
        {places.length === 0 ? (
          <p className="text-caption text-admin-ink-secondary">No places configured yet.</p>
        ) : (
          <ol className="flex flex-col">
            {places.map((place, index) => {
              const uses = placeUsage.get(place.id) ?? [];
              return (
                <li
                  key={`${place.id}-${index}`}
                  className="mt-sm border-admin-rule-hairline border-t-admin-hairline pt-sm first:mt-0 first:border-t-0 first:pt-0"
                >
                  <div className="grid gap-sm sm:grid-cols-3">
                    <TextField
                      label={`Place ${index + 1} name`}
                      value={place.name}
                      onChange={(value) => {
                        const patch = { name: value };
                        if (!place.persisted && !place.id) patch.id = placeIdFromName(value);
                        changePlace(index, patch);
                      }}
                      error={errorFor(`venue.places[${index}].name`)}
                    />
                    <TextField
                      label={`Place ${index + 1} id`}
                      value={place.id}
                      onChange={(value) => changePlace(index, { id: value })}
                      error={errorFor(`venue.places[${index}].id`) ?? errorFor('venue.places')}
                      hint="Lowercase letters, digits, and single hyphens. Keep a saved id stable."
                      className="font-admin-data"
                    />
                    <TextField
                      label={`Place ${index + 1} floor`}
                      value={place.floor}
                      onChange={(value) => changePlace(index, { floor: value })}
                      error={errorFor(`venue.places[${index}].floor`)}
                    />
                  </div>
                  {uses.length > 0 ? (
                    <p className="mt-xs text-caption text-admin-state-caution">
                      Used by {uses.slice(0, 4).join(', ')}
                      {uses.length > 4 ? ` and ${uses.length - 4} more` : ''}. Move those sessions before removing this place.
                    </p>
                  ) : null}
                  <button
                    ref={(node) => { placeRemoveRefs.current[index] = node; }}
                    type="button"
                    className={`${dangerButtonClass} mt-sm`}
                    disabled={uses.length > 0}
                    onClick={() => removePlace(index)}
                  >
                    Remove {place.name || `place ${index + 1}`}
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </Panel>

      <Panel
        title="Movements"
        description="One recorded, one-way route between two places. Zero minutes means across the corridor."
        actions={
          <button
            ref={addMovementRef}
            type="button"
            className={secondaryButtonClass}
            onClick={() => onChange({ movements: [...movements, blankMovement()] })}
          >
            Add movement
          </button>
        }
      >
        {movements.length === 0 ? (
          <p className="text-caption text-admin-ink-secondary">No movements configured yet.</p>
        ) : (
          <ol className="flex flex-col">
            {movements.map((movement, index) => (
              <li
                key={`${movement.from}-${movement.to}-${index}`}
                className="mt-sm border-admin-rule-hairline border-t-admin-hairline pt-sm first:mt-0 first:border-t-0 first:pt-0"
              >
                <div className="grid gap-sm sm:grid-cols-2">
                  <SelectField
                    label={`Movement ${index + 1} from`}
                    value={movement.from}
                    onChange={(value) => changeMovement(index, { from: value })}
                    options={options}
                    error={errorFor(`venue.movements[${index}].from`)}
                  />
                  <SelectField
                    label={`Movement ${index + 1} to`}
                    value={movement.to}
                    onChange={(value) => changeMovement(index, { to: value })}
                    options={options}
                    error={errorFor(`venue.movements[${index}].to`)}
                  />
                  <TextField
                    label={`Movement ${index + 1} walking minutes`}
                    type="number"
                    min="0"
                    max="120"
                    step="1"
                    value={movement.walkingMinutes}
                    onChange={(value) => changeMovement(index, { walkingMinutes: value })}
                    error={errorFor(`venue.movements[${index}].walkingMinutes`)}
                    hint="A whole number from 0 to 120."
                  />
                  <TextField
                    label={`Movement ${index + 1} accessible route`}
                    value={movement.accessibleRoute}
                    onChange={(value) => changeMovement(index, { accessibleRoute: value })}
                    error={errorFor(`venue.movements[${index}].accessibleRoute`)}
                    hint="Optional step-free route guidance."
                  />
                </div>
                <button
                  ref={(node) => { movementRemoveRefs.current[index] = node; }}
                  type="button"
                  className={`${dangerButtonClass} mt-sm`}
                  onClick={() => removeMovement(index)}
                >
                  Remove movement {index + 1}
                </button>
              </li>
            ))}
          </ol>
        )}
      </Panel>

      {/* THE MAP. An uploaded picture of the building, plus where the places
          above sit on it. The room list the public page prints beside the
          picture is the places list, not this one — a marker only says where
          a room already named sits, so a room is never named twice and a
          venue with no markers still publishes a readable room list. */}
      <Panel
        title="Venue map"
        description="An uploaded map of the building. The public travel page prints the room list beside it, so a reader who cannot see the image still gets every room name."
        actions={
          map.image ? (
            <button
              ref={addMarkerRef}
              type="button"
              className={secondaryButtonClass}
              onClick={() => changeMap({ markers: [...markers, blankMarker()] })}
            >
              Add marker
            </button>
          ) : null
        }
      >
        <div className="flex flex-col gap-sm">
          <ImagePicker
            label="Map image"
            value={map.image}
            // CLEARING THE PICTURE CLEARS WHAT BELONGED TO IT. The alt text
            // describes THAT plan and the markers are coordinates on it, so
            // leaving either behind in the form means the next picture
            // chosen here publishes an unrelated plan under the old
            // sentence, with the old dots over rooms it does not show. The
            // fields stop rendering either way; this is what makes them
            // stop existing.
            onChange={(value) =>
              changeMap(value ? { image: value } : { image: '', alt: '', markers: [] })
            }
            hint="Choose or upload the map. Clearing this removes the map from the travel page."
            error={errorFor('venue.map.image')}
          />
          {map.image ? (
            <TextField
              label="Map alt text"
              value={map.alt}
              onChange={(value) => changeMap({ alt: value })}
              error={errorFor('venue.map.alt')}
              hint="What the map shows, in a sentence. Required, and the map does not publish without it."
            />
          ) : null}
        </div>

        {map.image ? (
          <div className="mt-sm">
            {markers.length === 0 ? (
              <p className="text-caption text-admin-ink-secondary">
                No rooms marked yet. Every place is listed beside the map either way; a marker
                also puts a numbered dot on the image.
              </p>
            ) : (
              <ol className="flex flex-col">
                {markers.map((marker, index) => (
                  <li
                    key={`${marker.placeId}-${index}`}
                    className="mt-sm border-admin-rule-hairline border-t-admin-hairline pt-sm first:mt-0 first:border-t-0 first:pt-0"
                  >
                    <div className="grid gap-sm sm:grid-cols-3">
                      <SelectField
                        label={`Marker ${index + 1} room`}
                        value={marker.placeId}
                        onChange={(value) => changeMarker(index, { placeId: value })}
                        options={options}
                        error={errorFor(`venue.map.markers[${index}].placeId`)}
                      />
                      {/* Typed, not dragged: a number is the coordinate a
                          keyboard can reach, and it is the stored value. */}
                      <TextField
                        label={`Marker ${index + 1} across (%)`}
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        value={marker.x}
                        onChange={(value) => changeMarker(index, { x: value })}
                        error={errorFor(`venue.map.markers[${index}].x`)}
                        hint="0 is the left edge, 100 the right."
                      />
                      <TextField
                        label={`Marker ${index + 1} down (%)`}
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        value={marker.y}
                        onChange={(value) => changeMarker(index, { y: value })}
                        error={errorFor(`venue.map.markers[${index}].y`)}
                        hint="0 is the top edge, 100 the bottom."
                      />
                    </div>
                    <button
                      ref={(node) => { markerRemoveRefs.current[index] = node; }}
                      type="button"
                      className={`${dangerButtonClass} mt-sm`}
                      onClick={() => removeMarker(index)}
                    >
                      Remove marker {index + 1}
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </div>
        ) : null}
      </Panel>
    </>
  );
}
