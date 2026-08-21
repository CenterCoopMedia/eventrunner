// One attendee's public profile (issue #17, spec §3.4).
//
// Reads users_public/{uid} — the trigger-maintained projection, the only
// document about another attendee any client may read. A profile the rules
// refuse and a profile that does not exist render the SAME "not available"
// state on purpose: distinguishing them would turn this page into an oracle
// for "this person is here but has a private profile".
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { validateBadgeSelection } from 'shared/badges';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import { useProfile } from '../contexts/ProfileContext.jsx';
import { fetchPublicProfile } from '../lib/profileSource.js';
import EmptyState from '../components/EmptyState.jsx';
import LoadingState from '../components/LoadingState.jsx';
import ProfileSidebar from '../components/ProfileSidebar.jsx';
import ProfilePhoto from '../components/media/ProfilePhoto.jsx';

/**
 * Render only strings — the projection coerces these fields and the rules
 * type-check them, but a page that hands React a map crashes outright.
 */
function text(value) {
  return typeof value === 'string' ? value : '';
}

/** config/badges label lookup for an id already known to be configured. */
function badgeLabel(badgesConfig, badgeId) {
  const categories = Array.isArray(badgesConfig?.categories) ? badgesConfig.categories : [];
  for (const category of categories) {
    for (const badge of Array.isArray(category?.badges) ? category.badges : []) {
      if (badge?.id === badgeId) {
        return typeof badge.label === 'string' && badge.label ? badge.label : badgeId;
      }
    }
  }
  return badgeId;
}

export default function AttendeeProfile() {
  const { uid } = useParams();
  const { features, badges: badgesConfig } = useEventConfig();
  // A read denied while the viewer was still pending must not stick: when
  // their approval lands (or they sign in, or out) the rules answer
  // differently, so the read is re-run rather than leaving "unavailable"
  // frozen on screen until a manual reload.
  const { attendeeAccess, status: accountStatus } = useProfile();
  const [state, setState] = useState({ status: 'loading', profile: null });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading', profile: null });
    fetchPublicProfile(uid).then((profile) => {
      if (cancelled) return;
      setState({ status: profile ? 'found' : 'unavailable', profile });
    });
    return () => {
      cancelled = true;
    };
  }, [uid, attendeeAccess, accountStatus]);

  if (!features.attendeeDirectory) {
    return (
      <EmptyState
        title="This event doesn’t have an attendee directory"
        description="Everything else about the event is on the home page."
        action={
          <Link
            to="/"
            className="touch-target inline-flex items-center rounded-brand bg-brand-primary px-4 py-2 font-semibold text-brand-surface"
          >
            Go to the home page
          </Link>
        }
      />
    );
  }

  if (state.status === 'loading') return <LoadingState label="Loading profile" />;

  if (state.status === 'unavailable') {
    return (
      <EmptyState
        title="This profile isn’t available"
        description="It may be private, or the attendee may not have set one up."
        action={
          <Link
            to="/attendees"
            className="touch-target inline-flex items-center rounded-brand bg-brand-primary px-4 py-2 font-semibold text-brand-surface"
          >
            Back to the directory
          </Link>
        }
      />
    );
  }

  const { profile } = state;
  // Intersect with the LIVE config/badges rather than trusting the stored
  // projection: the projection is rewritten when its user's document is
  // written, so a badge the operator removed from config/badges afterwards
  // stays in it until that user next edits their profile. Rendering through
  // the same validator the projection uses means a removed badge stops
  // being shown the moment the config changes. (The stored projection is
  // still stale — see the reprojection note in the PR.)
  const badges = validateBadgeSelection(
    Array.isArray(profile.badges) ? profile.badges : [],
    badgesConfig,
  ).valid;

  return (
    <div className="grid gap-8 lg:grid-cols-[2fr_1fr]">
      <article>
        <div className="flex items-start gap-4">
          <ProfilePhoto
            size="lg"
            photoPath={profile.photoPath}
            displayName={text(profile.displayName)}
          />
          <div>
            <h1 className="font-heading text-3xl font-semibold text-brand-ink">
              {text(profile.displayName)}
            </h1>
            {text(profile.pronouns) ? (
              <p className="mt-1 text-brand-ink-muted">{text(profile.pronouns)}</p>
            ) : null}
            {text(profile.jobTitle) || text(profile.organization) ? (
              <p className="mt-2 text-brand-ink-muted">
                {[text(profile.jobTitle), text(profile.organization)].filter(Boolean).join(' · ')}
              </p>
            ) : null}
            {profile.speakerId ? (
              <p className="mt-2 font-semibold text-brand-primary-dark">Speaker at this event</p>
            ) : null}
          </div>
        </div>
        {text(profile.bio) ? (
          <p className="mt-6 max-w-prose whitespace-pre-line text-brand-ink">
            {text(profile.bio)}
          </p>
        ) : null}
        {features.badges && badges.length > 0 ? (
          <>
            <h2 className="mt-8 font-heading text-xl text-brand-ink">Badges</h2>
            <ul className="mt-2 flex flex-wrap gap-2">
              {badges.map((badgeId) => (
                <li
                  key={badgeId}
                  className="rounded-brand border border-brand-ink/10 bg-brand-surface-alt px-3 py-1 text-sm text-brand-ink"
                >
                  {badgeLabel(badgesConfig, badgeId)}
                </li>
              ))}
            </ul>
          </>
        ) : null}
        <p className="mt-8">
          <Link to="/attendees" className="rounded-brand underline underline-offset-4">
            Back to the directory
          </Link>
        </p>
      </article>
      <ProfileSidebar />
    </div>
  );
}
