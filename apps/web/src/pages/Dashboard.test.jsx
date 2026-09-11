// The signed-in attendee's home (issue #168). Providers are fixtures: no
// Firebase, no network. The dashboard composes two existing cards, so what
// is under test is the shell — who gets in, what they see, and that the
// page carries no data of its own.
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AuthContext from '../contexts/AuthContext.jsx';
import ContentContext from '../contexts/ContentContext.jsx';
import EventConfigContext from '../contexts/EventConfigContext.jsx';
import ProfileContext from '../contexts/ProfileContext.jsx';
import Dashboard from './Dashboard.jsx';

// LiveUpdatesCard talks to a listener; the shell is what is under test, so
// the card is stubbed to a fixed body and its own tests cover the rest.
vi.mock('../components/LiveUpdatesCard.jsx', () => ({
  default: () => <section aria-label="Live updates fixture">Live updates</section>,
}));

const READY_PROFILE = {
  displayName: '[Fixture] Alex Rivera',
  registrationStatus: 'approved',
  profileVisibility: 'attendees_only',
  badges: [],
};

const FIXTURE_SESSIONS = [
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
    title: '[Fixture] Afternoon editing lab',
    visible: true,
  },
];

const FIXTURE_PAGES = [
  { id: 'travel', label: 'Travel', path: '/travel', visible: true },
  { id: 'faq', label: 'FAQ', path: '/faq', visible: true },
  { id: 'conduct', label: 'Conduct', path: '/conduct', visible: true },
  { id: 'contact', label: 'Contact', path: '/contact', visible: true },
];

function renderDashboard({
  auth = { user: { uid: 'u1' }, isAdmin: false, loading: false },
  profile = { profile: READY_PROFILE, status: 'ready', needsProfileSetup: false },
  features = { liveUpdates: true, sessionBookmarks: true },
  scheduleData = FIXTURE_SESSIONS,
  bookmarkedIds = new Set(['fx-s1', 'fx-s2']),
  pages = FIXTURE_PAGES,
} = {}) {
  holder.bookmarkedIds = bookmarkedIds;
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <EventConfigContext.Provider
          value={{
            eventConfig: {
              timezone: 'America/Chicago',
              days: [{ id: 'fx-day-1', label: 'Day one', date: '2026-10-15' }],
            },
            features,
            theme: {},
            badges: null,
            source: 'snapshot',
          }}
        >
        <AuthContext.Provider value={auth}>
          <ProfileContext.Provider value={profile}>
            <ContentContext.Provider
              value={{
                scheduleData,
                pages,
                speakers: [],
                organizationsData: [],
                loading: false,
                getBlock: () => null,
                getPage: () => null,
                getSectionBlocks: () => [],
              }}
            >
              <Dashboard />
            </ContentContext.Provider>
          </ProfileContext.Provider>
        </AuthContext.Provider>
      </EventConfigContext.Provider>
    </MemoryRouter>,
  );
}

// The signed-in reader's bookmarks live in a hook that subscribes; the
// tests hand the set straight through instead.
vi.mock('../hooks/useMyBookmarks.js', () => ({
  useMyBookmarks: () => ({ bookmarkedIds: holder.bookmarkedIds, loading: false }),
}));
const holder = { bookmarkedIds: new Set() };

describe('the attendee dashboard shell', () => {
  it('a signed-in attendee sees their name and their status card', () => {
    renderDashboard();
    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
    // The greeting carries the account's own name; the status card beside
    // it is ProfileSidebar's, which owns the registration status.
    expect(screen.getByText(/Welcome back, \[Fixture\] Alex Rivera/)).toBeInTheDocument();
    expect(screen.getByText('Registration approved')).toBeInTheDocument();
    expect(screen.getByText('Your profile')).toBeInTheDocument();
  });

  it('carries the link to the profile form', () => {
    renderDashboard();
    const link = screen.getByRole('link', { name: 'Edit your profile' });
    expect(link).toHaveAttribute('href', '/profile');
  });

  it('carries the live updates card where the event runs one', () => {
    renderDashboard();
    expect(screen.getByText('Live updates')).toBeInTheDocument();
  });

  it('an event without the live updates flag shows no dead frame', () => {
    renderDashboard({ features: { liveUpdates: false } });
    expect(screen.queryByText('Live updates')).toBeNull();
    // The status card is still there — it is the reason the reader came.
    expect(screen.getByText('Registration approved')).toBeInTheDocument();
  });

  it('a reader whose profile is not complete is still greeted and pointed at the form', () => {
    renderDashboard({
      profile: {
        profile: { displayName: '', registrationStatus: 'pending' },
        status: 'ready',
        needsProfileSetup: true,
      },
    });
    expect(screen.getByText('Welcome back. This is your place at the event.')).toBeInTheDocument();
    expect(screen.getByText('Registration under review')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Complete your profile' })).toHaveAttribute(
      'href',
      '/profile',
    );
  });

  it('a signed-out visitor gets a sign-in prompt, not an empty shell', () => {
    renderDashboard({ auth: { user: null, isAdmin: false, loading: false } });
    expect(
      screen.getByRole('heading', { name: 'Sign in to see your dashboard' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/signin');
    expect(screen.queryByText('Registration approved')).toBeNull();
  });

  it('waits through the auth handshake and the account setup without flashing the shell', () => {
    renderDashboard({
      auth: { user: null, isAdmin: false, loading: true },
      profile: { profile: null, status: 'signed-out', needsProfileSetup: false },
    });
    expect(screen.getByRole('status', { name: 'Loading your dashboard…' })).toBeInTheDocument();
  });
});

describe('the dashboard cards', () => {
  it('lists the bookmarked sessions in programme order, with the link to the full schedule', () => {
    renderDashboard();

    const card = screen.getByRole('region', { name: 'My sessions' });
    const rows = [...card.querySelectorAll('li a')];
    expect(rows.map((row) => row.textContent)).toEqual([
      '[Fixture] Morning kickoff',
      '[Fixture] Afternoon editing lab',
    ]);
    expect(rows[0]).toHaveAttribute('href', '/schedule/fx-s1');
    expect(screen.getByRole('link', { name: 'Your full schedule' })).toHaveAttribute(
      'href',
      '/schedule/mine',
    );
  });

  it('carries the day and the time beside each session, as data', () => {
    renderDashboard();
    expect(screen.getByText(/Day one · 9:05–9:45 AM/)).toBeInTheDocument();
  });

  it('an attendee with no bookmarks gets the way back to the schedule', () => {
    renderDashboard({ bookmarkedIds: new Set() });
    expect(screen.getByText(/Bookmark sessions from the schedule/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Browse the schedule' })).toHaveAttribute(
      'href',
      '/schedule',
    );
  });

  it('an event without bookmarking draws no sessions card at all', () => {
    renderDashboard({ features: { liveUpdates: true, sessionBookmarks: false } });
    expect(screen.queryByText('My sessions')).toBeNull();
  });

  it('the resource cards link to the seeded pages, labelled by the page docs', () => {
    renderDashboard();
    const nav = screen.getByRole('navigation', { name: 'Event resources' });
    const links = [...nav.querySelectorAll('a')];
    expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Travel', '/travel'],
      ['FAQ', '/faq'],
      ['Conduct', '/conduct'],
      ['Contact', '/contact'],
    ]);
  });

  it('a hidden page draws no card, and an event with no pages draws no row', () => {
    const hidden = FIXTURE_PAGES.map((page) => ({ ...page, visible: page.id === 'travel' }));
    const { rerender } = renderDashboard({ pages: hidden });
    const nav = screen.getByRole('navigation', { name: 'Event resources' });
    expect(nav.querySelectorAll('a')).toHaveLength(1);

    rerender(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <EventConfigContext.Provider
          value={{ eventConfig: {}, features: { liveUpdates: true, sessionBookmarks: true }, theme: {}, badges: null, source: 'snapshot' }}
        >
          <AuthContext.Provider value={{ user: { uid: 'u1' }, isAdmin: false, loading: false }}>
            <ProfileContext.Provider
              value={{ profile: READY_PROFILE, status: 'ready', needsProfileSetup: false }}
            >
              <ContentContext.Provider
                value={{
                  scheduleData: FIXTURE_SESSIONS,
                  pages: [],
                  speakers: [],
                  organizationsData: [],
                  loading: false,
                  getBlock: () => null,
                  getPage: () => null,
                  getSectionBlocks: () => [],
                }}
              >
                <Dashboard />
              </ContentContext.Provider>
            </ProfileContext.Provider>
          </AuthContext.Provider>
        </EventConfigContext.Provider>
      </MemoryRouter>,
    );
    expect(screen.queryByRole('navigation', { name: 'Event resources' })).toBeNull();
  });
});
