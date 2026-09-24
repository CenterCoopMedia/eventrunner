// A sponsor package (#193): a name, the pairs it states, and what it
// includes, sanitized. A run of packages is one ruled list.
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import SponsorPackageBlock, { sponsorLimitLabel } from './SponsorPackageBlock.jsx';
import SectionBlocks from './SectionBlocks.jsx';

/** The <dd> after a <dt> with this text, or null. */
const descriptionOf = (term) => {
  const dt = [...document.querySelectorAll('dt')].find((node) => node.textContent === term);
  return dt ? dt.nextElementSibling : null;
};

const PACKAGE = {
  blockType: 'sponsor_package',
  name: 'Coffee break',
  price: 'Illustrative figure',
  limit: 3,
  benefits: '<ul><li>Name on the break signs</li></ul>',
};

describe('SponsorPackageBlock', () => {
  it('heads the package with its name and states its price and its limit as pairs', () => {
    render(<SponsorPackageBlock block={PACKAGE} />);
    expect(screen.getByRole('heading', { level: 3, name: 'Coffee break' })).toBeInTheDocument();
    expect(descriptionOf('Price')).toHaveTextContent('Illustrative figure');
    expect(descriptionOf('Open to')).toHaveTextContent('3 sponsors');
    expect(screen.getByText('Name on the break signs').closest('.rich-text')).not.toBeNull();
    // No box: the entry is a plain article.
    expect(screen.getByRole('article').className).toBe('');
  });

  it('says "1 sponsor" for a limit of one, and states no limit it cannot read', () => {
    expect(sponsorLimitLabel(1)).toBe('1 sponsor');
    for (const limit of [0, -2, 2.5, '3', null, undefined, Number.NaN]) {
      expect(sponsorLimitLabel(limit), String(limit)).toBeNull();
    }
    for (const limit of [0, '3', undefined]) {
      const { unmount } = render(<SponsorPackageBlock block={{ ...PACKAGE, limit }} />);
      expect(descriptionOf('Open to'), String(limit)).toBeNull();
      unmount();
    }
    render(<SponsorPackageBlock block={{ ...PACKAGE, limit: 1 }} />);
    expect(descriptionOf('Open to')).toHaveTextContent('1 sponsor');
  });

  it('draws no pairs at all when the package states neither', () => {
    const { container } = render(<SponsorPackageBlock block={{ ...PACKAGE, price: '  ', limit: null }} />);
    expect(container.querySelector('dl')).toBeNull();
  });

  it('strips a script from the benefits', () => {
    const { container } = render(
      <SponsorPackageBlock block={{ ...PACKAGE, benefits: '<p>Signs</p><script>window.hit = 1</script><img src=x onerror="alert(1)">' }} />,
    );
    expect(container.querySelector('script')).toBeNull();
    expect(container.innerHTML).not.toMatch(/onerror/);
    expect(screen.getByText('Signs')).toBeInTheDocument();
  });

  it('draws nothing without a name', () => {
    const { container } = render(<SponsorPackageBlock block={{ ...PACKAGE, name: ' ' }} />);
    expect(container.innerHTML).toBe('');
  });

  it('sets a run of packages as one list of entries ruled on top, leaving out one with no name', () => {
    const { container } = render(
      <SectionBlocks
        blocks={[
          { ...PACKAGE, id: 'a', name: 'First' },
          { ...PACKAGE, id: 'b', name: '' },
          { ...PACKAGE, id: 'c', name: 'Second' },
        ]}
      />,
    );
    // The outer list; each package's benefits carry a list of their own.
    const list = container.querySelector('ul');
    const entries = within(list).getAllByRole('listitem').filter((item) => item.parentElement === list);
    expect(entries).toHaveLength(2);
    expect(entries[0].className).toContain('border-t-rule-hairline');
    expect(entries.map((entry) => within(entry).getByRole('heading', { level: 3 }).textContent)).toEqual(['First', 'Second']);
  });

  // Review round (c2, finding 5): a heading takes the base text-wrap:
  // balance (index.css, h1 to h4); `pretty` is for descriptions.
  it('leaves the package heading to the base balance', () => {
    render(<SponsorPackageBlock block={PACKAGE} />);
    const heading = screen.getByRole('heading', { level: 3, name: 'Coffee break' });
    expect(heading.className).not.toMatch(/\btext-pretty\b/);
  });
});
