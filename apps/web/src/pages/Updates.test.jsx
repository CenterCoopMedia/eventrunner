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
        <ContentContext.Provider
          value={{ updates, getBlock: () => null, getPage: () => null, getSectionBlocks: () => [] }}
        >
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
    // The feed is dated (design brief §2.1), so every entry states its
    // date. A post whose publishAt never resolved still gets a word — an
    // empty cell would read as a rendering fault, not as missing data —
    // and it runs under its own "Undated" head rather than being filed in a
    // month it never had.
    renderUpdates({ updates: [{ ...NEWER, id: 'update-undated', publishAt: null }] });
    expect(screen.getByRole('heading', { level: 2, name: 'Undated' })).toBeInTheDocument();
    expect(screen.getAllByText('Undated').length).toBeGreaterThan(0);
    expect(screen.getByText(NEWER.title)).toBeInTheDocument();
  });

  // THE FEED'S RUNS (this review): pinned first because pinned is not a
  // date, then one head per month, then the undated.
  it('heads the feed with Pinned, then months, newest first', () => {
    renderUpdates({
      updates: [
        { id: 'u-pin', title: 'Held to the top', pinned: true, publishAt: '2026-08-02T09:00:00Z' },
        { id: 'u-oct', title: 'October post', publishAt: '2026-10-03T09:00:00Z' },
        { id: 'u-sep', title: 'September post', publishAt: '2026-09-04T09:00:00Z' },
      ],
    });
    const heads = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent.trim());
    // Pinned first — an August post held to the top must not drag August's
    // month head above October's.
    expect(heads[0]).toBe('Pinned');
    expect(heads[1]).toBe('October 2026');
    expect(heads[2]).toBe('September 2026');
  });

  it('puts the title before the date, so the date never stacks above the heading', () => {
    // The eyebrow ban is absolute and holds at every size (design brief
    // §2.4). An entry on the spine is one column at every width, so the
    // title has to come first in the source. SessionCard.jsx carries the
    // same rule for the schedule.
    const { container } = renderUpdates({ updates: [NEWER] });
    const heading = container.querySelector('.update-feed__entry h3');
    const time = container.querySelector('.update-feed__entry time');
    expect(heading.compareDocumentPosition(time) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
