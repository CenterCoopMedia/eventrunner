// Speaker self-service profile wizard (spec §4.3, §9 "Speaker profile
// wizard", issue #22) — /speaker/profile.
//
// Five steps (ADR 0008 §3): About you → Bio and photo → Links → Logistics
// → Review, at /speaker/profile/:stepSlug. Each Next saves that step, so a
// speaker who stops halfway keeps what they wrote. Logistics answers go to
// a staff-only record through saveOwnSpeakerLogistics; Review submits once
// through submitOwnSpeakerProfile, which sends speaker.profile_received.
// The fields live in components/speaker/SpeakerProfileFields.jsx.
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
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { SELF_EDITABLE_SPEAKER_FIELDS } from 'shared/speaker';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useProfile } from '../contexts/ProfileContext.jsx';
import { useToast } from '../contexts/ToastContext.jsx';
import EmptyState from '../components/EmptyState.jsx';
import LoadingState from '../components/LoadingState.jsx';
import SignInPanel from '../components/SignInPanel.jsx';
import { StepHeading, StepList, StepPager, resolveStep, useStepHeadingFocus } from '../components/forms/Stepper.jsx';
import SpeakerProfileFields, { SPEAKER_STEPS } from '../components/speaker/SpeakerProfileFields.jsx';
import {
  deleteSpeakerPhoto,
  loadOwnSpeakerProfile,
  saveOwnSpeakerLogistics,
  submitOwnSpeakerProfile,
  updateOwnSpeakerProfile,
} from '../lib/speakerProfileApi.js';
import { primaryActionClass, secondaryActionClass } from '../components/controlClasses.js';
import { useMediaQuery, WIDE_VIEWPORT } from '../lib/viewport.js';

const hrefFor = (step) => `/speaker/profile/${step.slug}`;
const STEP_SAVES = Object.freeze(['about', 'bio', 'links', 'logistics']);
const BLANK_LOGISTICS = Object.freeze({ travel: '', accessNeeds: '', avNeeds: '' });

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


/** Logistics as the server stores them: trimmed, with empty answers as null. */
function logisticsPayload(logistics) {
  const out = {};
  for (const [key, value] of Object.entries(logistics)) out[key] = value.trim() || null;
  return out;
}

/** What a step would send, as text, to tell a changed step from an unchanged one. */
function stepPayloadKey(slug, form, logistics) {
  return JSON.stringify(slug === 'logistics' ? logisticsPayload(logistics) : fieldsFor(slug, form));
}

/** The fields one step saves through updateOwnSpeakerProfile. */
function fieldsFor(slug, form) {
  let fields = {};
  if (slug === 'about') {
    fields = {
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      pronouns: form.pronouns.trim(),
      organization: form.organization.trim(),
      jobTitle: form.jobTitle.trim(),
    };
  } else if (slug === 'bio') {
    fields = { bio: form.bio.trim(), headshotPath: form.headshotPath ? form.headshotPath : null };
  } else if (slug === 'links') {
    fields = { socialHandles: rowsToHandles(form.socialRows) };
  }
  // A static guard against this page drifting from the server's allowlist:
  // every key above is already on SELF_EDITABLE_SPEAKER_FIELDS.
  for (const key of Object.keys(fields)) {
    if (!SELF_EDITABLE_SPEAKER_FIELDS.includes(key)) delete fields[key];
  }
  return fields;
}

export default function SpeakerProfile() {
  const { user } = useAuth();
  const { profile, status: accountStatus } = useProfile();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const { stepSlug } = useParams();
  const wide = useMediaQuery(WIDE_VIEWPORT);
  const headingRef = useStepHeadingFocus(stepSlug);
  const speakerId = profile?.speakerId ?? null;

  const [load, setLoad] = useState({ status: 'loading', speaker: null, error: null });
  const [form, setForm] = useState(null);
  const [logistics, setLogisticsState] = useState(BLANK_LOGISTICS);
  const [saved, setSaved] = useState([]);
  const [savedNote, setSavedNote] = useState('');
  const [submitted, setSubmitted] = useState(null);
  const [nameError, setNameError] = useState(null);
  const [saving, setSaving] = useState(false);
  const nameRef = useRef(null);
  // What each step last saved (or loaded with). Next on an unchanged step
  // moves on without a save, so an approved speaker walking through the
  // steps queues no empty edit for staff to review.
  const savedPayloadsRef = useRef({});

  // Guards against a stale response landing after the identity it was
  // fetched for has changed (issue #22 review finding P2-9) — a signed-in
  // speaker signing out and a different one signing in inside the same
  // mounted page, or the linked speakerId changing under it. Each call to
  // loadProfile (mount, retry) claims the next id; a response only applies
  // if it is still the most recent claim when it resolves.
  const requestIdRef = useRef(0);

  // Photo cleanup bookkeeping (issue #22 review findings P1-2 / P2-3).
  // Every upload lands at a FRESH path (SpeakerPhotoField / speakerPhotoApi
  // .uploadSpeakerPhoto), so choosing a file never touches the live public
  // object — but that means a superseded upload needs an explicit deferred
  // delete once a save no longer points at it, the same rule
  // ProfilePhotoField follows for attendee photos. Two refs:
  //   • livePhotoPathRef  — speakers.headshotPath as currently PUBLISHED
  //     (or about-to-publish, pre-approval). NEVER deleted from here — an
  //     approved speaker's queued edit does not touch this object until an
  //     organizer applies it (functions/src/speakers/profile.cjs deletes
  //     the superseded live object itself, once it actually stops being
  //     live).
  //   • photoBaselineRef  — the EFFECTIVE path the form last saved (a
  //     queued pendingEdits.headshotPath if one exists, else the live
  //     value). Safe to delete once superseded, UNLESS it equals the live
  //     path AND the save result says the edit is staged. That flag comes
  //     from the server, not from the status read at load.
  const livePhotoPathRef = useRef(null);
  const photoBaselineRef = useRef(null);

  const loadProfile = useCallback(() => {
    if (!user || !speakerId) return;
    const requestId = ++requestIdRef.current;
    setLoad({ status: 'loading', speaker: null, error: null });
    loadOwnSpeakerProfile({ user, speakerId })
      .then(({ speaker, logistics: stored }) => {
        if (requestIdRef.current !== requestId) return; // superseded by a newer request
        const effective = { ...speaker, ...(speaker.pendingEdits ?? {}) };
        setLoad({ status: 'ready', speaker, error: null });
        const loadedForm = {
          firstName: effective.firstName ?? '',
          lastName: effective.lastName ?? '',
          pronouns: effective.pronouns ?? '',
          bio: effective.bio ?? '',
          organization: effective.organization ?? '',
          jobTitle: effective.jobTitle ?? '',
          headshotPath: effective.headshotPath ?? '',
          socialRows: handlesToRows(effective.socialHandles),
        };
        const loadedLogistics = {
          travel: stored?.travel ?? '',
          accessNeeds: stored?.accessNeeds ?? '',
          avNeeds: stored?.avNeeds ?? '',
        };
        setForm(loadedForm);
        setLogisticsState(loadedLogistics);
        savedPayloadsRef.current = Object.fromEntries(
          STEP_SAVES.map((slug) => [slug, stepPayloadKey(slug, loadedForm, loadedLogistics)]),
        );
        setSubmitted(speaker.profileSubmittedAt ?? null);
        livePhotoPathRef.current = speaker.headshotPath ?? null;
        photoBaselineRef.current = effective.headshotPath ?? null;
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
    // this branch — no redirect, no return-path state to lose.
    return (
      <article className="mx-auto max-w-md">
        <h1 className="font-heading text-h1 font-semibold text-text-primary">Sign in to continue</h1>
        <p className="mt-xs max-w-prose text-body text-text-secondary text-pretty">
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
        <LoadingState label="Setting up your account…" />
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
        <LoadingState label="Loading your speaker profile…" />
      </div>
    );
  }

  const { index: current, unknown } = resolveStep(SPEAKER_STEPS, stepSlug, 0);
  if (unknown) return <Navigate to="/speaker/profile" replace />;
  const step = SPEAKER_STEPS[current];
  const review = step.slug === 'review';
  const steps = SPEAKER_STEPS.map((item) => ({
    ...item,
    state: item.slug !== 'review' && (saved.includes(item.slug) || submitted) ? 'done' : 'todo',
  }));

  const statusNote = STATUS_COPY[load.speaker.status] ?? null;
  const hasPendingEdits = Boolean(load.speaker.pendingEdits);

  const setField = (key, value) => setForm((previous) => ({ ...previous, [key]: value }));
  const setLogistics = (key, value) => setLogisticsState((previous) => ({ ...previous, [key]: value }));
  const setSocialRow = (index, key, value) =>
    setForm((previous) => ({
      ...previous,
      socialRows: previous.socialRows.map((row, i) => (i === index ? { ...row, [key]: value } : row)),
    }));
  const addSocialRow = () =>
    setForm((previous) => ({ ...previous, socialRows: [...previous.socialRows, { label: '', handle: '' }] }));
  const removeSocialRow = (index) =>
    setForm((previous) => ({
      ...previous,
      socialRows: previous.socialRows.length > 1
        ? previous.socialRows.filter((_, i) => i !== index)
        : [{ label: '', handle: '' }],
    }));

  /** Save the open step. @returns {Promise<boolean>} true when it saved */
  async function saveStep() {
    if (step.slug === 'about' && (form.firstName.trim().length === 0 || form.lastName.trim().length === 0)) {
      setNameError('Enter the name you want printed on the programme.');
      nameRef.current?.focus();
      return false;
    }
    setNameError(null);
    const key = stepPayloadKey(step.slug, form, logistics);
    if (savedPayloadsRef.current[step.slug] === key) return true;
    if (step.slug === 'logistics') {
      await saveOwnSpeakerLogistics({ user, speakerId, logistics });
      savedPayloadsRef.current.logistics = key;
      setSavedNote('Saved. Only the organizers see these answers.');
      return true;
    }
    const fields = fieldsFor(step.slug, form);
    const result = await updateOwnSpeakerProfile({ user, speakerId, fields });
    savedPayloadsRef.current[step.slug] = key;
    const staged = result?.staged === true;
    if (step.slug === 'bio') {
      // Deferred photo cleanup (issue #22 review findings P1-2 / P2-3): the
      // upload already landed at a fresh path, so the only object left to
      // remove is the one this save just SUPERSEDED — and only when it is
      // safe to. The server says whether this save is queued; the status
      // from load can be stale, and a stale "not approved" would delete the
      // live photo.
      const previousPath = photoBaselineRef.current;
      const newPath = fields.headshotPath;
      const safeToDelete = previousPath !== newPath && previousPath && (!staged || previousPath !== livePhotoPathRef.current);
      if (safeToDelete) {
        try {
          await deleteSpeakerPhoto({ user, speakerId, path: previousPath });
        } catch {
          // Best-effort: an orphaned object costs a little storage, not a broken profile.
        }
      }
      photoBaselineRef.current = newPath;
      if (!staged) livePhotoPathRef.current = newPath;
    }
    setSavedNote(staged
      ? 'Saved for review. An organizer reviews changes before they replace your public profile.'
      : 'Saved.');
    return true;
  }

  async function goNext() {
    if (saving) return;
    setSaving(true);
    try {
      if (!(await saveStep())) return;
      setSaved((previous) => (previous.includes(step.slug) ? previous : [...previous, step.slug]));
      navigate(hrefFor(SPEAKER_STEPS[current + 1]));
    } catch (err) {
      showToast(err?.message || 'This step could not be saved. Your answers are still here.', { tone: 'error' });
    } finally {
      setSaving(false);
    }
  }

  async function submit() {
    if (saving) return;
    setSaving(true);
    try {
      const result = await submitOwnSpeakerProfile({ user, speakerId });
      setSubmitted(new Date().toISOString());
      setSavedNote(result?.emailed
        ? 'Profile submitted. We emailed you a note that we have it.'
        : 'Profile submitted.');
    } catch (err) {
      showToast(err?.message || 'Your profile could not be submitted. Your answers are saved.', { tone: 'error' });
    } finally {
      setSaving(false);
    }
  }

  const submitControl = submitted ? (
    <p role="status" className="font-data text-caption text-text-secondary">
      Submitted. Changes you save are kept; you do not need to submit again.
    </p>
  ) : (
    <button type="button" className={primaryActionClass} onClick={submit} disabled={saving} aria-busy={saving || undefined}>
      {saving ? 'Submitting…' : 'Submit profile'}
    </button>
  );

  return (
    <article className="mx-auto max-w-5xl space-y-lg">
      <header className="max-w-prose space-y-xs">
        <h1 className="font-heading text-h1 font-semibold text-text-primary">Your speaker profile</h1>
        <p className="text-body text-text-secondary">
          This is what appears on the public programme once an organizer approves it. Each step saves when you move on.
        </p>
        {statusNote ? (
          <p role="status" className="border-hairline border-rule-hairline bg-surface-alt px-sm py-xs font-data text-caption text-text-primary">
            {statusNote.text}
          </p>
        ) : null}
        {hasPendingEdits ? (
          <p role="status" className="border-hairline border-warning/40 bg-warning/10 px-sm py-xs font-data text-caption text-warning">
            {PENDING_EDITS_NOTE}
          </p>
        ) : null}
      </header>
      <div className="grid items-start gap-lg lg:grid-cols-[minmax(14rem,18rem)_minmax(0,1fr)]">
        <StepList steps={steps} current={current} hrefFor={hrefFor} wide={wide} label="Speaker profile steps" />
        <section className="min-w-0 space-y-md border-hairline border-rule-hairline bg-surface-alt p-md sm:p-lg" aria-labelledby="speaker-step-heading">
          <StepHeading index={current} total={SPEAKER_STEPS.length} title={step.title} headingRef={headingRef} headingId="speaker-step-heading" />
          {savedNote ? <p role="status" className="font-data text-caption text-text-secondary">{savedNote}</p> : null}
          <form noValidate className="space-y-lg" onSubmit={(e) => { e.preventDefault(); if (review) submit(); else goNext(); }}>
            <fieldset disabled={saving} className="min-w-0 space-y-lg">
              <SpeakerProfileFields
                slug={step.slug}
                form={form}
                setField={setField}
                nameError={nameError}
                nameRef={nameRef}
                user={user}
                speakerId={speakerId}
                setSocialRow={setSocialRow}
                addSocialRow={addSocialRow}
                removeSocialRow={removeSocialRow}
                logistics={logistics}
                setLogistics={setLogistics}
                socialHandles={rowsToHandles(form.socialRows)}
              />
            </fieldset>
          </form>
          <StepPager
            previous={SPEAKER_STEPS[current - 1]}
            next={review ? null : SPEAKER_STEPS[current + 1]}
            hrefFor={hrefFor}
            backClass={secondaryActionClass}
            nextClass={primaryActionClass}
            onNext={goNext}
            last={review ? submitControl : null}
          />
        </section>
      </div>
    </article>
  );
}
