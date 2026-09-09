// SponsorWall and SponsorStrip (M7 issue 10).
//
// The wall itself is the one the sponsors page has always drawn — its own
// rules are held by src/pages/Sponsors.test.jsx, which renders this
// component through that page. What is new, and what this file holds, is
// the home page's strip around it: the same wall, the same published
// organizations, and the three ways it must render nothing at all rather
// than a heading over an empty acknowledgement.
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

let organizationsData;

vi.mock('../contexts/ContentContext.jsx', () => ({
  useContent: () => ({ organizationsData }),
}));

const { SponsorStrip, default: SponsorWall, groupByTier, visibleOrganizations } = await import(
  './SponsorWall.jsx'
);

const org = (id, name, tier, extra = {}) => ({
  id,
  name,
  tier,
  url: `https://${id}.example.org`,
  visible: true,
  ...extra,
});

// Two tiers in the operator's own order: the first tier listed is the one
// whose marks are drawn largest, whatever its name happens to be.
const PUBLISHED = [
  org('one', 'First Supporter', 'Presenting'),
  org('two', 'Second Supporter', 'Presenting'),
  org('three', 'Third Supporter', 'Partner'),
];

describe('visibleOrganizations', () => {
  it('keeps only what an operator has published, and survives a missing list', () => {
    expect(visibleOrganizations([...PUBLISHED, org('four', 'Hidden', 'Partner', { visible: false })]))
      .toHaveLength(3);
    expect(visibleOrganizations(undefined)).toEqual([]);
  });

  // The committed snapshot arrives sorted by `order`; the runtime listener
  // does not — Firestore hands the documents back in its own query order.
  // The wall reads position as standing, so an unsorted list would regroup
  // the tiers and resize the marks behind the operator's back.
  it('puts the organizations back in the operator’s order, whatever order they arrive in', () => {
    const reversed = [
      org('two', 'Second Supporter', 'Partner', { order: 2 }),
      org('one', 'First Supporter', 'Presenting', { order: 1 }),
    ];
    expect(visibleOrganizations(reversed).map((o) => o.id)).toEqual(['one', 'two']);
  });

  it('breaks a tie on the id, so an unset order is still a stable order', () => {
    const tied = [org('c', 'C', 'Gold'), org('a', 'A', 'Gold'), org('b', 'B', 'Gold', { order: 0 })];
    expect(visibleOrganizations(tied).map((o) => o.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('groupByTier', () => {
  it('groups in the order the operator listed them, keeping their exact labels', () => {
    expect(groupByTier(PUBLISHED).map((g) => [g.tier, g.members.length])).toEqual([
      ['Presenting', 2],
      ['Partner', 1],
    ]);
    // "Gold" and "gold" are two labels somebody typed differently, and
    // folding them together would silently rewrite one of them.
    expect(groupByTier([org('a', 'A', 'Gold'), org('b', 'B', 'gold')])).toHaveLength(2);
  });

  it('heads an untiered group rather than leaving it nameless', () => {
    expect(groupByTier([org('a', 'A', null)])[0].tier).toBe('Supporters');
  });
});

describe('SponsorWall', () => {
  it('sizes each tier group by its rank in the operator’s own order', () => {
    const { container } = render(<SponsorWall organizations={PUBLISHED} />);
    const walls = [...container.querySelectorAll('.logo-wall')];
    expect(walls).toHaveLength(2);
    expect(walls[0].style.getPropertyValue('--logo-wall-mark-size')).toBe(
      'calc(var(--space-3xl) * 2)',
    );
    expect(walls[1].style.getPropertyValue('--logo-wall-mark-size')).toBe(
      'calc(var(--space-3xl) * 1.5)',
    );
  });

  it('takes the heading level and the id namespace its caller states', () => {
    const { container } = render(
      <SponsorWall organizations={PUBLISHED} level={3} idPrefix="home-tier" />,
    );
    expect(container.querySelector('#home-tier-0').tagName).toBe('H3');
    // A name sits UNDER its tier in the outline, so it follows the tier's
    // level rather than being fixed at one.
    expect(container.querySelector('.logo-wall h4').textContent).toBe('First Supporter');
  });

  // A mark is decorative: the organization's name is printed directly under
  // it and links to the same place. So a logo file that has gone from the
  // bucket must not print the media library's own miss sentence onto a
  // public page — that sentence is addressed to an operator, and a visitor
  // can do nothing with it. The frame keeps its size, so the wall does not
  // pull together around the gap.
  it('says nothing to a visitor when a mark’s file is gone, and keeps the frame', () => {
    organizationsData = undefined;
    const { container } = render(
      <SponsorWall
        organizations={[org('one', 'First Supporter', 'Presenting', { logoPath: 'gone/mark.png' })]}
      />,
    );
    expect(container.textContent).not.toContain('missing from storage');
    const frame = container.querySelector('.logo-wall__mark');
    expect(frame).not.toBeNull();
    expect(frame.textContent).toBe('');
    // The name is still there — the acknowledgement survives the lost file.
    expect(screen.getByRole('link', { name: 'First Supporter' })).toBeInTheDocument();
  });
});

describe('SponsorStrip', () => {
  it('draws the tiered wall under the section’s own heading', () => {
    organizationsData = PUBLISHED;
    render(<SponsorStrip id="section-sponsors" title="Sponsors" lede="Thank you." />);
    const section = screen.getByRole('region', { name: 'Sponsors' });
    expect(within(section).getByText('Thank you.')).toBeInTheDocument();
    // Tier order is the operator's order, and every published
    // organization is acknowledged.
    const tiers = within(section)
      .getAllByRole('heading', { level: 3 })
      .map((node) => node.textContent);
    expect(tiers).toEqual(['Presenting', 'Partner']);
    for (const name of ['First Supporter', 'Second Supporter', 'Third Supporter']) {
      expect(within(section).getByRole('link', { name })).toBeInTheDocument();
    }
  });

  // The strip reads whatever the runtime listener last handed the context,
  // and that is Firestore's query order, not the operator's. The tier heads
  // and the mark sizes both come out of position, so this is the difference
  // between "Presenting" being the largest wall and it being the second one.
  it('draws the operator’s order even when the runtime documents arrive reversed', () => {
    organizationsData = [
      org('three', 'Third Supporter', 'Partner', { order: 3 }),
      org('two', 'Second Supporter', 'Presenting', { order: 2 }),
      org('one', 'First Supporter', 'Presenting', { order: 1 }),
    ];
    const { container } = render(<SponsorStrip id="section-sponsors" title="Sponsors" />);
    const section = screen.getByRole('region', { name: 'Sponsors' });
    expect(
      within(section)
        .getAllByRole('heading', { level: 3 })
        .map((node) => node.textContent),
    ).toEqual(['Presenting', 'Partner']);
    // The first group is the operator's first, so it is the one drawn largest.
    expect(
      container.querySelector('.logo-wall').style.getPropertyValue('--logo-wall-mark-size'),
    ).toBe('calc(var(--space-3xl) * 2)');
    expect(
      [...container.querySelectorAll('.logo-wall h4')].map((node) => node.textContent),
    ).toEqual(['First Supporter', 'Second Supporter', 'Third Supporter']);
  });

  it('is the acknowledgement wall: marks and names, never the descriptions', () => {
    organizationsData = [org('one', 'First Supporter', 'Presenting', { description: 'A paragraph.' })];
    render(<SponsorStrip id="section-sponsors" title="Sponsors" />);
    expect(screen.queryByText('A paragraph.')).toBeNull();
  });

  it('renders nothing at all when there is nothing to acknowledge', () => {
    for (const list of [[], undefined, [org('one', 'Hidden', 'Partner', { visible: false })]]) {
      organizationsData = list;
      const { container, unmount } = render(<SponsorStrip id="section-sponsors" title="Sponsors" />);
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });
});
