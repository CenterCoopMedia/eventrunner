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
import EmptyState from '../components/EmptyState.jsx';
import LoadingState from '../components/LoadingState.jsx';
import ProfileSidebar from '../components/ProfileSidebar.jsx';
import ProfilePhoto from '../components/media/ProfilePhoto.jsx';

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
    className="touch-target inline-flex items-center rounded-brand bg-brand-primary px-4 py-2 font-semibold text-brand-surface"
  >
    Go to the home page
  </Link>
);

export default function Attendees() {
  const { features } = useEventConfig();
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
            className="touch-target inline-flex items-center rounded-brand bg-brand-primary px-4 py-2 font-semibold text-brand-surface"
          >
            Go to sign in
          </Link>
        }
      />
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[2fr_1fr]">
      <article>
        <h1 className="font-heading text-3xl font-semibold text-brand-ink">Attendees</h1>
        {status === 'ready' && !attendeeAccess ? (
          <p className="mt-2 text-brand-ink-muted">
            You can see attendees with public profiles. The full directory opens up once your
            registration is approved.
          </p>
        ) : null}

        {loading ? (
          <LoadingState label="Loading the attendee directory" />
        ) : failed ? (
          <div className="mt-6">
            <EmptyState
              title="The directory is unavailable right now"
              description="This is usually temporary. The page keeps trying in the background."
            />
          </div>
        ) : sorted.length === 0 ? (
          <div className="mt-6">
            <EmptyState
              title="No attendee profiles yet"
              description="Profiles appear here as attendees complete them."
            />
          </div>
        ) : (
          <ul className="mt-6 grid gap-4 sm:grid-cols-2">
            {sorted.map((profile) => (
              <li
                key={profile.id}
                className="rounded-brand-lg border border-brand-ink/10 bg-brand-surface-alt p-5"
              >
                <div className="flex items-start gap-3">
                  <ProfilePhoto
                    photoPath={profile.photoPath}
                    displayName={profile.displayName}
                  />
                  <div className="min-w-0">
                    <h2 className="font-heading text-lg text-brand-ink">
                      <Link
                        to={`/attendees/${profile.id}`}
                        className="rounded-brand underline-offset-4 hover:underline"
                      >
                        {profile.displayName}
                      </Link>
                    </h2>
                    {text(profile.pronouns) ? (
                      <p className="text-sm text-brand-ink-muted">{text(profile.pronouns)}</p>
                    ) : null}
                    {text(profile.jobTitle) || text(profile.organization) ? (
                      <p className="mt-1 text-sm text-brand-ink-muted">
                        {[text(profile.jobTitle), text(profile.organization)]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    ) : null}
                    {profile.speakerId ? (
                      <p className="mt-2 text-sm font-semibold text-brand-primary-dark">Speaker</p>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </article>
      <ProfileSidebar />
    </div>
  );
}
