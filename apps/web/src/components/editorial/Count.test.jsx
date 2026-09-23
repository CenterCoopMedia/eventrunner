// Count: a figure in tabular numerals with its label always beside it.
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import Count from './Count.jsx';
import { renderInEveryStyle } from '../../test/everyStyle.jsx';

describe('Count', () => {
  it('sets the figure in tabular figures with the label beside it', () => {
    const { container } = render(<Count value={12} label="saved" />);
    expect(container.textContent).toBe('12 saved');
    const figure = container.querySelector('[data-numeric]');
    expect(figure).toHaveClass('count__figure');
    expect(container.querySelector('.count__label').textContent).toBe('saved');
  });

  it('is never a bubble: no radius, no ground, no colour of its own', () => {
    const { container } = render(<Count value={12} label="saved" />);
    expect(container.firstChild.className).not.toMatch(/rounded|bg-/u);
  });

  it('draws nothing without a label, because a number is not self-describing', () => {
    const { container } = render(<Count value={12} label="" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('draws a zero when handed one; the caller decides whether to ask', () => {
    const { container } = render(<Count value={0} label="sessions" />);
    expect(container.textContent).toBe('0 sessions');
  });

  it('renders in every style and both modes', () => {
    renderInEveryStyle(<Count value={3} label="saved" />, (container, pair) => {
      expect(container.querySelector('.count')?.textContent, `${pair.style} ${pair.mode}`).toBe('3 saved');
    });
  });
});
