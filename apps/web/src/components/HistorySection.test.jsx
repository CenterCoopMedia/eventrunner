// The home page's History section (issue #194): the operator's blocks, then
// the past editions from the Timeline list, and nothing at all when there
// is neither.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

let timeline;
vi.mock('../contexts/ContentContext.jsx', () => ({
  useContent: () => ({ timeline }),
}));

import HistorySection from './HistorySection.jsx';

const STORY = { section: 'history', field: 'story', blockType: 'richtext', value: '<p>How the event began.</p>' };
// As ContentContext serves them: prepared, oldest first.
const EDITIONS = [
  { id: 'a', year: 2024, title: 'The first meeting', description: null, visible: true },
  { id: 'b', year: 2025, title: 'Two tracks', description: 'The second edition.', visible: true },
];

function draw(blocks) {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <HistorySection id="section-history" title="History" blocks={blocks} arrangement="grid" />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  timeline = [];
});

describe('HistorySection', () => {
  it('draws the section’s own blocks under its heading when there is no entry', () => {
    draw([STORY]);
    const section = screen.getByRole('region', { name: 'History' });
    expect(within(section).getByText('How the event began.')).toBeInTheDocument();
    expect(section.querySelector('ol')).toBeNull();
  });

  it('draws the entries under its heading when the section holds no block', () => {
    timeline = EDITIONS;
    draw([]);
    const section = screen.getByRole('region', { name: 'History' });
    const titles = within(section).getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(titles).toEqual(['The first meeting', 'Two tracks']);
    // The description is plain text; a missing one draws no empty paragraph.
    expect(within(section).getByText('The second edition.').tagName).toBe('P');
    const first = section.querySelectorAll('li')[0];
    expect(first.querySelectorAll('p')).toHaveLength(1);
  });

  it('draws the blocks first and the list after them', () => {
    timeline = EDITIONS;
    draw([STORY]);
    const section = screen.getByRole('region', { name: 'History' });
    const story = within(section).getByText('How the event began.');
    const list = section.querySelector('ol');
    expect(story.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('draws nothing, not even a heading, with no block and no entry', () => {
    const { container } = draw([]);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('heading', { name: 'History' })).toBeNull();
  });

});
