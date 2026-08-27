// The home page's opening section: the page's own heading, the tagline
// guard, and the one optional lead image.
//
// The tagline case is a regression test. Home.jsx rendered
// eventConfig.tagline directly as JSX children, so a non-string live value
// (validation for tagline was missing at the write boundary) would make
// React throw and blank the whole homepage. The render must guard the type
// defensively, independent of the write-boundary fix in
// packages/shared/src/config/schema.cjs.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

let eventConfig;
let heroBlocks;
let theme;
vi.mock('../contexts/EventConfigContext.jsx', () => ({
  useEventConfig: () => ({ eventConfig, theme }),
}));
vi.mock('../contexts/ContentContext.jsx', () => ({
  useContent: () => ({
    getPage: () => null,
    getSectionBlocks: () => heroBlocks,
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
