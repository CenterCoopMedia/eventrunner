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
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { PROFILE_VISIBILITIES } from 'shared/profile';
import { MAX_TOTAL_BADGES } from 'shared/badges';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import { useProfile } from '../contexts/ProfileContext.jsx';
import { useToast } from '../contexts/ToastContext.jsx';
import EmptyState from '../components/EmptyState.jsx';

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
  'touch-target w-full rounded-brand border border-brand-ink/20 bg-brand-surface px-3 py-2 ' +
  'text-brand-ink placeholder:text-brand-ink-muted aria-[invalid=true]:border-danger';

const primaryButtonClass =
  'touch-target inline-flex items-center justify-center rounded-brand bg-brand-primary ' +
  'px-4 py-2 font-semibold text-brand-surface hover:bg-brand-primary-dark disabled:opacity-60';

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
    });
  }, [profile, form]);

  if (!user) {
    return (
      <EmptyState
        title="Sign in to set up your profile"
        description="Your profile is part of your account, so it lives behind sign-in."
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
      });
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
      <h1 className="font-heading text-3xl font-semibold text-brand-ink">
        {needsProfileSetup ? 'Complete your profile' : 'Your profile'}
      </h1>
      <p className="mt-2 text-brand-ink-muted">
        This is what other attendees see about you. Everything except your name is optional.
      </p>

      <form className="mt-8 space-y-6" onSubmit={handleSubmit} noValidate>
        <div>
          <label htmlFor="displayName" className="block font-semibold text-brand-ink">
            Name
          </label>
          <input
            id="displayName"
            ref={nameRef}
            className={`mt-1 ${inputClass}`}
            value={form.displayName}
            onChange={(e) => setField('displayName', e.target.value)}
            aria-invalid={nameError ? 'true' : undefined}
            aria-describedby={nameError ? 'displayName-error' : undefined}
            autoComplete="name"
          />
          {nameError ? (
            <p id="displayName-error" role="alert" className="mt-1 text-sm text-danger">
              {nameError}
            </p>
          ) : null}
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <label htmlFor="pronouns" className="block font-semibold text-brand-ink">
              Pronouns
            </label>
            <input
              id="pronouns"
              className={`mt-1 ${inputClass}`}
              value={form.pronouns}
              onChange={(e) => setField('pronouns', e.target.value)}
            />
          </div>
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

        <div>
          <label htmlFor="bio" className="block font-semibold text-brand-ink">
            About you
          </label>
          <textarea
            id="bio"
            rows={4}
            className={`mt-1 ${inputClass}`}
            value={form.bio}
            onChange={(e) => setField('bio', e.target.value)}
          />
        </div>

        <fieldset>
          <legend className="font-semibold text-brand-ink">Who can see your profile</legend>
          <div className="mt-2 space-y-2">
            {visibilityOptions.map((value) => (
              <label key={value} className="flex items-start gap-3 rounded-brand p-2">
                <input
                  type="radio"
                  name="profileVisibility"
                  value={value}
                  checked={form.profileVisibility === value}
                  onChange={() => setField('profileVisibility', value)}
                  className="mt-1"
                />
                <span>
                  <span className="block font-semibold text-brand-ink">
                    {VISIBILITY_COPY[value].label}
                  </span>
                  <span className="block text-sm text-brand-ink-muted">
                    {VISIBILITY_COPY[value].description}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {badgeCategories.length > 0 ? (
          <section>
            <h2 className="font-heading text-xl text-brand-ink">Badges</h2>
            {nearBadgeLimit ? (
              <p className="mt-1 text-sm text-brand-ink-muted" role="status">
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
                <fieldset key={category.id} className="mt-4">
                  <legend className="font-semibold text-brand-ink">{category.label}</legend>
                  {category.maxPicks != null ? (
                    <p className="mt-1 text-sm text-brand-ink-muted" role="status">
                      {atCap
                        ? `You’ve picked all ${category.maxPicks} — clear one to choose another.`
                        : `Pick up to ${category.maxPicks} (${picked} chosen).`}
                    </p>
                  ) : null}
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {category.badges.map((badge) => {
                      const checked = form.badges.includes(badge.id);
                      return (
                        <label
                          key={badge.id}
                          className={`flex items-center gap-3 rounded-brand p-2 ${
                            !checked && atCap ? 'text-brand-ink-muted' : ''
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={!checked && atCap}
                            onChange={() => toggleBadge(badge.id)}
                          />
                          <span className="text-brand-ink">{badge.label}</span>
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
