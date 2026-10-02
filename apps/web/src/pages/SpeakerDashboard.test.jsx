import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

let authValue;
let configValue;
let profileValue;

vi.mock('../contexts/AuthContext.jsx', () => ({
  useAuth: () => authValue,
}));
vi.mock('../contexts/EventConfigContext.jsx', () => ({
  useEventConfig: () => configValue,
}));
vi.mock('../contexts/ProfileContext.jsx', () => ({
  useProfile: () => profileValue,
}));

const getOwnSpeakerProfileMock = vi.fn();
vi.mock('../lib/speakerProfileApi.js', () => ({
  getOwnSpeakerProfile: (...args) => getOwnSpeakerProfileMock(...args),
}));

vi.mock('../components/LiveUpdatesCard.jsx', () => ({
  default: () => <section aria-label="Live updates fixture">Live updates</section>,
}));

const { default: SpeakerDashboard } = await import('./SpeakerDashboard.jsx');

const SPEAKER = {
  speakerId: 'rae-okonkwo',
  firstName: 'Rae',
  lastName: 'Okonkwo',
  status: 'accepted',
};

function renderPage() {
  return render(
    <MemoryRouter
      initialEntries={['/speaker/dashboard']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="speaker/dashboard" element={<SpeakerDashboard />} />
        <Route path="dashboard" element={<h1>Attendee dashboard fixture</h1>} />
        <Route path="signin" element={<h1>Sign in fixture</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  authValue = { user: { uid: 'u1', getIdToken: async () => 'token' }, loading: false };
  configValue = { features: { liveUpdates: true } };
  profileValue = {
    profile: { speakerId: 'rae-okonkwo', displayName: 'Rae Okonkwo' },
    status: 'ready',
  };
  getOwnSpeakerProfileMock.mockReset().mockResolvedValue(SPEAKER);
});

describe('the speaker dashboard shell', () => {
  it('shows an accepted speaker their canonical name, status, profile wizard, and updates', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Speaker dashboard' })).toBeInTheDocument();
    expect(screen.getByText(/Welcome back, Rae Okonkwo/)).toBeInTheDocument();
    expect(screen.getByText('Accepted')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Edit your speaker profile' })).toHaveAttribute(
      'href',
      '/speaker/profile',
    );
    expect(screen.getByText('Live updates')).toBeInTheDocument();
    expect(getOwnSpeakerProfileMock).toHaveBeenCalledWith({
      user: authValue.user,
      speakerId: 'rae-okonkwo',
    });
  });

  it('admits an approved speaker and reports that pipeline status', async () => {
    getOwnSpeakerProfileMock.mockResolvedValue({ ...SPEAKER, status: 'approved' });
    renderPage();
    expect(await screen.findByText('Approved')).toBeInTheDocument();
    expect(screen.getByText(/profile is live on the public programme/)).toBeInTheDocument();
  });

  it('sends a signed-in account with no linked speaker to the attendee dashboard', async () => {
    profileValue = { profile: { speakerId: null }, status: 'ready' };
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Attendee dashboard fixture' })).toBeInTheDocument();
    expect(getOwnSpeakerProfileMock).not.toHaveBeenCalled();
  });

  it.each(['draft', 'invited', 'removed'])('sends a %s record to the attendee dashboard', async (status) => {
    getOwnSpeakerProfileMock.mockResolvedValue({ ...SPEAKER, status });
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Attendee dashboard fixture' })).toBeInTheDocument();
  });

  it('waits for the account record before deciding that the reader is not a speaker', () => {
    profileValue = { profile: null, status: 'pending-account' };
    renderPage();
    expect(screen.getByRole('status', { name: 'Loading your speaker dashboard…' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Attendee dashboard fixture' })).toBeNull();
    expect(getOwnSpeakerProfileMock).not.toHaveBeenCalled();
  });

  it('sends a signed-out visitor to sign in', async () => {
    authValue = { user: null, loading: false };
    profileValue = { profile: null, status: 'signed-out' };
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Sign in fixture' })).toBeInTheDocument();
  });

  it('keeps a failed owner read visible and retries instead of treating it as a denial', async () => {
    getOwnSpeakerProfileMock
      .mockRejectedValueOnce(new Error('Connection lost.'))
      .mockResolvedValueOnce(SPEAKER);
    renderPage();

    expect(await screen.findByText('Connection lost.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Attendee dashboard fixture' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(getOwnSpeakerProfileMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('heading', { name: 'Speaker dashboard' })).toBeInTheDocument();
  });

  it('leaves the updates area out when the event disables it', async () => {
    configValue = { features: { liveUpdates: false } };
    renderPage();
    expect(await screen.findByText('Accepted')).toBeInTheDocument();
    expect(screen.queryByText('Live updates')).toBeNull();
  });
});
