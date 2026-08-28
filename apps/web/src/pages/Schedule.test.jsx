// SchedulePage — grouping/sorting, event-timezone rendering, feature gate,
// keyboard day switching (issue #16 first slice). Fixture providers only:
// no Firebase, no network (spec §8.1 credential-free CI). The fixture event
// is fictional and distinct from the committed snapshot so nothing here
// accidentally passes by matching demo copy.
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import EventConfigContext from '../contexts/EventConfigContext.jsx';
import ContentContext from '../contexts/ContentContext.jsx';
import AuthContext from '../contexts/AuthContext.jsx';
import ProfileContext from '../contexts/ProfileContext.jsx';
import Schedule from './Schedule.jsx';
import { formatSessionTimeRange, zonedDateTime } from '../lib/eventTime.js';

// Non-UTC zone on purpose: America/Chicago is UTC−5 (CDT) on the fixture
// dates, so a renderer that ignored config.timezone would be caught.
const fixtureConfig = {
  name: '[Fixture] Lakeshore Docs Camp',
  timezone: 'America/Chicago',
  days: [
    { id: 'fx-day-1', label: 'Day one', date: '2026-10-15' },
    { id: 'fx-day-2', label: 'Day two', date: '2026-10-16' },
  ],
  // A SURVEYED venue, deliberately: the schedule list must state no
  // transfer even when the walk between two consecutive rows is recorded
  // and known, because the reader scanning a programme is not walking it.
  venue: {
    places: [
      { id: 'fx-hall', name: '[Fixture] Main hall' },
      { id: 'fx-lab', name: '[Fixture] Editing lab', floor: 'Second floor' },
    ],
    movements: [
      { from: 'fx-hall', to: 'fx-lab', walkingMinutes: 6 },
      {
        from: 'fx-lab',
        to: 'fx-hall',
        walkingMinutes: 4,
        accessibleRoute: '[Fixture] Lift by the cloakroom.',
      },
    ],
  },
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
    placeId: 'fx-lab',
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
    placeId: 'fx-hall',
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
  auth = { user: null, isAdmin: false, loading: false },
  profile = { attendeeAccess: false },
} = {}) {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <EventConfigContext.Provider
        value={{ eventConfig, features, theme: {}, badges: null, source: 'snapshot' }}
      >
        <AuthContext.Provider value={auth}>
          <ProfileContext.Provider value={profile}>
            <ContentContext.Provider
              value={{
                readSource: 'published',
                siteContent: {},
                scheduleData,
                speakers: [],
                organizationsData: [],
                loading,
                getBlock: () => null,
                // The page shell reads the page document for its layout and
                // its slot sections (components/SystemPage.jsx).
                getPage: () => null,
                getSectionBlocks: () => [],
              }}
            >
              <Schedule />
            </ContentContext.Provider>
          </ProfileContext.Provider>
        </AuthContext.Provider>
      </EventConfigContext.Provider>
    </MemoryRouter>,
  );
}

/**
 * The view a reader is looking at right now.
 *
 * The page carries two views of the same day: the screen view and the
 * printed programme, which lists EVERY day and no controls. Only one of
 * them is ever in the layout — `display: none` outside print media keeps
 * the other out of the accessibility tree too — but jsdom applies no CSS,
 * so a query that means "what the reader sees" says so here.
 */
function onScreen() {
  return within(document.querySelector('.schedule-screen'));
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
    expect(onScreen().queryByText('[Fixture] Unpublished session')).toBeNull();
    expect(onScreen().queryByText('[Fixture] Day-two roundtable')).toBeNull();

    // Day switching is a real, keyboard-reachable button.
    fireEvent.click(screen.getByRole('button', { name: 'Day two' }));
    expect(onScreen().getByText('[Fixture] Day-two roundtable')).toBeInTheDocument();
    expect(onScreen().queryByText('[Fixture] Morning kickoff')).toBeNull();
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

  it('fails soft on a wall clock inside a DST spring-forward gap', () => {
    // 2026-03-08 is the America/New_York spring-forward day: the clock jumps
    // from 2:00 AM straight to 3:00 AM, so 2:30 AM never happens. Resolving
    // it must not silently render as 1:30 AM (the pre-fix behavior).
    expect(zonedDateTime('2026-03-08', '02:30', 'America/New_York')).toBeNull();

    // A normal time on the same day still resolves — 9:00 AM is after the
    // 2:00 AM transition, so it's already EDT (UTC−4).
    expect(
      zonedDateTime('2026-03-08', '09:00', 'America/New_York').toISOString(),
    ).toBe('2026-03-08T13:00:00.000Z');

    // 2026-11-01 is the America/New_York fall-back day: 1:30 AM happens
    // twice (ambiguous, not missing) and must still resolve — consistently,
    // to one real instant rather than failing soft like the gap case.
    const fallBack = zonedDateTime('2026-11-01', '01:30', 'America/New_York');
    expect(fallBack).not.toBeNull();
    expect(
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      }).format(fallBack),
    ).toBe('1:30 AM');
  });

  it('rolls a midnight-crossing session end to the next calendar day', () => {
    const range = formatSessionTimeRange(fixtureConfig, {
      dayId: 'fx-day-1',
      startTime: '23:30',
      endTime: '00:15',
    });
    expect(range.startIso).toBe('2026-10-15T23:30');
    // The end instant must be after the start instant, not ~23h before it.
    expect(range.endIso).toBe('2026-10-16T00:15');
    expect(range.endLabel).toBe('12:15 AM');
  });

  it('does not crash on a malformed entry in config/event.days', () => {
    renderSchedule({
      eventConfig: {
        ...fixtureConfig,
        days: [null, { id: 'fx-day-1', label: 'Day one', date: '2026-10-15' }, {}],
      },
    });
    expect(screen.getByRole('heading', { level: 1, name: 'Schedule' })).toBeInTheDocument();
    expect(onScreen().getByText('[Fixture] Morning kickoff')).toBeInTheDocument();
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
    expect(screen.getByRole('status', { name: 'Loading the schedule…' })).toBeInTheDocument();
  });
});

// The schedule in the editorial register (design brief §2.1, §5.1). The
// two-axis grid is PR3; what PR1 owns is the list presentation — hairline
// rows, times in the mono face, and day heads as folios on rules.
describe('SchedulePage editorial register', () => {
  it('sets the day head as a folio on a rule, and keeps it a real h2', () => {
    renderSchedule();
    const dayHead = screen.getByRole('heading', { level: 2, name: 'Day one' });
    expect(dayHead).toHaveClass('folio');
    expect(dayHead.parentElement.querySelector('.folio__rule')).not.toBeNull();
  });

  it('marks the active day with weight and a rule, never a tinted pill', () => {
    const { container } = renderSchedule();
    const active = screen.getByRole('button', { name: 'Day one' });
    expect(active).toHaveClass('font-semibold', 'border-b-rule-strong');
    expect(active.className).not.toContain('bg-brand-primary/10');
    expect([...container.querySelectorAll('*')].flatMap((n) => [...n.classList])).not.toContain(
      'rounded-full',
    );
  });

  it('separates sessions with rules instead of gaps between cards', () => {
    const { container } = renderSchedule();
    const list = container.querySelector('section ul');
    expect(list.className).not.toContain('gap-3');
    // The rule is the --session-card-rule-* contract, drawn in index.css.
    expect(list.querySelector('li')).toHaveClass('session-block');
  });

  it('sets the day head plate number from the day’s real position', () => {
    // Visual story, Field Guide, moment 1: "PLATE III · SATURDAY 14
    // MARCH". Day two is Plate II because it is the second day, not because
    // a designer liked the number — and the mark is set only where the
    // token says the page is a plate book (index.css .plate-number).
    renderSchedule();
    expect(screen.getByText(/Plate I \u00b7/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Day two' }));
    expect(screen.getByText(/Plate II \u00b7/)).toBeInTheDocument();
  });

  it('states the room and never draws a transfer between two rows', () => {
    // The fixture venue RECORDS the walk from the hall to the lab, and
    // these two rows are in that order. The list still says nothing, and
    // that is the point: a recorded movement says what a move costs, not
    // that this reader is making it. A reader scanning the programme
    // skipped that session, or is following one track out of five.
    renderSchedule();
    const rows = [...document.querySelectorAll('section ul li')];
    expect(rows[0].textContent).toContain('Main hall');
    expect(rows[1].textContent).toContain('Room B');
    expect(document.body.textContent).not.toMatch(/transfer/i);
    expect(document.body.textContent).not.toMatch(/min walk/i);
    expect(document.querySelector('.transfer-line')).toBeNull();
  });
});

describe('the two views of a day', () => {
  // The list is what a viewport that cannot be measured gets, so jsdom —
  // which ships no matchMedia — renders it in every test above. These two
  // stub the query the way a wide browser would answer it.
  function withViewport(matches, run) {
    const original = window.matchMedia;
    window.matchMedia = () => ({
      matches,
      addEventListener: () => {},
      removeEventListener: () => {},
    });
    try {
      run();
    } finally {
      if (original) window.matchMedia = original;
      else delete window.matchMedia;
    }
  }

  const tracked = [
    { ...fixtureSessions[1], track: 'A' },
    {
      id: 'fx-parallel',
      dayId: 'fx-day-1',
      startTime: '09:05',
      endTime: '09:45',
      title: '[Fixture] Parallel session',
      location: 'Room B',
      track: 'B',
      speakerIds: [],
      visible: true,
      order: 1,
    },
  ];
  const eventWithTracks = {
    ...fixtureConfig,
    tracks: [
      { letter: 'A', name: 'Practice' },
      { letter: 'B', name: 'Sustainability' },
    ],
  };

  it('draws the grid at a wide viewport, when the event runs lines', () => {
    withViewport(true, () => {
      const { container } = renderSchedule({ eventConfig: eventWithTracks, scheduleData: tracked });
      expect(screen.getByRole('table', { name: /day one, sessions by track/i })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: /practice/i })).toBeInTheDocument();
      const region = container.querySelector('.horizontal-scroll-region');
      expect(region).not.toBeNull();
      expect(region).toHaveAttribute('data-scroll-label', 'Day one schedule grid');
    });
  });

  it('keeps the list at a narrow viewport, with every session in it', () => {
    withViewport(false, () => {
      renderSchedule({ eventConfig: eventWithTracks, scheduleData: tracked });
      expect(screen.queryByRole('table')).toBeNull();
      expect(onScreen().getByText('[Fixture] Morning kickoff')).toBeInTheDocument();
      expect(onScreen().getByText('[Fixture] Parallel session')).toBeInTheDocument();
    });
  });

  it('keeps the list at a wide viewport when the event runs no lines', () => {
    // No second axis, so there is nothing for a grid to be.
    withViewport(true, () => {
      renderSchedule();
      expect(screen.queryByRole('table')).toBeNull();
      expect(onScreen().getByText('[Fixture] Morning kickoff')).toBeInTheDocument();
    });
  });

  it('lists a child under its parent in the list too, never as its own row', () => {
    const parent = { ...fixtureSessions[1] };
    const child = {
      id: 'fx-clinic',
      dayId: 'fx-day-1',
      startTime: '09:20',
      endTime: '09:45',
      title: '[Fixture] Breakout clinic',
      location: 'Main hall',
      parentId: 'fx-early',
      speakerIds: [],
      visible: true,
      order: 1,
    };
    withViewport(false, () => {
      const { container } = renderSchedule({ scheduleData: [parent, child] });
      expect(container.querySelectorAll('li.session-block')).toHaveLength(1);
      const points = screen.getByRole('list', {
        name: /calling points of \[fixture\] morning kickoff/i,
      });
      expect(points).toBeInTheDocument();
      expect(onScreen().getByText('[Fixture] Breakout clinic')).toBeInTheDocument();
    });
  });

  // A CALLING POINT IS THE ONE SCHEDULE ROW THAT STATES A MOVE (brief §4.6;
  // shared/venue.cjs). A child runs INSIDE its parent, so a reader at the
  // calling point was in the parent's room a moment ago — the sequence is
  // the data, not a guess about a reader's route.
  describe('a calling point in another place', () => {
    const parent = { ...fixtureSessions[1], placeId: 'fx-hall' };
    const child = (overrides) => ({
      id: 'fx-clinic',
      dayId: 'fx-day-1',
      startTime: '09:20',
      endTime: '09:45',
      title: '[Fixture] Breakout clinic',
      parentId: 'fx-early',
      speakerIds: [],
      visible: true,
      order: 1,
      ...overrides,
    });

    it('states the recorded move from the parent’s place', () => {
      withViewport(false, () => {
        renderSchedule({ scheduleData: [parent, child({ placeId: 'fx-lab' })] });
        expect(
          screen.getByText(
            /Transfer from \[Fixture\] Main hall to \[Fixture\] Editing lab, Second floor — 6 min walk/,
          ),
        ).toBeInTheDocument();
      });
    });

    it('says nothing when the calling point is in the same place', () => {
      withViewport(false, () => {
        renderSchedule({ scheduleData: [parent, child({ placeId: 'fx-hall' })] });
        expect(screen.queryByText(/Transfer from/)).toBeNull();
      });
    });

    it('says nothing when the calling point names no place', () => {
      withViewport(false, () => {
        renderSchedule({ scheduleData: [parent, child({ location: 'Somewhere else' })] });
        expect(screen.queryByText(/Transfer from/)).toBeNull();
      });
    });
  });
});

describe('the back issue', () => {
  // The fixture event runs in October 2026. These render it from a day the
  // event has already passed, and from an operator's archive date.
  const pastEvent = {
    ...fixtureConfig,
    announcedAt: '2026-01-01T00:00',
    days: [
      { id: 'fx-day-1', label: 'Day one', date: '2020-10-15', startTime: '09:00', endTime: '17:00' },
    ],
  };
  const pastSessions = [{ ...fixtureSessions[1], dayId: 'fx-day-1' }];

  it('keeps every word of a past day, and says it is an archive', () => {
    renderSchedule({ eventConfig: pastEvent, scheduleData: pastSessions });
    // Nothing is hidden: the session is still there, still linked.
    expect(onScreen().getByText('[Fixture] Morning kickoff')).toBeInTheDocument();
    expect(screen.getByText(/back issue/i)).toBeInTheDocument();
  });

  it('drops the day to the archive tokens', () => {
    const { container } = renderSchedule({
      eventConfig: pastEvent,
      scheduleData: pastSessions,
    });
    const day = container.querySelector('section[data-back-issue]');
    expect(day).not.toBeNull();
    expect(day.className).toContain('back-issue');
  });

  it('takes the live controls away, and leaves the materials', () => {
    renderSchedule({
      eventConfig: pastEvent,
      scheduleData: pastSessions,
      features: { schedule: true, sessionBookmarks: true, icsExport: true },
      auth: { user: { uid: 'u1' }, isAdmin: false, loading: false },
      profile: { attendeeAccess: true },
    });
    // Bookmarking a session that has finished is an act on nothing.
    expect(screen.queryByRole('button', { name: /^bookmark$/i })).toBeNull();
    expect(screen.queryByText(/add to calendar/i)).toBeNull();
  });

  it('marks a live day as no such thing', () => {
    const { container } = renderSchedule();
    expect(container.querySelector('section[data-back-issue]')).toBeNull();
    expect(screen.queryByText(/back issue/i)).toBeNull();
  });

  it('files the whole event once the operator archives it', () => {
    const archived = { ...fixtureConfig, announcedAt: '2026-01-01T00:00', archivedAt: '2026-01-02T00:00' };
    const { container } = renderSchedule({
      eventConfig: archived,
      features: { schedule: true, icsExport: true },
    });
    expect(container.querySelector('section[data-back-issue]')).not.toBeNull();
    // The whole-schedule download acts on a live event too.
    expect(screen.queryByRole('button', { name: /download schedule/i })).toBeNull();
  });
});
