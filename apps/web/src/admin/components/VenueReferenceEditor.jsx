import { useMemo, useRef, useState } from 'react';
import {
  Panel,
  SelectField,
  TextField,
  dangerButtonClass,
  secondaryButtonClass,
} from './formControls.jsx';

const PLACE_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EMPTY_REFERENCES = Object.freeze([]);

export const blankPlace = () => ({ id: '', name: '', floor: '', persisted: false });
export const blankMovement = () => ({
  from: '',
  to: '',
  walkingMinutes: '0',
  accessibleRoute: '',
});

export function placeIdFromName(name) {
  return String(name ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
}

export function normalizeVenueReferences(venue) {
  return {
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

export function venueReferencesPayload(venue) {
  return {
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

function afterRender(callback) {
  setTimeout(callback, 0);
}

export default function VenueReferenceEditor({ venue, onChange, errorFor, placeUsage }) {
  const [notice, setNotice] = useState('');
  const addPlaceRef = useRef(null);
  const addMovementRef = useRef(null);
  const placeRemoveRefs = useRef([]);
  const movementRemoveRefs = useRef([]);
  const places = venue.places ?? EMPTY_REFERENCES;
  const movements = venue.movements ?? EMPTY_REFERENCES;
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
    });
    setNotice(
      removedMovements > 0
        ? `${place.name || place.id} and ${removedMovements} unsaved route${removedMovements === 1 ? '' : 's'} will be removed when you save.`
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
    </>
  );
}
