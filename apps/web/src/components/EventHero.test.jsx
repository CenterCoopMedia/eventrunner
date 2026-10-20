// The event hero's artwork (issue #333). A picture picked from the media
// library is a Storage path: it resolves to the bucket and offers the
// display sizes the function wrote. Alt text and focal point stay.
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import EventHero from './EventHero.jsx';

const IMAGE = {
  blockType: 'image',
  url: 'cms-images/a1b2c3/hall.jpg',
  alt: 'The hall before doors open',
  focalX: 10,
  focalY: 90,
};

describe('EventHero artwork', () => {
  it('resolves a picked path to the bucket and offers the sizes', () => {
    render(<EventHero name="Summit" image={IMAGE} />);
    const img = screen.getByAltText(IMAGE.alt);
    expect(img.getAttribute('src')).toContain('firebasestorage.googleapis.com');
    expect(img.getAttribute('srcset')).toContain(encodeURIComponent('cms-images/a1b2c3/_sizes/1920.webp'));
    expect(img).toHaveAttribute('sizes', '100vw');
    expect(img).toHaveAttribute('fetchpriority', 'high');
    expect(img).toHaveStyle({ objectPosition: '10% 90%' });
  });

  it('falls back to the original when a size fails to load', () => {
    render(<EventHero name="Summit" image={IMAGE} />);
    fireEvent.error(screen.getByAltText(IMAGE.alt));
    expect(screen.getByAltText(IMAGE.alt)).not.toHaveAttribute('srcset');
  });

  it('keeps a site path as it was, with no sizes', () => {
    render(<EventHero name="Summit" image={{ ...IMAGE, url: '/hero/newsroom.webp' }} />);
    const img = screen.getByAltText(IMAGE.alt);
    expect(img).toHaveAttribute('src', '/hero/newsroom.webp');
    expect(img).not.toHaveAttribute('srcset');
  });

  it('draws no artwork without alt text', () => {
    const { container } = render(<EventHero name="Summit" image={{ ...IMAGE, alt: ' ' }} />);
    expect(container.querySelector('img')).toBeNull();
  });
});
