// MySchedule — personal schedule view at /schedule/mine (issue #16). No
// Firebase, no network (spec §8.1); useMyBookmarks is mocked directly so
// tests drive the bookmarked-id set without a Firestore listener.
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import EventConfigContext from '../contexts/EventConfigContext.jsx';
import ContentContext from '../contexts/ContentContext.jsx';
import AuthContext from '../contexts/AuthContext.jsx';
import ProfileContext from '../contexts/ProfileContext.jsx';
import { ToastProvider } from '../contexts/ToastContext.jsx';
import MySchedule from './MySchedule.jsx';

const useMyBookmarksMock = vi.fn();
vi.mock('../hooks/useMyBookmarks.js', () => ({
  useMyBookmarks: () => useMyBookmarksMock(),
}));

const fixtureConfig = {
  name: '[Fixture] Lakeshore Docs Camp',
  timezone: 'America/Chicago',
  days: [
    { id: 'fx-day-1', label: 'Day one', date: '2026-10-15' },
    { id: 'fx-day-2', label: 'Day two', date: '2026-10-16' },
  ],
  // A surveyed venue: three places, and ONE recorded move between two of
  // them. The gaps are the point — hall → lab is recorded, lab → annex is
  // not, and the difference has to show.
  venue: {
    places: [
      { id: 'fx-hall', name: '[Fixture] Main hall', floor: 'Ground floor' },
      { id: 'fx-lab', name: '[Fixture] Editing lab', floor: 'Second floor' },
      { id: 'fx-annex', name: '[Fixture] Annex' },
    ],
    movements: [
      {
        from: 'fx-hall',
        to: 'fx-lab',
        walkingMinutes: 6,
        accessibleRoute: '[Fixture] Lift by the cloakroom, then right.',
      },
    ],
  },
};

const fixtureSessions = [
  {
    id: 'fx-early',
    dayId: 'fx-day-1',
    startTime: '09:05',
    endTime: '09:45',
    title: '[Fixture] Morning kickoff',
    placeId: 'fx-hall',
    type: 'keynote',
    speakerIds: [],
    visible: true,
  },
  {
    id: 'fx-late',
    dayId: 'fx-day-1',
    startTime: '13:30',
    endTime: '14:15',
    title: '[Fixture] Afternoon editing lab',
    placeId: 'fx-lab',
    type: 'workshop',
    speakerIds: [],
    visible: true,
  },
  // Same day as the two above, in a place the venue defines but to which
  // nobody recorded a route from the editing lab.
  {
    id: 'fx-annex-talk',
    dayId: 'fx-day-1',
    startTime: '15:00',
    endTime: '15:45',
    title: '[Fixture] Late annex talk',
    placeId: 'fx-annex',
    type: 'panel',
    speakerIds: [],
    visible: true,
  },
  {
    id: 'fx-d2',
    dayId: 'fx-day-2',
    startTime: '10:00',
    endTime: '11:00',
    title: '[Fixture] Day-two roundtable',
    type: 'panel',
    speakerIds: [],
    visible: true,
  },
  // Its dayId ('fx-day-removed') matches no entry in fixtureConfig.days —
  // simulates a session left pointing at a day an admin removed from
  // config/event.days after the session was bookmarked.
  {
    id: 'fx-orphan',
    dayId: 'fx-day-removed',
    startTime: '09:00',
    endTime: '09:30',
    title: '[Fixture] Orphaned-day session',
    type: 'panel',
    speakerIds: [],
    visible: true,
  },
];

function renderMySchedule({
  features = { schedule: true, sessionBookmarks: true },
  auth = { user: { uid: 'u1' }, loading: false },
  profile = { attendeeAccess: true },
  bookmarkedIds = new Set(),
  bookmarksLoading = false,
} = {}) {
  useMyBookmarksMock.mockReturnValue({ bookmarkedIds, loading: bookmarksLoading });
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <EventConfigContext.Provider
        value={{ eventConfig: fixtureConfig, features, theme: {}, badges: null, source: 'snapshot' }}
      >
        <AuthContext.Provider value={auth}>
          <ProfileContext.Provider value={profile}>
            <ToastProvider>
              <ContentContext.Provider
                value={{
                  readSource: 'published',
                  siteContent: {},
                  scheduleData: fixtureSessions,
                  speakers: [],
                  organizationsData: [],
                  loading: false,
                  getBlock: () => null,
                }}
              >
                <MySchedule />
              </ContentContext.Provider>
            </ToastProvider>
          </ProfileContext.Provider>
        </AuthContext.Provider>
      </EventConfigContext.Provider>
    </MemoryRouter>,
  );
}

describe('MySchedule', () => {
  it('is hidden when config/features.sessionBookmarks is off', () => {
    renderMySchedule({ features: { schedule: true, sessionBookmarks: false } });
    expect(
      screen.getByRole('heading', { name: 'This event doesn’t have a personal schedule' }),
    ).toBeInTheDocument();
  });

  it('prompts a signed-out visitor to sign in, rather than showing an empty list', () => {
    renderMySchedule({ auth: { user: null, loading: false }, profile: { attendeeAccess: false } });
    expect(screen.getByRole('heading', { name: 'Sign in to see your schedule' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/signin');
  });

  it('shows a designed empty state for a signed-in user with no bookmarks', () => {
    renderMySchedule({ bookmarkedIds: new Set() });
    expect(screen.getByRole('heading', { name: 'No bookmarked sessions yet' })).toBeInTheDocument();
  });

  it('renders only bookmarked sessions, grouped by day in day order', () => {
    renderMySchedule({ bookmarkedIds: new Set(['fx-late', 'fx-d2']) });
    expect(screen.getByRole('heading', { level: 3, name: '[Fixture] Afternoon editing lab' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: '[Fixture] Day-two roundtable' })).toBeInTheDocument();
    expect(screen.queryByText('[Fixture] Morning kickoff')).toBeNull();
    // Both day headings render since each has a bookmarked session.
    expect(screen.getByRole('heading', { level: 2, name: /Day one/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /Day two/ })).toBeInTheDocument();
  });

  it('omits a day heading entirely when it has no bookmarked sessions', () => {
    renderMySchedule({ bookmarkedIds: new Set(['fx-early']) });
    expect(screen.getByRole('heading', { level: 2, name: /Day one/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: /Day two/ })).toBeNull();
  });

  describe('a bookmarked session whose configured day was removed', () => {
    it('shows the "no bookmarks" empty state instead of a blank page when it is the only bookmark', () => {
      renderMySchedule({ bookmarkedIds: new Set(['fx-orphan']) });
      expect(screen.getByRole('heading', { name: 'No bookmarked sessions yet' })).toBeInTheDocument();
      expect(screen.queryByText('[Fixture] Orphaned-day session')).toBeNull();
      // Sanity: this is genuinely the "no bookmarks" branch, not a
      // coincidental blank body — no stray day-section heading either
      // (EmptyState's own "No bookmarked sessions yet" IS an <h2>).
      expect(screen.queryByRole('heading', { level: 2, name: /Day/ })).toBeNull();
    });

    it('is dropped from a mixed bookmark set — the valid session still renders, nothing is blank', () => {
      renderMySchedule({ bookmarkedIds: new Set(['fx-orphan', 'fx-early']) });
      expect(
        screen.getByRole('heading', { level: 3, name: '[Fixture] Morning kickoff' }),
      ).toBeInTheDocument();
      expect(screen.queryByText('[Fixture] Orphaned-day session')).toBeNull();
      expect(screen.getByRole('heading', { level: 2, name: /Day one/ })).toBeInTheDocument();
    });

    it('does not count toward the bulk "download my schedule" export', () => {
      renderMySchedule({
        bookmarkedIds: new Set(['fx-orphan']),
        features: { schedule: true, sessionBookmarks: true, icsExport: true },
      });
      // Only the orphaned bookmark exists, so mySessions is empty — the
      // download button (gated on mySessions.length > 0) must not render.
      expect(screen.queryByRole('button', { name: /download my schedule/i })).toBeNull();
    });
  });

  // THE TRANSFER LINE, AND THE ONE LIST IT BELONGS IN (design brief §4.6;
  // shared/venue.cjs). A recorded movement says what a move costs. It does
  // not say the reader is making it — here, the reader said so themselves
  // by bookmarking both ends.
  describe('a stated move between two sessions the reader chose', () => {
    it('states where, where to, and how long, from the recorded move', () => {
      renderMySchedule({ bookmarkedIds: new Set(['fx-early', 'fx-late']) });
      expect(
        screen.getByText(
          /Transfer from \[Fixture\] Main hall to \[Fixture\] Editing lab, Second floor — 6 min walk/,
        ),
      ).toBeInTheDocument();
      // The step-free way, in the operator's own words.
      expect(
        screen.getByText(/Step-free route: \[Fixture\] Lift by the cloakroom, then right\./),
      ).toBeInTheDocument();
    });

    it('says nothing where nobody recorded the route', () => {
      // Both places are defined, both sessions state one, and the reader
      // attends both — and still the site says nothing, because nobody
      // walked lab → annex and wrote it down. Silence is what an
      // unrecorded route looks like; an estimate would be the old
      // inference wearing better data.
      renderMySchedule({ bookmarkedIds: new Set(['fx-late', 'fx-annex-talk']) });
      expect(screen.queryByText(/Transfer from/)).toBeNull();
    });

    it('never opens a day with a transfer — arriving is not transferring', () => {
      renderMySchedule({ bookmarkedIds: new Set(['fx-late']) });
      expect(screen.queryByText(/Transfer from/)).toBeNull();
    });

    it('states nothing about a session that names no place', () => {
      // fx-d2 carries no placeId, so it is nowhere the reader can be routed
      // to and nowhere they can be routed from.
      renderMySchedule({ bookmarkedIds: new Set(['fx-early', 'fx-late', 'fx-d2']) });
      expect(screen.getAllByText(/Transfer from/)).toHaveLength(1);
    });
  });
});
