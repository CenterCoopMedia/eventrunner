// One attendee's public profile (issue #17, spec §3.4).
//
// Reads users_public/{uid} — the trigger-maintained projection, the only
// document about another attendee any client may read. A profile the rules
// refuse and a profile that does not exist render the SAME "not available"
// state on purpose: distinguishing them would turn this page into an oracle
// for "this person is here but has a private profile".
//
// Editorial base restyle (design brief §2.1, §2.4): earned badges render as
// the small ruled-rectangle tag Attendees.jsx and SessionCard.jsx already
// use — never a pill, never a colored chip.
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import { useProfile } from '../contexts/ProfileContext.jsx';
import { fetchPublicProfile } from '../lib/profileSource.js';
import { badgeLabel, visibleBadgeIds } from '../lib/badgeDisplay.js';
import EmptyState from '../components/EmptyState.jsx';
import LoadingState from '../components/LoadingState.jsx';
import ProfileSidebar from '../components/ProfileSidebar.jsx';
import ProfilePhoto from '../components/media/ProfilePhoto.jsx';
import SectionHead from '../components/editorial/SectionHead.jsx';
import Tag from '../components/editorial/Tag.jsx';
import { primaryActionClass } from '../components/controlClasses.js';

/**
 * Render only strings — the projection coerces these fields and the rules
 * type-check them, but a page that hands React a map crashes outright.
 */
function text(value) {
  return typeof value === 'string' ? value : '';
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
          <Link to="/" className={primaryActionClass}>
            Go to the home page
          </Link>
        }
      />
    );
  }

  if (state.status === 'loading') return <LoadingState label="Loading profile…" />;

  if (state.status === 'unavailable') {
    return (
      <EmptyState
        title="This profile isn’t available"
        description="It may be private, or the attendee may not have set one up."
        action={
          <Link to="/attendees" className={primaryActionClass}>
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
  const badges = visibleBadgeIds(profile.badges, badgesConfig);

  return (
    <div className="grid gap-xl lg:grid-cols-[2fr_1fr]">
      <article>
        <div className="flex items-start gap-sm">
          <ProfilePhoto
            size="lg"
            photoPath={profile.photoPath}
            displayName={text(profile.displayName)}
          />
          <div>
            <h1 className="font-heading text-h1 font-semibold text-text-primary">
              {text(profile.displayName)}
            </h1>
            {text(profile.pronouns) ? (
              <p className="mt-2xs font-data text-caption text-text-secondary">
                {text(profile.pronouns)}
              </p>
            ) : null}
            {text(profile.jobTitle) || text(profile.organization) ? (
              <p className="mt-2xs font-data text-caption text-text-secondary">
                {[text(profile.jobTitle), text(profile.organization)].filter(Boolean).join(' · ')}
              </p>
            ) : null}
            {profile.speakerId ? (
              <p className="mt-xs font-data text-caption font-semibold text-text-primary">
                Speaker at this event
              </p>
            ) : null}
          </div>
        </div>
        {text(profile.bio) ? (
          <p className="mt-lg max-w-prose whitespace-pre-line text-body text-text-secondary">
            {text(profile.bio)}
          </p>
        ) : null}
        {features.badges && badges.length > 0 ? (
          <section className="mt-xl">
            <SectionHead level={2} title="Badges" />
            <ul className="mt-sm flex flex-wrap gap-2xs">
              {badges.map((badgeId) => (
                <li key={badgeId}>
                  <Tag>{badgeLabel(badgesConfig, badgeId)}</Tag>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <p className="mt-xl">
          <Link to="/attendees" className="font-data text-caption text-text-secondary underline underline-offset-2 hover:text-text-primary">
            Back to the directory
          </Link>
        </p>
      </article>
      <ProfileSidebar />
    </div>
  );
}
