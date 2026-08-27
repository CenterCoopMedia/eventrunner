// Updates list — /updates (issue #27 follow-up: OG cards must link
// somewhere real). No Firebase, no network; context providers only, same
// pattern as Sponsors.test.jsx / SessionDetail.test.jsx.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import EventConfigContext from '../contexts/EventConfigContext.jsx';
import ContentContext from '../contexts/ContentContext.jsx';
import Updates from './Updates.jsx';

const PINNED = {
  id: 'update-pinned',
  title: '[Fixture] Parking has moved',
  body: 'Please use lot B starting Thursday. '.repeat(10),
  pinned: true,
  publishAt: new Date('2026-10-01T00:00:00Z'),
  visible: true,
};
const NEWER = {
  id: 'update-newer',
  title: '[Fixture] Wifi password changed',
  body: 'The new password is on your badge.',
  pinned: false,
  publishAt: new Date('2026-10-10T00:00:00Z'),
  visible: true,
};
const OLDER = {
  id: 'update-older',
  title: '[Fixture] Welcome',
  body: 'Welcome to the event.',
  pinned: false,
  publishAt: new Date('2026-09-01T00:00:00Z'),
  visible: true,
};
const HIDDEN = {
  id: 'update-hidden',
  title: '[Fixture] Draft, never published',
  body: 'should never render',
  pinned: false,
  publishAt: null,
  visible: false,
};

function renderUpdates({ features = { updates: true }, updates = [] } = {}) {
  return render(
    <MemoryRouter>
      <EventConfigContext.Provider
        value={{ eventConfig: {}, features, theme: {}, badges: null, source: 'snapshot' }}
      >
        <ContentContext.Provider value={{ updates, getBlock: () => null }}>
          <Updates />
        </ContentContext.Provider>
      </EventConfigContext.Provider>
    </MemoryRouter>,
  );
}

describe('Updates', () => {
  it('is gated behind config/features.updates', () => {
    renderUpdates({ features: { updates: false }, updates: [PINNED] });
    expect(
      screen.getByRole('heading', { name: 'This event doesn’t have public updates' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(PINNED.title)).toBeNull();
  });

  it('renders pinned posts first, then newest-first, and links each to /updates/:id', () => {
    renderUpdates({ updates: [OLDER, PINNED, NEWER] });
    const links = screen.getAllByRole('link').filter((a) => a.getAttribute('href')?.startsWith('/updates/'));
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/updates/update-pinned',
      '/updates/update-newer',
      '/updates/update-older',
    ]);
  });

  it('never renders a hidden (unpublished draft) update, even if it slips into the overlay', () => {
    renderUpdates({ updates: [NEWER, HIDDEN] });
    expect(screen.queryByText(HIDDEN.title)).toBeNull();
    expect(screen.getByText(NEWER.title)).toBeInTheDocument();
  });

  it('shows an empty state when there are no published updates yet', () => {
    renderUpdates({ updates: [] });
    expect(screen.getByRole('heading', { name: 'No updates yet' })).toBeInTheDocument();
  });

  it('labels a post with no resolvable publish date rather than leaving the date column blank', () => {
    // The list is a dated column (design brief §2.1), so every row states
    // its date. A post whose publishAt never resolved still gets a word —
    // an empty cell would read as a rendering fault, not as missing data.
    renderUpdates({ updates: [{ ...NEWER, id: 'update-undated', publishAt: null }] });
    expect(screen.getByText('Undated')).toBeInTheDocument();
    expect(screen.getByText(NEWER.title)).toBeInTheDocument();
  });
});
