import { describe, expect, it } from 'vitest';
import {
  normalizeVenueReferences,
  placeIdFromName,
  validateVenueReferences,
  venueReferencesPayload,
} from './VenueReferenceEditor.jsx';

describe('venue reference helpers', () => {
  it('generates a valid starting id and keeps stored ids marked as persisted', () => {
    expect(placeIdFromName('Main Hall — East')).toBe('main-hall-east');
    expect(
      normalizeVenueReferences({ places: [{ id: 'main-hall', name: 'Renamed hall' }] }).places[0],
    ).toMatchObject({ id: 'main-hall', persisted: true });
  });

  it('matches the shared place and movement validation before save', () => {
    const venue = {
      places: [
        { id: 'Main Hall', name: '', floor: '' },
        { id: 'studio', name: 'Studio', floor: '' },
      ],
      movements: [
        { from: 'studio', to: 'studio', walkingMinutes: '121', accessibleRoute: '' },
      ],
    };
    const errors = validateVenueReferences(venue);
    expect(errors.get('venue.places[0].id')).toMatch(/lowercase/);
    expect(errors.get('venue.places[0].name')).toMatch(/place name/);
    expect(errors.get('venue.movements[0].to')).toMatch(/different/);
    expect(errors.get('venue.movements[0].walkingMinutes')).toMatch(/0 to 120/);
  });

  it('rejects duplicate routes and accepts the reverse route', () => {
    const errors = validateVenueReferences({
      places: [
        { id: 'main-hall', name: 'Main hall' },
        { id: 'studio', name: 'Studio' },
      ],
      movements: [
        { from: 'main-hall', to: 'studio', walkingMinutes: '2' },
        { from: 'studio', to: 'main-hall', walkingMinutes: '3' },
        { from: 'main-hall', to: 'studio', walkingMinutes: '4' },
      ],
    });
    expect(errors.has('venue.movements[1].to')).toBe(false);
    expect(errors.get('venue.movements[2].to')).toMatch(/already recorded/);
  });

  it('sends zero walking minutes and null optional strings', () => {
    expect(
      venueReferencesPayload({
        places: [{ id: 'main-hall', name: 'Main hall', floor: '' }],
        movements: [
          { from: 'main-hall', to: 'studio', walkingMinutes: '0', accessibleRoute: '' },
        ],
      }),
    ).toEqual({
      places: [{ id: 'main-hall', name: 'Main hall', floor: null }],
      movements: [
        { from: 'main-hall', to: 'studio', walkingMinutes: 0, accessibleRoute: null },
      ],
    });
  });
});
