// Attendee directory (issue #17, spec §3.4).
//
// Feature-gated by config/features.attendeeDirectory — the route gates too,
// not just the nav link, since direct navigation bypasses the nav (matches
// the Schedule/Speakers pattern).
//
// Privacy here is a rules outcome, not a UI one: firestore.rules grant
// `attendees_only` profiles only to a requester whose OWN users doc shows
// approved/speaker/admin. This page asks for the narrower query when it
// believes it lacks that access, because a Firestore list fails outright if
// any returned document is unreadable — guessing wrong costs a query, never
// a leak.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import { useProfile } from '../contexts/ProfileContext.jsx';
import { subscribeDirectory } from '../lib/profileSource.js';
import { badgeLabel, visibleBadgeIds } from '../lib/badgeDisplay.js';
import EmptyState from '../components/EmptyState.jsx';
import LoadingState from '../components/LoadingState.jsx';
import ProfileSidebar from '../components/ProfileSidebar.jsx';
import ProfilePhoto from '../components/media/ProfilePhoto.jsx';
import Tag from '../components/editorial/Tag.jsx';

/**
 * Render only strings. The rules type-check these fields and the projection
 * coerces them, but a directory that hands React a map crashes for every
 * visitor at once — the cheapest place to be sure is the render itself.
 */
function text(value) {
  return typeof value === 'string' ? value : '';
}

const homeLink = (
  <Link
    to="/"
    className="touch-target inline-flex items-center rounded-brand bg-accent px-md py-xs font-data text-caption font-semibold text-surface"
  >
    Go to the home page
  </Link>
);

export default function Attendees() {
  const { features, badges: badgesConfig } = useEventConfig();
  const { status, attendeeAccess } = useProfile();
  const [profiles, setProfiles] = useState(null);
  const [failed, setFailed] = useState(false);

  const directoryEnabled = features.attendeeDirectory;
  const includeAttendeesOnly = attendeeAccess;
  // A signed-out visitor at an event with no public profiles has nothing to
  // query for — they get the sign-in state below, so skip the listener
  // rather than running a query whose result is known to be empty.
  const signedOutWithNothingToSee =
    status === 'signed-out' && !features.publicAttendeeProfiles;

  useEffect(() => {
    if (!directoryEnabled || signedOutWithNothingToSee) return undefined;
    setFailed(false);
    return subscribeDirectory(
      { includeAttendeesOnly },
      (docs) => {
        setProfiles(docs);
        setFailed(false);
      },
      () => setFailed(true),
    );
  }, [directoryEnabled, includeAttendeesOnly, signedOutWithNothingToSee]);

  const sorted = useMemo(
    () =>
      (profiles ?? [])
        .filter((p) => typeof p.displayName === 'string' && p.displayName.trim().length > 0)
        .slice()
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [profiles],
  );
  // null = no snapshot has arrived yet; [] = the directory really is empty.
  // Conflating them tells a visitor nobody signed up while the query is
  // still in flight.
  const loading = profiles === null && !failed;

  if (!directoryEnabled) {
    return (
      <EmptyState
        title="This event doesn’t have an attendee directory"
        description="Everything else about the event is on the home page."
        action={homeLink}
      />
    );
  }

  if (signedOutWithNothingToSee) {
    return (
      <EmptyState
        title="Sign in to see who’s attending"
        description="The attendee directory is open to registered attendees and speakers."
        action={
          <Link
            to="/signin"
            className="touch-target inline-flex items-center rounded-brand bg-accent px-md py-xs font-data text-caption font-semibold text-surface"
          >
            Go to sign in
          </Link>
        }
      />
    );
  }

  return (
    <div className="grid gap-xl lg:grid-cols-[2fr_1fr]">
      <article>
        <h1 className="font-heading text-h1 font-semibold text-text-primary">Attendees</h1>
        {status === 'ready' && !attendeeAccess ? (
          <p className="mt-xs max-w-prose text-body text-text-secondary">
            You can see attendees with public profiles. The full directory opens up once your
            registration is approved.
          </p>
        ) : null}

        {loading ? (
          <div className="mt-lg">
            <LoadingState label="Loading the attendee directory" />
          </div>
        ) : failed ? (
          <div className="mt-lg">
            <EmptyState
              title="The directory is unavailable right now"
              description="This is usually temporary. The page keeps trying in the background."
            />
          </div>
        ) : sorted.length === 0 ? (
          <div className="mt-lg">
            <EmptyState
              title="No attendee profiles yet"
              description="Profiles appear here as attendees complete them."
            />
          </div>
        ) : (
          // A ruled directory, not a card grid (design brief §2.1, §5.1): the
          // same device Speakers.jsx and Sponsors.jsx use — a hairline opens
          // each row, name and photo on the left in the heading face, role
          // and organization on the right in the data face.
          <ul className="mt-lg">
            {sorted.map((profile) => {
              const badges = features.badges ? visibleBadgeIds(profile.badges, badgesConfig) : [];
              const affiliation = [text(profile.jobTitle), text(profile.organization)]
                .filter(Boolean)
                .join(' · ');
              return (
                <li
                  key={profile.id}
                  className="border-t-hairline border-t-rule-hairline py-md sm:grid sm:grid-cols-[1fr,2fr] sm:gap-md"
                >
                  <div className="flex items-start gap-xs">
                    <ProfilePhoto
                      photoPath={profile.photoPath}
                      displayName={profile.displayName}
                    />
                    <div className="min-w-0">
                      <h2 className="font-heading text-h3 font-semibold text-text-primary">
                        <Link to={`/attendees/${profile.id}`} className="hover:underline">
                          {profile.displayName}
                        </Link>
                      </h2>
                      {text(profile.pronouns) ? (
                        <p className="mt-2xs font-data text-caption text-text-secondary">
                          {text(profile.pronouns)}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-xs sm:mt-0">
                    {affiliation ? (
                      <p className="font-data text-caption text-text-secondary">{affiliation}</p>
                    ) : null}
                    {profile.speakerId || badges.length > 0 ? (
                      <ul className="mt-xs flex flex-wrap gap-2xs">
                        {profile.speakerId ? (
                          <li>
                            <Tag>Speaker</Tag>
                          </li>
                        ) : null}
                        {badges.map((badgeId) => (
                          <li key={badgeId}>
                            <Tag>{badgeLabel(badgesConfig, badgeId)}</Tag>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </article>
      <ProfileSidebar />
    </div>
  );
}
