// Speaker self-service profile steps (issue #22, ADR 0008 §3): gates on
// being signed in AND linked to a speaker (users/{uid}.speakerId), loads the
// caller's own record and logistics through loadOwnSpeakerProfile, saves
// each step's SELF_EDITABLE_SPEAKER_FIELDS through updateOwnSpeakerProfile,
// the Logistics step through saveOwnSpeakerLogistics, and submits once.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';

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

// The speaker record comes from this mock; loadOwnSpeakerProfile pairs it
// with `logisticsValue`, as the server pairs the two records.
const getOwnSpeakerProfileMock = vi.fn();
let logisticsValue;
const updateOwnSpeakerProfileMock = vi.fn(() => Promise.resolve({ ok: true }));
const saveOwnSpeakerLogisticsMock = vi.fn(() => Promise.resolve({ ok: true }));
const submitOwnSpeakerProfileMock = vi.fn(() => Promise.resolve({ submitted: true, emailed: true }));
const deleteSpeakerPhotoMock = vi.fn(() => Promise.resolve());
vi.mock('../lib/speakerProfileApi.js', () => ({
  loadOwnSpeakerProfile: (...args) => getOwnSpeakerProfileMock(...args).then((speaker) => ({ speaker, logistics: logisticsValue })),
  updateOwnSpeakerProfile: (...args) => updateOwnSpeakerProfileMock(...args),
  saveOwnSpeakerLogistics: (...args) => saveOwnSpeakerLogisticsMock(...args),
  submitOwnSpeakerProfile: (...args) => submitOwnSpeakerProfileMock(...args),
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

// Most tests here are about the Bio and photo step, so that is the default.
function page(path) {
  return (
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/speaker/profile" element={<SpeakerProfile />} />
        <Route path="/speaker/profile/:stepSlug" element={<SpeakerProfile />} />
      </Routes>
    </MemoryRouter>
  );
}
function renderPage(path = '/speaker/profile/bio') {
  return render(page(path));
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
  logisticsValue = { travel: null, accessNeeds: null, avNeeds: null };
  saveOwnSpeakerLogisticsMock.mockReset().mockResolvedValue({ ok: true });
  submitOwnSpeakerProfileMock.mockReset().mockResolvedValue({ submitted: true, emailed: true });
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
    expect(screen.getByText('Setting up your account…')).toBeInTheDocument();
  });

  it('loads the caller’s own speaker record and seeds each step from it', async () => {
    renderPage('/speaker/profile/about');
    await waitFor(() => expect(getOwnSpeakerProfileMock).toHaveBeenCalledWith({
      user: authValue.user,
      speakerId: 'rae-okonkwo',
    }));
    expect(await screen.findByDisplayValue('Rae')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'About you' })).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 5')).toBeInTheDocument();
  });

  it('shows the review-status note for an accepted (not yet approved) speaker', async () => {
    renderPage();
    expect(
      await screen.findByText(/An organizer reviews your profile/),
    ).toBeInTheDocument();
  });

  it('each step saves only its own self-editable fields, never slug, email or status', async () => {
    renderPage('/speaker/profile/about');
    await screen.findByDisplayValue('Rae');
    fireEvent.change(screen.getByLabelText('Pronouns (optional)'), { target: { value: ' they/them ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next: Bio and photo' }));
    await waitFor(() => expect(updateOwnSpeakerProfileMock).toHaveBeenCalledTimes(1));
    expect(updateOwnSpeakerProfileMock.mock.calls[0][0]).toEqual({
      user: authValue.user,
      speakerId: 'rae-okonkwo',
      fields: { firstName: 'Rae', lastName: 'Okonkwo', pronouns: 'they/them', organization: '', jobTitle: '' },
    });
    // The step saved, so the page moved on.
    expect(await screen.findByRole('heading', { level: 2, name: 'Bio and photo' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Biography'), { target: { value: 'New bio.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next: Links' }));
    await waitFor(() => expect(updateOwnSpeakerProfileMock).toHaveBeenCalledTimes(2));
    const { fields } = updateOwnSpeakerProfileMock.mock.calls[1][0];
    expect(fields).toEqual({ bio: 'New bio.', headshotPath: null });
    for (const key of ['slug', 'email', 'status']) expect(key in fields).toBe(false);
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
  });

  it('saves logistics to the private record and submits the profile once from Review', async () => {
    logisticsValue = { travel: 'Train', accessNeeds: null, avNeeds: null };
    renderPage('/speaker/profile/logistics');
    expect(await screen.findByDisplayValue('Train')).toBeInTheDocument();
    expect(screen.getByText(/Only the organizers see these answers/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Audio and video needs (optional)'), { target: { value: 'A clip-on mic.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next: Review' }));
    await waitFor(() => expect(saveOwnSpeakerLogisticsMock).toHaveBeenCalledWith({
      user: authValue.user,
      speakerId: 'rae-okonkwo',
      logistics: { travel: 'Train', accessNeeds: '', avNeeds: 'A clip-on mic.' },
    }));
    expect(updateOwnSpeakerProfileMock).not.toHaveBeenCalled();
    expect(await screen.findByRole('heading', { level: 2, name: 'Review' })).toBeInTheDocument();
    expect(screen.getByText('A clip-on mic.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Submit profile' }));
    expect(await screen.findByText('Profile submitted. We emailed you a note that we have it.')).toBeInTheDocument();
    expect(submitOwnSpeakerProfileMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Submit profile' })).not.toBeInTheDocument();
  });

  it('saves a step left by the step list before it submits, so Review never shows an unsaved answer as sent', async () => {
    renderPage('/speaker/profile/bio');
    fireEvent.change(await screen.findByLabelText('Biography'), { target: { value: 'Edited, then left by the list.' } });
    fireEvent.click(screen.getAllByRole('link', { name: /Review/ })[0]);
    expect(await screen.findByRole('heading', { level: 2, name: 'Review' })).toBeInTheDocument();
    expect(updateOwnSpeakerProfileMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Submit profile' }));
    await waitFor(() => expect(submitOwnSpeakerProfileMock).toHaveBeenCalledTimes(1));
    expect(updateOwnSpeakerProfileMock).toHaveBeenCalledTimes(1);
    expect(updateOwnSpeakerProfileMock.mock.calls[0][0].fields).toEqual({ bio: 'Edited, then left by the list.', headshotPath: null });
    // The save came first.
    expect(updateOwnSpeakerProfileMock.mock.invocationCallOrder[0]).toBeLessThan(submitOwnSpeakerProfileMock.mock.invocationCallOrder[0]);
  });

  it('sends a speaker back to About you when a blank name would be submitted', async () => {
    renderPage('/speaker/profile/about');
    fireEvent.change(await screen.findByLabelText('First name'), { target: { value: '' } });
    fireEvent.click(screen.getAllByRole('link', { name: /Review/ })[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'Submit profile' }));
    expect(await screen.findByText('Enter the name you want printed on the programme.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'About you' })).toBeInTheDocument();
    expect(submitOwnSpeakerProfileMock).not.toHaveBeenCalled();
  });

  it('shows a submitted profile as submitted, with no second submit', async () => {
    getOwnSpeakerProfileMock.mockResolvedValue({ ...SEEDED_SPEAKER, profileSubmittedAt: '2026-11-01T14:00:00.000Z' });
    renderPage('/speaker/profile/review');
    expect(await screen.findByText(/you do not need to submit again/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit profile' })).not.toBeInTheDocument();
  });

  it('moves on without saving a step nobody changed, so an approved speaker queues no empty edit', async () => {
    getOwnSpeakerProfileMock.mockResolvedValue({ ...SEEDED_SPEAKER, status: 'approved' });
    renderPage('/speaker/profile/about');
    await screen.findByDisplayValue('Rae');
    fireEvent.click(screen.getByRole('button', { name: 'Next: Bio and photo' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Bio and photo' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next: Links' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Links' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next: Logistics' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Logistics' })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Next: Review' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Review' })).toBeInTheDocument();
    expect(updateOwnSpeakerProfileMock).not.toHaveBeenCalled();
    expect(saveOwnSpeakerLogisticsMock).not.toHaveBeenCalled();
    // A change after that is saved once, and the same answer is not saved again.
    fireEvent.click(screen.getByRole('link', { name: 'Back' }));
    fireEvent.change(await screen.findByLabelText('Travel (optional)'), { target: { value: 'Car' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next: Review' }));
    await waitFor(() => expect(saveOwnSpeakerLogisticsMock).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByRole('link', { name: 'Back' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Next: Review' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Review' })).toBeInTheDocument();
    expect(saveOwnSpeakerLogisticsMock).toHaveBeenCalledTimes(1);
  });

  it('sends an unknown step address to the first step', async () => {
    renderPage('/speaker/profile/nope');
    expect(await screen.findByRole('heading', { level: 2, name: 'About you' })).toBeInTheDocument();
  });

  it('requires a first and last name before moving on', async () => {
    renderPage('/speaker/profile/about');
    await screen.findByDisplayValue('Rae');
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next: Bio and photo' }));
    expect(
      await screen.findByText('Enter the name you want printed on the programme.'),
    ).toBeInTheDocument();
    expect(updateOwnSpeakerProfileMock).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { level: 2, name: 'About you' })).toBeInTheDocument();
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
    await screen.findByLabelText('Biography');
    expect(screen.getByDisplayValue('Old bio.')).toBeInTheDocument();
    expect(screen.queryByText(/awaiting organizer review/)).not.toBeInTheDocument();
  });

  it('reports a staged save with review copy, distinct from a direct save', async () => {
    getOwnSpeakerProfileMock.mockResolvedValue({ ...SEEDED_SPEAKER, status: 'approved' });
    updateOwnSpeakerProfileMock.mockResolvedValue({ ok: true, staged: true });
    renderPage();
    await screen.findByLabelText('Biography');

    fireEvent.change(screen.getByLabelText('Biography'), { target: { value: 'New bio.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next: Links' }));

    expect(
      await screen.findByText('Saved for review. An organizer reviews changes before they replace your public profile.'),
    ).toBeInTheDocument();
  });

  it('reports a direct (non-staged) save with the ordinary copy', async () => {
    // SEEDED_SPEAKER's status is 'accepted' — not yet approved, so nothing
    // is staged.
    renderPage();
    await screen.findByLabelText('Biography');
    fireEvent.change(screen.getByLabelText('Biography'), { target: { value: 'New bio.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next: Links' }));
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
  });

  // --- deferred photo cleanup (issue #22 review findings P1-2 / P2-3) -------

  it('does not delete anything when the photo was never changed', async () => {
    getOwnSpeakerProfileMock.mockResolvedValue({
      ...SEEDED_SPEAKER,
      status: 'accepted',
      headshotPath: 'speaker-photos/rae-okonkwo/old/photo.png',
    });
    renderPage();
    await screen.findByLabelText('Biography');

    fireEvent.change(screen.getByLabelText('Biography'), { target: { value: 'New bio.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next: Links' }));
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
    await screen.findByLabelText('Biography');

    fireEvent.click(screen.getByRole('button', { name: 'Simulate upload' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next: Links' }));

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
    await screen.findByLabelText('Biography');

    fireEvent.click(screen.getByRole('button', { name: 'Simulate upload' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next: Links' }));
    await waitFor(() => expect(updateOwnSpeakerProfileMock).toHaveBeenCalled());
    expect(deleteSpeakerPhotoMock).not.toHaveBeenCalled();
  });

  it('deletes a replaced live photo when the server applied the save, even if the loaded status was approved', async () => {
    getOwnSpeakerProfileMock.mockResolvedValue({
      ...SEEDED_SPEAKER,
      status: 'approved',
      headshotPath: 'speaker-photos/rae-okonkwo/live/photo.png',
    });
    updateOwnSpeakerProfileMock.mockResolvedValue({ ok: true, staged: false });
    renderPage();
    await screen.findByLabelText('Biography');

    fireEvent.click(screen.getByRole('button', { name: 'Simulate upload' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next: Links' }));

    await waitFor(() =>
      expect(deleteSpeakerPhotoMock).toHaveBeenCalledWith({
        user: authValue.user,
        speakerId: 'rae-okonkwo',
        path: 'speaker-photos/rae-okonkwo/live/photo.png',
      }),
    );
  });

  it('does not delete the live photo when the server staged the save, even if the loaded status was not approved', async () => {
    getOwnSpeakerProfileMock.mockResolvedValue({
      ...SEEDED_SPEAKER,
      status: 'accepted',
      headshotPath: 'speaker-photos/rae-okonkwo/live/photo.png',
    });
    updateOwnSpeakerProfileMock.mockResolvedValue({ ok: true, staged: true });
    renderPage();
    await screen.findByLabelText('Biography');

    fireEvent.click(screen.getByRole('button', { name: 'Simulate upload' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next: Links' }));

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
    await screen.findByLabelText('Biography');

    fireEvent.click(screen.getByRole('button', { name: 'Simulate upload' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next: Links' }));

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
    rerender(page('/speaker/profile/bio'));
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
