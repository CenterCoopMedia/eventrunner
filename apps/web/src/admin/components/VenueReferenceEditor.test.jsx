import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

// Credential-free (spec §8.1): the image picker resolves a thumbnail through
// Storage, and nothing here needs a bucket.
vi.mock('../../firebase.js', () => ({
  app: {}, auth: {}, db: {}, storage: {},
  storageBucketName: 'demo.appspot.com',
  storageDownloadOrigin: 'https://firebasestorage.example',
  appCheckEnabled: false,
  appCheckHeaders: async () => ({}),
}));

import VenueReferenceEditor, {
  normalizeVenueReferences,
  placeIdFromName,
  validateVenueMap,
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

  it('rejects blank walking minutes before payload conversion', () => {
    const errors = validateVenueReferences({
      places: [
        { id: 'main-hall', name: 'Main hall' },
        { id: 'studio', name: 'Studio' },
      ],
      movements: [
        { from: 'main-hall', to: 'studio', walkingMinutes: '', accessibleRoute: '' },
      ],
    });
    expect(errors.get('venue.movements[0].walkingMinutes')).toMatch(/whole number/);
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
      // No image chosen is no map, and null is the server's "clear this".
      map: null,
    });
  });
});

describe('venue map helpers', () => {
  const PLACES = [
    { id: 'main-hall', name: 'Main hall' },
    { id: 'studio', name: 'Studio' },
  ];

  it('reads a stored map into form strings and sends it back as numbers', () => {
    const form = normalizeVenueReferences({
      places: PLACES,
      map: {
        image: 'cms-images/a/plan.png',
        alt: 'A floor plan.',
        markers: [{ placeId: 'studio', x: 12.5, y: 0 }],
      },
    });
    expect(form.map).toEqual({
      image: 'cms-images/a/plan.png',
      alt: 'A floor plan.',
      markers: [{ placeId: 'studio', x: '12.5', y: '0' }],
    });
    expect(venueReferencesPayload(form).map).toEqual({
      image: 'cms-images/a/plan.png',
      alt: 'A floor plan.',
      markers: [{ placeId: 'studio', x: 12.5, y: 0 }],
    });
  });

  it('sends a blank coordinate as null rather than calling it zero', () => {
    // Number('') is 0, and 0 is the left edge of the picture — a real answer
    // an operator can mean. A blank must never become one.
    const payload = venueReferencesPayload({
      places: PLACES,
      map: {
        image: 'cms-images/a/plan.png',
        alt: 'A floor plan.',
        markers: [{ placeId: 'studio', x: '', y: '  ' }],
      },
    });
    expect(payload.map.markers[0]).toEqual({ placeId: 'studio', x: null, y: null });
  });

  it('keeps the map out of the errors that disable the save button', () => {
    // Issue #219: the disabled-while-invalid set does not grow. A map with
    // nothing but problems still leaves validateVenueReferences empty.
    const venue = {
      places: PLACES,
      movements: [],
      map: { image: 'https://example.org/plan.png', alt: '', markers: [{ placeId: '', x: '', y: '' }] },
    };
    expect(validateVenueReferences(venue).size).toBe(0);
    expect(validateVenueMap(venue).size).toBeGreaterThan(0);
  });

  it('asks for alt text as soon as an image is chosen', () => {
    const errors = validateVenueMap({
      places: PLACES,
      map: { image: 'cms-images/a/plan.png', alt: '  ', markers: [] },
    });
    expect(errors.get('venue.map.alt')).toMatch(/alt text/i);
    // No image is no map, so there is nothing to describe and no error.
    expect(
      validateVenueMap({ places: PLACES, map: { image: '', alt: '', markers: [] } }).size,
    ).toBe(0);
  });

  it('refuses a URL or a path outside the media library', () => {
    for (const image of ['https://example.org/plan.png', 'profile-photos/abc/photo.png']) {
      const errors = validateVenueMap({
        places: PLACES,
        map: { image, alt: 'A floor plan.', markers: [] },
      });
      expect(errors.get('venue.map.image')).toMatch(/media library/);
    }
  });

  it('refuses a marker off the places list, out of range, blank, or twice for one room', () => {
    const errors = validateVenueMap({
      places: PLACES,
      map: {
        image: 'cms-images/a/plan.png',
        alt: 'A floor plan.',
        markers: [
          { placeId: '', x: '10', y: '10' },
          { placeId: 'studio', x: '101', y: '' },
          { placeId: 'studio', x: '10', y: '10' },
        ],
      },
    });
    expect(errors.get('venue.map.markers[0].placeId')).toMatch(/defined place/);
    expect(errors.get('venue.map.markers[1].x')).toMatch(/0 to 100/);
    expect(errors.get('venue.map.markers[1].y')).toMatch(/0 to 100/);
    expect(errors.get('venue.map.markers[2].placeId')).toMatch(/already marked/);
  });
});

/** The editor is controlled, so a test that adds a row has to hold the state. */
function EditorHarness({ venue: initial }) {
  const [venue, setVenue] = useState(initial);
  return (
    <VenueReferenceEditor
      venue={venue}
      onChange={(patch) => setVenue((current) => ({ ...current, ...patch }))}
      errorFor={() => undefined}
      placeUsage={new Map()}
    />
  );
}

describe('VenueReferenceEditor map panel', () => {
  const venue = {
    places: [
      { id: 'main-hall', name: 'Main hall', floor: '', persisted: true },
      { id: 'studio', name: 'Studio', floor: '', persisted: true },
    ],
    movements: [],
    map: { image: 'cms-images/a/plan.png', alt: 'A floor plan.', markers: [] },
  };

  it('adds and removes a marker, and hands focus back afterwards', async () => {
    render(<EditorHarness venue={venue} />);

    // Both controls are real buttons in the form's own tab order, which is
    // the whole keyboard path: no drag, no click-on-image step.
    const add = screen.getByRole('button', { name: 'Add marker' });
    expect(add.tagName).toBe('BUTTON');
    fireEvent.click(add);

    // The new row asks which room and where, in plain typed fields.
    const place = screen.getByLabelText('Marker 1 room');
    fireEvent.change(place, { target: { value: 'studio' } });
    fireEvent.change(screen.getByLabelText('Marker 1 across (%)'), { target: { value: '40' } });
    fireEvent.change(screen.getByLabelText('Marker 1 down (%)'), { target: { value: '60' } });
    expect(screen.getByLabelText('Marker 1 across (%)')).toHaveValue(40);
    expect(screen.getByLabelText('Marker 1 room')).toHaveValue('studio');

    const remove = screen.getByRole('button', { name: 'Remove marker 1' });
    expect(remove.tagName).toBe('BUTTON');
    fireEvent.click(remove);

    expect(screen.queryByLabelText('Marker 1 room')).not.toBeInTheDocument();
    // Focus lands on a real control rather than on the body, and the removal
    // is announced rather than left to be noticed.
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add marker' })),
    );
    expect(
      within(screen.getByRole('status')).getByText(/removed when you save/),
    ).toBeInTheDocument();
  });

  it('takes a room’s marker with it when the room is removed', () => {
    render(
      <EditorHarness
        venue={{
          ...venue,
          map: { ...venue.map, markers: [{ placeId: 'studio', x: '40', y: '60' }] },
        }}
      />,
    );
    expect(screen.getByLabelText('Marker 1 room')).toHaveValue('studio');

    fireEvent.click(screen.getByRole('button', { name: 'Remove Studio' }));

    // A marker naming a place the venue no longer defines is refused by the
    // server, so the editor cannot leave one behind for the save to hit.
    expect(screen.queryByLabelText('Marker 1 room')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('its map marker');
  });

  it('takes the alt text and the markers with the picture when it is cleared', () => {
    render(
      <EditorHarness
        venue={{
          ...venue,
          map: { ...venue.map, markers: [{ placeId: 'studio', x: '40', y: '60' }] },
        }}
      />,
    );
    expect(screen.getByLabelText('Map alt text')).toHaveValue('A floor plan.');
    expect(screen.getByLabelText('Marker 1 room')).toHaveValue('studio');

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    // Both fields are gone from the panel, which is what clearing the image
    // has always looked like \u2014 the point is that they are gone from the FORM
    // STATE too. They used to sit there unrendered and come back the moment
    // another picture was chosen: an unrelated plan, described by the old
    // sentence, with the old dots over rooms it does not show.
    expect(screen.queryByLabelText('Map alt text')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Marker 1 room')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Map image'), {
      target: { value: 'cms-images/b/other-plan.png' },
    });
    expect(screen.getByLabelText('Map alt text')).toHaveValue('');
    expect(screen.queryByLabelText('Marker 1 room')).not.toBeInTheDocument();
  });

  it('offers no marker rows until an image is chosen', () => {
    render(<EditorHarness venue={{ ...venue, map: { image: '', alt: '', markers: [] } }} />);
    expect(screen.queryByRole('button', { name: 'Add marker' })).not.toBeInTheDocument();
  });
});
