// SessionCard — the pill row is feature-flag conditional (spec §9), and the
// bookmark pill's click itself is further gated by ProfileContext's
// attendeeAccess (spec §3.4's hasAttendeeAccess predicate). No Firebase, no
// network (spec §8.1) — bookmarksSource is mocked.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AuthContext from '../contexts/AuthContext.jsx';
import ContentContext from '../contexts/ContentContext.jsx';
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

const setSessionReactionMock = vi.fn();
vi.mock('../lib/reactionsSource.js', () => ({
  REACTION_KINDS: ['👍', '❤️', '🎉', '💡', '👏'],
  setSessionReaction: (...args) => setSessionReactionMock(...args),
}));

const EMPTY_COUNTS = { '👍': 0, '❤️': 0, '🎉': 0, '💡': 0, '👏': 0 };
let useSessionReactionsMock = vi.fn(() => ({ counts: EMPTY_COUNTS, myReaction: null, loading: false }));
vi.mock('../hooks/useSessionReactions.js', () => ({
  useSessionReactions: (...args) => useSessionReactionsMock(...args),
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
  content = { speakers: [] },
} = {}) {
  return (
    <MemoryRouter
      initialEntries={initialEntries}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <AuthContext.Provider value={auth}>
        <ContentContext.Provider value={content}>
          <ProfileContext.Provider value={profile}>
            <ToastProvider>
              <ul>
                <SessionCard session={fixtureSession} eventConfig={fixtureConfig} features={features} bookmarked={bookmarked} />
              </ul>
            </ToastProvider>
          </ProfileContext.Provider>
        </ContentContext.Provider>
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
  setSessionReactionMock.mockReset();
  useSessionReactionsMock.mockReset();
  useSessionReactionsMock.mockReturnValue({ counts: EMPTY_COUNTS, myReaction: null, loading: false });
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

  function renderWithSpeaker({ speakerFeature = true, initialEntries = ['/schedule'] } = {}) {
    const withSpeakers = { ...fixtureSession, speakerIds: ['spk-1', 'spk-ghost'] };
    return render(
      <MemoryRouter initialEntries={initialEntries} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AuthContext.Provider value={{ user: null }}>
          <ContentContext.Provider value={{ speakers: [{ id: 'spk-1', displayName: 'Rae Okonkwo', slug: 'rae-okonkwo' }] }}>
            <ProfileContext.Provider value={{ attendeeAccess: false }}>
              <ToastProvider>
                <ul>
                  <SessionCard
                    session={withSpeakers}
                    eventConfig={fixtureConfig}
                    features={{ speakers: speakerFeature }}
                  />
                </ul>
              </ToastProvider>
            </ProfileContext.Provider>
          </ContentContext.Provider>
        </AuthContext.Provider>
      </MemoryRouter>,
    );
  }

  it('renders a link per resolved speaker name, dropping ids with no matching document', () => {
    renderWithSpeaker();
    const link = screen.getByRole('link', { name: 'Rae Okonkwo' });
    expect(link).toHaveAttribute('href', '/speakers/rae-okonkwo');
    expect(screen.queryByText(/spk-ghost/)).toBeNull();
  });

  it('renders plain (unlinked) names when features.speakers is off (issue #22 review P2-7)', () => {
    renderWithSpeaker({ speakerFeature: false });
    expect(screen.getByText('Rae Okonkwo')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Rae Okonkwo' })).not.toBeInTheDocument();
  });

  it('carries the current query string into the speaker link (issue #22 review P2-8)', () => {
    renderWithSpeaker({ initialEntries: ['/schedule?preview=1'] });
    expect(screen.getByRole('link', { name: 'Rae Okonkwo' })).toHaveAttribute(
      'href',
      '/speakers/rae-okonkwo?preview=1',
    );
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
            <ContentContext.Provider value={{ speakers: [] }}>
              <ProfileContext.Provider value={{ attendeeAccess: false }}>
                <ToastProvider>
                  <ul>
                    <SessionCard session={unresolved} eventConfig={fixtureConfig} features={{ icsExport: true }} />
                  </ul>
                </ToastProvider>
              </ProfileContext.Provider>
            </ContentContext.Provider>
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

  describe('reactions pill (features.sessionReactions)', () => {
    it('renders nothing for a signed-out visitor when every count is zero', () => {
      renderCard({ features: { sessionReactions: true }, auth: { user: null } });
      expect(screen.queryByRole('group', { name: /session reactions/i })).toBeNull();
    });

    it('shows read-only counts to a signed-out visitor when a session has reactions', () => {
      useSessionReactionsMock.mockReturnValue({
        counts: { ...EMPTY_COUNTS, '👍': 3 },
        myReaction: null,
        loading: false,
      });
      renderCard({ features: { sessionReactions: true }, auth: { user: null } });
      expect(screen.queryByRole('button', { name: /react with/i })).toBeNull();
      expect(screen.getByRole('group', { name: /session reactions/i })).toHaveTextContent('3');
    });

    it('shows read-only counts for a signed-in user without attendee access', () => {
      useSessionReactionsMock.mockReturnValue({
        counts: { ...EMPTY_COUNTS, '👍': 1 },
        myReaction: null,
        loading: false,
      });
      renderCard({
        features: { sessionReactions: true },
        auth: { user: { uid: 'u1' } },
        profile: { attendeeAccess: false },
      });
      expect(screen.queryByRole('button', { name: /react with/i })).toBeNull();
    });

    it('an approved attendee can pick a reaction, optimistically', async () => {
      setSessionReactionMock.mockResolvedValue({ emoji: '👍', counts: { ...EMPTY_COUNTS, '👍': 1 } });
      renderCard({
        features: { sessionReactions: true },
        auth: { user: { uid: 'u1' } },
        profile: { attendeeAccess: true },
      });
      const button = screen.getByRole('button', { name: /react with 👍/i });
      expect(button).toHaveAttribute('aria-pressed', 'false');
      fireEvent.click(button);
      // Optimistic: flips before the promise resolves.
      expect(screen.getByRole('button', { name: /react with 👍/i })).toHaveAttribute('aria-pressed', 'true');
      expect(setSessionReactionMock).toHaveBeenCalledWith({
        user: { uid: 'u1' },
        sessionId: 'fx-1',
        emoji: '👍',
      });
    });

    it('an already-reacted user with no override shows the correct count and stays selected', () => {
      // Regression test for the optimistic-sentinel collision: `counts`
      // already includes this user's own reaction (as the real aggregate
      // would), so with no click in flight the displayed count must NOT be
      // decremented, and the button must still read as pressed.
      useSessionReactionsMock.mockReturnValue({
        counts: { ...EMPTY_COUNTS, '👍': 1 },
        myReaction: '👍',
        loading: false,
      });
      renderCard({
        features: { sessionReactions: true },
        auth: { user: { uid: 'u1' } },
        profile: { attendeeAccess: true },
      });
      const button = screen.getByRole('button', { name: /react with 👍/i });
      expect(button).toHaveAttribute('aria-pressed', 'true');
      expect(button).toHaveAccessibleName('React with 👍, 1');
    });

    it('clicking the reaction you already left clears it: unselects immediately and decrements exactly once', async () => {
      useSessionReactionsMock.mockReturnValue({
        counts: { ...EMPTY_COUNTS, '👍': 1 },
        myReaction: '👍',
        loading: false,
      });
      // Resolves only when told to, so the assertions below observe the
      // OPTIMISTIC (pre-confirmation) state, not the post-confirmation one.
      let resolveRequest;
      setSessionReactionMock.mockReturnValue(
        new Promise((resolve) => {
          resolveRequest = resolve;
        }),
      );
      renderCard({
        features: { sessionReactions: true },
        auth: { user: { uid: 'u1' } },
        profile: { attendeeAccess: true },
      });
      const button = screen.getByRole('button', { name: /react with 👍/i });
      expect(button).toHaveAttribute('aria-pressed', 'true');
      fireEvent.click(button);

      // Optimistic clear: unselected, and the count drops from 1 to 0 —
      // exactly once, not further on a stray re-render.
      const clearedButton = screen.getByRole('button', { name: /^React with 👍$/i });
      expect(clearedButton).toHaveAttribute('aria-pressed', 'false');
      expect(clearedButton).toHaveAccessibleName('React with 👍');

      expect(setSessionReactionMock).toHaveBeenCalledWith({
        user: { uid: 'u1' },
        sessionId: 'fx-1',
        emoji: null,
      });

      // Drain the in-flight promise so it can't resolve into a later test.
      resolveRequest({ emoji: null, counts: EMPTY_COUNTS });
      await screen.findByRole('button', { name: /^React with 👍$/i });
    });

    it('reverts the optimistic pick when the request fails', async () => {
      setSessionReactionMock.mockRejectedValue(new Error('The reaction could not be saved.'));
      renderCard({
        features: { sessionReactions: true },
        auth: { user: { uid: 'u1' } },
        profile: { attendeeAccess: true },
      });
      fireEvent.click(screen.getByRole('button', { name: /react with 👍/i }));
      expect(await screen.findByRole('button', { name: /react with 👍/i })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
      expect(await screen.findByRole('alert')).toHaveTextContent('The reaction could not be saved.');
    });

    it('resets the optimistic override when the signed-in identity changes', async () => {
      setSessionReactionMock.mockResolvedValue({ emoji: '👍', counts: { ...EMPTY_COUNTS, '👍': 1 } });
      const { rerenderCard } = renderCard({
        features: { sessionReactions: true },
        auth: { user: { uid: 'u1' } },
        profile: { attendeeAccess: true },
      });
      fireEvent.click(screen.getByRole('button', { name: /react with 👍/i }));
      await screen.findByRole('button', { name: /react with 👍.*1/i });

      rerenderCard({
        features: { sessionReactions: true },
        auth: { user: { uid: 'u2' } },
        profile: { attendeeAccess: true },
      });
      expect(await screen.findByRole('button', { name: /react with 👍$/i })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
    });
  });
});

// Issue #113, closed by the editorial restyle (design brief §2.4, §5.1).
//
// Two rejected patterns leave the schedule here: the arbitrary colored left
// edge on a keynote card, and the fully rounded pill. Both assertions are
// written against the rendered class list on purpose — these are shape
// rules, and a shape rule that no test can see is a shape rule that comes
// back on the next restyle.
describe('SessionCard shape rules, issue 113', () => {
  const classesOf = (container) =>
    [...container.querySelectorAll('*')].flatMap((node) => [...node.classList]);

  it('gives a keynote no colored left edge', () => {
    const { container } = renderCard();
    const classes = classesOf(container);
    expect(classes).not.toContain('border-s-4');
    expect(classes).not.toContain('border-s-keynote');
  });

  it('names the keynote in words, so nothing depends on color alone', () => {
    // §8.1: never signal status with color alone. The type is the word.
    renderCard();
    expect(screen.getByText('keynote')).toBeInTheDocument();
  });

  it('opens the row with a hairline instead of boxing it in a card', () => {
    const { container } = renderCard();
    const row = container.querySelector('li');
    expect(row).toHaveClass('border-t-hairline', 'border-t-rule-hairline');
    expect(row.querySelector('article').className).not.toContain('rounded-brand');
  });

  it('renders the type badge as a small rectangle, never a pill', () => {
    const { container } = renderCard();
    const badge = screen.getByText('keynote');
    expect(badge.className).toContain('rounded-brand');
    expect(badge.className).not.toContain('rounded-full');
    expect(classesOf(container)).not.toContain('rounded-full');
  });

  it('keeps every session control off the pill shape too', () => {
    const { container } = renderCard({
      features: { sessionBookmarks: true, icsExport: true },
      auth: { user: { uid: 'u1' } },
      profile: { attendeeAccess: true },
    });
    expect(classesOf(container)).not.toContain('rounded-full');
    expect(screen.getByRole('button', { name: /bookmark/i }).className).toContain(
      'rounded-brand',
    );
  });

  it('sets the time in the mono face, which carries tabular figures', () => {
    // Interface guidelines, Typography: schedule columns read in tabular
    // figures, and .font-mono is where index.css sets them.
    const { container } = renderCard();
    const time = container.querySelector('time');
    expect(time.closest('p').className).toContain('font-mono');
  });

  it('puts the title before the time, so the time never stacks above the heading', () => {
    // The eyebrow ban is absolute and holds at every size (design brief
    // §2.4). This row is one column below `sm`, so the title has to come
    // first in the source; the grid moves the time back into its own
    // left-hand column once there is room for one.
    const { container } = renderCard();
    const heading = container.querySelector('h3');
    const time = container.querySelector('time');
    expect(heading.compareDocumentPosition(time) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
