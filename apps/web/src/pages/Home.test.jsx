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
vi.mock('../contexts/EventConfigContext.jsx', () => ({
  useEventConfig: () => ({ eventConfig, theme }),
}));
vi.mock('../contexts/ContentContext.jsx', () => ({
  useContent: () => ({
    getPage: () => pageDoc,
    getSectionBlocks: (section) => {
      if (section === 'hero') return heroBlocks;
      if (section === 'info') return infoBlocks;
      return [];
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
    expect(screen.getByText('Time until the event starts')).toBeInTheDocument();
  });

  it('clears its interval on unmount rather than leaving it for the real clock', () => {
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');
    const { unmount } = render(<Home />);
    expect(screen.getByText('Time until the event starts')).toBeInTheDocument();
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
      label: 'Home page',
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

  it('writes no heading for an empty section', () => {
    render(<Home />);
    expect(screen.queryByRole('heading', { name: 'Key facts' })).toBeNull();
  });
});
