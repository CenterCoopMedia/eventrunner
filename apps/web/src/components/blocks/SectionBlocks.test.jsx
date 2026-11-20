// Section layout (issue #1153): two columns split the section's blocks in
// reading order, the first half on the left and the rest on the right.
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import SectionBlocks from './SectionBlocks.jsx';

const text = (value) => ({ blockType: 'text', value });

function columnTexts(container) {
  const grid = container.querySelector('.section-blocks--columns');
  return [...grid.children].map((column) => column.textContent);
}

describe('SectionBlocks layout', () => {
  it('puts the first half on the left and the rest on the right', () => {
    const { container } = render(
      <SectionBlocks layout="columns" blocks={[text('One'), text('Two'), text('Three')]} />,
    );
    expect(columnTexts(container)).toEqual(['OneTwo', 'Three']);
  });

  it('counts blocks one by one, so four questions split two and two', () => {
    const faq = (n) => ({ id: `q${n}`, blockType: 'faq_item', question: `Question ${n}?`, answer: `<p>Answer ${n}.</p>` });
    const { container } = render(<SectionBlocks layout="columns" blocks={[faq(1), faq(2), faq(3), faq(4)]} />);
    const [left, right] = columnTexts(container);
    expect(left).toContain('Question 1?');
    expect(left).toContain('Question 2?');
    expect(right).toContain('Question 3?');
    expect(right).toContain('Question 4?');
    expect(left).not.toContain('Question 3?');
  });

  it('keeps the long read opening on the first block only', () => {
    const rich = (n) => ({ id: `r${n}`, blockType: 'richtext', value: `<p>Paragraph ${n}.</p>` });
    const { container } = render(
      <div className="long-read-opening"><SectionBlocks layout="columns" blocks={[rich(1), rich(2)]} /></div>,
    );
    // The selector index.css gives the opening.
    const opening = container.querySelectorAll('.long-read-opening .rich-text:first-child:not(.section-blocks__rest > *) > p:first-child');
    expect([...opening].map((p) => p.textContent)).toEqual(['Paragraph 1.']);
  });

  it('keeps a single block in one column', () => {
    const { container } = render(<SectionBlocks layout="columns" blocks={[text('Only')]} />);
    expect(columnTexts(container)).toEqual(['Only']);
  });

  it('draws the reading width with no layout class when no layout is given', () => {
    const { container } = render(<SectionBlocks blocks={[text('One')]} />);
    expect(container.querySelector('.section-blocks')).toBeNull();
    expect(container.textContent).toBe('One');
  });
});
