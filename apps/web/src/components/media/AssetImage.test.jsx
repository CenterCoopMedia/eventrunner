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

vi.mock('../../lib/mediaSource.js', () => ({
  assetUrl: (path) => (typeof path === 'string' && path ? `https://cdn.example.org/${path}` : null),
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
});
