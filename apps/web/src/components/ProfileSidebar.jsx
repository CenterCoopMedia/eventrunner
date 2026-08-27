// ProfileSidebar — the signed-in attendee's own card, rendered beside the
// directory and profile pages (issue #17).
//
// It is the one place the account owner sees what other attendees see: the
// name on their card, who their profile is visible to, and where their
// registration stands. Registration status is deliberately shown ONLY here,
// to its owner — it is not part of the public projection (spec §4.1).
//
// It is bounded by a hairline rule rather than an ink-derived border, its
// ink reads the tier 2 role names, its type sits on the named scale, and its
// two actions are the shared filled and outlined controls (design brief
// §3.1, §3.7) — the vocabulary SessionCard and the restyled pages use.
import { Link } from 'react-router-dom';
import { useProfile } from '../contexts/ProfileContext.jsx';
import { primaryActionClass, secondaryActionClass } from './controlClasses.js';

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
  'rounded-brand-lg border-hairline border-rule-hairline bg-surface-alt p-md';

// The card's own heading: the section-heading step every other block-level
// heading on the site uses (EmptyState, SessionMaterialsList).
const headingClass = 'font-heading text-h3 font-semibold text-text-primary';

export default function ProfileSidebar() {
  const { profile, status, needsProfileSetup } = useProfile();

  if (status === 'signed-out') {
    return (
      <aside aria-labelledby="profile-sidebar-heading" className={cardClass}>
        <h2 id="profile-sidebar-heading" className={headingClass}>
          Your profile
        </h2>
        <p className="mt-xs text-body text-text-secondary">
          Sign in to add your profile to the attendee directory.
        </p>
        <Link to="/signin" className={`${primaryActionClass} mt-md`}>
          Sign in
        </Link>
      </aside>
    );
  }

  if (status === 'pending-account') {
    return (
      <aside aria-labelledby="profile-sidebar-heading" className={cardClass}>
        <h2 id="profile-sidebar-heading" className={headingClass}>
          Your profile
        </h2>
        <p role="status" className="mt-xs text-body text-text-secondary">
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
      <h2 id="profile-sidebar-heading" className={headingClass}>
        Your profile
      </h2>
      <p className="mt-xs text-body font-semibold text-text-primary">
        {profile?.displayName || 'No name yet'}
      </p>
      {profile?.jobTitle || profile?.organization ? (
        <p className="mt-3xs font-data text-caption text-text-secondary">
          {[profile.jobTitle, profile.organization].filter(Boolean).join(' · ')}
        </p>
      ) : null}
      <dl className="mt-md space-y-xs font-data text-caption">
        {visibilityLabel ? (
          <div>
            <dt className="text-text-secondary">Directory visibility</dt>
            <dd className="text-text-primary">{visibilityLabel}</dd>
          </div>
        ) : null}
        {registrationLabel ? (
          <div>
            <dt className="text-text-secondary">Registration</dt>
            <dd className="text-text-primary">{registrationLabel}</dd>
          </div>
        ) : null}
        {badgeCount > 0 ? (
          <div>
            <dt className="text-text-secondary">Badges</dt>
            <dd className="text-text-primary">{badgeCount} selected</dd>
          </div>
        ) : null}
      </dl>
      {needsProfileSetup ? (
        <p className="mt-md text-body text-text-secondary">
          Your profile is not complete yet, so it does not appear in the directory.
        </p>
      ) : null}
      <Link to="/profile" className={`${secondaryActionClass} mt-md`}>
        {needsProfileSetup ? 'Complete your profile' : 'Edit your profile'}
      </Link>
    </aside>
  );
}
