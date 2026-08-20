// SchedulePage — grouping/sorting, event-timezone rendering, feature gate,
// keyboard day switching (issue #16 first slice). Fixture providers only:
// no Firebase, no network (spec §8.1 credential-free CI). The fixture event
// is fictional and distinct from the committed snapshot so nothing here
// accidentally passes by matching demo copy.
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import EventConfigContext from '../contexts/EventConfigContext.jsx';
import ContentContext from '../contexts/ContentContext.jsx';
import Schedule from './Schedule.jsx';
import { zonedDateTime } from '../lib/eventTime.js';

// Non-UTC zone on purpose: America/Chicago is UTC−5 (CDT) on the fixture
// dates, so a renderer that ignored config.timezone would be caught.
const fixtureConfig = {
  name: '[Fixture] Lakeshore Docs Camp',
  timezone: 'America/Chicago',
  days: [
    { id: 'fx-day-1', label: 'Day one', date: '2026-10-15' },
    { id: 'fx-day-2', label: 'Day two', date: '2026-10-16' },
  ],
};

const fixtureSessions = [
  // Deliberately listed out of start-time order, with `order` disagreeing
  // with the clock — start time must win the sort.
  {
    id: 'fx-late',
    dayId: 'fx-day-1',
    startTime: '13:30',
    endTime: '14:15',
    title: '[Fixture] Afternoon editing lab',
    description: null,
    location: 'Room B',
    type: 'workshop',
    speakerIds: [],
    visible: true,
    order: 0,
  },
  {
    id: 'fx-early',
    dayId: 'fx-day-1',
    startTime: '09:05',
    endTime: '09:45',
    title: '[Fixture] Morning kickoff',
    description: '[Fixture] What the day covers.',
    location: 'Main hall',
    type: 'keynote',
    speakerIds: ['fx-speaker-1'],
    visible: true,
    order: 5,
  },
  {
    id: 'fx-hidden',
    dayId: 'fx-day-1',
    startTime: '11:00',
    endTime: '11:30',
    title: '[Fixture] Unpublished session',
    location: 'Room C',
    type: 'panel',
    speakerIds: [],
    visible: false,
    order: 2,
  },
  {
    id: 'fx-d2',
    dayId: 'fx-day-2',
    startTime: '10:00',
    endTime: '11:00',
    title: '[Fixture] Day-two roundtable',
    location: 'Main hall',
    type: 'panel',
    speakerIds: [],
    visible: true,
    order: 0,
  },
];

function renderSchedule({
  eventConfig = fixtureConfig,
  features = { schedule: true },
  scheduleData = fixtureSessions,
  loading = false,
} = {}) {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <EventConfigContext.Provider
        value={{ eventConfig, features, theme: {}, badges: null, source: 'snapshot' }}
      >
        <ContentContext.Provider
          value={{
            readSource: 'published',
            siteContent: {},
            scheduleData,
            speakers: [],
            organizationsData: [],
            loading,
            getBlock: () => null,
          }}
        >
          <Schedule />
        </ContentContext.Provider>
      </EventConfigContext.Provider>
    </MemoryRouter>,
  );
}

describe('SchedulePage', () => {
  it('groups sessions by day and sorts the active day by start time', () => {
    renderSchedule();

    // Day one is active by default; its sessions are sorted by start time
    // even though `order` says otherwise.
    const cards = screen.getAllByRole('heading', { level: 3 });
    expect(cards.map((h) => h.textContent)).toEqual([
      '[Fixture] Morning kickoff',
      '[Fixture] Afternoon editing lab',
    ]);

    // Hidden sessions and other-day sessions never leak into day one.
    expect(screen.queryByText('[Fixture] Unpublished session')).toBeNull();
    expect(screen.queryByText('[Fixture] Day-two roundtable')).toBeNull();

    // Day switching is a real, keyboard-reachable button.
    fireEvent.click(screen.getByRole('button', { name: 'Day two' }));
    expect(screen.getByText('[Fixture] Day-two roundtable')).toBeInTheDocument();
    expect(screen.queryByText('[Fixture] Morning kickoff')).toBeNull();
    expect(screen.getByRole('button', { name: 'Day two' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('renders session times on the event wall clock from config.timezone', () => {
    const { container } = renderSchedule();

    // 09:05–09:45 event-local, both AM: the period renders once, on the end.
    const start = container.querySelector('time[datetime="2026-10-15T09:05"]');
    const end = container.querySelector('time[datetime="2026-10-15T09:45"]');
    expect(start).not.toBeNull();
    expect(start.textContent).toBe('9:05');
    expect(end.textContent).toBe('9:45 AM');

    // 13:30 event-local renders as a PM wall-clock time, not UTC.
    const pmStart = container.querySelector('time[datetime="2026-10-15T13:30"]');
    expect(pmStart.textContent).toBe('1:30');
    expect(
      container.querySelector('time[datetime="2026-10-15T14:15"]').textContent,
    ).toBe('2:15 PM');

    // The zone is named — October 15 is daylight time in America/Chicago —
    // both in the orientation line and on the cards.
    expect(screen.getByText('All times are shown in CDT.')).toBeInTheDocument();
    expect(screen.getAllByText('CDT').length).toBeGreaterThan(0);
  });

  it('resolves event-local wall clocks to the correct instant across DST', () => {
    // CDT (UTC−5) on the fixture date…
    expect(zonedDateTime('2026-10-15', '09:05', 'America/Chicago').toISOString()).toBe(
      '2026-10-15T14:05:00.000Z',
    );
    // …CST (UTC−6) after the November transition.
    expect(zonedDateTime('2026-12-15', '09:05', 'America/Chicago').toISOString()).toBe(
      '2026-12-15T15:05:00.000Z',
    );
    // Malformed inputs fail soft, never throw.
    expect(zonedDateTime('2026-10-15', '9:05', 'America/Chicago')).toBeNull();
    expect(zonedDateTime('2026-10-15', '09:05', 'Not/AZone')).toBeNull();
  });

  it('is hidden behind config/features.schedule', () => {
    renderSchedule({ features: { schedule: false } });

    expect(screen.queryByRole('heading', { level: 1, name: 'Schedule' })).toBeNull();
    expect(screen.queryByText('[Fixture] Morning kickoff')).toBeNull();
    expect(
      screen.getByRole('heading', { name: 'This event doesn’t have a public schedule' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to the home page' })).toBeInTheDocument();
  });

  it('shows a designed empty state when nothing is published', () => {
    renderSchedule({ scheduleData: [] });
    expect(
      screen.getByRole('heading', { name: 'The schedule isn’t published yet' }),
    ).toBeInTheDocument();
    // No day switcher without sessions to switch between.
    expect(screen.queryByRole('button', { name: 'Day two' })).toBeNull();
  });

  it('shows the loading state while runtime content is loading', () => {
    renderSchedule({ loading: true });
    expect(screen.getByRole('status', { name: 'Loading the schedule' })).toBeInTheDocument();
  });
});
