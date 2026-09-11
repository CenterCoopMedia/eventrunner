// The signed-in attendee's home (issue #168). Providers are fixtures: no
// Firebase, no network. The dashboard composes two existing cards, so what
// is under test is the shell — who gets in, what they see, and that the
// page carries no data of its own.
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AuthContext from '../contexts/AuthContext.jsx';
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

function renderDashboard({
  auth = { user: { uid: 'u1' }, isAdmin: false, loading: false },
  profile = { profile: READY_PROFILE, status: 'ready', needsProfileSetup: false },
  features = { liveUpdates: true },
} = {}) {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <EventConfigContext.Provider
        value={{ eventConfig: {}, features, theme: {}, badges: null, source: 'snapshot' }}
      >
        <AuthContext.Provider value={auth}>
          <ProfileContext.Provider value={profile}>
            <Dashboard />
          </ProfileContext.Provider>
        </AuthContext.Provider>
      </EventConfigContext.Provider>
    </MemoryRouter>,
  );
}

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
