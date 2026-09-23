// Legend: one line at the head of a list that names what a mark means.
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import Legend from './Legend.jsx';
import { renderInEveryStyle } from '../../test/everyStyle.jsx';

const ITEMS = [
  { term: 'Saved', meaning: 'how many attendees bookmarked a session' },
  { term: 'Now', meaning: 'a session running at this minute.' },
];

describe('Legend', () => {
  it('states each mark as one sentence, in one line', () => {
    const { container } = render(<Legend items={ITEMS} />);
    expect(container.firstChild.tagName).toBe('P');
    expect(container.textContent).toBe(
      '“Saved” is how many attendees bookmarked a session. “Now” is a session running at this minute.',
    );
  });

  it('reads the contract class and nothing that boxes it', () => {
    const { container } = render(<Legend items={ITEMS} />);
    expect(container.firstChild).toHaveClass('legend');
    expect(container.firstChild.className).not.toMatch(/rounded|bg-/u);
  });

  it('drops an item missing its term or its meaning, and draws nothing for none', () => {
    const { container } = render(<Legend items={[{ term: 'Saved', meaning: '' }, { term: '', meaning: 'x' }]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders in every style and both modes', () => {
    renderInEveryStyle(<Legend items={ITEMS} />, (container, pair) => {
      expect(container.querySelectorAll('.legend__term'), `${pair.style} ${pair.mode}`).toHaveLength(2);
    });
  });
});
