// Speaker self-service profile wizard (spec §4.3, §9 "Speaker profile
// wizard", issue #22) — /speaker/profile.
//
// One form, not a multi-step flow: SELF_EDITABLE_SPEAKER_FIELDS (shared/
// speaker) is seven fields — name, bio, headshot, organization, jobTitle,
// socialHandles — the same size class Profile.jsx's single-form attendee
// editor handles, and interface-guidelines.md's ergonomics bar ("don't make
// people click Next for no reason") argues against paging seven fields
// across steps. `stipend`/`diversity` steps the legacy wizard carried are
// NOT here: no config namespace in this port defines them as toggleable
// (docs/adr/0001 §2 lists no such flag), so adding UI for fields the server
// would reject as unknown speaker fields would promise something this
// deployment cannot save. A client that needs them gets a follow-up ADR
// entry, not a guess encoded here.
//
// The linked account (`users/{uid}.speakerId`) says WHICH speaker record is
// "mine"; the canonical values come from getOwnSpeakerProfile, because the
// client has no other read path to `speakers/{id}` (firestore.rules keeps
// it admin-only even for its own owner — see profile.cjs's module doc: the
// pipeline fields this endpoint deliberately omits, email/inviteToken/
// approvedAt, are exactly why a direct rule was not the fix here).
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { SELF_EDITABLE_SPEAKER_FIELDS } from 'shared/speaker';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useProfile } from '../contexts/ProfileContext.jsx';
import { useToast } from '../contexts/ToastContext.jsx';
import EmptyState from '../components/EmptyState.jsx';
import LoadingState from '../components/LoadingState.jsx';
import SpeakerPhotoField from '../components/media/SpeakerPhotoField.jsx';
import { getOwnSpeakerProfile, updateOwnSpeakerProfile } from '../lib/speakerProfileApi.js';

const inputClass =
  'touch-target w-full rounded-brand border border-brand-ink/20 bg-brand-surface px-3 py-2 ' +
  'text-brand-ink placeholder:text-brand-ink-muted aria-[invalid=true]:border-danger';

const primaryButtonClass =
  'touch-target inline-flex items-center justify-center rounded-brand bg-brand-primary ' +
  'px-4 py-2 font-semibold text-brand-surface hover:bg-brand-primary-dark disabled:opacity-60';

const STATUS_COPY = {
  draft: null,
  invited: null,
  accepted: {
    tone: 'status',
    text: 'An organizer reviews your profile before it appears on the public programme.',
  },
  approved: {
    tone: 'status',
    text: 'Your profile is live on the public programme. Changes here are reviewed again before they replace it.',
  },
  removed: {
    tone: 'status',
    text: 'This speaker record has been removed and is not on the public programme.',
  },
};

/** One `label: handle` pair per row, matching Object.entries(socialHandles). */
function handlesToRows(handles) {
  const source = handles && typeof handles === 'object' ? handles : {};
  const rows = Object.entries(source).map(([label, handle]) => ({ label, handle }));
  return rows.length > 0 ? rows : [{ label: '', handle: '' }];
}

function rowsToHandles(rows) {
  const out = {};
  for (const row of rows) {
    const label = row.label.trim();
    const handle = row.handle.trim();
    if (label && handle) out[label] = handle;
  }
  return out;
}

export default function SpeakerProfile() {
  const { user } = useAuth();
  const { profile, status: accountStatus } = useProfile();
  const { showToast } = useToast();
  const speakerId = profile?.speakerId ?? null;

  const [load, setLoad] = useState({ status: 'loading', speaker: null, error: null });
  const [form, setForm] = useState(null);
  const [nameError, setNameError] = useState(null);
  const [saving, setSaving] = useState(false);
  const nameRef = useRef(null);

  const loadProfile = useCallback(() => {
    if (!user || !speakerId) return;
    setLoad({ status: 'loading', speaker: null, error: null });
    getOwnSpeakerProfile({ user, speakerId })
      .then((speaker) => {
        setLoad({ status: 'ready', speaker, error: null });
        setForm({
          firstName: speaker.firstName ?? '',
          lastName: speaker.lastName ?? '',
          bio: speaker.bio ?? '',
          organization: speaker.organization ?? '',
          jobTitle: speaker.jobTitle ?? '',
          headshotPath: speaker.headshotPath ?? '',
          socialRows: handlesToRows(speaker.socialHandles),
        });
      })
      .catch((err) => {
        setLoad({ status: 'error', speaker: null, error: err?.message || 'Your profile could not be loaded.' });
      });
  }, [user, speakerId]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  if (!user) {
    return (
      <EmptyState
        title="Sign in to complete your speaker profile"
        description="Your speaker profile is part of your account, so it lives behind sign-in."
        action={
          <Link
            to="/signin"
            className="touch-target inline-flex items-center rounded-brand bg-brand-primary px-4 py-2 font-semibold text-brand-surface"
          >
            Go to sign in
          </Link>
        }
      />
    );
  }

  if (accountStatus === 'pending-account') {
    return (
      <div className="mt-6">
        <LoadingState label="Setting up your account" />
      </div>
    );
  }

  if (!speakerId) {
    return (
      <EmptyState
        title="This account is not linked to a speaker"
        description="If you were invited as a speaker, accept the invitation in that email first — it links this account to your speaker record."
        action={
          <Link to="/profile" className="touch-target inline-flex items-center rounded-brand bg-brand-primary px-4 py-2 font-semibold text-brand-surface">
            Go to your account
          </Link>
        }
      />
    );
  }

  if (load.status === 'error') {
    return (
      <EmptyState
        title="Your speaker profile could not be loaded"
        description={load.error}
        action={
          <button type="button" onClick={loadProfile} className={primaryButtonClass}>
            Try again
          </button>
        }
      />
    );
  }

  if (load.status === 'loading' || form == null) {
    return (
      <div className="mt-6">
        <LoadingState label="Loading your speaker profile" />
      </div>
    );
  }

  const statusNote = STATUS_COPY[load.speaker.status] ?? null;

  const setField = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const setSocialRow = (index, key, value) =>
    setForm((current) => ({
      ...current,
      socialRows: current.socialRows.map((row, i) => (i === index ? { ...row, [key]: value } : row)),
    }));

  const addSocialRow = () =>
    setForm((current) => ({ ...current, socialRows: [...current.socialRows, { label: '', handle: '' }] }));

  const removeSocialRow = (index) =>
    setForm((current) => ({
      ...current,
      socialRows: current.socialRows.length > 1
        ? current.socialRows.filter((_, i) => i !== index)
        : [{ label: '', handle: '' }],
    }));

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (form.firstName.trim().length === 0 || form.lastName.trim().length === 0) {
      setNameError('Enter the name you want printed on the programme.');
      nameRef.current?.focus();
      return;
    }
    setNameError(null);
    setSaving(true);
    try {
      const fields = {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        bio: form.bio.trim(),
        organization: form.organization.trim(),
        jobTitle: form.jobTitle.trim(),
        headshotPath: form.headshotPath ? form.headshotPath : null,
        socialHandles: rowsToHandles(form.socialRows),
      };
      // Sent exactly against SELF_EDITABLE_SPEAKER_FIELDS — a static guard
      // against this form ever drifting from the server's allowlist, not a
      // filter the user can trigger: every key above is already on the list.
      for (const key of Object.keys(fields)) {
        if (!SELF_EDITABLE_SPEAKER_FIELDS.includes(key)) delete fields[key];
      }
      await updateOwnSpeakerProfile({ user, speakerId, fields });
      showToast('Speaker profile saved.');
      loadProfile();
    } catch (err) {
      showToast(err?.message || 'Your speaker profile could not be saved.', { tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <article className="mx-auto max-w-2xl">
      <h1 className="font-heading text-3xl font-semibold text-brand-ink">Your speaker profile</h1>
      <p className="mt-2 text-brand-ink-muted">
        This is what appears on the public programme once an organizer approves it.
      </p>
      {statusNote ? (
        <p role="status" className="mt-4 rounded-brand border border-brand-ink/10 bg-brand-surface-alt px-3 py-2 text-sm text-brand-ink">
          {statusNote.text}
        </p>
      ) : null}

      <form className="mt-8 space-y-6" onSubmit={handleSubmit} noValidate>
        <SpeakerPhotoField
          user={user}
          speakerId={speakerId}
          value={form.headshotPath}
          onChange={(path) => setField('headshotPath', path)}
        />

        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <label htmlFor="firstName" className="block font-semibold text-brand-ink">
              First name
            </label>
            <input
              id="firstName"
              ref={nameRef}
              className={`mt-1 ${inputClass}`}
              value={form.firstName}
              onChange={(e) => setField('firstName', e.target.value)}
              aria-invalid={nameError ? 'true' : undefined}
              aria-describedby={nameError ? 'speaker-name-error' : undefined}
              autoComplete="given-name"
            />
          </div>
          <div>
            <label htmlFor="lastName" className="block font-semibold text-brand-ink">
              Last name
            </label>
            <input
              id="lastName"
              className={`mt-1 ${inputClass}`}
              value={form.lastName}
              onChange={(e) => setField('lastName', e.target.value)}
              aria-invalid={nameError ? 'true' : undefined}
              aria-describedby={nameError ? 'speaker-name-error' : undefined}
              autoComplete="family-name"
            />
          </div>
        </div>
        {nameError ? (
          <p id="speaker-name-error" role="alert" className="text-sm text-danger">
            {nameError}
          </p>
        ) : null}

        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <label htmlFor="jobTitle" className="block font-semibold text-brand-ink">
              Role
            </label>
            <input
              id="jobTitle"
              className={`mt-1 ${inputClass}`}
              value={form.jobTitle}
              onChange={(e) => setField('jobTitle', e.target.value)}
              autoComplete="organization-title"
            />
          </div>
          <div>
            <label htmlFor="organization" className="block font-semibold text-brand-ink">
              Organization
            </label>
            <input
              id="organization"
              className={`mt-1 ${inputClass}`}
              value={form.organization}
              onChange={(e) => setField('organization', e.target.value)}
              autoComplete="organization"
            />
          </div>
        </div>

        <div>
          <label htmlFor="bio" className="block font-semibold text-brand-ink">
            Biography
          </label>
          <textarea
            id="bio"
            rows={5}
            className={`mt-1 ${inputClass}`}
            value={form.bio}
            onChange={(e) => setField('bio', e.target.value)}
          />
        </div>

        <fieldset>
          <legend className="font-semibold text-brand-ink">Social links</legend>
          <div className="mt-2 space-y-2">
            {form.socialRows.map((row, index) => (
              <div key={index} className="flex flex-wrap items-center gap-2">
                <label className="sr-only" htmlFor={`social-label-${index}`}>
                  Platform
                </label>
                <input
                  id={`social-label-${index}`}
                  className={`${inputClass} w-32`}
                  placeholder="Platform, e.g. twitter"
                  value={row.label}
                  onChange={(e) => setSocialRow(index, 'label', e.target.value)}
                />
                <label className="sr-only" htmlFor={`social-handle-${index}`}>
                  Handle or URL
                </label>
                <input
                  id={`social-handle-${index}`}
                  className={`${inputClass} flex-1`}
                  placeholder="@you or a full URL"
                  value={row.handle}
                  onChange={(e) => setSocialRow(index, 'handle', e.target.value)}
                />
                <button
                  type="button"
                  className="touch-target rounded-brand px-3 py-2 text-brand-ink-muted underline hover:bg-brand-surface-alt"
                  onClick={() => removeSocialRow(index)}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="touch-target mt-2 inline-flex items-center rounded-brand border border-brand-ink/20 px-3 py-2 text-sm font-semibold text-brand-ink hover:bg-brand-surface-alt"
            onClick={addSocialRow}
          >
            + Add another link
          </button>
        </fieldset>

        <button type="submit" className={primaryButtonClass} disabled={saving}>
          {saving ? 'Saving…' : 'Save speaker profile'}
        </button>
      </form>
    </article>
  );
}
