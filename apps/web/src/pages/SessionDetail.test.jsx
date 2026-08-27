// SessionDetail — one published session at /schedule/:sessionId (issue #16).
// No Firebase, no network (spec §8.1); context providers only, same pattern
// as Schedule.test.jsx.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import EventConfigContext from '../contexts/EventConfigContext.jsx';
import ContentContext from '../contexts/ContentContext.jsx';
import AuthContext from '../contexts/AuthContext.jsx';
import ProfileContext from '../contexts/ProfileContext.jsx';
import { ToastProvider } from '../contexts/ToastContext.jsx';
import SessionDetail from './SessionDetail.jsx';

// session_materials_public (issue #23) — mocked the same way bookmarksSource
// would be, keeping this file Firebase-free (spec §8.1). Default: no rows.
const subscribeSessionMaterialsMock = vi.fn((sessionId, onNext) => {
  onNext([]);
  return () => {};
});
vi.mock('../lib/materialsSource.js', () => ({
  subscribeSessionMaterials: (...args) => subscribeSessionMaterialsMock(...args),
  fetchSessionMaterialUrl: vi.fn(),
}));

beforeEach(() => {
  subscribeSessionMaterialsMock.mockReset().mockImplementation((sessionId, onNext) => {
    onNext([]);
    return () => {};
  });
});

const fixtureConfig = {
  name: '[Fixture] Lakeshore Docs Camp',
  timezone: 'America/Chicago',
  days: [{ id: 'fx-day-1', label: 'Day one', date: '2026-10-15' }],
};

const fixtureSessions = [
  {
    id: 'fx-early',
    dayId: 'fx-day-1',
    startTime: '09:05',
    endTime: '09:45',
    title: '[Fixture] Morning kickoff',
    description: '[Fixture] What the day covers.',
    location: 'Main hall',
    type: 'keynote',
    speakerIds: [],
    visible: true,
  },
  {
    id: 'fx-hidden',
    dayId: 'fx-day-1',
    startTime: '11:00',
    endTime: '11:30',
    title: '[Fixture] Unpublished session',
    type: 'panel',
    speakerIds: [],
    visible: false,
  },
];

function renderDetail(
  sessionId,
  {
    eventConfig = fixtureConfig,
    features = { schedule: true },
    scheduleData = fixtureSessions,
    loading = false,
    auth = { user: null },
    profile = { attendeeAccess: false },
    search = '',
  } = {},
) {
  return render(
    <MemoryRouter
      initialEntries={[`/schedule/${sessionId}${search}`]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <EventConfigContext.Provider
        value={{ eventConfig, features, theme: {}, badges: null, source: 'snapshot' }}
      >
        <AuthContext.Provider value={auth}>
          <ProfileContext.Provider value={profile}>
            <ToastProvider>
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
                <Routes>
                  <Route path="/schedule/:sessionId" element={<SessionDetail />} />
                </Routes>
              </ContentContext.Provider>
            </ToastProvider>
          </ProfileContext.Provider>
        </AuthContext.Provider>
      </EventConfigContext.Provider>
    </MemoryRouter>,
  );
}

describe('SessionDetail', () => {
  it('renders the session title, time, location, and description', () => {
    renderDetail('fx-early');
    expect(
      screen.getByRole('heading', { level: 1, name: '[Fixture] Morning kickoff' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Main hall')).toBeInTheDocument();
    expect(screen.getByText('[Fixture] What the day covers.')).toBeInTheDocument();
    expect(screen.getByText('Day one')).toBeInTheDocument();
  });

  it('sets the title in the heading face on the type-scale step, and the time in the mono face', () => {
    // Design brief §2.1/§3.2: real typographic hierarchy carries the
    // structure, and a changing value (the time) reads in the mono face
    // with tabular figures — never a card, never a colored edge.
    const { container } = renderDetail('fx-early');
    expect(
      screen.getByRole('heading', { level: 1, name: '[Fixture] Morning kickoff' }),
    ).toHaveClass('font-heading', 'text-h1');
    const time = container.querySelector('header time');
    expect(time.closest('.font-mono')).not.toBeNull();
  });

  it('404s (designed empty state) for an unknown session id', () => {
    renderDetail('no-such-session');
    expect(
      screen.getByRole('heading', { name: 'This session is not available' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the schedule' })).toHaveAttribute(
      'href',
      '/schedule',
    );
  });

  it('carries ?preview=1 into both "back to the schedule" links', () => {
    renderDetail('fx-early', { search: '?preview=1' });
    expect(
      screen.getByRole('link', { name: '← Back to the schedule' }),
    ).toHaveAttribute('href', '/schedule?preview=1');
  });

  it('carries ?preview=1 into the 404 state\'s "back to the schedule" link too', () => {
    renderDetail('no-such-session', { search: '?preview=1' });
    expect(screen.getByRole('link', { name: 'Back to the schedule' })).toHaveAttribute(
      'href',
      '/schedule?preview=1',
    );
  });

  it('404s for a hidden (visible:false) session — no ID enumeration', () => {
    renderDetail('fx-hidden');
    expect(
      screen.getByRole('heading', { name: 'This session is not available' }),
    ).toBeInTheDocument();
  });

  it('is hidden behind config/features.schedule even via direct navigation', () => {
    renderDetail('fx-early', { features: { schedule: false } });
    expect(
      screen.getByRole('heading', { name: 'This event doesn’t have a public schedule' }),
    ).toBeInTheDocument();
  });

  it('shows the loading state while runtime content is loading', () => {
    renderDetail('fx-early', { loading: true });
    expect(screen.getByRole('status', { name: 'Loading the session…' })).toBeInTheDocument();
  });

  it('renders no pill row when every relevant feature flag is off', () => {
    renderDetail('fx-early');
    expect(screen.queryByRole('button', { name: /bookmark/i })).toBeNull();
  });

  it('renders the bookmark pill when features.sessionBookmarks is on', () => {
    renderDetail('fx-early', { features: { schedule: true, sessionBookmarks: true } });
    expect(screen.getByRole('link', { name: /sign in to bookmark/i })).toBeInTheDocument();
  });

  it('renders no materials section when the session has no approved materials', () => {
    renderDetail('fx-early', { features: { schedule: true, sessionMaterials: true } });
    expect(screen.queryByRole('heading', { name: 'Materials' })).toBeNull();
  });

  it('lists approved materials from session_materials_public when features.sessionMaterials is on', () => {
    // Two hooks subscribe independently here (MaterialsPill's count and the
    // list itself), so this stubs every call, not just the first.
    subscribeSessionMaterialsMock.mockImplementation((sessionId, onNext) => {
      onNext([
        { id: 'm1', sessionId, type: 'link', filename: 'Opening slides', reviewStatus: 'approved' },
        { id: 'm2', sessionId, type: 'file', filename: 'handout.pdf', reviewStatus: 'approved' },
      ]);
      return () => {};
    });
    renderDetail('fx-early', { features: { schedule: true, sessionMaterials: true } });
    expect(screen.getByRole('heading', { name: 'Materials' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Opening slides' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'handout.pdf' })).toBeInTheDocument();
  });

  it('does not render the materials section when config/features.sessionMaterials is off, even with rows available', () => {
    subscribeSessionMaterialsMock.mockImplementationOnce((sessionId, onNext) => {
      onNext([{ id: 'm1', sessionId, type: 'link', filename: 'Slides', reviewStatus: 'approved' }]);
      return () => {};
    });
    renderDetail('fx-early', { features: { schedule: true, sessionMaterials: false } });
    expect(screen.queryByRole('heading', { name: 'Materials' })).toBeNull();
  });
});
