// Regression test for the sponsor-link XSS gap: Sponsors.jsx rendered
// organizationsData's raw `url` field straight into an href, so a
// javascript: URL in a sponsor record would execute on click. It must go
// through the same isSafeHref allowlist the block renderers use.
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const UNSAFE_URL = 'javascript:alert(1)';
const SAFE_URL = 'https://example.org';

let organizationsData;
let pageDoc = null;
let sectionBlocks = {};
vi.mock('../contexts/ContentContext.jsx', () => ({
  // The page shell reads the cmsPages document for its layout and its
  // slot sections (components/SystemPage.jsx); this directory states no
  // sections, and states a layout only where a test sets one.
  useContent: () => ({
    organizationsData,
    getPage: () => pageDoc,
    getSectionBlocks: (id) => sectionBlocks[id] ?? [],
  }),
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
    // A prefix match: the link's own name now carries the new-tab sentence
    // after the supporter's name (components/ExternalLink.jsx).
    expect(screen.getByRole('link', { name: /^Safe Org\b/ })).toHaveAttribute('href', SAFE_URL);
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
    // that comes FIRST in the operator's own `order` gets the largest mark.
    //
    // The documents arrive here in the opposite order on purpose: the
    // runtime listener hands them over in Firestore's query order, so the
    // wall has to put them back in the operator's before it groups them.
    organizationsData = [
      { id: 'org-1', name: 'First', tier: 'Presenting', logoPath: 'a.svg', visible: true, order: 2 },
      { id: 'org-2', name: 'Second', tier: 'Partner', logoPath: 'b.svg', visible: true, order: 1 },
    ];
    const { container } = renderSponsors();
    const walls = [...container.querySelectorAll('.logo-wall')];
    expect(walls).toHaveLength(2);
    // Partner is first in the operator's order, so Partner is the big wall.
    // The step values are set for the stage and may be retuned with it, so
    // what is asserted is the order of the two marks, not their literals.
    const step = (wall) =>
      Number(
        /\* ([\d.]+)\)$/.exec(wall.style.getPropertyValue('--logo-wall-mark-size'))[1],
      );
    expect(step(walls[0])).toBeGreaterThan(step(walls[1]));
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

  // Issue 192: an organization the editor publishes joins the group its
  // tier names, by the tier's exact text.
  it('puts a live organization in the group its tier names', () => {
    organizationsData = [
      { id: 'beacon-fund', name: 'Beacon Fund', tier: 'presenting', visible: true, order: 0 },
      { id: 'e2e-org', name: 'Published Org', tier: 'supporting', visible: true, order: 6 },
      { id: 'press-trust', name: 'Press Trust', tier: 'supporting', visible: true, order: 1 },
      { id: 'draft-org', name: 'Hidden Org', tier: 'supporting', visible: false, order: 2 },
    ];
    renderSponsors();
    const group = screen.getByRole('region', { name: 'supporting' });
    expect(within(group).getByText('Published Org')).toBeInTheDocument();
    expect(within(group).getByText('2 organizations')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'presenting' })).queryByText('Published Org')).toBeNull();
    expect(screen.queryByText('Hidden Org')).toBeNull();
    expect(within(group).getByRole('link', { name: /about Published Org/ })).toHaveAttribute('href', '/sponsors/e2e-org');
  });

  // Issue 193: the seeded Sponsorship packages section draws its packages
  // after the wall, and nothing at all while it is empty.
  it('draws the Sponsorship packages section after the wall once it holds a package', () => {
    organizationsData = [{ id: 'beacon-fund', name: 'Beacon Fund', tier: 'presenting', visible: true }];
    pageDoc = {
      id: 'sponsors',
      sections: [{ id: 'sponsor_packages', label: 'Sponsorship packages', allowedBlocks: ['sponsor_package', 'richtext'], maxBlocks: 6 }],
    };
    sectionBlocks = {};
    const { unmount } = renderSponsors();
    expect(screen.queryByRole('region', { name: 'Sponsorship packages' })).toBeNull();
    unmount();

    sectionBlocks = {
      sponsor_packages: [
        { id: 'sponsor_packages__a', blockType: 'sponsor_package', name: 'Presenting', price: 'Illustrative', limit: 1, benefits: '<p>Plenary</p>' },
        { id: 'sponsor_packages__b', blockType: 'sponsor_package', name: 'Partner', benefits: '<p>Clinic</p>' },
      ],
    };
    const { container } = renderSponsors();
    pageDoc = null;
    sectionBlocks = {};
    const region = screen.getByRole('region', { name: 'Sponsorship packages' });
    expect(within(region).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Presenting', 'Partner']);
    // After the wall, in the page's main slot.
    const wall = container.querySelector('.logo-wall');
    expect(wall.compareDocumentPosition(region) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
