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
//
// Editorial base restyle (design brief §2.1, §2.4): inputs and buttons carry
// the hairline-rule tokens SignInPanel established, and the status notes sit
// in flat-tint blocks rather than a rounded card. Every visible `<label>`
// stays a control label above its own input — the eyebrow ban's one named
// exception (§2.4).
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { SELF_EDITABLE_SPEAKER_FIELDS } from 'shared/speaker';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useProfile } from '../contexts/ProfileContext.jsx';
import { useToast } from '../contexts/ToastContext.jsx';
import EmptyState from '../components/EmptyState.jsx';
import LoadingState from '../components/LoadingState.jsx';
import SignInPanel from '../components/SignInPanel.jsx';
import SpeakerPhotoField from '../components/media/SpeakerPhotoField.jsx';
import {
  deleteSpeakerPhoto,
  getOwnSpeakerProfile,
  updateOwnSpeakerProfile,
} from '../lib/speakerProfileApi.js';
import { inputClass, primaryActionClass } from '../components/controlClasses.js';

const STATUS_COPY = {
  draft: null,
  invited: null,
  accepted: {
    tone: 'status',
    text: 'An organizer reviews your profile before it appears on the public programme.',
  },
  approved: {
    tone: 'status',
    text: 'Your profile is live on the public programme. Changes here are reviewed by an organizer before they replace it.',
  },
  removed: {
    tone: 'status',
    text: 'This speaker record has been removed and is not on the public programme.',
  },
};

// Staged edits (spec §4.3, issue #22 review finding P1-1): once a speaker
// is `approved`, a self-service save is queued in `pendingEdits` rather
// than written onto the live fields, so speakers_public is untouched until
// an organizer applies it (functions/src/speakers/profile.cjs). This is a
// SEPARATE note from STATUS_COPY.approved above — the status note is about
// the whole record's publish state, this one is about a specific edit still
// in flight.
const PENDING_EDITS_NOTE =
  'You have changes awaiting organizer review. The form below shows those changes; the public page ' +
  'still shows what was last approved until an organizer applies them.';

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

  // Guards against a stale response landing after the identity it was
  // fetched for has changed (issue #22 review finding P2-9) — a signed-in
  // speaker signing out and a different one signing in inside the same
  // mounted page, or the linked speakerId changing under it. Each call to
  // loadProfile (mount, retry, post-save refresh) claims the next id;
  // a response only applies if it is still the most recent claim when it
  // resolves. Effect-cleanup alone would not cover the "Try again" button
  // or the post-save refresh, both of which call loadProfile directly
  // rather than through the effect, so the guard lives in the request
  // itself.
  const requestIdRef = useRef(0);

  // Photo cleanup bookkeeping (issue #22 review findings P1-2 / P2-3).
  // Every upload lands at a FRESH path (SpeakerPhotoField / speakerPhotoApi
  // .uploadSpeakerPhoto), so choosing a file never touches the live public
  // object — but that means a superseded upload needs an explicit deferred
  // delete once a save no longer points at it, the same rule
  // ProfilePhotoField follows for attendee photos. Two refs, captured at
  // LOAD time (before any edit) and read again at SAVE time:
  //   • livePhotoPathRef  — speakers.headshotPath as currently PUBLISHED
  //     (or about-to-publish, pre-approval). NEVER deleted from here — an
  //     approved speaker's queued edit does not touch this object until an
  //     organizer applies it (functions/src/speakers/profile.cjs deletes
  //     the superseded live object itself, once it actually stops being
  //     live).
  //   • photoBaselineRef  — the EFFECTIVE path the form started from this
  //     load (a queued pendingEdits.headshotPath if one exists, else the
  //     live value). Safe to delete once superseded, UNLESS it equals the
  //     live path AND this save is itself going to be staged (i.e., it is
  //     not yet safe to delete the still-public photo).
  const livePhotoPathRef = useRef(null);
  const photoBaselineRef = useRef(null);
  const statusAtLoadRef = useRef(null);

  const loadProfile = useCallback(() => {
    if (!user || !speakerId) return;
    const requestId = ++requestIdRef.current;
    setLoad({ status: 'loading', speaker: null, error: null });
    getOwnSpeakerProfile({ user, speakerId })
      .then((speaker) => {
        if (requestIdRef.current !== requestId) return; // superseded by a newer request
        const effective = { ...speaker, ...(speaker.pendingEdits ?? {}) };
        setLoad({ status: 'ready', speaker, error: null });
        setForm({
          firstName: effective.firstName ?? '',
          lastName: effective.lastName ?? '',
          bio: effective.bio ?? '',
          organization: effective.organization ?? '',
          jobTitle: effective.jobTitle ?? '',
          headshotPath: effective.headshotPath ?? '',
          socialRows: handlesToRows(effective.socialHandles),
        });
        livePhotoPathRef.current = speaker.headshotPath ?? null;
        photoBaselineRef.current = effective.headshotPath ?? null;
        statusAtLoadRef.current = speaker.status;
      })
      .catch((err) => {
        if (requestIdRef.current !== requestId) return; // superseded by a newer request
        setLoad({ status: 'error', speaker: null, error: err?.message || 'Your profile could not be loaded.' });
      });
  }, [user, speakerId]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  if (!user) {
    // SignInPanel mounts INLINE rather than navigating to /signin (issue
    // #22 review finding P2-11): AuthContext's `user` flips truthy the
    // moment sign-in completes, which re-renders this same component past
    // this branch — no redirect, no return-path state to lose. Navigating
    // to /signin instead would need a return-path mechanism AND would need
    // to be coordinated with ProfileSetupRedirect, which claims '/' and
    // '/signin' as its post-sign-in landing spots and would otherwise
    // hijack a brand-new account to /profile before it ever reached this
    // page. Staying on /speaker/profile the whole time sidesteps both.
    return (
      <article className="mx-auto max-w-md">
        <h1 className="font-heading text-h1 font-semibold text-text-primary">Sign in to continue</h1>
        <p className="mt-xs max-w-prose text-body text-text-secondary" style={{ textWrap: 'pretty' }}>
          Your speaker profile is part of your account, so it lives behind sign-in. Sign in below to pick
          up right where you left off.
        </p>
        <div className="mt-lg">
          <SignInPanel />
        </div>
      </article>
    );
  }

  if (accountStatus === 'pending-account') {
    return (
      <div className="mt-lg">
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
          <Link to="/profile" className={primaryActionClass}>
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
          <button type="button" onClick={loadProfile} className={primaryActionClass}>
            Try again
          </button>
        }
      />
    );
  }

  if (load.status === 'loading' || form == null) {
    return (
      <div className="mt-lg">
        <LoadingState label="Loading your speaker profile" />
      </div>
    );
  }

  const statusNote = STATUS_COPY[load.speaker.status] ?? null;
  const hasPendingEdits = Boolean(load.speaker.pendingEdits);

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
      const result = await updateOwnSpeakerProfile({ user, speakerId, fields });

      // Deferred photo cleanup (issue #22 review findings P1-2 / P2-3): the
      // upload already landed at a fresh path, so the only object left to
      // remove is the one this save just SUPERSEDED — and only when it is
      // safe to. See the refs' own comments above for why the live path is
      // excluded from a staged save.
      const previousPath = photoBaselineRef.current;
      const newPath = fields.headshotPath;
      const wasStaged = statusAtLoadRef.current === 'approved';
      const changed = previousPath !== newPath;
      const safeToDelete = changed && previousPath && (!wasStaged || previousPath !== livePhotoPathRef.current);
      if (safeToDelete) {
        try {
          await deleteSpeakerPhoto({ user, speakerId, path: previousPath });
        } catch {
          // Best-effort, same as ProfilePhotoField's deferred delete: an
          // orphaned object costs a little storage, not a broken profile.
        }
      }

      showToast(
        result?.staged
          ? 'Changes submitted. An organizer reviews them before they replace your public profile.'
          : 'Speaker profile saved.',
      );
      loadProfile();
    } catch (err) {
      showToast(err?.message || 'Your speaker profile could not be saved.', { tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <article className="mx-auto max-w-2xl">
      <h1 className="font-heading text-h1 font-semibold text-text-primary">Your speaker profile</h1>
      <p className="mt-xs max-w-prose text-body text-text-secondary">
        This is what appears on the public programme once an organizer approves it.
      </p>
      {statusNote ? (
        <p role="status" className="mt-md border-hairline border-rule-hairline bg-surface-alt px-sm py-xs font-data text-caption text-text-primary">
          {statusNote.text}
        </p>
      ) : null}
      {hasPendingEdits ? (
        <p role="status" className="mt-xs border-hairline border-warning/40 bg-warning/10 px-sm py-xs font-data text-caption text-warning">
          {PENDING_EDITS_NOTE}
        </p>
      ) : null}

      <form className="mt-xl space-y-lg" onSubmit={handleSubmit} noValidate>
        <SpeakerPhotoField
          user={user}
          speakerId={speakerId}
          value={form.headshotPath}
          onChange={(path) => setField('headshotPath', path)}
        />

        <div className="grid gap-lg sm:grid-cols-2">
          <div>
            <label htmlFor="firstName" className="block font-semibold text-text-primary">
              First name
            </label>
            <input
              id="firstName"
              ref={nameRef}
              className={`mt-2xs ${inputClass}`}
              value={form.firstName}
              onChange={(e) => setField('firstName', e.target.value)}
              aria-invalid={nameError ? 'true' : undefined}
              aria-describedby={nameError ? 'speaker-name-error' : undefined}
              autoComplete="given-name"
            />
          </div>
          <div>
            <label htmlFor="lastName" className="block font-semibold text-text-primary">
              Last name
            </label>
            <input
              id="lastName"
              className={`mt-2xs ${inputClass}`}
              value={form.lastName}
              onChange={(e) => setField('lastName', e.target.value)}
              aria-invalid={nameError ? 'true' : undefined}
              aria-describedby={nameError ? 'speaker-name-error' : undefined}
              autoComplete="family-name"
            />
          </div>
        </div>
        {nameError ? (
          <p id="speaker-name-error" role="alert" className="font-data text-caption text-danger">
            {nameError}
          </p>
        ) : null}

        <div className="grid gap-lg sm:grid-cols-2">
          <div>
            <label htmlFor="jobTitle" className="block font-semibold text-text-primary">
              Role
            </label>
            <input
              id="jobTitle"
              className={`mt-2xs ${inputClass}`}
              value={form.jobTitle}
              onChange={(e) => setField('jobTitle', e.target.value)}
              autoComplete="organization-title"
            />
          </div>
          <div>
            <label htmlFor="organization" className="block font-semibold text-text-primary">
              Organization
            </label>
            <input
              id="organization"
              className={`mt-2xs ${inputClass}`}
              value={form.organization}
              onChange={(e) => setField('organization', e.target.value)}
              autoComplete="organization"
            />
          </div>
        </div>

        <div>
          <label htmlFor="bio" className="block font-semibold text-text-primary">
            Biography
          </label>
          <textarea
            id="bio"
            rows={5}
            className={`mt-2xs ${inputClass}`}
            value={form.bio}
            onChange={(e) => setField('bio', e.target.value)}
          />
        </div>

        <fieldset>
          <legend className="font-semibold text-text-primary">Social links</legend>
          <div className="mt-xs space-y-xs">
            {form.socialRows.map((row, index) => (
              <div key={index} className="flex flex-wrap items-center gap-xs">
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
                  className="touch-target rounded-brand px-sm py-xs font-data text-caption text-text-secondary underline hover:bg-surface-alt"
                  onClick={() => removeSocialRow(index)}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="touch-target mt-xs inline-flex items-center rounded-brand border-hairline border-rule-hairline px-sm py-xs font-data text-caption font-semibold text-text-primary hover:bg-surface-alt"
            onClick={addSocialRow}
          >
            + Add another link
          </button>
        </fieldset>

        <button type="submit" className={primaryActionClass} disabled={saving}>
          {saving ? 'Saving…' : 'Save speaker profile'}
        </button>
      </form>
    </article>
  );
}
