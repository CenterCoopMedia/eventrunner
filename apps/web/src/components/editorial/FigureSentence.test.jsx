// FigureSentence: figures in a sentence, in place of a tile.
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import FigureSentence, { SentenceFigure } from './FigureSentence.jsx';
import { renderInEveryStyle } from '../../test/everyStyle.jsx';

const sentence = (
  <FigureSentence>
    <SentenceFigure>412</SentenceFigure> registered, <SentenceFigure>38</SentenceFigure> in the last
    day, read at <SentenceFigure>09:14</SentenceFigure>.
  </FigureSentence>
);

describe('FigureSentence', () => {
  it('reads as one sentence with its figures marked', () => {
    const { container } = render(sentence);
    expect(container.textContent).toBe('412 registered, 38 in the last day, read at 09:14.');
    const figures = [...container.querySelectorAll('[data-numeric]')].map((node) => node.textContent);
    expect(figures).toEqual(['412', '38', '09:14']);
  });

  it('is a paragraph by default and never a tile', () => {
    const { container } = render(sentence);
    expect(container.firstChild.tagName).toBe('P');
    expect(container.firstChild).toHaveClass('figure-sentence');
    expect(container.firstChild.className).not.toMatch(/rounded|border|shadow/u);
  });

  it('can be an inline span inside another line', () => {
    const { container } = render(
      <FigureSentence as="span">
        <SentenceFigure>3</SentenceFigure> saved
      </FigureSentence>,
    );
    expect(container.firstChild.tagName).toBe('SPAN');
  });

  it('renders nothing for an empty sentence', () => {
    const { container } = render(<FigureSentence>{''}</FigureSentence>);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders in every style and both modes', () => {
    renderInEveryStyle(sentence, (container, pair) => {
      expect(container.querySelectorAll('.figure-sentence__figure'), `${pair.style} ${pair.mode}`).toHaveLength(3);
    });
  });
});
