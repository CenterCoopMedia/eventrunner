// QuoteBlock renders a quoted sentence through the pull quote device.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import QuoteBlock from './QuoteBlock.jsx';

const QUOTE = {
  blockType: 'quote',
  text: 'Decide who checks sources before the deadline decides for you.',
  attribution: 'Lucia Bennett, workshop lead',
};

describe('QuoteBlock', () => {
  it('renders the sentence and its attribution as a pull quote', () => {
    const { container } = render(<QuoteBlock block={QUOTE} />);
    expect(container.querySelector('figure.pull-quote')).not.toBeNull();
    expect(screen.getByText(QUOTE.text)).toBeInTheDocument();
    expect(screen.getByText(QUOTE.attribution).tagName).toBe('FIGCAPTION');
  });

  it('renders the sentence alone when nobody is credited', () => {
    const { container } = render(<QuoteBlock block={{ ...QUOTE, attribution: '' }} />);
    expect(container.querySelector('figcaption')).toBeNull();
    expect(screen.getByText(QUOTE.text)).toBeInTheDocument();
  });

  it('renders nothing for a quote with no sentence', () => {
    const { container } = render(<QuoteBlock block={{ blockType: 'quote', text: '  ' }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
