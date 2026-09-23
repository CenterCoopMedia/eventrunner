// DefinitionList: a real <dl>, ruled between pairs (expansion record §3.1).
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import DefinitionList, { DefinitionPair } from './DefinitionList.jsx';
import { renderInEveryStyle } from '../../test/everyStyle.jsx';

/** The <dt> that carries a term. A dt takes no accessible name from its text in jsdom. */
const termNamed = (term) =>
  [...document.querySelectorAll('dt')].find((node) => node.textContent === term) ?? null;

const ITEMS = [
  { term: 'Where', description: 'Test Hall', note: '1 Test Way' },
  { term: 'Format', description: 'Workshops and panels' },
];

describe('DefinitionList', () => {
  it('renders a real <dl> with one term and one description per pair', () => {
    const { container } = render(<DefinitionList items={ITEMS} />);
    const list = container.querySelector('dl');
    expect(list).not.toBeNull();
    expect(list.querySelectorAll('dt')).toHaveLength(2);
    expect(termNamed('Where')).toBeInTheDocument();
    expect(screen.getByText('Test Hall').tagName).toBe('DD');
  });

  it('puts the note under the description as a second dd', () => {
    const { container } = render(<DefinitionList items={ITEMS} />);
    const first = container.querySelector('.definition-list__pair');
    expect(first.querySelectorAll('dd')).toHaveLength(2);
    expect(first.querySelectorAll('dd')[1].textContent).toBe('1 Test Way');
  });

  it('builds every pair out of the elements a dl allows', () => {
    const { container } = render(<DefinitionList items={ITEMS} />);
    for (const child of container.querySelector('dl').children) {
      expect(child.tagName).toBe('DIV');
      for (const inner of child.children) expect(['DT', 'DD']).toContain(inner.tagName);
    }
  });

  it('drops a pair missing either half rather than drawing a hole', () => {
    const { container } = render(
      <DefinitionList items={[{ term: 'Where', description: '  ' }, { term: '', description: 'x' }]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('draws the rule through the contract class, never a card', () => {
    render(<DefinitionList items={ITEMS} />);
    const pair = termNamed('Where').parentElement;
    expect(pair).toHaveClass('definition-list__pair');
    expect(pair.className).not.toMatch(/rounded|shadow/u);
  });

  it('renders in every style and both modes', () => {
    renderInEveryStyle(<DefinitionList items={ITEMS} />, (container, pair) => {
      expect(container.querySelectorAll('dt'), `${pair.style} ${pair.mode}`).toHaveLength(2);
    });
  });

  it('exports the pair for a caller that holds its own dl', () => {
    const { container } = render(
      <dl>
        <DefinitionPair term="Room">Main hall</DefinitionPair>
      </dl>,
    );
    expect(container.querySelector('dl > div > dt').textContent).toBe('Room');
  });
});
