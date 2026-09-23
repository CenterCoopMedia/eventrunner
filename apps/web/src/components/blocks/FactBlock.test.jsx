// FactBlock renders a non-numeric fact as a term and a description (#234).
//
// The block carries no evidence fields, and the renderer asks for none: a
// venue name has no source line. The stat block's contract is untouched.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import FactBlock, { factDraws } from './FactBlock.jsx';
import { renderInEveryStyle } from '../../test/everyStyle.jsx';

/** The <dt> that carries a term. A dt takes no accessible name from its text in jsdom. */
const termNamed = (term) =>
  [...document.querySelectorAll('dt')].find((node) => node.textContent === term) ?? null;

const WHERE = {
  blockType: 'fact',
  label: 'Where',
  value: 'Harborlight Hall',
  note: '12 Quay Street, Portsmouth',
};

describe('FactBlock', () => {
  it('renders the term and the description as a definition pair', () => {
    render(
      <dl>
        <FactBlock block={WHERE} />
      </dl>,
    );
    expect(termNamed('Where')).toBeInTheDocument();
    expect(screen.getByText('Harborlight Hall').tagName).toBe('DD');
  });

  it('renders the optional note under the description, and nothing when there is none', () => {
    const { container, rerender } = render(
      <dl>
        <FactBlock block={WHERE} />
      </dl>,
    );
    expect(container.querySelectorAll('dd')).toHaveLength(2);
    rerender(
      <dl>
        <FactBlock block={{ ...WHERE, note: '' }} />
      </dl>,
    );
    expect(container.querySelectorAll('dd')).toHaveLength(1);
  });

  it('asks for no evidence fields', () => {
    // A stat with these fields renders a source line; a fact ignores them.
    const { container } = render(
      <dl>
        <FactBlock block={{ ...WHERE, source: 'Read yesterday', takeaway: 'Not shown' }} />
      </dl>,
    );
    expect(container.textContent).not.toContain('Read yesterday');
    expect(container.textContent).not.toContain('Not shown');
  });

  it('renders nothing when either half is missing', () => {
    const { container } = render(
      <dl>
        <FactBlock block={{ blockType: 'fact', label: 'Where', value: '  ' }} />
        <FactBlock block={{ blockType: 'fact', value: 'Harborlight Hall' }} />
      </dl>,
    );
    expect(container.querySelector('dl')).toBeEmptyDOMElement();
    expect(factDraws(WHERE)).toBe(true);
    expect(factDraws({ label: 'Where' })).toBe(false);
  });

  it('renders in every style and both modes', () => {
    renderInEveryStyle(
      <dl>
        <FactBlock block={WHERE} />
      </dl>,
      (container, pair) => {
        expect(container.querySelector('dt')?.textContent, `${pair.style} ${pair.mode}`).toBe('Where');
      },
    );
  });
});
