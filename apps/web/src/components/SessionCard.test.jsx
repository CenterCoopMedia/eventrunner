// SessionCard — the pill row is feature-flag conditional (spec §9), and the
// bookmark pill's click itself is further gated by ProfileContext's
// attendeeAccess (spec §3.4's hasAttendeeAccess predicate). No Firebase, no
// network (spec §8.1) — bookmarksSource is mocked.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AuthContext from '../contexts/AuthContext.jsx';
import ProfileContext from '../contexts/ProfileContext.jsx';
import { ToastProvider } from '../contexts/ToastContext.jsx';
import SessionCard from './SessionCard.jsx';

const setSessionBookmarkedMock = vi.fn();
vi.mock('../lib/bookmarksSource.js', () => ({
  setSessionBookmarked: (...args) => setSessionBookmarkedMock(...args),
}));

// useSessionMaterialsCount (issue #23) subscribes through materialsSource.js
// — mocked the same way bookmarksSource.js is, so this file stays
// Firebase-free (spec §8.1). Defaults to no materials; individual tests
// override via subscribeSessionMaterialsMock.mockImplementation.
const subscribeSessionMaterialsMock = vi.fn((sessionId, onNext) => {
  onNext([]);
  return () => {};
});
vi.mock('../lib/materialsSource.js', () => ({
  subscribeSessionMaterials: (...args) => subscribeSessionMaterialsMock(...args),
}));

const fixtureConfig = {
  shortName: '[Fixture] LDC',
  timezone: 'America/Chicago',
  venue: { name: '[Fixture] Hall', city: 'Fixtureville' },
  days: [{ id: 'fx-day-1', label: 'Day one', date: '2026-10-15' }],
};

const fixtureSession = {
  id: 'fx-1',
  dayId: 'fx-day-1',
  startTime: '09:05',
  endTime: '09:45',
  title: '[Fixture] Morning kickoff',
  description: '[Fixture] What the day covers.',
  location: 'Main hall',
  type: 'keynote',
  speakerIds: [],
  visible: true,
};

function cardTree({
  features = {},
  auth = { user: null },
  profile = { attendeeAccess: false },
  bookmarked = false,
  initialEntries = ['/schedule'],
} = {}) {
  return (
    <MemoryRouter
      initialEntries={initialEntries}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <AuthContext.Provider value={auth}>
        <ProfileContext.Provider value={profile}>
          <ToastProvider>
            <ul>
              <SessionCard session={fixtureSession} eventConfig={fixtureConfig} features={features} bookmarked={bookmarked} />
            </ul>
          </ToastProvider>
        </ProfileContext.Provider>
      </AuthContext.Provider>
    </MemoryRouter>
  );
}

function renderCard(props = {}) {
  const result = render(cardTree(props));
  return {
    ...result,
    // Rerenders the SAME tree shape with new props — MemoryRouter/Providers
    // included — so a test can simulate the `bookmarked` prop changing
    // underneath an already-mounted BookmarkPill (a subscription update, an
    // identity switch) without unmounting it.
    rerenderCard: (nextProps) => result.rerender(cardTree(nextProps)),
  };
}

beforeEach(() => {
  setSessionBookmarkedMock.mockReset();
  subscribeSessionMaterialsMock.mockReset().mockImplementation((sessionId, onNext) => {
    onNext([]);
    return () => {};
  });
});

describe('SessionCard', () => {
  it('links the title to the session detail route', () => {
    renderCard();
    expect(screen.getByRole('link', { name: fixtureSession.title })).toHaveAttribute(
      'href',
      '/schedule/fx-1',
    );
  });

  it('carries the current query string (?preview=1) into the detail link', () => {
    renderCard({ initialEntries: ['/schedule?preview=1'] });
    expect(screen.getByRole('link', { name: fixtureSession.title })).toHaveAttribute(
      'href',
      '/schedule/fx-1?preview=1',
    );
  });

  it('renders no pill row when every relevant feature flag is off', () => {
    renderCard({ features: {} });
    expect(screen.queryByRole('button', { name: /bookmark/i })).toBeNull();
    expect(screen.queryByText(/add to calendar/i)).toBeNull();
  });

  describe('bookmark pill (features.sessionBookmarks)', () => {
    it('shows a sign-in prompt for a signed-out visitor', () => {
      renderCard({ features: { sessionBookmarks: true }, auth: { user: null }, profile: { attendeeAccess: false } });
      expect(screen.getByRole('link', { name: /sign in to bookmark/i })).toHaveAttribute(
        'href',
        '/signin',
      );
    });

    it('shows a disabled pill for a signed-in user without attendee access', () => {
      renderCard({
        features: { sessionBookmarks: true },
        auth: { user: { uid: 'u1' } },
        profile: { attendeeAccess: false },
      });
      const pill = screen.getByText('Bookmark');
      expect(pill.closest('[aria-disabled="true"]')).not.toBeNull();
    });

    it('an approved attendee can toggle the bookmark, optimistically', async () => {
      setSessionBookmarkedMock.mockResolvedValue({ bookmarked: true, count: 1 });
      renderCard({
        features: { sessionBookmarks: true },
        auth: { user: { uid: 'u1' } },
        profile: { attendeeAccess: true },
        bookmarked: false,
      });
      const button = screen.getByRole('button', { name: /bookmark/i });
      expect(button).toHaveAttribute('aria-pressed', 'false');
      fireEvent.click(button);
      // Optimistic: flips before the promise resolves.
      expect(screen.getByRole('button', { name: /bookmarked/i })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      expect(setSessionBookmarkedMock).toHaveBeenCalledWith({
        user: { uid: 'u1' },
        sessionId: 'fx-1',
        bookmarked: true,
      });
    });

    it('reverts the optimistic toggle when the request fails', async () => {
      setSessionBookmarkedMock.mockRejectedValue(new Error('The bookmark could not be saved.'));
      renderCard({
        features: { sessionBookmarks: true },
        auth: { user: { uid: 'u1' } },
        profile: { attendeeAccess: true },
        bookmarked: false,
      });
      fireEvent.click(screen.getByRole('button', { name: /bookmark/i }));
      expect(await screen.findByRole('button', { name: /^Bookmark$/i })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
      expect(await screen.findByRole('alert')).toHaveTextContent('The bookmark could not be saved.');
    });

    it('drops the optimistic override once an external change updates the subscribed `bookmarked` prop', async () => {
      setSessionBookmarkedMock.mockResolvedValue({ bookmarked: true, count: 1 });
      const { rerenderCard } = renderCard({
        features: { sessionBookmarks: true },
        auth: { user: { uid: 'u1' } },
        profile: { attendeeAccess: true },
        bookmarked: false,
      });
      fireEvent.click(screen.getByRole('button', { name: /bookmark/i }));
      await screen.findByRole('button', { name: /bookmarked/i }); // optimistic write in flight/confirmed

      // The subscription catches up and confirms the write — `bookmarked`
      // itself flips to true. Still shows "Bookmarked" (optimistic already
      // agreed), but now `optimistic` is cleared and `bookmarked` alone is
      // driving the display.
      rerenderCard({
        features: { sessionBookmarks: true },
        auth: { user: { uid: 'u1' } },
        profile: { attendeeAccess: true },
        bookmarked: true,
      });
      expect(await screen.findByRole('button', { name: /bookmarked/i })).toHaveAttribute(
        'aria-pressed',
        'true',
      );

      // Someone else unbookmarks this session from elsewhere (another tab,
      // an admin action) — the next snapshot flips `bookmarked` back to
      // false. Before the fix this never happened: a stale `optimistic`
      // from the FIRST click kept masking every subsequent `bookmarked`
      // update, so the pill stayed stuck on "Bookmarked" forever.
      rerenderCard({
        features: { sessionBookmarks: true },
        auth: { user: { uid: 'u1' } },
        profile: { attendeeAccess: true },
        bookmarked: false,
      });
      const button = await screen.findByRole('button', { name: /^Bookmark$/i });
      expect(button).toHaveAttribute('aria-pressed', 'false');

      // A subsequent click now sends the CORRECT desired state (true, to
      // re-bookmark) instead of the inverse of a stale optimistic value.
      setSessionBookmarkedMock.mockClear();
      fireEvent.click(button);
      expect(setSessionBookmarkedMock).toHaveBeenCalledWith({
        user: { uid: 'u1' },
        sessionId: 'fx-1',
        bookmarked: true,
      });
      // Drain the click's async state update before the test (and its
      // cleanup/unmount) exits, so it can't resolve into the next test.
      await screen.findByRole('button', { name: /bookmarked/i });
    });

    it('resets the optimistic override when the signed-in identity changes', async () => {
      setSessionBookmarkedMock.mockResolvedValue({ bookmarked: true, count: 1 });
      const { rerenderCard } = renderCard({
        features: { sessionBookmarks: true },
        auth: { user: { uid: 'u1' } },
        profile: { attendeeAccess: true },
        bookmarked: false,
      });
      fireEvent.click(screen.getByRole('button', { name: /bookmark/i }));
      await screen.findByRole('button', { name: /bookmarked/i });

      // A different user signs in on the same mounted card (e.g. a shared
      // kiosk session) — u1's optimistic bookmark must not leak onto u2's
      // view, which starts from u2's own (unbookmarked) subscribed state.
      rerenderCard({
        features: { sessionBookmarks: true },
        auth: { user: { uid: 'u2' } },
        profile: { attendeeAccess: true },
        bookmarked: false,
      });
      expect(await screen.findByRole('button', { name: /^Bookmark$/i })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
    });
  });

  describe('calendar pill (features.icsExport)', () => {
    it('renders Google/Outlook links and an .ics download button', () => {
      renderCard({ features: { icsExport: true } });
      expect(screen.getByRole('link', { name: 'Google' })).toHaveAttribute(
        'href',
        expect.stringContaining('calendar.google.com'),
      );
      expect(screen.getByRole('link', { name: 'Outlook' })).toHaveAttribute(
        'href',
        expect.stringContaining('outlook.live.com'),
      );
      expect(screen.getByRole('button', { name: '.ics' })).toBeInTheDocument();
    });

    it('renders nothing for a session whose time cannot be resolved', () => {
      renderCard({
        features: { icsExport: true },
      });
      // sanity check against the unresolved case rendering nothing:
      const unresolved = { ...fixtureSession, dayId: 'no-such-day' };
      const { container } = render(
        <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <AuthContext.Provider value={{ user: null }}>
            <ProfileContext.Provider value={{ attendeeAccess: false }}>
              <ToastProvider>
                <ul>
                  <SessionCard session={unresolved} eventConfig={fixtureConfig} features={{ icsExport: true }} />
                </ul>
              </ToastProvider>
            </ProfileContext.Provider>
          </AuthContext.Provider>
        </MemoryRouter>,
      );
      expect(container.textContent).not.toContain('Add to calendar');
    });
  });

  it('the materials pill stays hidden when the session has no approved materials', () => {
    renderCard({ features: { sessionMaterials: true } });
    expect(screen.queryByText(/material/i)).toBeNull();
  });

  it('the materials pill shows the live count once session_materials_public has rows', () => {
    subscribeSessionMaterialsMock.mockImplementationOnce((sessionId, onNext) => {
      onNext([
        { id: 'm1', sessionId, type: 'link', filename: 'Slides', reviewStatus: 'approved' },
        { id: 'm2', sessionId, type: 'file', filename: 'handout.pdf', reviewStatus: 'approved' },
      ]);
      return () => {};
    });
    renderCard({ features: { sessionMaterials: true } });
    expect(screen.getByText('2 materials')).not.toBeNull();
  });

  it('the reactions pill stays hidden (no backend yet — TODO stub)', () => {
    renderCard({ features: { sessionReactions: true } });
    expect(screen.queryByText(/reaction/i)).toBeNull();
  });
});
