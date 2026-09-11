// The public shared schedule page (issue #173). The projection source is
// mocked; what is under test is who sees what: the permitted viewer, the
// stated reason, and the nothing at all for an owner who never consented.
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AuthContext from '../contexts/AuthContext.jsx';
import ContentContext from '../contexts/ContentContext.jsx';
import EventConfigContext from '../contexts/EventConfigContext.jsx';
import ProfileContext from '../contexts/ProfileContext.jsx';
import ToastContext from '../contexts/ToastContext.jsx';
import SharedSchedule from './SharedSchedule.jsx';

const holder = { share: undefined, error: false };
vi.mock('../lib/scheduleShareSource.js', () => ({
  subscribeScheduleShare: (uid, onNext, onError) => {
    if (holder.error) onError(new Error('denied'));
    else onNext(holder.share);
    return () => {};
  },
}));

const EVENT = {
  name: '[Fixture] Lakeshore Docs Camp',
  timezone: 'America/Chicago',
  days: [{ id: 'fx-day-1', label: 'Day one', date: '2026-10-15' }],
};

const SESSIONS = [
  {
    id: 'fx-s1',
    dayId: 'fx-day-1',
    startTime: '09:05',
    endTime: '09:45',
    title: '[Fixture] Morning kickoff',
    visible: true,
  },
  {
    id: 'fx-s2',
    dayId: 'fx-day-1',
    startTime: '13:30',
    endTime: '14:15',
    title: '[Fixture] Hidden from the share',
    visible: false,
  },
];

function sharedTree({ share, error = false, auth = { user: null, isAdmin: false, loading: false }, profile = { attendeeAccess: false }, features = { schedule: true, sessionBookmarks: true } } = {}) {
  holder.share = share;
  holder.error = error;
  return (
    <MemoryRouter initialEntries={['/schedule/user/owner-1']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="schedule/user/:uid" element={
          <EventConfigContext.Provider value={{ eventConfig: EVENT, features, theme: {}, badges: null, source: 'snapshot' }}>
            <AuthContext.Provider value={auth}>
              <ProfileContext.Provider value={profile}>
                <ToastContext.Provider value={{ showToast: () => {}, dismiss: () => {} }}>
                  <ContentContext.Provider
                    value={{
                      readSource: 'published',
                      siteContent: {},
                      scheduleData: SESSIONS,
                      speakers: [],
                      organizationsData: [],
                      loading: false,
                      getBlock: () => null,
                      getPage: () => null,
                      getSectionBlocks: () => [],
                    }}
                  >
                    <SharedSchedule />
                  </ContentContext.Provider>
                </ToastContext.Provider>
              </ProfileContext.Provider>
            </AuthContext.Provider>
          </EventConfigContext.Provider>
        } />
      </Routes>
    </MemoryRouter>
  );
}

function renderShared(options) { return render(sharedTree(options)); }

describe('the shared schedule page', () => {
  it('a permitted viewer sees the owner named and their saved sessions, as the usual rows', () => {
    renderShared({
      share: { scheduleVisibility: 'public', displayName: '[Fixture] Alex Rivera', sessionIds: ['fx-s1'] },
    });
    expect(
      screen.getByRole('heading', { level: 1, name: '[Fixture] Alex Rivera’s schedule' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: '[Fixture] Morning kickoff' })).toBeInTheDocument();
    // An unpublished session is not in the projection's answer.
    expect(screen.queryByText('[Fixture] Hidden from the share')).toBeNull();
  });

  it('a private schedule states the reason, as privacy rather than as failure', () => {
    renderShared({ share: { scheduleVisibility: 'private', displayName: 'Alex', sessionIds: ['fx-s1'] } });
    expect(screen.getByRole('heading', { name: 'This schedule is private' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 3 })).toBeNull();
  });

  it('an attendees-only schedule asks a signed-out viewer to sign in', () => {
    renderShared({
      share: { scheduleVisibility: 'attendees_only', displayName: 'Alex', sessionIds: ['fx-s1'] },
    });
    expect(screen.getByRole('heading', { name: 'This schedule is shared with attendees' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/signin');
  });

  it('an attendees-only schedule opens for a signed-in attendee with access', () => {
    renderShared({
      share: { scheduleVisibility: 'attendees_only', displayName: 'Alex', sessionIds: ['fx-s1'] },
      auth: { user: { uid: 'viewer-1' }, isAdmin: false, loading: false },
      profile: { attendeeAccess: true },
    });
    expect(screen.getByRole('heading', { level: 3, name: '[Fixture] Morning kickoff' })).toBeInTheDocument();
  });

  it('an owner who never consented renders nothing at all', () => {
    const { container } = renderShared({ share: null });
    expect(container).toBeEmptyDOMElement();
  });

  it('a refusal from the rules reads as privacy, never as the sessions', () => {
    renderShared({ share: null, error: true });
    expect(screen.getByRole('heading', { name: 'This schedule is private' })).toBeInTheDocument();
  });

  it('an owner with saved sessions that are all unpublished says so plainly', () => {
    renderShared({
      share: { scheduleVisibility: 'public', displayName: 'Alex', sessionIds: ['fx-s2'] },
    });
    expect(screen.getByRole('heading', { name: 'No saved sessions to show' })).toBeInTheDocument();
  });
});

it('retries a denied subscription when the viewer signs in with attendee access', () => {
  const { rerender } = renderShared({ error: true });
  expect(screen.getByRole('heading', { name: 'This schedule is private' })).toBeInTheDocument();
  rerender(sharedTree({
    share: { scheduleVisibility: 'attendees_only', displayName: 'Alex', sessionIds: ['fx-s1'] },
    auth: { user: { uid: 'viewer-1' }, isAdmin: false, loading: false },
    profile: { attendeeAccess: true },
  }));
  expect(screen.getByRole('heading', { level: 3, name: '[Fixture] Morning kickoff' })).toBeInTheDocument();
});
