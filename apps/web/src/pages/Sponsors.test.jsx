// Regression test for the sponsor-link XSS gap: Sponsors.jsx rendered
// organizationsData's raw `url` field straight into an href, so a
// javascript: URL in a sponsor record would execute on click. It must go
// through the same isSafeHref allowlist the block renderers use.
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const UNSAFE_URL = 'javascript:alert(1)';
const SAFE_URL = 'https://example.org';

let organizationsData;
let pageDoc = null;
vi.mock('../contexts/ContentContext.jsx', () => ({
  // The page shell reads the cmsPages document for its layout and its
  // slot sections (components/SystemPage.jsx); this directory states no
  // sections, and states a layout only where a test sets one.
  useContent: () => ({ organizationsData, getPage: () => pageDoc, getSectionBlocks: () => [] }),
}));
vi.mock('../contexts/EventConfigContext.jsx', () => ({
  useEventConfig: () => ({ features: { sponsors: true } }),
}));

import Sponsors from './Sponsors.jsx';

function renderSponsors() {
  return render(
    <MemoryRouter>
      <Sponsors />
    </MemoryRouter>,
  );
}

describe('Sponsors', () => {
  it('renders no link for a sponsor with an unsafe (javascript:) url, but still shows its name', () => {
    organizationsData = [
      {
        id: 'org-1',
        name: 'Unsafe Org',
        url: UNSAFE_URL,
        tier: 'Gold',
        description: 'desc',
        visible: true,
      },
    ];
    renderSponsors();
    expect(screen.getByText('Unsafe Org')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Unsafe Org' })).toBeNull();
  });

  it('renders a link for a sponsor with a safe (https:) url', () => {
    organizationsData = [
      {
        id: 'org-2',
        name: 'Safe Org',
        url: SAFE_URL,
        tier: 'Gold',
        description: 'desc',
        visible: true,
      },
    ];
    renderSponsors();
    expect(screen.getByRole('link', { name: 'Safe Org' })).toHaveAttribute('href', SAFE_URL);
  });

  // THE TIERED LOGO WALL (this review). The page is an acknowledgement,
  // and the thing acknowledged is degree — so the tier is the composition.

  it('groups by tier and heads each group with the operator’s own words', () => {
    organizationsData = [
      { id: 'org-1', name: 'First', tier: 'Presenting', logoPath: 'a.svg', visible: true },
      { id: 'org-2', name: 'Second', tier: 'Partner', logoPath: 'b.svg', visible: true },
      { id: 'org-3', name: 'Third', tier: 'Presenting', logoPath: 'c.svg', visible: true },
    ];
    renderSponsors();
    expect(screen.getByRole('heading', { level: 2, name: /Presenting/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /Partner/ })).toBeInTheDocument();
    // Two in the first group, one in the second — counted, not guessed.
    expect(screen.getByText('2 organizations')).toBeInTheDocument();
    expect(screen.getByText('1 organization')).toBeInTheDocument();
  });

  it('takes standing from the operator’s order, never from the tier’s name', () => {
    // Nothing here knows that "Presenting" outranks "Partner", and nothing
    // should: the tier is free text an operator wrote, and ranking those
    // words would be a guess about meaning dressed as a fact. The group
    // that appears FIRST in the operator's ordering gets the largest mark.
    organizationsData = [
      { id: 'org-2', name: 'Second', tier: 'Partner', logoPath: 'b.svg', visible: true },
      { id: 'org-1', name: 'First', tier: 'Presenting', logoPath: 'a.svg', visible: true },
    ];
    const { container } = renderSponsors();
    const walls = [...container.querySelectorAll('.logo-wall')];
    expect(walls).toHaveLength(2);
    // Partner came first in the list, so Partner is the big wall.
    expect(walls[0].style.getPropertyValue('--logo-wall-mark-size')).toBe(
      'calc(var(--space-3xl) * 2)',
    );
    expect(walls[1].style.getPropertyValue('--logo-wall-mark-size')).toBe(
      'calc(var(--space-3xl) * 1.5)',
    );
    expect(container.querySelectorAll('h2')[0].textContent).toContain('Partner');
  });

  it('gives an untiered supporter a heading rather than a blank one', () => {
    organizationsData = [{ id: 'org-1', name: 'Only', logoPath: 'a.svg', visible: true }];
    renderSponsors();
    expect(screen.getByRole('heading', { level: 2, name: /Supporters/ })).toBeInTheDocument();
  });

  it('drops the descriptions in a grid and keeps them in a list', () => {
    // The layout variant decides how much of a supporter the wall says
    // (brief §6.1) — the same wall, the same data, one link away either
    // way. It never turns a mark into a card.
    organizationsData = [
      { id: 'org-1', name: 'First', tier: 'Gold', description: 'What they do', visible: true },
    ];
    pageDoc = { id: 'sponsors', layout: { arrangement: 'grid' } };
    const { container } = renderSponsors();
    pageDoc = null;
    expect(screen.queryByText('What they do')).toBeNull();
    expect(container.querySelector('.logo-wall__mark')).toBeInTheDocument();

    renderSponsors();
    expect(screen.getByText('What they do')).toBeInTheDocument();
  });
});
