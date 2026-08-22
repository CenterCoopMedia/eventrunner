// Speaker self-service profile wizard (issue #22): gates on being signed in
// AND linked to a speaker (users/{uid}.speakerId), loads the caller's own
// canonical record through getOwnSpeakerProfile, and saves only
// SELF_EDITABLE_SPEAKER_FIELDS through updateOwnSpeakerProfile.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

let authValue;
let profileValue;
const showToastMock = vi.fn();

vi.mock('../contexts/AuthContext.jsx', () => ({
  useAuth: () => authValue,
}));
vi.mock('../contexts/ProfileContext.jsx', () => ({
  useProfile: () => profileValue,
}));
vi.mock('../contexts/ToastContext.jsx', () => ({
  useToast: () => ({ showToast: showToastMock }),
}));

const getOwnSpeakerProfileMock = vi.fn();
const updateOwnSpeakerProfileMock = vi.fn(() => Promise.resolve({ ok: true }));
vi.mock('../lib/speakerProfileApi.js', () => ({
  getOwnSpeakerProfile: (...args) => getOwnSpeakerProfileMock(...args),
  updateOwnSpeakerProfile: (...args) => updateOwnSpeakerProfileMock(...args),
}));

// SpeakerPhotoField uploads through the same module; the wizard test only
// needs the field to render, not to exercise an upload — SpeakerPhotoField
// itself is unit-tested separately.
vi.mock('../components/media/SpeakerPhotoField.jsx', () => ({
  default: ({ value }) => <div data-testid="speaker-photo-field">{value || 'no photo'}</div>,
}));

const { default: SpeakerProfile } = await import('./SpeakerProfile.jsx');

function renderPage() {
  return render(
    <MemoryRouter>
      <SpeakerProfile />
    </MemoryRouter>,
  );
}

const SEEDED_SPEAKER = {
  speakerId: 'rae-okonkwo',
  firstName: 'Rae',
  lastName: 'Okonkwo',
  slug: 'rae-okonkwo',
  bio: 'Old bio.',
  organization: '',
  jobTitle: '',
  headshotPath: null,
  socialHandles: {},
  status: 'accepted',
};

beforeEach(() => {
  authValue = { user: { uid: 'u1', getIdToken: async () => 't' } };
  profileValue = { profile: { speakerId: 'rae-okonkwo' }, status: 'ready' };
  getOwnSpeakerProfileMock.mockReset().mockResolvedValue(SEEDED_SPEAKER);
  updateOwnSpeakerProfileMock.mockReset().mockResolvedValue({ ok: true });
  showToastMock.mockClear();
});

describe('SpeakerProfile', () => {
  it('sends visitors who are not signed in to sign-in', () => {
    authValue = { user: null };
    renderPage();
    expect(
      screen.getByRole('heading', { name: 'Sign in to complete your speaker profile' }),
    ).toBeInTheDocument();
  });

  it('tells an account with no linked speaker record it is not a speaker', () => {
    profileValue = { profile: { speakerId: null }, status: 'ready' };
    renderPage();
    expect(screen.getByText('This account is not linked to a speaker')).toBeInTheDocument();
    expect(getOwnSpeakerProfileMock).not.toHaveBeenCalled();
  });

  it('waits without erroring while the account document is still being seeded', () => {
    profileValue = { profile: null, status: 'pending-account' };
    renderPage();
    expect(screen.getByText('Setting up your account')).toBeInTheDocument();
  });

  it('loads the caller’s own speaker record and seeds the form from it', async () => {
    renderPage();
    await waitFor(() => expect(getOwnSpeakerProfileMock).toHaveBeenCalledWith({
      user: authValue.user,
      speakerId: 'rae-okonkwo',
    }));
    expect(await screen.findByDisplayValue('Rae')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Old bio.')).toBeInTheDocument();
  });

  it('shows the review-status note for an accepted (not yet approved) speaker', async () => {
    renderPage();
    expect(
      await screen.findByText(/An organizer reviews your profile/),
    ).toBeInTheDocument();
  });

  it('saves only the self-editable fields, unchanged by slug/email/status', async () => {
    renderPage();
    await screen.findByDisplayValue('Rae');

    fireEvent.change(screen.getByLabelText('Biography'), { target: { value: 'New bio.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save speaker profile' }));

    await waitFor(() => expect(updateOwnSpeakerProfileMock).toHaveBeenCalled());
    const [[call]] = updateOwnSpeakerProfileMock.mock.calls;
    expect(call.speakerId).toBe('rae-okonkwo');
    expect(call.fields).toEqual({
      firstName: 'Rae',
      lastName: 'Okonkwo',
      bio: 'New bio.',
      organization: '',
      jobTitle: '',
      headshotPath: null,
      socialHandles: {},
    });
    expect('slug' in call.fields).toBe(false);
    expect('email' in call.fields).toBe(false);
    expect('status' in call.fields).toBe(false);
    expect(showToastMock).toHaveBeenCalledWith('Speaker profile saved.');
  });

  it('requires a first and last name before saving', async () => {
    renderPage();
    await screen.findByDisplayValue('Rae');
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save speaker profile' }));
    expect(
      await screen.findByText('Enter the name you want printed on the programme.'),
    ).toBeInTheDocument();
    expect(updateOwnSpeakerProfileMock).not.toHaveBeenCalled();
  });

  it('reports a load failure with a retry action rather than crashing', async () => {
    getOwnSpeakerProfileMock.mockRejectedValueOnce(new Error('network down'));
    renderPage();
    expect(await screen.findByText('Your speaker profile could not be loaded')).toBeInTheDocument();
    expect(screen.getByText('network down')).toBeInTheDocument();
  });
});
