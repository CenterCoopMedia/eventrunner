import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

let hookResult;
vi.mock('../hooks/useLiveUpdates.js', () => ({
  useLiveUpdates: () => hookResult,
}));

import LiveUpdatesCard from './LiveUpdatesCard.jsx';

describe('LiveUpdatesCard', () => {
  it('renders nothing while loading', () => {
    hookResult = { updates: [], loading: true };
    const { container } = render(<LiveUpdatesCard />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing once loaded with no updates', () => {
    hookResult = { updates: [], loading: false };
    const { container } = render(<LiveUpdatesCard />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders every update message', () => {
    hookResult = {
      loading: false,
      updates: [
        { id: 'u1', message: 'Doors open at 9am.', postedAt: new Date('2026-08-21T13:00:00Z') },
        { id: 'u2', message: 'Shuttle delayed 10 minutes.', pinned: true },
      ],
    };
    render(<LiveUpdatesCard />);
    expect(screen.getByText('Doors open at 9am.')).toBeInTheDocument();
    expect(screen.getByText('Shuttle delayed 10 minutes.')).toBeInTheDocument();
    expect(screen.getByText('Pinned')).toBeInTheDocument();
  });

  it('sorts pinned entries ahead of unpinned ones', () => {
    hookResult = {
      loading: false,
      updates: [
        { id: 'u1', message: 'First (unpinned, newest)' },
        { id: 'u2', message: 'Second (pinned)', pinned: true },
      ],
    };
    render(<LiveUpdatesCard />);
    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(items[0]).toContain('Second (pinned)');
    expect(items[1]).toContain('First (unpinned, newest)');
  });
});
