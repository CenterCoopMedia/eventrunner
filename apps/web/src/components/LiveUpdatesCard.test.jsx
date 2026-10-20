import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

let hookResult;
vi.mock('../hooks/useLiveUpdates.js', () => ({
  useLiveUpdates: () => hookResult,
}));
let eventConfig = {};
vi.mock('../contexts/EventConfigContext.jsx', () => ({
  useEventConfig: () => ({ eventConfig }),
}));

import LiveUpdatesCard from './LiveUpdatesCard.jsx';

describe('LiveUpdatesCard', () => {
  beforeEach(() => {
    eventConfig = {};
  });

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

  it('preserves multiline messages instead of collapsing them to one line (Codex P2)', () => {
    hookResult = {
      loading: false,
      updates: [{ id: 'u1', message: 'Line one\nLine two' }],
    };
    const { container } = render(<LiveUpdatesCard />);
    const messageEl = container.querySelector('li p');
    expect(messageEl).toHaveClass('whitespace-pre-wrap');
    expect(messageEl.textContent).toBe('Line one\nLine two');
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

  it('sets the category and a non-public audience beside the timestamp, in words', () => {
    hookResult = {
      loading: false,
      updates: [
        { id: 'u1', message: 'Green room moved.', category: 'Rooms', audience: 'speakers' },
        { id: 'u2', message: 'Badge desk open.', category: null, audience: 'attendees' },
        { id: 'u3', message: 'Doors open.', category: 'Venue', audience: 'everyone' },
      ],
    };
    render(<LiveUpdatesCard />);
    const [speakers, attendees, everyone] = screen.getAllByRole('listitem');
    expect(speakers).toHaveTextContent('Rooms');
    expect(speakers).toHaveTextContent('For speakers');
    expect(attendees).toHaveTextContent('For attendees');
    expect(everyone).toHaveTextContent('Venue');
    expect(everyone).not.toHaveTextContent(/For /);
  });

  it('draws no tag for a category or an audience it does not know', () => {
    hookResult = {
      loading: false,
      updates: [{ id: 'u1', message: 'Hello', category: '   ', audience: 'constructor' }],
    };
    render(<LiveUpdatesCard />);
    expect(screen.getByRole('listitem').textContent).toBe('Hello');
  });

  describe('key dates (issue 200)', () => {
    const MILESTONES = [
      { label: 'Speaker slides due', date: '2026-11-02' },
      { label: 'Early rate ends', date: '2026-10-20' },
      { label: 'Agenda published', date: '2026-11-02' },
      { label: 'Not a date', date: 'soon' },
    ];

    function keyDateTitles() {
      const section = screen.getByRole('region', { name: 'Key dates' });
      return within(section).getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    }

    it('renders the event milestones in date order, then name order for a tie', () => {
      eventConfig = { timezone: 'America/New_York', milestones: MILESTONES };
      hookResult = { loading: false, updates: [{ id: 'u1', message: 'Doors open.' }] };
      render(<LiveUpdatesCard />);
      expect(keyDateTitles()).toEqual(['Early rate ends', 'Agenda published', 'Speaker slides due']);
      const times = within(screen.getByRole('region', { name: 'Key dates' })).getAllByText(
        (_, el) => el?.tagName === 'TIME',
      );
      expect(times.map((t) => t.getAttribute('datetime'))).toEqual(['2026-10-20', '2026-11-02', '2026-11-02']);
      expect(times[0]).toHaveTextContent('Tuesday, October 20, 2026');
      // The feed stays first, and its own section.
      expect(screen.getByRole('region', { name: 'Live updates' })).toHaveTextContent('Doors open.');
    });

    it('renders the key dates when the feed is empty, with no empty feed heading', () => {
      eventConfig = { timezone: 'America/New_York', milestones: MILESTONES };
      hookResult = { loading: false, updates: [] };
      render(<LiveUpdatesCard />);
      expect(keyDateTitles()).toHaveLength(3);
      expect(screen.queryByRole('heading', { name: 'Live updates' })).toBeNull();
    });

    it('renders the key dates while the feed is still loading', () => {
      eventConfig = { timezone: 'America/New_York', milestones: MILESTONES };
      hookResult = { loading: true, updates: [] };
      render(<LiveUpdatesCard />);
      expect(keyDateTitles()).toHaveLength(3);
    });

    it('renders nothing when the feed and the milestones are both empty', () => {
      eventConfig = { timezone: 'America/New_York', milestones: [] };
      hookResult = { loading: false, updates: [] };
      const { container } = render(<LiveUpdatesCard />);
      expect(container).toBeEmptyDOMElement();
    });

    it('keeps the pinned-first feed order beside the key dates', () => {
      eventConfig = { timezone: 'America/New_York', milestones: MILESTONES };
      hookResult = {
        loading: false,
        updates: [
          { id: 'u1', message: 'Newest, unpinned' },
          { id: 'u2', message: 'Pinned', pinned: true },
        ],
      };
      render(<LiveUpdatesCard />);
      const feed = within(screen.getByRole('region', { name: 'Live updates' })).getAllByRole('listitem');
      expect(feed[0]).toHaveTextContent('Pinned');
      expect(feed[1]).toHaveTextContent('Newest, unpinned');
    });
  });
});
