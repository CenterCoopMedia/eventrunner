// SessionCard — the shape of one row in the programme.
//
// What each control DOES is session/SessionActions.test.jsx's subject; this
// file is about the row: what it states, in what order, and at what weight.
// No Firebase, no network (spec §8.1) — every source module is mocked.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AuthContext from '../contexts/AuthContext.jsx';
import ContentContext from '../contexts/ContentContext.jsx';
import ProfileContext from '../contexts/ProfileContext.jsx';
import { ToastProvider } from '../contexts/ToastContext.jsx';
import SessionCard from './SessionCard.jsx';

vi.mock('../lib/bookmarksSource.js', () => ({ setSessionBookmarked: vi.fn() }));

const subscribeSessionMaterialsMock = vi.fn((sessionId, onNext) => {
  onNext([]);
  return () => {};
});
vi.mock('../lib/materialsSource.js', () => ({
  subscribeSessionMaterials: (...args) => subscribeSessionMaterialsMock(...args),
}));

vi.mock('../lib/reactionsSource.js', () => ({
  REACTION_KINDS: ['👍', '❤️', '🎉', '💡', '👏'],
  setSessionReaction: vi.fn(),
}));

const EMPTY_COUNTS = { '👍': 0, '❤️': 0, '🎉': 0, '💡': 0, '👏': 0 };
const useSessionReactionsMock = vi.fn(() => ({
  counts: EMPTY_COUNTS,
  myReaction: null,
  loading: false,
}));
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

function renderCard({
  features = {},
  auth = { user: null },
  profile = { attendeeAccess: false },
  bookmarked = false,
  initialEntries = ['/schedule'],
  content = { speakers: [] },
  session = fixtureSession,
  position = null,
  lead = false,
} = {}) {
  return render(
    <MemoryRouter
      initialEntries={initialEntries}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <AuthContext.Provider value={auth}>
        <ContentContext.Provider value={content}>
          <ProfileContext.Provider value={profile}>
            <ToastProvider>
              <ul>
                <SessionCard
                  session={session}
                  eventConfig={fixtureConfig}
                  features={features}
                  bookmarked={bookmarked}
                  position={position}
                  lead={lead}
                />
              </ul>
            </ToastProvider>
          </ProfileContext.Provider>
        </ContentContext.Provider>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  subscribeSessionMaterialsMock.mockReset().mockImplementation((sessionId, onNext) => {
    onNext([]);
    return () => {};
  });
  useSessionReactionsMock.mockReset();
  useSessionReactionsMock.mockReturnValue({
    counts: EMPTY_COUNTS,
    myReaction: null,
    loading: false,
  });
});

describe('what a row states', () => {
  it('states the time, the title, the format, the room, and nothing invented', () => {
    const { container } = renderCard();
    expect(container.querySelector('time')).toHaveTextContent('9:05');
    expect(screen.getByRole('heading', { name: fixtureSession.title })).toBeInTheDocument();
    expect(screen.getByText('keynote')).toBeInTheDocument();
    expect(container.textContent).toContain('Main hall');
    expect(container.textContent).not.toMatch(/transfer/i);
  });

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

  it('names one way into the session, however many features are off', () => {
    renderCard({ features: {} });
    expect(screen.getByRole('link', { name: 'Session details' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /bookmark/i })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add to calendar' })).toBeNull();
  });

  function renderWithSpeaker({ speakerFeature = true, initialEntries = ['/schedule'] } = {}) {
    return renderCard({
      session: { ...fixtureSession, speakerIds: ['spk-1', 'spk-ghost'] },
      features: { speakers: speakerFeature },
      initialEntries,
      content: {
        speakers: [{ id: 'spk-1', displayName: 'Rae Okonkwo', slug: 'rae-okonkwo' }],
      },
    });
  }

  it('renders a link per resolved speaker name, dropping ids with no matching document', () => {
    renderWithSpeaker();
    expect(screen.getByRole('link', { name: 'Rae Okonkwo' })).toHaveAttribute(
      'href',
      '/speakers/rae-okonkwo',
    );
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
});

// Issue #113, closed by the editorial restyle (design brief §2.4, §5.1),
// and re-argued by this review: two rejected patterns leave the schedule —
// the arbitrary colored left edge on a keynote card, and the fully rounded
// pill — and a third leaves with them, the shelf of bordered controls under
// every row. All three assertions are written against the rendered class
// list on purpose: a shape rule no test can see is a shape rule that comes
// back on the next restyle.
describe('the row keeps its shape rules', () => {
  const classesOf = (container) =>
    [...container.querySelectorAll('*')].flatMap((node) => [...node.classList]);

  it('gives a keynote no colored left edge', () => {
    const classes = classesOf(renderCard().container);
    expect(classes).not.toContain('border-s-4');
    expect(classes).not.toContain('border-s-keynote');
  });

  it('names the keynote in words, so nothing depends on color alone', () => {
    // §8.1: never signal status with color alone. The format is the word.
    renderCard();
    expect(screen.getByText('keynote')).toBeInTheDocument();
  });

  it('opens the row with a rule instead of boxing it in a card', () => {
    // The rule is the --session-card-rule-* contract now, drawn in
    // index.css rather than by a border utility: a style moves the width
    // (Zine sets the strong rule), and a utility in a later cascade layer
    // would beat the token every time.
    const { container } = renderCard();
    const row = container.querySelector('li');
    expect(row).toHaveClass('session-block');
    expect(row.className).not.toContain('border-t-hairline');
    expect(row.querySelector('article').className).not.toContain('rounded-brand');
  });

  it('reads its measure and its steps from the tier-3 contract, not utilities', () => {
    // A Schedule style is a data change (brief §3.4): picking one remaps
    // these tokens and the row has to follow. A `py-md`/`text-h3` utility
    // on the markup would silently outrank every one of them.
    const { container } = renderCard();
    const face = container.querySelector('.session-block__face');
    expect(face.className).not.toContain('py-md');
    expect(container.querySelector('.session-block__data')).not.toBeNull();
    expect(container.querySelector('.session-block__title').className).not.toContain('text-h3');
  });

  it('numbers the row only from a real position, never a decorative one', () => {
    // §2.4 rejects zero-padded decorative numbers. This is the session's
    // real place in its day, and the five styles that do not number their
    // programme hide it with --schedule-number-display.
    const { container } = renderCard();
    expect(container.querySelector('.session-block__number')).toBeNull();
    const numbered = renderCard({ position: 3 });
    expect(numbered.container.querySelector('.session-block__number').textContent).toBe('3');
  });

  it('marks the first row of a day so lead-and-rest can set it larger', () => {
    expect(renderCard().container.querySelector('li').className).not.toContain(
      'session-block--lead',
    );
    expect(renderCard({ lead: true }).container.querySelector('li')).toHaveClass(
      'session-block--lead',
    );
  });

  it('renders the session format as a small rectangle, never a pill', () => {
    const { container } = renderCard();
    const format = screen.getByText('keynote');
    expect(format.className).toContain('rounded-brand');
    expect(format.className).not.toContain('rounded-full');
    expect(classesOf(container)).not.toContain('rounded-full');
  });

  it('draws no shelf of bordered controls under the row', () => {
    subscribeSessionMaterialsMock.mockImplementation((sessionId, onNext) => {
      onNext([{ id: 'm1', sessionId, type: 'link', filename: 'Slides', reviewStatus: 'approved' }]);
      return () => {};
    });
    const { container } = renderCard({
      features: {
        sessionBookmarks: true,
        sessionMaterials: true,
        sessionReactions: true,
        icsExport: true,
      },
      auth: { user: { uid: 'u1' } },
      profile: { attendeeAccess: true },
    });
    const controls = [...container.querySelectorAll('.session-actions a, .session-actions button')];
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) {
      expect(control.className).not.toContain('border-hairline');
      expect(control.className).not.toContain('rounded-brand');
    }
    // The five reaction chips were the bulk of the old shelf. They are on
    // the session's own page now, not under every row of the programme.
    expect(screen.queryByRole('group', { name: /session reactions/i })).toBeNull();
  });

  it('sets the time in the mono face, which carries tabular figures', () => {
    // Interface guidelines, Typography: schedule columns read in tabular
    // figures, and .font-mono is where index.css sets them.
    const { container } = renderCard();
    expect(container.querySelector('time').closest('p').className).toContain('font-mono');
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

  it('sends the time back to the left-hand column at `sm`, so the wide row is unchanged', () => {
    // Title first in the source is a narrow-screen rule; it must not cost
    // the wide row its time column. These are the placements that put the
    // time back beside the title once there is room.
    const { container } = renderCard();
    const time = container.querySelector('time').closest('p');
    expect(time.className).toContain('sm:col-start-1');
    expect(time.className).toContain('sm:row-start-1');
    const heading = container.querySelector('h3');
    expect(heading.parentElement.className).toContain('sm:col-start-2');
    expect(heading.parentElement.className).toContain('sm:row-start-1');
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

  it('spans the time cell across both rows, so a wrapped time cannot push row 2 down', () => {
    // Row 1 holds the title/badge cell and row 2 holds the location and
    // description. Without row-span-2 the time cell sizes row 1 on its own,
    // and a time range long enough to wrap (e.g. "10:30 AM–12:00 PM EDT")
    // grows row 1 taller than the title needs and pushes row 2 with it.
    const { container } = renderCard();
    const time = container.querySelector('time');
    expect(time.closest('p').className).toContain('sm:row-span-2');
  });
});
