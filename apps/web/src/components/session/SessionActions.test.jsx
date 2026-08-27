// SessionActions — which controls a session gets, and where.
//
// The set is different on the two surfaces, and that difference is the
// point of the component, so it is tested first and by name. No Firebase,
// no network (spec §8.1): every source module is mocked.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AuthContext from '../../contexts/AuthContext.jsx';
import ProfileContext from '../../contexts/ProfileContext.jsx';
import { ToastProvider } from '../../contexts/ToastContext.jsx';
import SessionActions from './SessionActions.jsx';

const setSessionBookmarkedMock = vi.fn();
vi.mock('../../lib/bookmarksSource.js', () => ({
  setSessionBookmarked: (...args) => setSessionBookmarkedMock(...args),
}));

const subscribeSessionMaterialsMock = vi.fn((sessionId, onNext) => {
  onNext([]);
  return () => {};
});
vi.mock('../../lib/materialsSource.js', () => ({
  subscribeSessionMaterials: (...args) => subscribeSessionMaterialsMock(...args),
}));

const setSessionReactionMock = vi.fn();
vi.mock('../../lib/reactionsSource.js', () => ({
  REACTION_KINDS: ['👍', '❤️', '🎉', '💡', '👏'],
  setSessionReaction: (...args) => setSessionReactionMock(...args),
}));

const EMPTY_COUNTS = { '👍': 0, '❤️': 0, '🎉': 0, '💡': 0, '👏': 0 };
const useSessionReactionsMock = vi.fn(() => ({
  counts: EMPTY_COUNTS,
  myReaction: null,
  loading: false,
}));
vi.mock('../../hooks/useSessionReactions.js', () => ({
  useSessionReactions: (...args) => useSessionReactionsMock(...args),
}));

const downloadIcsMock = vi.fn();
vi.mock('../../utils/calendar.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, downloadIcs: (...args) => downloadIcsMock(...args) };
});

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
  location: 'Main hall',
  type: 'keynote',
  speakerIds: [],
  visible: true,
};

const EVERY_FEATURE = {
  sessionBookmarks: true,
  sessionMaterials: true,
  sessionReactions: true,
  icsExport: true,
};

function actionsTree({
  surface = 'row',
  features = {},
  auth = { user: null },
  profile = { attendeeAccess: false },
  bookmarked = false,
  backIssue = false,
  initialEntries = ['/schedule'],
  session = fixtureSession,
} = {}) {
  return (
    <MemoryRouter
      initialEntries={initialEntries}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <AuthContext.Provider value={auth}>
        <ProfileContext.Provider value={profile}>
          <ToastProvider>
            <SessionActions
              surface={surface}
              session={session}
              eventConfig={fixtureConfig}
              features={features}
              bookmarked={bookmarked}
              backIssue={backIssue}
            />
          </ToastProvider>
        </ProfileContext.Provider>
      </AuthContext.Provider>
    </MemoryRouter>
  );
}

function renderActions(props = {}) {
  const result = render(actionsTree(props));
  return {
    ...result,
    // Rerenders the SAME tree shape with new props so a test can simulate
    // the `bookmarked` prop changing underneath an already-mounted
    // BookmarkAction (a subscription update, an identity switch) without
    // unmounting it.
    rerenderActions: (nextProps) => result.rerender(actionsTree(nextProps)),
  };
}

const twoMaterials = (sessionId, onNext) => {
  onNext([
    { id: 'm1', sessionId, type: 'link', filename: 'Slides', reviewStatus: 'approved' },
    { id: 'm2', sessionId, type: 'file', filename: 'handout.pdf', reviewStatus: 'approved' },
  ]);
  return () => {};
};

beforeEach(() => {
  setSessionBookmarkedMock.mockReset();
  subscribeSessionMaterialsMock.mockReset().mockImplementation((sessionId, onNext) => {
    onNext([]);
    return () => {};
  });
  setSessionReactionMock.mockReset();
  downloadIcsMock.mockReset();
  useSessionReactionsMock.mockReset();
  useSessionReactionsMock.mockReturnValue({
    counts: EMPTY_COUNTS,
    myReaction: null,
    loading: false,
  });
});

describe('which controls each surface gets', () => {
  const approved = {
    auth: { user: { uid: 'u1' } },
    profile: { attendeeAccess: true },
    features: EVERY_FEATURE,
  };

  it('gives a row a bookmark, a materials link, one calendar control, and one way in', () => {
    subscribeSessionMaterialsMock.mockImplementation(twoMaterials);
    renderActions({ ...approved, surface: 'row' });
    expect(screen.getByRole('button', { name: /^bookmark$/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Materials (2)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add to calendar' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Session details' })).toHaveAttribute(
      'href',
      '/schedule/fx-1',
    );
  });

  it('keeps reactions off the row entirely', () => {
    useSessionReactionsMock.mockReturnValue({
      counts: { ...EMPTY_COUNTS, '👍': 9 },
      myReaction: null,
      loading: false,
    });
    renderActions({ ...approved, surface: 'row' });
    expect(screen.queryByRole('group', { name: /session reactions/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /react with/i })).toBeNull();
  });

  it('gives the detail page the reactions, and no link back to itself', () => {
    subscribeSessionMaterialsMock.mockImplementation(twoMaterials);
    renderActions({ ...approved, surface: 'detail' });
    expect(screen.getByRole('group', { name: /session reactions/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Session details' })).toBeNull();
    // The materials list itself is on this page, so the count link is not.
    expect(screen.queryByRole('link', { name: /^Materials/ })).toBeNull();
  });

  it('renders no more than three separate targets on a row', () => {
    // The shelf this replaced could reach ten: five reaction chips, three
    // calendar buttons, a materials box, and a bookmark. Closed, a row now
    // carries the bookmark, the calendar disclosure, and the way in — plus
    // the materials count when a session has any.
    renderActions({ ...approved, surface: 'row' });
    const targets = [...screen.getByRole('link', { name: 'Session details' }).parentElement.children];
    expect(targets).toHaveLength(3);
  });

  it('renders nothing at all on a detail page whose every feature is off', () => {
    const { container } = renderActions({ surface: 'detail', features: {} });
    expect(container.querySelector('.session-actions')).toBeNull();
  });

  it('takes the live controls off a back issue and keeps the materials count', () => {
    subscribeSessionMaterialsMock.mockImplementation(twoMaterials);
    renderActions({ ...approved, surface: 'row', backIssue: true });
    expect(screen.queryByRole('button', { name: /bookmark/i })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add to calendar' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Materials (2)' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Session details' })).toBeInTheDocument();
  });

  it('draws no bordered box around any control on a row', () => {
    // The shelf is the pattern that went; a class assertion is the only
    // thing that keeps it gone through the next restyle.
    subscribeSessionMaterialsMock.mockImplementation(twoMaterials);
    const { container } = renderActions({ ...approved, surface: 'row' });
    const classes = [...container.querySelectorAll('a, button')].flatMap((node) => [
      ...node.classList,
    ]);
    expect(classes).not.toContain('border-hairline');
    expect(classes).not.toContain('rounded-brand');
    expect(classes).not.toContain('rounded-full');
  });
});

describe('BookmarkAction', () => {
  it('offers a signed-out visitor the path that makes them eligible', () => {
    renderActions({ features: { sessionBookmarks: true }, auth: { user: null } });
    expect(screen.getByRole('link', { name: 'Sign in to save sessions' })).toHaveAttribute(
      'href',
      '/signin',
    );
  });

  it('renders no control at all for a signed-in visitor who cannot bookmark', () => {
    // The old pill drew a dead, greyed-out rectangle here — an offer the
    // page had already refused, repeated under every session.
    renderActions({
      features: { sessionBookmarks: true },
      auth: { user: { uid: 'u1' } },
      profile: { attendeeAccess: false },
    });
    expect(screen.queryByText(/bookmark/i)).toBeNull();
    expect(screen.queryByText(/sign in/i)).toBeNull();
    expect(document.querySelector('[aria-disabled="true"]')).toBeNull();
  });

  it('lets an approved attendee toggle the bookmark, optimistically', () => {
    setSessionBookmarkedMock.mockResolvedValue({ bookmarked: true, count: 1 });
    renderActions({
      features: { sessionBookmarks: true },
      auth: { user: { uid: 'u1' } },
      profile: { attendeeAccess: true },
      bookmarked: false,
    });
    const button = screen.getByRole('button', { name: /bookmark/i });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(button);
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
    renderActions({
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

  it('drops the optimistic override once an external change updates the subscribed prop', async () => {
    setSessionBookmarkedMock.mockResolvedValue({ bookmarked: true, count: 1 });
    const attendee = {
      features: { sessionBookmarks: true },
      auth: { user: { uid: 'u1' } },
      profile: { attendeeAccess: true },
    };
    const { rerenderActions } = renderActions({ ...attendee, bookmarked: false });
    fireEvent.click(screen.getByRole('button', { name: /bookmark/i }));
    await screen.findByRole('button', { name: /bookmarked/i });

    // The subscription catches up and confirms the write.
    rerenderActions({ ...attendee, bookmarked: true });
    expect(await screen.findByRole('button', { name: /bookmarked/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // Someone else unbookmarks it from elsewhere (another tab, an admin
    // action). Before the fix a stale `optimistic` masked every later
    // update, so the control stayed stuck on "Bookmarked" forever.
    rerenderActions({ ...attendee, bookmarked: false });
    const button = await screen.findByRole('button', { name: /^Bookmark$/i });
    expect(button).toHaveAttribute('aria-pressed', 'false');

    // A later click now sends the CORRECT desired state, not the inverse
    // of a stale optimistic value.
    setSessionBookmarkedMock.mockClear();
    fireEvent.click(button);
    expect(setSessionBookmarkedMock).toHaveBeenCalledWith({
      user: { uid: 'u1' },
      sessionId: 'fx-1',
      bookmarked: true,
    });
    await screen.findByRole('button', { name: /bookmarked/i });
  });

  it('resets the optimistic override when the signed-in identity changes', async () => {
    setSessionBookmarkedMock.mockResolvedValue({ bookmarked: true, count: 1 });
    const { rerenderActions } = renderActions({
      features: { sessionBookmarks: true },
      auth: { user: { uid: 'u1' } },
      profile: { attendeeAccess: true },
      bookmarked: false,
    });
    fireEvent.click(screen.getByRole('button', { name: /bookmark/i }));
    await screen.findByRole('button', { name: /bookmarked/i });

    rerenderActions({
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

describe('CalendarMenu', () => {
  it('is one closed disclosure until the reader opens it', () => {
    renderActions({ features: { icsExport: true } });
    const trigger = screen.getByRole('button', { name: 'Add to calendar' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: 'Google Calendar' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Outlook' })).toBeNull();
    expect(screen.queryByRole('button', { name: /\.ics/ })).toBeNull();
  });

  it('opens onto the three destinations, and only then', () => {
    renderActions({ features: { icsExport: true } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to calendar' }));
    expect(screen.getByRole('button', { name: 'Add to calendar' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('link', { name: 'Google Calendar' })).toHaveAttribute(
      'href',
      expect.stringContaining('calendar.google.com'),
    );
    expect(screen.getByRole('link', { name: 'Outlook' })).toHaveAttribute(
      'href',
      expect.stringContaining('outlook.live.com'),
    );
    expect(screen.getByRole('button', { name: 'Calendar file (.ics)' })).toBeInTheDocument();
  });

  it('downloads the file and closes itself', () => {
    renderActions({ features: { icsExport: true } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to calendar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Calendar file (.ics)' }));
    expect(downloadIcsMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Add to calendar' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('closes on Escape and gives focus back to the control that opened it', () => {
    renderActions({ features: { icsExport: true } });
    const trigger = screen.getByRole('button', { name: 'Add to calendar' });
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('link', { name: 'Google Calendar' }), { key: 'Escape' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
  });

  it('renders no control for a session whose time cannot be resolved', () => {
    renderActions({
      features: { icsExport: true },
      session: { ...fixtureSession, dayId: 'no-such-day' },
    });
    expect(screen.queryByRole('button', { name: 'Add to calendar' })).toBeNull();
  });
});

describe('MaterialsLink', () => {
  it('says nothing when a session has no approved materials', () => {
    renderActions({ features: { sessionMaterials: true } });
    expect(screen.queryByText(/material/i)).toBeNull();
  });

  it('counts the live rows and goes to the list it counts', () => {
    subscribeSessionMaterialsMock.mockImplementation(twoMaterials);
    renderActions({ features: { sessionMaterials: true } });
    expect(screen.getByRole('link', { name: 'Materials (2)' })).toHaveAttribute(
      'href',
      '/schedule/fx-1#session-materials',
    );
  });

  it('carries the preview query string into the link', () => {
    subscribeSessionMaterialsMock.mockImplementation(twoMaterials);
    renderActions({
      features: { sessionMaterials: true },
      initialEntries: ['/schedule?preview=1'],
    });
    expect(screen.getByRole('link', { name: 'Materials (2)' })).toHaveAttribute(
      'href',
      '/schedule/fx-1?preview=1#session-materials',
    );
  });
});

describe('ReactionGroup, on the detail surface', () => {
  const onDetail = (props) => renderActions({ surface: 'detail', ...props });

  it('renders nothing for a signed-out visitor when every count is zero', () => {
    onDetail({ features: { sessionReactions: true }, auth: { user: null } });
    expect(screen.queryByRole('group', { name: /session reactions/i })).toBeNull();
  });

  it('shows read-only counts to a signed-out visitor when a session has reactions', () => {
    useSessionReactionsMock.mockReturnValue({
      counts: { ...EMPTY_COUNTS, '👍': 3 },
      myReaction: null,
      loading: false,
    });
    onDetail({ features: { sessionReactions: true }, auth: { user: null } });
    expect(screen.queryByRole('button', { name: /react with/i })).toBeNull();
    expect(screen.getByRole('group', { name: /session reactions/i })).toHaveTextContent('3');
  });

  it('shows read-only counts for a signed-in user without attendee access', () => {
    useSessionReactionsMock.mockReturnValue({
      counts: { ...EMPTY_COUNTS, '👍': 1 },
      myReaction: null,
      loading: false,
    });
    onDetail({
      features: { sessionReactions: true },
      auth: { user: { uid: 'u1' } },
      profile: { attendeeAccess: false },
    });
    expect(screen.queryByRole('button', { name: /react with/i })).toBeNull();
  });

  it('lets an approved attendee pick a reaction, optimistically', () => {
    setSessionReactionMock.mockResolvedValue({ emoji: '👍', counts: { ...EMPTY_COUNTS, '👍': 1 } });
    onDetail({
      features: { sessionReactions: true },
      auth: { user: { uid: 'u1' } },
      profile: { attendeeAccess: true },
    });
    const button = screen.getByRole('button', { name: /react with 👍/i });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(button);
    expect(screen.getByRole('button', { name: /react with 👍/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(setSessionReactionMock).toHaveBeenCalledWith({
      user: { uid: 'u1' },
      sessionId: 'fx-1',
      emoji: '👍',
    });
  });

  it('shows an already-reacted user the right count, still selected, with no click in flight', () => {
    // Regression test for the optimistic-sentinel collision: `counts`
    // already includes this user's own reaction, so with no click in flight
    // the displayed count must NOT be decremented.
    useSessionReactionsMock.mockReturnValue({
      counts: { ...EMPTY_COUNTS, '👍': 1 },
      myReaction: '👍',
      loading: false,
    });
    onDetail({
      features: { sessionReactions: true },
      auth: { user: { uid: 'u1' } },
      profile: { attendeeAccess: true },
    });
    const button = screen.getByRole('button', { name: /react with 👍/i });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button).toHaveAccessibleName('React with 👍, 1');
  });

  it('clears the reaction you already left: unselects at once, decrements exactly once', async () => {
    useSessionReactionsMock.mockReturnValue({
      counts: { ...EMPTY_COUNTS, '👍': 1 },
      myReaction: '👍',
      loading: false,
    });
    // Resolves only when told to, so the assertions below observe the
    // OPTIMISTIC state, not the post-confirmation one.
    let resolveRequest;
    setSessionReactionMock.mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    );
    onDetail({
      features: { sessionReactions: true },
      auth: { user: { uid: 'u1' } },
      profile: { attendeeAccess: true },
    });
    fireEvent.click(screen.getByRole('button', { name: /react with 👍/i }));

    const cleared = screen.getByRole('button', { name: /^React with 👍$/i });
    expect(cleared).toHaveAttribute('aria-pressed', 'false');
    expect(cleared).toHaveAccessibleName('React with 👍');
    expect(setSessionReactionMock).toHaveBeenCalledWith({
      user: { uid: 'u1' },
      sessionId: 'fx-1',
      emoji: null,
    });

    resolveRequest({ emoji: null, counts: EMPTY_COUNTS });
    await screen.findByRole('button', { name: /^React with 👍$/i });
  });

  it('reverts the optimistic pick when the request fails', async () => {
    setSessionReactionMock.mockRejectedValue(new Error('The reaction could not be saved.'));
    onDetail({
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
    const { rerenderActions } = renderActions({
      surface: 'detail',
      features: { sessionReactions: true },
      auth: { user: { uid: 'u1' } },
      profile: { attendeeAccess: true },
    });
    fireEvent.click(screen.getByRole('button', { name: /react with 👍/i }));
    await screen.findByRole('button', { name: /react with 👍.*1/i });

    rerenderActions({
      surface: 'detail',
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
