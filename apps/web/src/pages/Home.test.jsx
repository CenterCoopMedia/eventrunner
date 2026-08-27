// Regression test for the tagline crash gap: Home.jsx rendered
// eventConfig.tagline directly as JSX children, so a non-string live value
// (validation for tagline was missing at the write boundary) would make
// React throw and blank the whole homepage. The render must guard the type
// defensively, independent of the write-boundary fix in
// packages/shared/src/config/schema.cjs.
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

let eventConfig;
vi.mock('../contexts/EventConfigContext.jsx', () => ({
  useEventConfig: () => ({ eventConfig }),
}));
vi.mock('../contexts/ContentContext.jsx', () => ({
  useContent: () => ({
    getPage: () => null,
    getSectionBlocks: () => [],
    getBlock: (section, field) =>
      section === 'hero' && field === 'title' ? { value: 'Fallback title' } : null,
  }),
}));

import Home from './Home.jsx';

describe('Home', () => {
  it('owns the page heading, and puts nothing above it', () => {
    // The shell's header carries the running site identity, so this page's
    // stored hero title is its own <h1> (design brief §2.1, §2.4).
    eventConfig = { name: 'Demo Event', tagline: 'A gathering', days: [] };
    const { container } = render(<Home />);
    const heading = screen.getByRole('heading', { level: 1, name: 'Fallback title' });
    expect(heading).toBeInTheDocument();
    const section = container.querySelector('section');
    expect(section.firstElementChild).toBe(heading);
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
});
