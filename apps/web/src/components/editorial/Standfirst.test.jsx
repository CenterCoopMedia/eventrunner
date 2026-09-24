// Standfirst: one sentence under a heading, at the measure.
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import Standfirst from './Standfirst.jsx';
import { renderInEveryStyle } from '../../test/everyStyle.jsx';

describe('Standfirst', () => {
  it('is a paragraph at the measure that reads the contract class', () => {
    const { container } = render(<Standfirst>Three days for local newsrooms.</Standfirst>);
    expect(container.firstChild.tagName).toBe('P');
    expect(container.firstChild).toHaveClass('standfirst', 'max-w-prose');
  });

  it('sits under the heading it explains, never above it', () => {
    const { container } = render(
      <div>
        <h1>Programme</h1>
        <Standfirst>What runs when.</Standfirst>
      </div>,
    );
    const standfirst = container.querySelector('.standfirst');
    expect(standfirst.previousElementSibling.tagName).toBe('H1');
  });

  it('renders nothing for an empty sentence', () => {
    const { container } = render(<Standfirst>{''}</Standfirst>);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders in every style and both modes', () => {
    renderInEveryStyle(<Standfirst>Three days for local newsrooms.</Standfirst>, (container, pair) => {
      expect(container.querySelector('.standfirst'), `${pair.style} ${pair.mode}`).not.toBeNull();
    });
  });
});
