// The home page's opening section: the page's own heading, the tagline
// guard, and the one optional lead image.
//
// The tagline case is a regression test. Home.jsx rendered
// eventConfig.tagline directly as JSX children, so a non-string live value
// (validation for tagline was missing at the write boundary) would make
// React throw and blank the whole homepage. The render must guard the type
// defensively, independent of the write-boundary fix in
// packages/shared/src/config/schema.cjs.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

let eventConfig;
let heroBlocks;
let theme;
// The key facts group (M7 issue 9) reads its own section's blocks and the
// page document's label for it, so the mock answers per section rather than
// handing every section the hero's blocks. Both default to empty, so every
// test above renders exactly the page it rendered before the group existed.
let infoBlocks;
let pageDoc;
// The sponsor strip (M7 issue 10) is a section of this page drawn through
// the page's own ordered section flow, so it reads the feature flags, the
// page document's section list, and the published organizations. Each
// defaults to the state that draws no strip.
let features;
let organizationsData;
let sectionBlocks;
vi.mock('../contexts/EventConfigContext.jsx', () => ({
  useEventConfig: () => ({ eventConfig, theme, features }),
}));
vi.mock('../contexts/ContentContext.jsx', () => ({
  useContent: () => ({
    organizationsData,
    getPage: () => pageDoc,
    getSectionBlocks: (section) => {
      if (section === 'hero') return heroBlocks;
      if (section === 'info') return infoBlocks;
      return sectionBlocks[section] ?? [];
    },
    getBlock: (section, field) =>
      section === 'hero' && field === 'title' ? { value: 'Fallback title' } : null,
  }),
}));

import Home from './Home.jsx';

const LEAD = {
  section: 'hero',
  field: 'lead',
  blockType: 'image',
  url: 'https://example.org/lead.jpg',
  alt: 'The main hall before doors open',
};

beforeEach(() => {
  heroBlocks = [];
  theme = undefined;
  infoBlocks = [];
  pageDoc = null;
  features = {};
  organizationsData = [];
  sectionBlocks = {};
});

describe('Home', () => {
  it('owns the page heading, and puts nothing above it', () => {
    // The shell's header carries the running site identity, so this page's
    // stored hero title is its own <h1> (design brief §2.1, §2.4).
    eventConfig = { name: 'Demo Event', tagline: 'A gathering', days: [] };
    render(<Home />);
    const heading = screen.getByRole('heading', { level: 1, name: 'Fallback title' });
    expect(heading.parentElement.firstElementChild).toBe(heading);
  });

  it('renders the tagline when it is a string', () => {
    eventConfig = { name: 'Demo Event', tagline: 'A gathering for demo people', days: [] };
    render(<Home />);
    expect(screen.getByText('A gathering for demo people')).toBeInTheDocument();
  });

  it('renders nothing for the tagline (instead of throwing) when it is not a string', () => {
    eventConfig = { name: 'Demo Event', tagline: { unexpected: 'object' }, days: [] };
    expect(() => render(<Home />)).not.toThrow();
    expect(screen.queryByText('[object Object]')).toBeNull();
  });

  it('renders nothing for the tagline when it is absent', () => {
    eventConfig = { name: 'Demo Event', days: [] };
    expect(() => render(<Home />)).not.toThrow();
  });

  it('does not print the event name twice under a masthead', () => {
    // The masthead has already set the name at display size. The page keeps
    // exactly one <h1>, and only its second printing goes.
    eventConfig = { name: 'Fallback title', days: [] };
    theme = { header: 'masthead' };
    render(<Home />);
    const heading = screen.getByRole('heading', { level: 1, name: 'Fallback title' });
    expect(heading.className).toBe('sr-only');
  });

  it('prints the page headline under a masthead when it is not the event name', () => {
    eventConfig = { name: 'Demo Event', days: [] };
    theme = { header: 'masthead' };
    render(<Home />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Fallback title' }).className,
    ).not.toContain('sr-only');
  });

  it('prints the page headline under every other header', () => {
    eventConfig = { name: 'Fallback title', days: [] };
    for (const header of ['standard', 'compact', 'minimal']) {
      theme = { header };
      const { unmount } = render(<Home />);
      expect(
        screen.getByRole('heading', { level: 1, name: 'Fallback title' }).className,
      ).not.toContain('sr-only');
      unmount();
    }
  });
});

describe('Home lead image', () => {
  beforeEach(() => {
    eventConfig = { name: 'Demo Event', days: [] };
  });

  it('opens with no image at all when the section stores none', () => {
    const { container } = render(<Home />);
    expect(container.querySelector('img')).toBeNull();
  });

  it('renders the stored image beside the opening copy, never behind it', () => {
    heroBlocks = [LEAD];
    const { container } = render(<Home />);
    const heading = screen.getByRole('heading', { level: 1 });
    const figure = container.querySelector('figure');
    expect(figure).not.toBeNull();
    // Copy and picture are siblings in the flow, so no text sits over the
    // image and no image sits behind the text.
    expect(figure.parentElement).toBe(heading.parentElement.parentElement);
    expect(container.querySelector('[style*="background-image"]')).toBeNull();
  });

  it('takes one lead image, not a gallery', () => {
    heroBlocks = [LEAD, { ...LEAD, field: 'second', url: 'https://example.org/other.jpg' }];
    const { container } = render(<Home />);
    expect(container.querySelectorAll('img')).toHaveLength(1);
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://example.org/lead.jpg');
  });

  it('skips a stored image with no alt text rather than rendering it unlabelled', () => {
    heroBlocks = [{ ...LEAD, alt: '' }];
    const { container } = render(<Home />);
    expect(container.querySelector('img')).toBeNull();
  });
});

// The lifecycle-aware countdown (M7 issue 7) lives inside the same lead
// section as the heading and tagline above — this proves it actually
// renders there, rather than only unit-testing EventCountdown in isolation.
//
// This describe block's own render schedules a real setInterval whenever it
// escapes the fake clock still mounted, so its afterEach unmounts (via
// cleanup()) BEFORE switching timers back: afterEach hooks run in reverse
// registration order, so a bare `vi.useRealTimers()` here would run before
// the global test setup's own cleanup() call, restoring native timers while
// this block's render was still mounted and its interval still pending.
describe('Home lead countdown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T00:00:00.000Z'));
    eventConfig = {
      name: 'Demo Event',
      timezone: 'UTC',
      announcedAt: '2026-01-01T00:00',
      days: [{ id: 'day-1', date: '2026-10-14', startTime: '09:00', endTime: '17:00' }],
    };
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders the countdown in the lead, ahead of a future event', () => {
    render(<Home />);
    expect(screen.getByText('Countdown')).toBeInTheDocument();
  });

  it('clears its interval on unmount rather than leaving it for the real clock', () => {
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');
    const { unmount } = render(<Home />);
    expect(screen.getByText('Countdown')).toBeInTheDocument();
    expect(clearSpy).not.toHaveBeenCalled();
    unmount();
    expect(clearSpy).toHaveBeenCalledTimes(1);
    clearSpy.mockRestore();
  });
});

// The key facts group (M7 issue 9). The arrangement's own rules live with
// it (components/InfoCards.test.jsx). What the page owns is whether to open
// the section at all, and the case that matters is a section holding only
// something the arrangement cannot draw: the heading must not be written
// over nothing.
describe('Home key facts', () => {
  const stat = {
    section: 'info',
    field: 'when',
    blockType: 'stat',
    value: '3 days',
    label: 'When',
    takeaway: 'The event runs from Wednesday to Friday',
    description: 'The three days on the programme.',
    source: 'The programme, read today.',
    alt: 'The event runs for three days.',
  };

  beforeEach(() => {
    eventConfig = { name: 'Demo Event', days: [] };
    pageDoc = {
      id: 'home',
      path: '/',
      label: 'Home',
      sections: [{ id: 'info', label: 'Key facts' }],
    };
  });

  it('opens the section under the page document’s own label for it', () => {
    infoBlocks = [stat, { section: 'info', field: 'venue', blockType: 'list_item', text: 'Venue: The hall' }];
    render(<Home />);
    expect(screen.getByRole('heading', { level: 2, name: 'Key facts' })).toBeInTheDocument();
    expect(screen.getByText('The event runs from Wednesday to Friday')).toBeInTheDocument();
    expect(screen.getByText('Venue: The hall')).toBeInTheDocument();
  });

  it('writes no heading over a section it cannot draw', () => {
    // Every block is a type this arrangement does not render, so there is
    // no group under the heading and therefore no heading.
    infoBlocks = [{ section: 'info', field: 'note', blockType: 'richtext', value: '<p>Not here.</p>' }];
    render(<Home />);
    expect(screen.queryByRole('heading', { name: 'Key facts' })).toBeNull();
  });

  it('writes no heading over a section whose lines are all blank', () => {
    // A line's text is not checked when content is written, so a published
    // line can be empty. It draws nothing, so it must not open the section.
    infoBlocks = [
      { section: 'info', field: 'venue', blockType: 'list_item', text: '' },
      { section: 'info', field: 'note', blockType: 'list_item', text: '  ' },
    ];
    render(<Home />);
    expect(screen.queryByRole('heading', { name: 'Key facts' })).toBeNull();
    expect(document.querySelector('section[aria-labelledby="section-info"]')).toBeNull();
  });

  it('writes no heading for an empty section', () => {
    render(<Home />);
    expect(screen.queryByRole('heading', { name: 'Key facts' })).toBeNull();
  });

  // The group is a section of this page like any other, drawn through the
  // page's own ordered section flow (M7 issue 10 gave the shell the hook
  // for it). Rendering it at a fixed point in the core made the admin's
  // reorder control look like it worked on this section and do nothing.
  it('moves when an operator reorders the section', () => {
    infoBlocks = [stat];
    const other = { id: 'details', label: 'Details' };
    sectionBlocks = {
      details: [{ section: 'details', field: 'body', blockType: 'text', value: 'Details body' }],
    };
    const headings = (container) =>
      [...container.querySelectorAll('h2')].map((el) => el.textContent.trim());

    pageDoc = { ...pageDoc, sections: [other, { id: 'info', label: 'Key facts' }] };
    const before = render(<Home />);
    expect(headings(before.container)).toEqual(['Details', 'Key facts']);
    before.unmount();

    pageDoc = { ...pageDoc, sections: [{ id: 'info', label: 'Key facts' }, other] };
    const after = render(<Home />);
    expect(headings(after.container)).toEqual(['Key facts', 'Details']);
  });

  it('draws nothing when an operator has deleted the section from the page', () => {
    // The blocks are still in cmsContent — deleting a section does not
    // delete them — so this is the case that proves the cards follow the
    // page document rather than the content.
    infoBlocks = [stat];
    pageDoc = { ...pageDoc, sections: [] };
    render(<Home />);
    expect(screen.queryByRole('heading', { name: 'Key facts' })).toBeNull();
    expect(screen.queryByText('The event runs from Wednesday to Friday')).toBeNull();
  });
});

// THE SUMMARY ROW (2026-09-10 vocabulary expansion). One composed moment on
// the first screen: the dates, the key facts and the clock as three equal
// cells across the stage. What the page owns is which cells there are and
// where the row is drawn; the row's own shape is a stylesheet rule
// (components/stageLayout.test.js).
describe('Home summary row', () => {
  const CLOCK = '2026-06-01T00:00:00.000Z';
  const stat = {
    section: 'info',
    field: 'when',
    blockType: 'stat',
    value: '3 days',
    label: 'When',
    takeaway: 'The event runs from Wednesday to Friday',
    description: 'The three days on the programme.',
    source: 'The programme, read today.',
    alt: 'The event runs for three days.',
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(CLOCK));
    eventConfig = {
      name: 'Demo Event',
      timezone: 'UTC',
      announcedAt: '2026-01-01T00:00',
      days: [
        { id: 'day-1', label: 'Day one', date: '2026-10-14', startTime: '09:00', endTime: '17:00' },
      ],
    };
    pageDoc = { id: 'home', path: '/', label: 'Home', sections: [{ id: 'info', label: 'Key facts' }] };
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  /** @param {HTMLElement} container @returns {HTMLElement} */
  const row = (container) => container.querySelector('.stage-row');

  it('draws the three cells as one row, each opening on its own head', () => {
    infoBlocks = [stat];
    const { container } = render(<Home />);
    const cells = [...row(container).children];
    expect(cells).toHaveLength(3);
    expect(cells.map((cell) => cell.querySelector('h2').textContent.trim())).toEqual([
      'Dates',
      'Key facts',
      'Countdown',
    ]);
  });

  it('draws no cell for a fact the operator has not written', () => {
    // The section is on the page and holds nothing this arrangement draws,
    // so the row is the dates and the clock rather than three heads one of
    // which stands over nothing.
    infoBlocks = [];
    const { container } = render(<Home />);
    const cells = [...row(container).children];
    expect(cells).toHaveLength(2);
    expect(cells.map((cell) => cell.querySelector('h2').textContent.trim())).toEqual([
      'Dates',
      'Countdown',
    ]);
  });

  it('draws no row at all when nothing in it has anything to say', () => {
    eventConfig = { name: 'Demo Event', days: [] };
    const { container } = render(<Home />);
    expect(row(container)).toBeNull();
  });

  it('still states the dates and the clock on a page with no key facts section', () => {
    // Deleting the section deletes one cell, never the other two: the dates
    // and the clock are configuration, not that section's content.
    pageDoc = { ...pageDoc, sections: [] };
    infoBlocks = [stat];
    const { container } = render(<Home />);
    expect([...row(container).children]).toHaveLength(2);
    expect(screen.queryByRole('heading', { name: 'Key facts' })).toBeNull();
  });

  it('moves with the key facts section when an operator reorders it', () => {
    infoBlocks = [stat];
    sectionBlocks = {
      details: [{ section: 'details', field: 'body', blockType: 'text', value: 'Details body' }],
    };
    const other = { id: 'details', label: 'Details' };

    pageDoc = { ...pageDoc, sections: [other, { id: 'info', label: 'Key facts' }] };
    const before = render(<Home />);
    expect([...before.container.querySelectorAll('h2')][0].textContent.trim()).toBe('Details');
    before.unmount();

    pageDoc = { ...pageDoc, sections: [{ id: 'info', label: 'Key facts' }, other] };
    const after = render(<Home />);
    expect([...after.container.querySelectorAll('h2')][0].textContent.trim()).toBe('Dates');
  });
});

// The sponsor strip (M7 issue 10). The wall's own rules live with the wall
// (components/SponsorWall.test.jsx). What the page owns is where the strip
// goes and whether it is drawn at all.
//
// WHERE IT GOES IS THE OPERATOR'S. The strip is a section of this page like
// any other, drawn through the page's own ordered section flow, so dragging
// it in the admin moves it on the page. Rendering it at a fixed point in
// the core — which is what this did first — made that control look like it
// worked and do nothing.
describe('Home sponsor strip', () => {
  const sponsors = { id: 'sponsors', label: 'Sponsors' };
  const other = { id: 'details', label: 'Details' };
  const PUBLISHED = [
    {
      id: 'one',
      name: 'First Supporter',
      tier: 'Presenting',
      url: 'https://one.example.org',
      visible: true,
    },
  ];

  /** The page's section headings, in document order. */
  const headings = (container) =>
    [...container.querySelectorAll('h2')].map((el) => el.textContent.trim());

  beforeEach(() => {
    eventConfig = { name: 'Demo Event', days: [] };
    features = { sponsors: true };
    pageDoc = { id: 'home', path: '/', label: 'Home', sections: [sponsors] };
    organizationsData = PUBLISHED;
    sectionBlocks = {
      details: [{ section: 'details', field: 'body', blockType: 'text', value: 'Details body' }],
    };
  });

  it('draws the tiered wall under the section’s own label', () => {
    render(<Home />);
    expect(screen.getByRole('region', { name: 'Sponsors' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'First Supporter' })).toBeInTheDocument();
  });

  it('moves when an operator reorders the section', () => {
    pageDoc = { ...pageDoc, sections: [other, sponsors] };
    const before = render(<Home />);
    expect(headings(before.container)).toEqual(['Details', 'Sponsors']);
    before.unmount();

    pageDoc = { ...pageDoc, sections: [sponsors, other] };
    const after = render(<Home />);
    expect(headings(after.container)).toEqual(['Sponsors', 'Details']);
  });

  it('moves above the lead when the section states that slot', () => {
    pageDoc = { ...pageDoc, sections: [{ ...sponsors, slot: 'above' }] };
    const { container } = render(<Home />);
    const strip = screen.getByRole('region', { name: 'Sponsors' });
    const lead = screen.getByRole('heading', { level: 1 });
    expect(strip.compareDocumentPosition(lead) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector('.logo-wall')).not.toBeNull();
  });

  it('draws the section’s own line above the wall, and nothing when it is cleared', () => {
    sectionBlocks = {
      sponsors: [{ section: 'sponsors', field: 'lede', blockType: 'text', value: 'Thank you.' }],
    };
    const withLede = render(<Home />);
    expect(screen.getByText('Thank you.')).toBeInTheDocument();
    withLede.unmount();

    // An empty paragraph renders as its own margin: a stray gap between the
    // heading and the wall.
    sectionBlocks = {
      sponsors: [{ section: 'sponsors', field: 'lede', blockType: 'text', value: '   ' }],
    };
    render(<Home />);
    const strip = screen.getByRole('region', { name: 'Sponsors' });
    expect(strip.querySelector(':scope > p')).toBeNull();
  });

  it('draws nothing when the sponsors feature is off', () => {
    features = { sponsors: false };
    render(<Home />);
    expect(screen.queryByRole('region', { name: 'Sponsors' })).toBeNull();
    expect(screen.queryByText('First Supporter')).toBeNull();
  });

  it('draws nothing when an operator has deleted the section from the page', () => {
    pageDoc = { ...pageDoc, sections: [] };
    render(<Home />);
    expect(screen.queryByRole('region', { name: 'Sponsors' })).toBeNull();
  });

  it('draws no heading over an empty wall when nothing is published yet', () => {
    for (const organizations of [
      [],
      [{ id: 'x', name: 'Hidden', tier: 'Partner', url: 'https://x.example.org', visible: false }],
    ]) {
      organizationsData = organizations;
      const { unmount } = render(<Home />);
      expect(screen.queryByRole('region', { name: 'Sponsors' })).toBeNull();
      expect(screen.queryByRole('heading', { name: 'Sponsors' })).toBeNull();
      unmount();
    }
  });
});
