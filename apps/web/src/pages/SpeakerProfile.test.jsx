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
const deleteSpeakerPhotoMock = vi.fn(() => Promise.resolve());
vi.mock('../lib/speakerProfileApi.js', () => ({
  getOwnSpeakerProfile: (...args) => getOwnSpeakerProfileMock(...args),
  updateOwnSpeakerProfile: (...args) => updateOwnSpeakerProfileMock(...args),
  deleteSpeakerPhoto: (...args) => deleteSpeakerPhotoMock(...args),
}));

// SpeakerPhotoField uploads through the same module; the wizard test only
// needs the field to render, not to exercise an upload — SpeakerPhotoField
// itself is unit-tested separately.
vi.mock('../components/media/SpeakerPhotoField.jsx', () => ({
  default: ({ value, onChange }) => (
    <div data-testid="speaker-photo-field">
      <span>{value || 'no photo'}</span>
      <button type="button" onClick={() => onChange('speaker-photos/rae-okonkwo/new/photo.png')}>
        Simulate upload
      </button>
    </div>
  ),
}));

// SignInPanel talks to Firebase auth directly; this suite only needs to
// confirm SpeakerProfile mounts it (issue #22 review finding P2-11) rather
// than navigating away — the panel's own behavior is tested where it lives.
vi.mock('../components/SignInPanel.jsx', () => ({
  default: () => <div data-testid="sign-in-panel">sign-in form</div>,
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
  deleteSpeakerPhotoMock.mockReset().mockResolvedValue();
  showToastMock.mockClear();
});

describe('SpeakerProfile', () => {
  it('mounts sign-in INLINE for a signed-out visitor rather than navigating away (issue #22 review P2-11)', () => {
    // Staying on /speaker/profile means AuthContext's `user` flipping
    // truthy re-renders straight past this branch — no return-path state
    // to lose, and no risk of ProfileSetupRedirect (which only fires from
    // '/' and '/signin') hijacking a brand-new account elsewhere.
    authValue = { user: null };
    renderPage();
    expect(screen.getByRole('heading', { name: 'Sign in to continue' })).toBeInTheDocument();
    expect(screen.getByTestId('sign-in-panel')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /sign in/i })).not.toBeInTheDocument();
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

  // --- staged edits (issue #22 review finding P1-1) -------------------------

  it('seeds the form from live values merged with any queued pendingEdits, and shows the review banner', async () => {
    getOwnSpeakerProfileMock.mockResolvedValue({
      ...SEEDED_SPEAKER,
      status: 'approved',
      bio: 'Live bio.',
      pendingEdits: { bio: 'Queued bio.' },
    });
    renderPage();
    // The QUEUED value is what the speaker sees and continues editing —
    // not the stale live one, which would make it look like their earlier
    // edit was lost.
    expect(await screen.findByDisplayValue('Queued bio.')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Live bio.')).not.toBeInTheDocument();
    expect(screen.getByText(/awaiting organizer review/)).toBeInTheDocument();
  });

  it('shows no review banner when there is nothing queued', async () => {
    getOwnSpeakerProfileMock.mockResolvedValue({ ...SEEDED_SPEAKER, status: 'approved', pendingEdits: null });
    renderPage();
    await screen.findByDisplayValue('Rae');
    expect(screen.queryByText(/awaiting organizer review/)).not.toBeInTheDocument();
  });

  it('reports a staged save with review copy, distinct from a direct save', async () => {
    getOwnSpeakerProfileMock.mockResolvedValue({ ...SEEDED_SPEAKER, status: 'approved' });
    updateOwnSpeakerProfileMock.mockResolvedValue({ ok: true, staged: true });
    renderPage();
    await screen.findByDisplayValue('Rae');

    fireEvent.change(screen.getByLabelText('Biography'), { target: { value: 'New bio.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save speaker profile' }));

    await waitFor(() =>
      expect(showToastMock).toHaveBeenCalledWith(
        'Changes submitted. An organizer reviews them before they replace your public profile.',
      ),
    );
  });

  it('reports a direct (non-staged) save with the ordinary copy', async () => {
    // SEEDED_SPEAKER's status is 'accepted' — not yet approved, so nothing
    // is staged.
    renderPage();
    await screen.findByDisplayValue('Rae');
    fireEvent.change(screen.getByLabelText('Biography'), { target: { value: 'New bio.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save speaker profile' }));
    await waitFor(() => expect(showToastMock).toHaveBeenCalledWith('Speaker profile saved.'));
  });

  // --- deferred photo cleanup (issue #22 review findings P1-2 / P2-3) -------

  it('does not delete anything when the photo was never changed', async () => {
    getOwnSpeakerProfileMock.mockResolvedValue({
      ...SEEDED_SPEAKER,
      status: 'accepted',
      headshotPath: 'speaker-photos/rae-okonkwo/old/photo.png',
    });
    renderPage();
    await screen.findByDisplayValue('Rae');

    fireEvent.change(screen.getByLabelText('Biography'), { target: { value: 'New bio.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save speaker profile' }));
    await waitFor(() => expect(updateOwnSpeakerProfileMock).toHaveBeenCalled());
    expect(deleteSpeakerPhotoMock).not.toHaveBeenCalled();
  });

  it('deletes the superseded photo after a direct (non-staged) save replaces it', async () => {
    getOwnSpeakerProfileMock.mockResolvedValue({
      ...SEEDED_SPEAKER,
      status: 'accepted',
      headshotPath: 'speaker-photos/rae-okonkwo/old/photo.png',
    });
    renderPage();
    await screen.findByDisplayValue('Rae');

    fireEvent.click(screen.getByRole('button', { name: 'Simulate upload' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save speaker profile' }));

    await waitFor(() =>
      expect(deleteSpeakerPhotoMock).toHaveBeenCalledWith({
        user: authValue.user,
        speakerId: 'rae-okonkwo',
        path: 'speaker-photos/rae-okonkwo/old/photo.png',
      }),
    );
  });

  it('never deletes the currently-live photo when the save itself is staged', async () => {
    // An approved speaker's FIRST staged photo change: the live path and
    // the pre-edit baseline are the SAME object (nothing was queued yet),
    // so even though the save changes headshotPath, the old (live, still
    // public) object must not be deleted — profile.cjs's
    // applyApplySpeakerPendingEdits is what removes it, and only once an
    // organizer actually applies the change.
    getOwnSpeakerProfileMock.mockResolvedValue({
      ...SEEDED_SPEAKER,
      status: 'approved',
      headshotPath: 'speaker-photos/rae-okonkwo/live/photo.png',
      pendingEdits: null,
    });
    updateOwnSpeakerProfileMock.mockResolvedValue({ ok: true, staged: true });
    renderPage();
    await screen.findByDisplayValue('Rae');

    fireEvent.click(screen.getByRole('button', { name: 'Simulate upload' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save speaker profile' }));
    await waitFor(() => expect(updateOwnSpeakerProfileMock).toHaveBeenCalled());
    expect(deleteSpeakerPhotoMock).not.toHaveBeenCalled();
  });

  it('deletes a superseded QUEUED photo (a second staged edit) — it was never the live object', async () => {
    getOwnSpeakerProfileMock.mockResolvedValue({
      ...SEEDED_SPEAKER,
      status: 'approved',
      headshotPath: 'speaker-photos/rae-okonkwo/live/photo.png',
      pendingEdits: { headshotPath: 'speaker-photos/rae-okonkwo/first-staged/photo.png' },
    });
    updateOwnSpeakerProfileMock.mockResolvedValue({ ok: true, staged: true });
    renderPage();
    await screen.findByDisplayValue('Rae');

    fireEvent.click(screen.getByRole('button', { name: 'Simulate upload' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save speaker profile' }));

    await waitFor(() =>
      expect(deleteSpeakerPhotoMock).toHaveBeenCalledWith({
        user: authValue.user,
        speakerId: 'rae-okonkwo',
        path: 'speaker-photos/rae-okonkwo/first-staged/photo.png',
      }),
    );
  });

  // --- stale-response guard (issue #22 review finding P2-9) -----------------

  it('ignores a load response that resolves after a newer request has already started', async () => {
    let resolveFirst;
    getOwnSpeakerProfileMock
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => Promise.resolve({ ...SEEDED_SPEAKER, bio: 'Second load bio.' }));

    const { rerender } = renderPage();
    // A second load starts (e.g. the account switched) before the first
    // ever resolves.
    profileValue = { profile: { speakerId: 'someone-else' }, status: 'ready' };
    rerender(
      <MemoryRouter>
        <SpeakerProfile />
      </MemoryRouter>,
    );
    await screen.findByDisplayValue('Second load bio.');

    // The FIRST request now resolves, late. It must not clobber the form
    // the second, newer request already populated.
    resolveFirst({ ...SEEDED_SPEAKER, bio: 'First load bio (stale).' });
    await Promise.resolve();
    await Promise.resolve();
    expect(screen.queryByDisplayValue('First load bio (stale).')).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('Second load bio.')).toBeInTheDocument();
  });
});
