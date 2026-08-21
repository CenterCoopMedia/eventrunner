// ProfileSidebar — the signed-in attendee's own card, rendered beside the
// directory and profile pages (issue #17).
//
// It is the one place the account owner sees what other attendees see: the
// name on their card, who their profile is visible to, and where their
// registration stands. Registration status is deliberately shown ONLY here,
// to its owner — it is not part of the public projection (spec §4.1).
import { Link } from 'react-router-dom';
import { useProfile } from '../contexts/ProfileContext.jsx';

const VISIBILITY_LABELS = {
  public: 'Visible to anyone',
  attendees_only: 'Visible to attendees',
  private: 'Hidden from the directory',
};

// Owner-facing copy for the four §3.4 statuses. Neutral about the reason:
// the account owner is told what is true and what happens next, never why a
// decision went the way it did.
const STATUS_LABELS = {
  pending: 'Registration under review',
  ticketed: 'Ticket confirmed',
  approved: 'Registration approved',
  revoked: 'Registration not active',
};

const cardClass =
  'rounded-brand-lg border border-brand-ink/10 bg-brand-surface-alt p-5';

export default function ProfileSidebar() {
  const { profile, status, needsProfileSetup } = useProfile();

  if (status === 'signed-out') {
    return (
      <aside aria-labelledby="profile-sidebar-heading" className={cardClass}>
        <h2 id="profile-sidebar-heading" className="font-heading text-lg text-brand-ink">
          Your profile
        </h2>
        <p className="mt-2 text-sm text-brand-ink-muted">
          Sign in to add your profile to the attendee directory.
        </p>
        <Link
          to="/signin"
          className="touch-target mt-4 inline-flex items-center rounded-brand bg-brand-primary px-4 py-2 font-semibold text-brand-surface"
        >
          Sign in
        </Link>
      </aside>
    );
  }

  if (status === 'pending-account') {
    return (
      <aside aria-labelledby="profile-sidebar-heading" className={cardClass}>
        <h2 id="profile-sidebar-heading" className="font-heading text-lg text-brand-ink">
          Your profile
        </h2>
        <p role="status" className="mt-2 text-sm text-brand-ink-muted">
          Setting up your account. This takes a moment after your first sign-in.
        </p>
      </aside>
    );
  }

  const registrationLabel = STATUS_LABELS[profile?.registrationStatus] ?? null;
  const visibilityLabel = VISIBILITY_LABELS[profile?.profileVisibility] ?? null;
  const badgeCount = Array.isArray(profile?.badges) ? profile.badges.length : 0;

  return (
    <aside aria-labelledby="profile-sidebar-heading" className={cardClass}>
      <h2 id="profile-sidebar-heading" className="font-heading text-lg text-brand-ink">
        Your profile
      </h2>
      <p className="mt-2 font-semibold text-brand-ink">
        {profile?.displayName || 'No name yet'}
      </p>
      {profile?.jobTitle || profile?.organization ? (
        <p className="text-sm text-brand-ink-muted">
          {[profile.jobTitle, profile.organization].filter(Boolean).join(' · ')}
        </p>
      ) : null}
      <dl className="mt-4 space-y-2 text-sm">
        {visibilityLabel ? (
          <div>
            <dt className="text-brand-ink-muted">Directory visibility</dt>
            <dd className="text-brand-ink">{visibilityLabel}</dd>
          </div>
        ) : null}
        {registrationLabel ? (
          <div>
            <dt className="text-brand-ink-muted">Registration</dt>
            <dd className="text-brand-ink">{registrationLabel}</dd>
          </div>
        ) : null}
        {badgeCount > 0 ? (
          <div>
            <dt className="text-brand-ink-muted">Badges</dt>
            <dd className="text-brand-ink">{badgeCount} selected</dd>
          </div>
        ) : null}
      </dl>
      {needsProfileSetup ? (
        <p className="mt-4 text-sm text-brand-ink-muted">
          Your profile is not complete yet, so it does not appear in the directory.
        </p>
      ) : null}
      <Link
        to="/profile"
        className="touch-target mt-4 inline-flex items-center rounded-brand border border-brand-ink/20 bg-brand-surface px-4 py-2 font-semibold text-brand-ink hover:bg-brand-surface-alt"
      >
        {needsProfileSetup ? 'Complete your profile' : 'Edit your profile'}
      </Link>
    </aside>
  );
}
