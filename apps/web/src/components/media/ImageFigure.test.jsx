import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ImageBlock from '../blocks/ImageBlock.jsx';

const block = { url: '/test-image.webp', alt: 'A station entrance', caption: 'The entrance on Oak Street' };

describe('image captions', () => {
  it('keeps the existing image and caption when a placement has no settings', () => {
    const { rerender } = render(<ImageBlock block={block} />);
    expect(screen.getByRole('figure').querySelector('figcaption')).toHaveTextContent(block.caption);
    expect(screen.getByRole('img')).toHaveAttribute('alt', block.alt);
    rerender(<ImageBlock block={{ ...block, caption: undefined }} />);
    expect(screen.queryByRole('figure')).not.toBeInTheDocument();
    expect(screen.getByRole('img')).toBeInTheDocument();
  });

  it('hides the caption while retaining the image and its alt text', () => {
    render(<ImageBlock block={{ ...block, captionMode: 'hidden' }} />);
    expect(screen.queryByText(block.caption)).not.toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAttribute('alt', block.alt);
  });

  it.each([
    ['below', 'left'],
    ['overlay', 'center'],
    ['hover', 'right'],
  ])('renders the %s caption with %s alignment', async (captionMode, captionAlign) => {
    render(<ImageBlock block={{ ...block, captionMode, captionAlign, size: 'small', alignment: 'right' }} />);
    const figure = await waitFor(() => {
      const rendered = screen.getByRole('figure');
      expect(rendered).toHaveAttribute('data-caption-align', captionAlign);
      return rendered;
    });
    expect(figure.querySelector('figcaption')).toHaveTextContent(block.caption);
    expect(figure.style.maxWidth).toBe('min(100%, 320px)');
    expect(figure).toHaveClass('ml-auto');
    if (captionMode === 'below') {
      expect(figure).not.toHaveClass('image-figure--overlay');
      expect(figure).not.toHaveClass('image-figure--hover');
    } else {
      expect(figure).toHaveClass(`image-figure--${captionMode}`);
    }
    if (captionMode === 'hover') expect(figure).toHaveAttribute('tabindex', '0');
    else expect(figure).not.toHaveAttribute('tabindex');
  });
});
