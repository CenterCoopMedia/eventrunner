// GalleryBlock (#1176): one block, three fixed layouts. The carousel and the
// slideshow follow the WAI-ARIA carousel pattern; the grid is a plain list.
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import GalleryBlock from './GalleryBlock.jsx';

const IMAGES = [
  { url: 'cms-images/a1/hall.webp', alt: 'The main hall before the keynote' },
  { url: 'cms-images/a2/panel.webp', alt: 'A panel of four editors' },
  { url: 'cms-images/a3/lunch.webp', alt: 'Attendees at lunch' },
];

const gallery = (fields = {}) => ({ blockType: 'gallery', layout: 'grid', images: IMAGES, ...fields });

describe('GalleryBlock', () => {
  it('draws a grid as a named list of every picture, each with its alt text', () => {
    render(<GalleryBlock block={gallery({ label: 'Last year' })} />);
    const region = screen.getByRole('region', { name: 'Last year' });
    const items = within(region).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    // Hidden until the size manifest answers, so query the elements.
    const pictures = [...region.querySelectorAll('img')];
    expect(pictures.map((img) => img.getAttribute('alt'))).toEqual(IMAGES.map((image) => image.alt));
    for (const img of pictures) expect(img).toHaveAttribute('loading', 'lazy');
    expect(within(region).queryByRole('button')).toBeNull();
  });

  it.each(['carousel', 'slideshow'])('draws a %s as a labelled carousel with slides named n of m', (layout) => {
    render(<GalleryBlock block={gallery({ layout })} />);
    const region = screen.getByRole('region', { name: 'Photo gallery' });
    expect(region).toHaveAttribute('aria-roledescription', 'carousel');
    const slides = within(region).getAllByRole('group').filter((group) => group.getAttribute('aria-roledescription') === 'slide');
    expect(slides.map((slide) => slide.getAttribute('aria-label'))).toEqual(['1 of 3', '2 of 3', '3 of 3']);
    const previous = within(region).getByRole('button', { name: 'Previous photo' });
    const next = within(region).getByRole('button', { name: 'Next photo' });
    const scroller = document.getElementById(next.getAttribute('aria-controls'));
    expect(scroller).not.toBeNull();
    expect(scroller).toHaveAttribute('tabindex', '0');
    expect(previous).toHaveAttribute('aria-disabled', 'true');
    expect(within(region).getByText('1 of 3')).toHaveAttribute('aria-live', 'polite');
  });

  it('never moves on its own: no timer, no pause control', () => {
    render(<GalleryBlock block={gallery({ layout: 'slideshow' })} />);
    expect(screen.queryByRole('button', { name: /pause|play|stop/i })).toBeNull();
  });

  it('keeps a focused Previous button focusable at the first slide and refuses the move', () => {
    render(<GalleryBlock block={gallery({ layout: 'carousel' })} />);
    const previous = screen.getByRole('button', { name: 'Previous photo' });
    previous.focus();
    fireEvent.click(previous);
    expect(previous).not.toBeDisabled();
    expect(document.activeElement).toBe(previous);
    expect(screen.getByText('1 of 3')).toBeInTheDocument();
  });

  it('draws an unknown layout as a grid', () => {
    render(<GalleryBlock block={gallery({ layout: 'masonry' })} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('leaves out pictures with no alt text or an unsafe address, and draws nothing when none are left', () => {
    const { container, rerender } = render(
      <GalleryBlock block={gallery({ images: [{ url: 'cms-images/a1/x.webp', alt: ' ' }, { url: 'javascript:alert(1)', alt: 'x' }, IMAGES[0]] })} />,
    );
    expect(container.querySelectorAll('img')).toHaveLength(1);
    rerender(<GalleryBlock block={gallery({ images: [{ url: 'cms-images/a1/x.webp', alt: '' }] })} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<GalleryBlock block={gallery({ images: 'not a list' })} />);
    expect(container).toBeEmptyDOMElement();
  });
});
