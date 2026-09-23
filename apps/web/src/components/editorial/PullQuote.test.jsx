// PullQuote: a quotation with a source, drawn through the callout device.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import PullQuote from './PullQuote.jsx';
import { renderInEveryStyle } from '../../test/everyStyle.jsx';

const LINE = 'Bring one task your team could share and one it must keep.';

describe('PullQuote', () => {
  it('is a figure holding a blockquote and its attribution as the caption', () => {
    const { container } = render(<PullQuote attribution="Marisol Reyes, opening talk">{LINE}</PullQuote>);
    const figure = container.querySelector('figure.pull-quote');
    expect(figure).not.toBeNull();
    expect(figure.querySelector('blockquote').textContent).toContain(LINE);
    expect(figure.querySelector('figcaption').textContent).toBe('Marisol Reyes, opening talk');
  });

  it('renders the sentence through the callout, which gives that device its call site', () => {
    const { container } = render(<PullQuote>{LINE}</PullQuote>);
    expect(container.querySelector('blockquote > .callout').textContent).toBe(LINE);
  });

  it('puts the attribution below the quote, never above it', () => {
    const { container } = render(<PullQuote attribution="A speaker">{LINE}</PullQuote>);
    const figure = container.querySelector('figure');
    const children = [...figure.children].map((child) => child.tagName);
    expect(children.indexOf('BLOCKQUOTE')).toBeLessThan(children.indexOf('FIGCAPTION'));
  });

  it('hides the drawn opening mark from assistive technology', () => {
    const { container } = render(<PullQuote>{LINE}</PullQuote>);
    const mark = container.querySelector('.pull-quote__mark');
    expect(mark).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText(LINE)).toBeInTheDocument();
  });

  it('draws no caption when there is no attribution, and nothing for an empty quote', () => {
    const { container, rerender } = render(<PullQuote>{LINE}</PullQuote>);
    expect(container.querySelector('figcaption')).toBeNull();
    rerender(<PullQuote attribution="Someone">{''}</PullQuote>);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders in every style and both modes', () => {
    renderInEveryStyle(<PullQuote attribution="A speaker">{LINE}</PullQuote>, (container, pair) => {
      expect(container.querySelector('.pull-quote .callout'), `${pair.style} ${pair.mode}`).not.toBeNull();
    });
  });
});
