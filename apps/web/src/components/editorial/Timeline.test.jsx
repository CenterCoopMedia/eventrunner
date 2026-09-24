// Timeline: an ordered list on a spine, dated by real dates and never by a
// sequence ornament.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Timeline from './Timeline.jsx';
import { renderInEveryStyle } from '../../test/everyStyle.jsx';

const EDITIONS = [
  { id: 'e3', title: 'Third edition', date: '2025-10-15', dateLabel: '2025', body: 'Two tracks, one clinic.' },
  { id: 'e2', title: 'Second edition', date: '2024-10-16', dateLabel: '2024', href: '/recap' },
  { id: 'e1', title: 'First edition', date: '2023-10-18', dateLabel: '2023' },
];

const inRouter = (node) => render(<MemoryRouter>{node}</MemoryRouter>);

describe('Timeline', () => {
  it('is an ordered list with one entry per item', () => {
    const { container } = inRouter(<Timeline entries={EDITIONS} />);
    const list = container.querySelector('ol.timeline');
    expect(list).not.toBeNull();
    expect(list.querySelectorAll('li.timeline__entry')).toHaveLength(3);
  });

  it('dates an entry with a real time element beside its title, never above it', () => {
    const { container } = inRouter(<Timeline entries={EDITIONS} />);
    const first = container.querySelector('.timeline__entry');
    const heading = first.querySelector('h3');
    const time = first.querySelector('time');
    expect(time).toHaveAttribute('dateTime', '2025-10-15');
    expect(time.textContent).toBe('2025');
    // The heading is the first element in its row; the date follows it.
    expect(heading.parentElement.firstElementChild).toBe(heading);
    expect(heading.compareDocumentPosition(time) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('draws no counter and no zero-padded number', () => {
    const { container } = inRouter(<Timeline entries={EDITIONS} />);
    expect(container.textContent).not.toMatch(/\b0\d\b/u);
    expect(container.querySelector('ol')).toHaveClass('timeline');
    expect(container.querySelector('ol').getAttribute('style')).toBeNull();
  });

  it('links a title that has somewhere to go, and leaves the rest as text', () => {
    inRouter(<Timeline entries={EDITIONS} />);
    expect(screen.getByRole('link', { name: 'Second edition' })).toHaveAttribute('href', '/recap');
    expect(screen.queryByRole('link', { name: 'Third edition' })).toBeNull();
  });

  it('takes the heading level the outline needs', () => {
    const { container } = inRouter(<Timeline entries={EDITIONS} level={2} />);
    expect(container.querySelectorAll('h2')).toHaveLength(3);
  });

  it('renders nothing for an empty list', () => {
    const { container } = inRouter(<Timeline entries={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders in every style and both modes', () => {
    renderInEveryStyle(<Timeline entries={EDITIONS} />, (container, pair) => {
      expect(container.querySelectorAll('.timeline__entry'), `${pair.style} ${pair.mode}`).toHaveLength(3);
    });
  });
});
