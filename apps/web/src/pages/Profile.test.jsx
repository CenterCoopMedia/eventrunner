// Profile setup/edit: what the form may write (never a server-owned field),
// the visibility choices the event config allows, and the waiting state
// before the account document exists (issue #17, spec §3.4, §4.5).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

let features;
let badgesConfig;
let authValue;
let profileValue;
const saveProfileMock = vi.fn(() => Promise.resolve());
const showToastMock = vi.fn();

vi.mock('../contexts/EventConfigContext.jsx', () => ({
  useEventConfig: () => ({ features, badges: badgesConfig }),
}));
vi.mock('../contexts/AuthContext.jsx', () => ({
  useAuth: () => authValue,
}));
vi.mock('../contexts/ProfileContext.jsx', () => ({
  useProfile: () => ({ ...profileValue, saveProfile: saveProfileMock }),
}));
vi.mock('../contexts/ToastContext.jsx', () => ({
  useToast: () => ({ showToast: showToastMock }),
}));

const { default: Profile } = await import('./Profile.jsx');

function renderPage() {
  return render(
    <MemoryRouter>
      <Profile />
    </MemoryRouter>,
  );
}

const SEEDED_PROFILE = {
  displayName: 'Rae Okonkwo',
  pronouns: '',
  jobTitle: '',
  organization: '',
  bio: '',
  profileVisibility: 'attendees_only',
  badges: [],
  // Server-owned fields ride along on the document; the form must not offer
  // or send any of them.
  registrationStatus: 'pending',
  speakerId: null,
};

beforeEach(() => {
  features = { publicAttendeeProfiles: false, badges: false };
  badgesConfig = null;
  authValue = { user: { uid: 'u1' } };
  profileValue = { profile: SEEDED_PROFILE, status: 'ready', needsProfileSetup: false };
  saveProfileMock.mockClear();
  showToastMock.mockClear();
});

describe('Profile', () => {
  it('sends visitors who are not signed in to sign-in', () => {
    authValue = { user: null };
    renderPage();
    expect(
      screen.getByRole('heading', { name: 'Sign in to set up your profile' }),
    ).toBeInTheDocument();
  });

  it('waits, without an error, while the auth trigger seeds the account document', () => {
    profileValue = { profile: null, status: 'pending-account', needsProfileSetup: false };
    renderPage();
    expect(screen.getByRole('heading', { name: 'Setting up your account' })).toBeInTheDocument();
  });

  it('saves only self-editable fields — never registrationStatus or speakerId', async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Amara Diallo' } });
    fireEvent.change(screen.getByLabelText('Organization'), { target: { value: 'The Weekly' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));

    await waitFor(() => expect(saveProfileMock).toHaveBeenCalled());
    const payload = saveProfileMock.mock.calls[0][0];
    expect(payload).toEqual({
      displayName: 'Amara Diallo',
      pronouns: '',
      jobTitle: '',
      organization: 'The Weekly',
      bio: '',
      profileVisibility: 'attendees_only',
      badges: [],
    });
    expect(showToastMock).toHaveBeenCalledWith('Profile saved.');
  });

  it('refuses to save a profile with no name, and moves focus to the field', () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));

    expect(saveProfileMock).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveFocus();
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true');
  });

  it('says so when the save is rejected instead of pretending it worked', async () => {
    saveProfileMock.mockRejectedValueOnce(new Error('permission denied'));
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    await waitFor(() =>
      expect(showToastMock).toHaveBeenCalledWith(
        'Your profile could not be saved. Try again.',
        { tone: 'error' },
      ),
    );
  });

  it('offers a public profile only when the event runs public attendee profiles', () => {
    const { unmount } = renderPage();
    expect(screen.queryByRole('radio', { name: /Anyone/ })).toBeNull();
    expect(screen.getByRole('radio', { name: /Attendees only/ })).toBeInTheDocument();
    unmount();

    features.publicAttendeeProfiles = true;
    renderPage();
    expect(screen.getByRole('radio', { name: /Anyone/ })).toBeInTheDocument();
  });

  it('keeps showing a profile already stored as public even with the flag off', () => {
    profileValue = {
      profile: { ...SEEDED_PROFILE, profileVisibility: 'public' },
      status: 'ready',
      needsProfileSetup: false,
    };
    renderPage();
    expect(screen.getByRole('radio', { name: /Anyone/ })).toBeChecked();
  });

  it('offers the configured badge set only when the badges feature is on', async () => {
    badgesConfig = {
      categories: [{ id: 'craft', label: 'Craft', maxPicks: 2, badges: [{ id: 'writer', label: 'Writer' }] }],
    };
    const { unmount } = renderPage();
    expect(screen.queryByRole('checkbox', { name: /Writer/ })).toBeNull();
    unmount();

    features.badges = true;
    renderPage();
    fireEvent.click(screen.getByRole('checkbox', { name: /Writer/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    await waitFor(() => expect(saveProfileMock).toHaveBeenCalled());
    expect(saveProfileMock.mock.calls[0][0].badges).toEqual(['writer']);
  });
});
