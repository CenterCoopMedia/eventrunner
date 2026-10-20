// AssetImage: what a missing object says, and to whom.
//
// The admin sentence ("This file is missing from storage.") is written for
// somebody who owns the library and can fix it. On the public site the same
// sentence reaches a visitor who cannot act on it, about a file they were
// never meant to think about — a sponsor's logo, whose organization is
// already named directly under the mark. `decorative` is the caller saying
// the image carries no information of its own, and a miss is then silent
// while still holding its space in the layout.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { BRAND_UTILITY_PREFIX } from '../../test/retiredUtilityNames.js';

vi.mock('../../lib/mediaSource.js', () => ({
  assetUrl: (path) => (typeof path === 'string' && path ? `https://cdn.example.org/${path}` : null),
  assetSrcSet: (path) =>
    typeof path === 'string' && path.startsWith('speaker-photos/')
      ? `https://cdn.example.org/${path}-320.webp 320w, https://cdn.example.org/${path}-640.webp 640w`
      : null,
}));

const { default: AssetImage } = await import('./AssetImage.jsx');

describe('AssetImage', () => {
  it('renders the image for a path that resolves', () => {
    const { container } = render(<AssetImage path="branding/mark.svg" alt="A mark" />);
    const img = container.querySelector('img');
    expect(img).toHaveAttribute('src', 'https://cdn.example.org/branding/mark.svg');
    expect(img).toHaveAttribute('alt', 'A mark');
  });

  it('tells an operator when the object cannot be resolved', () => {
    const { container } = render(<AssetImage path={null} alt="A mark" />);
    expect(container.textContent).toContain('This file is missing from storage.');
  });

  it('reads the tier 2 role tokens, not the old compatibility names (issue 247)', () => {
    const { container } = render(<AssetImage path={null} alt="A mark" />);
    const missing = container.firstChild;
    expect(missing).toHaveClass('bg-surface-alt');
    expect(missing).toHaveClass('text-text-secondary');
    expect(missing.className).not.toMatch(BRAND_UTILITY_PREFIX);
  });

  it('tells an operator when the object is gone from the bucket', () => {
    const { container } = render(<AssetImage path="branding/gone.png" alt="A mark" />);
    fireEvent.error(container.querySelector('img'));
    expect(container.textContent).toContain('This file is missing from storage.');
  });

  it('says nothing at all for a decorative miss, and keeps the space', () => {
    for (const props of [{ path: null }, { path: '' }]) {
      const { container, unmount } = render(<AssetImage {...props} alt="" decorative />);
      expect(container.textContent).toBe('');
      // The slot is still in the document — the layout around it sizes the
      // box, so collapsing to nothing would pull the wall together.
      const slot = container.firstChild;
      expect(slot).not.toBeNull();
      expect(slot).toHaveAttribute('aria-hidden', 'true');
      unmount();
    }
  });

  it('says nothing when a decorative image fails to load either', () => {
    const { container } = render(<AssetImage path="branding/gone.png" alt="" decorative />);
    fireEvent.error(container.querySelector('img'));
    expect(container.textContent).toBe('');
    expect(container.firstChild).toHaveAttribute('aria-hidden', 'true');
  });

  // Issue #333: a caller that states the slot's size gets the display
  // sizes. The original stays the src, so it is the fallback.
  describe('display sizes', () => {
    const PHOTO = 'speaker-photos/spk-1/a1b2c3/face.jpg';

    it('offers the sizes with the slot width the caller states', () => {
      const { container } = render(<AssetImage path={PHOTO} alt="" sizes="14rem" />);
      const img = container.querySelector('img');
      expect(img).toHaveAttribute('src', `https://cdn.example.org/${PHOTO}`);
      expect(img).toHaveAttribute('sizes', '14rem');
      expect(img.getAttribute('srcset')).toContain(' 320w');
      expect(img.getAttribute('srcset')).toContain(' 640w');
    });

    it('offers no sizes when the caller states no slot width', () => {
      // An editor preview shows an upload seconds old, before its sizes
      // exist, so the default stays the original alone.
      const { container } = render(<AssetImage path={PHOTO} alt="" />);
      const img = container.querySelector('img');
      expect(img).not.toHaveAttribute('srcset');
      expect(img).not.toHaveAttribute('sizes');
    });

    it('offers no sizes for a path that has none', () => {
      const { container } = render(<AssetImage path="branding/mark.svg" alt="" sizes="10rem" />);
      expect(container.querySelector('img')).not.toHaveAttribute('srcset');
    });

    it('falls back to the original when a size fails to load', () => {
      const { container } = render(<AssetImage path={PHOTO} alt="" sizes="14rem" decorative />);
      fireEvent.error(container.querySelector('img'));
      const img = container.querySelector('img');
      expect(img).not.toBeNull();
      expect(img).not.toHaveAttribute('srcset');
      expect(img).toHaveAttribute('src', `https://cdn.example.org/${PHOTO}`);
    });

    it('reports a miss only when the original fails too', () => {
      const { container } = render(<AssetImage path={PHOTO} alt="Rae" sizes="14rem" />);
      fireEvent.error(container.querySelector('img'));
      fireEvent.error(container.querySelector('img'));
      expect(container.querySelector('img')).toBeNull();
      expect(container.textContent).toContain('This file is missing from storage.');
    });

    it('tries the sizes again for a new path', () => {
      const { container, rerender } = render(<AssetImage path={PHOTO} alt="" sizes="14rem" />);
      fireEvent.error(container.querySelector('img'));
      rerender(<AssetImage path="speaker-photos/spk-1/d4e5f6/face.jpg" alt="" sizes="14rem" />);
      expect(container.querySelector('img').getAttribute('srcset')).toContain('d4e5f6');
    });
  });
});
