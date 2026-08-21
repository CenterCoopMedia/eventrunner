// One attendee's public profile: the feature gate, the badge labels, and the
// deliberate ambiguity between "private" and "does not exist" (issue #17).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

let features;
let badgesConfig;
let profileValue;
const fetchPublicProfileMock = vi.fn();

vi.mock('../contexts/EventConfigContext.jsx', () => ({
  useEventConfig: () => ({ features, badges: badgesConfig }),
}));
vi.mock('../contexts/ProfileContext.jsx', () => ({
  useProfile: () => profileValue,
}));
vi.mock('../lib/profileSource.js', () => ({
  fetchPublicProfile: (...args) => fetchPublicProfileMock(...args),
}));

const { default: AttendeeProfile } = await import('./AttendeeProfile.jsx');

function renderPage(uid = 'u1') {
  return render(
    <MemoryRouter initialEntries={[`/attendees/${uid}`]}>
      <Routes>
        <Route path="/attendees/:uid" element={<AttendeeProfile />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  features = { attendeeDirectory: true, badges: true };
  badgesConfig = {
    categories: [{ id: 'craft', label: 'Craft', maxPicks: 2, badges: [{ id: 'writer', label: 'Writer' }] }],
  };
  profileValue = {
    profile: null,
    status: 'signed-out',
    needsProfileSetup: false,
    attendeeAccess: false,
  };
  fetchPublicProfileMock.mockReset();
  fetchPublicProfileMock.mockResolvedValue(null);
});

describe('AttendeeProfile', () => {
  it('gates the route behind config/features.attendeeDirectory', async () => {
    features.attendeeDirectory = false;
    renderPage();
    expect(
      await screen.findByRole('heading', {
        name: 'This event doesn’t have an attendee directory',
      }),
    ).toBeInTheDocument();
  });

  it('renders the public projection, badge labels resolved from config/badges', async () => {
    fetchPublicProfileMock.mockResolvedValue({
      id: 'u1',
      displayName: 'Amara Diallo',
      pronouns: 'she/her',
      jobTitle: 'Editor',
      organization: 'The Weekly',
      bio: 'Covers local government.',
      badges: ['writer', 'left-over-id'],
      speakerId: 'spk-1',
    });
    renderPage();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Amara Diallo' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Editor · The Weekly')).toBeInTheDocument();
    expect(screen.getByText('Speaker at this event')).toBeInTheDocument();
    expect(screen.getByText('Writer')).toBeInTheDocument();
    // A badge the operator removed from config/badges is not shown, even
    // though the stored projection still carries it.
    expect(screen.queryByText('left-over-id')).toBeNull();
  });

  it('re-reads the profile when the viewer’s access changes, so a denial does not stick', async () => {
    profileValue = { ...profileValue, status: 'ready', attendeeAccess: false };
    const { rerender } = renderPage();
    expect(
      await screen.findByRole('heading', { name: 'This profile isn’t available' }),
    ).toBeInTheDocument();

    // Their approval lands: the rules now allow the read.
    fetchPublicProfileMock.mockResolvedValue({ id: 'u1', displayName: 'Amara Diallo', badges: [] });
    profileValue = { ...profileValue, attendeeAccess: true };
    rerender(
      <MemoryRouter initialEntries={['/attendees/u1']}>
        <Routes>
          <Route path="/attendees/:uid" element={<AttendeeProfile />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Amara Diallo' }),
    ).toBeInTheDocument();
  });

  it('renders a profile whose fields are the wrong type instead of crashing', async () => {
    fetchPublicProfileMock.mockResolvedValue({
      id: 'u1',
      displayName: 'Amara Diallo',
      bio: { html: '<b>hi</b>' },
      pronouns: ['she', 'her'],
      badges: [{ id: 'writer' }],
    });
    renderPage();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Amara Diallo' }),
    ).toBeInTheDocument();
  });

  it('shows the same state for a denied read as for a profile that does not exist', async () => {
    fetchPublicProfileMock.mockResolvedValue(null);
    renderPage('somebody-else');
    expect(
      await screen.findByRole('heading', { name: 'This profile isn’t available' }),
    ).toBeInTheDocument();
    // No hint about which of the two it was.
    expect(screen.queryByText(/permission/i)).toBeNull();
  });
});
