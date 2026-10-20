// The lead image device (design brief §2.5.2): one optional image beside the
// opening copy, with required alt text, a stable crop, and a focal point.
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import LeadImage, { focalPosition } from './LeadImage.jsx';

const BLOCK = {
  blockType: 'image',
  url: 'https://example.org/hall.jpg',
  alt: 'The main hall before doors open',
};

describe('LeadImage', () => {
  it('renders the picture with its alt text', () => {
    render(<LeadImage block={BLOCK} />);
    expect(screen.getByAltText('The main hall before doors open')).toHaveAttribute(
      'src',
      'https://example.org/hall.jpg',
    );
  });

  it('renders nothing at all when the block has no alt text', () => {
    // Alt text is required by the block contract, and a decorative empty
    // alt is not an option for the one image that opens a page.
    const { container } = render(<LeadImage block={{ ...BLOCK, alt: '   ' }} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for a url the href allowlist rejects', () => {
    const { container } = render(<LeadImage block={{ ...BLOCK, url: 'javascript:alert(1)' }} />);
    expect(container.firstChild).toBeNull();
  });

  it('never paints the picture behind text', () => {
    const { container } = render(<LeadImage block={{ ...BLOCK, caption: 'Harbour Hall' }} />);
    expect(container.querySelector('[style*="background-image"]')).toBeNull();
    // The caption is a figcaption under the picture, not an overlay.
    expect(container.querySelector('figcaption').textContent).toBe('Harbour Hall');
  });

  it('crops to the stated focal point', () => {
    render(<LeadImage block={{ ...BLOCK, focalX: 20, focalY: 80 }} />);
    expect(screen.getByAltText(BLOCK.alt)).toHaveStyle({ objectPosition: '20% 80%' });
  });
});

// Issue #333: a picture picked from the media library is a Storage path.
// It resolves to the bucket, and it offers the display sizes the function
// wrote, at the slot's width. Alt text, crop, and focal point stay.
describe('LeadImage display sizes', () => {
  const PICKED = { ...BLOCK, url: 'cms-images/a1b2c3/hall.jpg', focalX: 30, focalY: 70 };

  it('resolves a picked path to the bucket and offers the sizes', () => {
    render(<LeadImage block={PICKED} />);
    const img = screen.getByAltText(BLOCK.alt);
    expect(img.getAttribute('src')).toContain('firebasestorage.googleapis.com');
    expect(img.getAttribute('src')).toContain(encodeURIComponent('cms-images/a1b2c3/hall.jpg'));
    expect(img.getAttribute('srcset')).toContain(encodeURIComponent('cms-images/a1b2c3/_sizes/640.webp'));
    expect(img.getAttribute('sizes')).toBe('(min-width: 64rem) 22rem, 100vw');
    expect(img).toHaveStyle({ objectPosition: '30% 70%' });
  });

  it('falls back to the original when a size fails to load', () => {
    render(<LeadImage block={PICKED} />);
    fireEvent.error(screen.getByAltText(BLOCK.alt));
    const img = screen.getByAltText(BLOCK.alt);
    expect(img).not.toHaveAttribute('srcset');
    expect(img.getAttribute('src')).toContain(encodeURIComponent('cms-images/a1b2c3/hall.jpg'));
  });

  it('offers no sizes for a link to another site', () => {
    render(<LeadImage block={BLOCK} />);
    expect(screen.getByAltText(BLOCK.alt)).not.toHaveAttribute('srcset');
  });
});

describe('focalPosition', () => {
  it('centres the crop when the block states no focal point', () => {
    expect(focalPosition({})).toBe('50% 50%');
  });

  it('clamps a stored coordinate to the picture', () => {
    expect(focalPosition({ focalX: -40, focalY: 260 })).toBe('0% 100%');
  });

  it('centres an axis a live write left unusable', () => {
    // cmsContent is unvalidated at read time (spec §2.4), so a string or a
    // NaN must not reach object-position.
    expect(focalPosition({ focalX: 'left', focalY: Number.NaN })).toBe('50% 50%');
  });
});
