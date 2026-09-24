// Updates list — /updates (issue #27 follow-up: OG cards must link
// somewhere real). No Firebase, no network; context providers only, same
// pattern as Sponsors.test.jsx / SessionDetail.test.jsx.
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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

function renderUpdates({ features = { updates: true }, updates = [], eventConfig = {} } = {}) {
  return render(
    <MemoryRouter>
      <EventConfigContext.Provider
        value={{ eventConfig, features, theme: {}, badges: null, source: 'snapshot' }}
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

  it('dates the feed and its month heads on the event’s clock, not the reader’s', () => {
    // 02:30 UTC on 1 November is the evening of 31 October at a west-coast
    // venue: the post belongs under October, dated the 31st (design record
    // §3.1, the dateline carries the event's clock). The east-of-UTC render
    // shows the same instant land in November, so the assertion holds in
    // whatever zone the test runner sits.
    const post = { id: 'u-late', title: 'Late post', publishAt: '2026-11-01T02:30:00Z' };
    const west = renderUpdates({ updates: [post], eventConfig: { timezone: 'America/Los_Angeles' } });
    expect(screen.getByRole('heading', { level: 2, name: 'October 2026' })).toBeInTheDocument();
    expect(screen.getByText('October 31, 2026').tagName).toBe('TIME');
    west.unmount();
    renderUpdates({ updates: [post], eventConfig: { timezone: 'Pacific/Auckland' } });
    expect(screen.getByRole('heading', { level: 2, name: 'November 2026' })).toBeInTheDocument();
    expect(screen.getByText('November 1, 2026').tagName).toBe('TIME');
  });

  it('shows a published update dated in the future: the date is display scheduling only (issue 190)', () => {
    // publishAt never gates the publish action, and it never hides a
    // published post either. A post dated a year ahead is on the page, at
    // the top of the dated runs, under its own month.
    const future = { id: 'u-future', title: 'Next year’s dates', publishAt: '2027-10-15T16:00:00Z', visible: true };
    renderUpdates({ updates: [NEWER, future], eventConfig: { timezone: 'America/New_York' } });
    const links = screen.getAllByRole('link').filter((a) => a.getAttribute('href')?.startsWith('/updates/'));
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/updates/u-future', '/updates/update-newer']);
    expect(screen.getByRole('heading', { level: 2, name: 'October 2027' })).toBeInTheDocument();
    expect(screen.getByText('October 15, 2027').tagName).toBe('TIME');
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

  // THE CATEGORY AND THE LEAD (issue #191).
  it('sets a category as a plain tag in the title row, before Pinned', () => {
    const { container } = renderUpdates({ updates: [{ ...PINNED, category: ' Travel ' }] });
    const row = container.querySelector('.update-feed__entry h3').parentElement;
    const tags = [...row.querySelectorAll('span')].map((tag) => tag.textContent);
    expect(tags).toEqual(['Travel', 'Pinned']);
    // The ruled rectangle, never a pill; the word stays in natural case.
    expect(within(row).getByText('Travel').className).toContain('rounded-brand');
    expect(within(row).getByText('Travel').className).not.toContain('rounded-full');
  });

  it('draws no tag for a stored category that breaks the rule, and the page still renders', () => {
    const bad = [
      { ...NEWER, id: 'u-long', title: 'Long', category: 'x'.repeat(25) },
      { ...NEWER, id: 'u-num', title: 'Number', category: 7 },
      { ...NEWER, id: 'u-lines', title: 'Lines', category: 'Two\nlines' },
      { ...NEWER, id: 'u-blank', title: 'Blank', category: '   ' },
    ];
    const { container } = renderUpdates({ updates: bad });
    expect(screen.getAllByRole('link').filter((a) => a.getAttribute('href')?.startsWith('/updates/'))).toHaveLength(4);
    for (const entry of container.querySelectorAll('.update-feed__entry')) {
      expect(entry.querySelector('h3').parentElement.querySelectorAll('span')).toHaveLength(0);
    }
  });

  it('leads the list with the featured update, under its own Featured head, once', () => {
    const featured = { ...OLDER, id: 'update-featured', title: '[Fixture] Featured', featured: true, category: 'Workshops' };
    const { container } = renderUpdates({ updates: [OLDER, NEWER, PINNED, featured] });
    const heads = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent.trim());
    expect(heads[0]).toBe('Featured');
    expect(heads[1]).toBe('Pinned');
    const links = screen.getAllByRole('link').filter((a) => a.getAttribute('href')?.startsWith('/updates/'));
    // Ahead of a pinned post and a newer one, and listed once.
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/updates/update-featured',
      '/updates/update-pinned',
      '/updates/update-newer',
      '/updates/update-older',
    ]);
    const lead = container.querySelector('section .update-feed__entry');
    expect(within(lead).getByRole('heading', { level: 3 }).className).toContain('text-h2');
    expect(within(lead).getByText('Workshops')).toBeInTheDocument();
    // The opening is a standfirst, and it is the lead's own text.
    expect(lead.querySelector('.standfirst')).toHaveTextContent(OLDER.body);
  });

  it('keeps a second featured update in its own run', () => {
    const first = { ...NEWER, id: 'f-newer', title: 'First featured', featured: true };
    const second = { ...OLDER, id: 'f-older', title: 'Second featured', featured: true };
    renderUpdates({ updates: [second, first] });
    const sections = screen.getAllByRole('region');
    expect(within(sections[0]).getByRole('heading', { level: 2 })).toHaveTextContent('Featured');
    expect(within(sections[0]).getByRole('link', { name: 'First featured' })).toBeInTheDocument();
    expect(within(sections[0]).queryByRole('link', { name: 'Second featured' })).toBeNull();
    expect(screen.getAllByRole('link', { name: 'Second featured' })).toHaveLength(1);
  });

  it('dates the lead with a dateline on the event’s clock', () => {
    const featured = { id: 'u-lead', title: 'Late lead', body: 'Body.', publishAt: '2026-10-01T02:30:00Z', featured: true };
    const { container } = renderUpdates({ updates: [featured], eventConfig: { timezone: 'America/Los_Angeles' } });
    const dateline = container.querySelector('.update-feed__entry .byline time');
    expect(dateline).toHaveTextContent('September 30, 2026');
    expect(dateline).toHaveAttribute('datetime', '2026-10-01T02:30:00.000Z');
  });

  it('says Undated in the lead’s byline when it has no date', () => {
    const featured = { id: 'u-lead', title: 'Undated lead', body: 'Body.', publishAt: null, featured: true };
    const { container } = renderUpdates({ updates: [featured] });
    expect(container.querySelector('.update-feed__entry .byline')).toHaveTextContent('Undated');
  });
});

