// LongReadOpening: marks the first block of a long read, and nothing else.
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import LongReadOpening from './LongReadOpening.jsx';
import { renderInEveryStyle } from '../../test/everyStyle.jsx';

const body = (
  <div>
    <div className="rich-text">
      <p>Once, a summit began with a sentence.</p>
      <p>Then it went on.</p>
    </div>
  </div>
);

describe('LongReadOpening', () => {
  it('wraps the opening in the contract class when active', () => {
    const { container } = render(<LongReadOpening active>{body}</LongReadOpening>);
    expect(container.firstChild).toHaveClass('long-read-opening');
    expect(container.querySelector('.long-read-opening .rich-text:first-child > p:first-child').textContent).toBe(
      'Once, a summit began with a sentence.',
    );
  });

  it('adds nothing to the document when it is not the opening', () => {
    const { container } = render(<LongReadOpening>{body}</LongReadOpening>);
    expect(container.querySelector('.long-read-opening')).toBeNull();
    expect(container.querySelector('.rich-text')).not.toBeNull();
  });

  it('renders in every style and both modes', () => {
    renderInEveryStyle(<LongReadOpening active>{body}</LongReadOpening>, (container, pair) => {
      expect(container.querySelector('.long-read-opening'), `${pair.style} ${pair.mode}`).not.toBeNull();
    });
  });
});
