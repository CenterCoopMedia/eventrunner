import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

let authValue;
let configValue;
let contentValue;
let profileValue;

vi.mock('../contexts/AuthContext.jsx', () => ({
  useAuth: () => authValue,
}));
vi.mock('../contexts/EventConfigContext.jsx', () => ({
  useEventConfig: () => configValue,
}));
vi.mock('../contexts/ContentContext.jsx', () => ({
  useContent: () => contentValue,
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
vi.mock('../components/SignInPanel.jsx', () => ({
  default: () => <div>Sign in panel fixture</div>,
}));
vi.mock('../components/speaker/SpeakerStatusHeader.jsx', () => ({
  default: ({ scheduleData, speakerId }) => (
    <section aria-label="Speaker event status fixture">
      {speakerId}:{scheduleData.length}
    </section>
  ),
}));
vi.mock('../components/speaker/SpeakerSessionHub.jsx', () => ({
  default: ({ scheduleData, speakerId }) => (
    <section aria-label="Speaker session hub fixture">
      {speakerId}:{scheduleData.length}
    </section>
  ),
}));
vi.mock('../components/speaker/SpeakerResourceCard.jsx', () => ({
  default: () => <div data-testid="speaker-resources-fixture" />,
}));

const { default: SpeakerDashboard } = await import('./SpeakerDashboard.jsx');

const SPEAKER = {
  speakerId: 'rae-okonkwo',
  firstName: 'Rae',
  lastName: 'Okonkwo',
  status: 'accepted',
};

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="Current route">{location.pathname}{location.search}</output>;
}

function PageFixture({ initialEntry = '/speaker/dashboard' }) {
  return (
    <MemoryRouter
      initialEntries={[initialEntry]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <LocationProbe />
      <Routes>
        <Route path="speaker/dashboard" element={<SpeakerDashboard />} />
        <Route path="dashboard" element={<h1>Attendee dashboard fixture</h1>} />
        <Route path="signin" element={<h1>Sign in fixture</h1>} />
      </Routes>
    </MemoryRouter>
  );
}

function renderPage(initialEntry) {
  return render(<PageFixture initialEntry={initialEntry} />);
}

beforeEach(() => {
  authValue = { user: { uid: 'u1', getIdToken: async () => 'token' }, loading: false };
  configValue = { eventConfig: {}, features: { liveUpdates: true } };
  contentValue = { scheduleData: [{ id: 'session-one' }] };
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
    expect(screen.getByRole('region', { name: 'Speaker event status fixture' })).toHaveTextContent(
      'rae-okonkwo:1',
    );
    expect(screen.getByRole('region', { name: 'Speaker session hub fixture' })).toHaveTextContent(
      'rae-okonkwo:1',
    );
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

  it('keeps a direct dashboard route mounted through sign-in', async () => {
    authValue = { user: null, loading: false };
    profileValue = { profile: null, status: 'signed-out' };
    const view = renderPage('/speaker/dashboard?returnNonce=fixture');

    expect(screen.getByRole('heading', { name: 'Sign in to continue' })).toBeInTheDocument();
    expect(screen.getByText('Sign in panel fixture')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Loading your speaker dashboard…' })).toBeNull();
    expect(screen.getByRole('status', { name: 'Current route' })).toHaveTextContent(
      '/speaker/dashboard?returnNonce=fixture',
    );

    authValue = { user: { uid: 'u1', getIdToken: async () => 'token' }, loading: false };
    profileValue = {
      profile: { speakerId: 'rae-okonkwo', displayName: 'Rae Okonkwo' },
      status: 'ready',
    };
    view.rerender(<PageFixture initialEntry="/speaker/dashboard?returnNonce=fixture" />);

    expect(await screen.findByRole('heading', { name: 'Speaker dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Current route' })).toHaveTextContent(
      '/speaker/dashboard?returnNonce=fixture',
    );
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

  it('does not show the previous speaker while a changed account loads', async () => {
    let resolveOld;
    const oldRead = new Promise((resolve) => { resolveOld = resolve; });
    getOwnSpeakerProfileMock.mockReturnValueOnce(oldRead).mockResolvedValueOnce({
      ...SPEAKER, speakerId: 'sam-own', firstName: 'Sam', lastName: 'Rivers',
    });
    const view = renderPage();

    authValue = { user: { uid: 'u2', getIdToken: async () => 'new-token' }, loading: false };
    profileValue = { profile: { speakerId: 'sam-own' }, status: 'ready' };
    view.rerender(<PageFixture />);

    expect(screen.getByRole('status', { name: 'Loading your speaker dashboard…' })).toBeInTheDocument();
    expect(await screen.findByText(/Welcome back, Sam Rivers/)).toBeInTheDocument();
    resolveOld(SPEAKER);
    await waitFor(() => expect(screen.queryByText(/Welcome back, Rae Okonkwo/)).toBeNull());
  });

  it('keeps account scope distinct when ids contain colons', async () => {
    authValue = { user: { uid: 'a:b', getIdToken: async () => 'old-token' }, loading: false };
    profileValue = { profile: { speakerId: 'c' }, status: 'ready' };
    let resolveNew;
    const newRead = new Promise((resolve) => { resolveNew = resolve; });
    getOwnSpeakerProfileMock.mockReset()
      .mockResolvedValueOnce({ ...SPEAKER, speakerId: 'c' })
      .mockReturnValueOnce(newRead);
    const view = renderPage();
    expect(await screen.findByText(/Welcome back, Rae Okonkwo/)).toBeInTheDocument();

    authValue = { user: { uid: 'a', getIdToken: async () => 'new-token' }, loading: false };
    profileValue = { profile: { speakerId: 'b:c' }, status: 'ready' };
    view.rerender(<PageFixture />);

    expect(screen.getByRole('status', { name: 'Loading your speaker dashboard…' })).toBeInTheDocument();
    expect(screen.queryByText(/Welcome back, Rae Okonkwo/)).toBeNull();
    resolveNew({ ...SPEAKER, speakerId: 'b:c', firstName: 'Sam', lastName: 'Rivers' });
    expect(await screen.findByText(/Welcome back, Sam Rivers/)).toBeInTheDocument();
  });

  it('leaves the updates area out when the event disables it', async () => {
    configValue = { eventConfig: {}, features: { liveUpdates: false } };
    renderPage();
    expect(await screen.findByText('Accepted')).toBeInTheDocument();
    expect(screen.queryByText('Live updates')).toBeNull();
  });
});
