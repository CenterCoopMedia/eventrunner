// The book against the smallest configuration validateEventConfig accepts.
//
// Every specimen draws its content from the snapshot, and the snapshot is
// whatever a client's config/event holds. Several optional fields — the
// tracks, the venue's places, the days themselves — can be absent or empty
// in a document that is perfectly valid, including every deployment made
// before those fields existed. A specimen that read one of them at module
// level threw during import, and because the book is one lazy chunk, one
// throw took the whole route down rather than one figure.
//
// So this file renders the book with no tracks, no venue places and no
// days at all, and asserts that every section is still on the page.
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { MINIMAL_EVENT, FEATURES } = vi.hoisted(() => ({
  MINIMAL_EVENT: Object.freeze({
    name: 'Harborlight Summit',
    shortName: 'HARBOR',
    tagline: 'One room, one day, no lines.',
    timezone: 'America/New_York',
    // Valid and empty: an event that has not published its days yet.
    days: [],
    // `tracks` is absent rather than empty, which is what a document
    // written before that field existed holds. The venue is here with no
    // places and no movements, because that is the state every write path
    // produces for a venue nobody has walked yet.
    venue: {
      name: 'Harborlight Hall',
      city: 'Portsmouth',
      region: 'NH',
    },
  }),
  FEATURES: Object.freeze({
    schedule: true, speakers: true, sponsors: true, attendeeDirectory: true, updates: true,
  }),
}));

vi.mock('@generated/eventConfig.js', () => ({
  eventConfig: MINIMAL_EVENT,
  features: FEATURES,
  theme: { preset: 'newsroom', mode: 'light' },
  default: MINIMAL_EVENT,
}));

vi.mock('../../contexts/EventConfigContext.jsx', () => ({
  useEventConfig: () => ({
    eventConfig: MINIMAL_EVENT,
    features: FEATURES,
    theme: { preset: 'newsroom', mode: 'light' },
  }),
  useFeatures: () => FEATURES,
}));
vi.mock('../../contexts/ContentContext.jsx', () => ({
  useContent: () => ({
    speakers: [],
    organizationsData: [],
    getPage: () => null,
    getSectionBlocks: () => [],
  }),
}));
vi.mock('../../contexts/ToastContext.jsx', async (importOriginal) => ({
  ...(await importOriginal()),
  useToast: () => ({ showToast: vi.fn(), dismiss: vi.fn() }),
}));

import Specimen from './Specimen.jsx';
import { SPECIMEN_SECTIONS } from './sections/index.js';

describe('the specimen book on a minimal configuration', () => {
  it('draws every section it lists', () => {
    render(
      <MemoryRouter>
        <Specimen />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Specimen book' })).toBeInTheDocument();
    for (const section of SPECIMEN_SECTIONS) {
      expect(screen.getByRole('link', { name: section.label })).toBeInTheDocument();
      expect(document.getElementById(section.id), `${section.id} is missing`).not.toBeNull();
    }
  });

  it('still names a file in every caption', () => {
    const { container } = render(
      <MemoryRouter>
        <Specimen />
      </MemoryRouter>,
    );
    const figures = [...container.querySelectorAll('figure[data-specimen-file]')];
    expect(figures.length).toBeGreaterThan(20);
    for (const figure of figures) {
      const caption = figure.querySelector(':scope > figcaption');
      expect(caption, `${figure.getAttribute('data-specimen-file')} has no caption`).not.toBeNull();
    }
  });
});
