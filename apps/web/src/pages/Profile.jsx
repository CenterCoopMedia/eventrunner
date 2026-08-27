// Profile setup and edit (issue #17, spec §3.4, §4.5).
//
// One form serves both jobs: the first sign-in lands here to complete a
// profile, and every later visit edits the same fields. Nothing about the
// account itself is editable here — registrationStatus and speakerId are
// server-owned and the rules deny them, so they are not on the form at all
// (ProfileSidebar shows the account owner their status read-only).
//
// Interface guidelines applied: real labels, no placeholder-as-label, the
// submit button stays enabled until the request starts, validation on submit
// with aria-invalid plus focus moved to the first error, and the save result
// announced through the toast region.
//
// Editorial base restyle (design brief §2.1, §2.4): inputs and buttons carry
// the hairline-rule tokens SignInPanel established rather than a raw border
// color, and the "Badges" subsection opens with the SectionHead device
// instead of a bare heading. Every visible `<label>` here stays a control
// label above its own input — the eyebrow ban's one named exception (§2.4).
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { PROFILE_VISIBILITIES } from 'shared/profile';
import { MAX_TOTAL_BADGES } from 'shared/badges';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import { useProfile } from '../contexts/ProfileContext.jsx';
import { useToast } from '../contexts/ToastContext.jsx';
import EmptyState from '../components/EmptyState.jsx';
import ProfilePhotoField from '../components/media/ProfilePhotoField.jsx';
import SectionHead from '../components/editorial/SectionHead.jsx';
import { deleteOwnPhoto } from '../lib/mediaSource.js';

const VISIBILITY_COPY = {
  public: {
    label: 'Anyone',
    description: 'Your profile appears in the directory and is readable by anyone, signed in or not.',
  },
  attendees_only: {
    label: 'Attendees only',
    description: 'Only approved attendees and speakers can see your profile.',
  },
  private: {
    label: 'Nobody',
    description: 'You are left out of the directory entirely.',
  },
};

const inputClass =
  'touch-target w-full rounded-brand border-hairline border-rule-hairline bg-surface px-sm py-xs ' +
  'font-body text-body text-text-primary placeholder:text-text-secondary ' +
  'aria-[invalid=true]:border-danger';

const primaryButtonClass =
  'touch-target inline-flex items-center justify-center rounded-brand bg-accent ' +
  'px-md py-xs font-data text-caption font-semibold text-surface hover:bg-accent-strong disabled:opacity-60';

/**
 * config/badges as the form needs it: one group per category, carrying the
 * category's maxPicks. The cap is enforced here as well as in the
 * projection, because a projection-only cap is invisible — the person sees
 * everything they ticked while everyone else sees the first N (§4.5).
 */
function readBadgeCategories(badgesConfig) {
  const categories = Array.isArray(badgesConfig?.categories) ? badgesConfig.categories : [];
  return categories
    .filter((category) => category && typeof category.id === 'string')
    .map((category) => ({
      id: category.id,
      label:
        typeof category.label === 'string' && category.label ? category.label : category.id,
      maxPicks:
        Number.isInteger(category.maxPicks) && category.maxPicks > 0 ? category.maxPicks : null,
      badges: (Array.isArray(category.badges) ? category.badges : [])
        .filter((badge) => badge && typeof badge.id === 'string')
        .map((badge) => ({
          id: badge.id,
          label: typeof badge.label === 'string' && badge.label ? badge.label : badge.id,
        })),
    }))
    .filter((category) => category.badges.length > 0);
}

// How close a config's total is allowed to get to MAX_TOTAL_BADGES before
// the picker says anything: the operator-side validator (validateBadgesConfig,
// packages/shared/src/config/schema.cjs) already refuses a config that
// crosses the limit, so this is advance notice for whoever is filling out
// categories close to it, not a correctness check the picker performs.
const APPROACHING_LIMIT_MARGIN = 5;

/**
 * The most badges an attendee could ever have selected at once across these
 * categories — sum of each category's maxPicks, bounded by how many badges
 * it actually offers. Mirrors the bound validateBadgesConfig enforces
 * against MAX_TOTAL_BADGES, so the picker can warn using the same number.
 */
function totalSelectable(categories) {
  return categories.reduce(
    (sum, category) =>
      sum + Math.min(category.maxPicks ?? category.badges.length, category.badges.length),
    0,
  );
}

export default function Profile() {
  const { user } = useAuth();
  const { features, badges: badgesConfig } = useEventConfig();
  const { profile, status, needsProfileSetup, saveProfile } = useProfile();
  const { showToast } = useToast();

  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState(null);
  const nameRef = useRef(null);
  // The photo path the SAVED profile currently references. Removing or
  // replacing a photo only changes the form; the old object is deleted once
  // a save has committed, so an abandoned edit never leaves the directory
  // pointing at an object that is gone (see ProfilePhotoField).
  const savedPhotoPathRef = useRef(null);

  // Seed the form from the account document the first time it arrives. Later
  // snapshots (e.g. the profileComplete trigger writing back) must not
  // clobber what the person is currently typing, so this seeds once.
  useEffect(() => {
    if (form != null || profile == null) return;
    setForm({
      displayName: profile.displayName ?? '',
      pronouns: profile.pronouns ?? '',
      jobTitle: profile.jobTitle ?? '',
      organization: profile.organization ?? '',
      bio: profile.bio ?? '',
      profileVisibility: profile.profileVisibility ?? 'attendees_only',
      badges: Array.isArray(profile.badges) ? profile.badges : [],
      photoPath: typeof profile.photoPath === 'string' ? profile.photoPath : '',
    });
    savedPhotoPathRef.current =
      typeof profile.photoPath === 'string' ? profile.photoPath : null;
  }, [profile, form]);

  if (!user) {
    return (
      <EmptyState
        title="Sign in to set up your profile"
        description="Your profile is part of your account, so it lives behind sign-in."
        action={
          <Link to="/signin" className="touch-target inline-flex items-center rounded-brand bg-accent px-md py-xs font-data text-caption font-semibold text-surface">
            Go to sign in
          </Link>
        }
      />
    );
  }

  if (status === 'pending-account' || form == null) {
    return (
      <EmptyState
        title="Setting up your account"
        description="This takes a moment after your first sign-in. The form appears as soon as your account is ready."
      />
    );
  }

  // `public` is only offered when the event runs public attendee profiles;
  // an event with the flag off can still hold profiles stored as `public`
  // from a previous setting, so the current value is never hidden from the
  // person who chose it.
  const visibilityOptions = PROFILE_VISIBILITIES.filter(
    (value) =>
      value !== 'public' || features.publicAttendeeProfiles || form.profileVisibility === 'public',
  );
  const badgeCategories = features.badges ? readBadgeCategories(badgesConfig) : [];
  const nearBadgeLimit =
    MAX_TOTAL_BADGES - totalSelectable(badgeCategories) <= APPROACHING_LIMIT_MARGIN;

  const setField = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const toggleBadge = (badgeId) =>
    setForm((current) => ({
      ...current,
      badges: current.badges.includes(badgeId)
        ? current.badges.filter((id) => id !== badgeId)
        : [...current.badges, badgeId],
    }));

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (form.displayName.trim().length === 0) {
      setNameError('Enter the name you want other attendees to see.');
      nameRef.current?.focus();
      return;
    }
    setNameError(null);
    setSaving(true);
    try {
      await saveProfile({
        displayName: form.displayName.trim(),
        pronouns: form.pronouns.trim(),
        jobTitle: form.jobTitle.trim(),
        organization: form.organization.trim(),
        bio: form.bio.trim(),
        profileVisibility: form.profileVisibility,
        badges: form.badges,
        // Empty string means "no photo". The rules accept a string or null
        // for photoPath (firestore.rules validSelfProfileTypes), and the
        // projection coerces either to nothing rendered.
        photoPath: form.photoPath ? form.photoPath : null,
      });
      // The save committed, so nothing points at the previous object any
      // more: clean it up. Best effort by design — a failed delete leaves an
      // orphan, which costs storage and nothing else, while failing the save
      // here would tell someone their profile did not save when it did.
      const previousPath = savedPhotoPathRef.current;
      const currentPath = form.photoPath ? form.photoPath : null;
      savedPhotoPathRef.current = currentPath;
      if (previousPath && previousPath !== currentPath) {
        await deleteOwnPhoto(previousPath);
      }
      showToast('Profile saved.');
    } catch {
      // The rules reject anything outside the self-editable allowlist, and
      // an offline write never lands: say so plainly rather than pretending
      // the save worked.
      showToast('Your profile could not be saved. Try again.', { tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <article className="mx-auto max-w-2xl">
      <h1 className="font-heading text-h1 font-semibold text-text-primary">
        {needsProfileSetup ? 'Complete your profile' : 'Your profile'}
      </h1>
      <p className="mt-xs max-w-prose text-body text-text-secondary">
        This is what other attendees see about you. Everything except your name is optional.
      </p>

      <form className="mt-xl space-y-lg" onSubmit={handleSubmit} noValidate>
        <ProfilePhotoField
          uid={user.uid}
          value={form.photoPath}
          onChange={(path) => setField('photoPath', path)}
        />
        <div>
          <label htmlFor="displayName" className="block font-semibold text-text-primary">
            Name
          </label>
          <input
            id="displayName"
            ref={nameRef}
            className={`mt-2xs ${inputClass}`}
            value={form.displayName}
            onChange={(e) => setField('displayName', e.target.value)}
            aria-invalid={nameError ? 'true' : undefined}
            aria-describedby={nameError ? 'displayName-error' : undefined}
            autoComplete="name"
          />
          {nameError ? (
            <p id="displayName-error" role="alert" className="mt-2xs font-data text-caption text-danger">
              {nameError}
            </p>
          ) : null}
        </div>

        <div className="grid gap-lg sm:grid-cols-2">
          <div>
            <label htmlFor="pronouns" className="block font-semibold text-text-primary">
              Pronouns
            </label>
            <input
              id="pronouns"
              className={`mt-2xs ${inputClass}`}
              value={form.pronouns}
              onChange={(e) => setField('pronouns', e.target.value)}
            />
          </div>
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

        <div>
          <label htmlFor="bio" className="block font-semibold text-text-primary">
            About you
          </label>
          <textarea
            id="bio"
            rows={4}
            className={`mt-2xs ${inputClass}`}
            value={form.bio}
            onChange={(e) => setField('bio', e.target.value)}
          />
        </div>

        <fieldset>
          <legend className="font-semibold text-text-primary">Who can see your profile</legend>
          <div className="mt-xs space-y-xs">
            {visibilityOptions.map((value) => (
              <label key={value} className="flex items-start gap-sm rounded-brand p-xs">
                <input
                  type="radio"
                  name="profileVisibility"
                  value={value}
                  checked={form.profileVisibility === value}
                  onChange={() => setField('profileVisibility', value)}
                  className="mt-3xs"
                />
                <span>
                  <span className="block font-semibold text-text-primary">
                    {VISIBILITY_COPY[value].label}
                  </span>
                  <span className="block font-data text-caption text-text-secondary">
                    {VISIBILITY_COPY[value].description}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {badgeCategories.length > 0 ? (
          <section className="mt-xl">
            <SectionHead level={2} title="Badges" />
            {nearBadgeLimit ? (
              <p className="mt-sm font-data text-caption text-text-secondary" role="status">
                This event is close to the platform’s {MAX_TOTAL_BADGES}-badge total across all
                categories, so some categories may offer fewer picks than usual.
              </p>
            ) : null}
            {badgeCategories.map((category) => {
              const picked = category.badges.filter((badge) =>
                form.badges.includes(badge.id),
              ).length;
              const atCap = category.maxPicks != null && picked >= category.maxPicks;
              return (
                <fieldset key={category.id} className="mt-md">
                  <legend className="font-semibold text-text-primary">{category.label}</legend>
                  {category.maxPicks != null ? (
                    <p className="mt-2xs font-data text-caption text-text-secondary" role="status">
                      {atCap
                        ? `You’ve picked all ${category.maxPicks} — clear one to choose another.`
                        : `Pick up to ${category.maxPicks} (${picked} chosen).`}
                    </p>
                  ) : null}
                  <div className="mt-xs grid gap-xs sm:grid-cols-2">
                    {category.badges.map((badge) => {
                      const checked = form.badges.includes(badge.id);
                      return (
                        <label
                          key={badge.id}
                          className={`flex items-center gap-sm rounded-brand p-xs ${
                            !checked && atCap ? 'text-text-secondary' : ''
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={!checked && atCap}
                            onChange={() => toggleBadge(badge.id)}
                          />
                          <span className="text-text-primary">{badge.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              );
            })}
          </section>
        ) : null}

        <button type="submit" className={primaryButtonClass} disabled={saving}>
          {saving ? 'Saving…' : 'Save profile'}
        </button>
      </form>
    </article>
  );
}
