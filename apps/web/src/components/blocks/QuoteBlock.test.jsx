// QuoteBlock renders a quoted sentence through the pull quote device.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import QuoteBlock from './QuoteBlock.jsx';
import { PullQuoteBudget } from './pullQuoteBudget.jsx';

const QUOTE = {
  blockType: 'quote',
  text: 'Decide who checks sources before the deadline decides for you.',
  attribution: 'Lucia Bennett, workshop lead',
};

describe('QuoteBlock', () => {
  it('renders the sentence and its attribution as a pull quote', () => {
    const { container } = render(<QuoteBlock block={QUOTE} />);
    expect(container.querySelector('figure.pull-quote')).not.toBeNull();
    expect(screen.getByText(QUOTE.text, { exact: false })).toBeInTheDocument();
    expect(screen.getByText(QUOTE.attribution).tagName).toBe('FIGCAPTION');
  });

  it('renders the sentence alone when nobody is credited', () => {
    const { container } = render(<QuoteBlock block={{ ...QUOTE, attribution: '' }} />);
    expect(container.querySelector('figcaption')).toBeNull();
    expect(screen.getByText(QUOTE.text, { exact: false })).toBeInTheDocument();
  });

  it('renders nothing for a quote with no sentence', () => {
    const { container } = render(<QuoteBlock block={{ blockType: 'quote', text: '  ' }} />);
    expect(container).toBeEmptyDOMElement();
  });

  // One pull quote per page at most (expansion record §3.1), enforced by the
  // page's budget rather than stated in a comment.
  it('sets the first quote on a page as the pull quote and any later one as a plain quotation', () => {
    const first = { ...QUOTE, id: 'details__quote', section: 'details', field: 'quote' };
    const second = {
      ...QUOTE,
      id: 'history__quote',
      section: 'history',
      field: 'quote',
      text: 'Every edition kept the sessions short.',
      attribution: 'A past attendee',
    };
    const blocks = { details: [first], history: [second] };
    const { container } = render(
      <PullQuoteBudget
        sections={[{ id: 'details' }, { id: 'history' }]}
        getSectionBlocks={(id) => blocks[id] ?? []}
      >
        <QuoteBlock block={first} />
        <QuoteBlock block={second} />
      </PullQuoteBudget>,
    );
    expect(container.querySelectorAll('figure.pull-quote')).toHaveLength(1);
    expect(container.querySelector('figure.pull-quote').textContent).toContain(QUOTE.text);
    // The second keeps its words and its attribution, in the body register.
    const plain = container.querySelector('figure.quote-plain');
    expect(plain).not.toBeNull();
    expect(plain.querySelector('blockquote').textContent).toBe('“Every edition kept the sessions short.”');
    expect(plain.querySelector('figcaption').textContent).toBe('A past attendee');
    expect(plain.querySelector('.callout')).toBeNull();
  });

  it('gives the pull quote to the first quote with a sentence, skipping an empty one', () => {
    const empty = { blockType: 'quote', id: 'details__quote', section: 'details', field: 'quote', text: '  ' };
    const spoken = { ...QUOTE, id: 'history__quote', section: 'history', field: 'quote' };
    const blocks = { details: [empty], history: [spoken] };
    const { container } = render(
      <PullQuoteBudget sections={[{ id: 'details' }, { id: 'history' }]} getSectionBlocks={(id) => blocks[id] ?? []}>
        <QuoteBlock block={empty} />
        <QuoteBlock block={spoken} />
      </PullQuoteBudget>,
    );
    expect(container.querySelectorAll('figure.pull-quote')).toHaveLength(1);
    expect(container.querySelector('figure.quote-plain')).toBeNull();
  });
});
