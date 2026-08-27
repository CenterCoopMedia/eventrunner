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
//
// AN INDEX, NOT A DIRECTORY OF PROFILES (design brief §5.1; this review).
//
// The other directories are read; this one is SEARCHED. A reader here has a
// name in mind — their own, or the person they met at lunch — and they are
// scanning hundreds of entries for it. Every affordance follows from that:
//
//   • one compact line per person, so more of the list is on screen at once
//     and the eye can run down a single column of names;
//   • LETTER GROUPS, because that is how a person looks a name up in a long
//     alphabetical list, and without them the scroll bar is the only
//     navigation;
//   • the letter head STICKS while its group is on screen, so the reader
//     always knows which letter they are in.
//
// The affiliation and the badges stay — they are how you tell two people
// with the same name apart — but they sit on the same line, in the data
// face, rather than claiming a column of their own. Nothing is boxed, and
// the letter heads are the same folio-on-a-rule standing head the schedule
// gives a day.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import { useProfile } from '../contexts/ProfileContext.jsx';
import { subscribeDirectory } from '../lib/profileSource.js';
import { badgeLabel, visibleBadgeIds } from '../lib/badgeDisplay.js';
import EmptyState from '../components/EmptyState.jsx';
import LoadingState from '../components/LoadingState.jsx';
import ProfileSidebar from '../components/ProfileSidebar.jsx';
import SystemPage from '../components/SystemPage.jsx';
import ProfilePhoto from '../components/media/ProfilePhoto.jsx';
import SectionHead from '../components/editorial/SectionHead.jsx';
import Tag from '../components/editorial/Tag.jsx';
import { primaryActionClass } from '../components/controlClasses.js';

/**
 * Render only strings. The rules type-check these fields and the projection
 * coerces them, but a directory that hands React a map crashes for every
 * visitor at once — the cheapest place to be sure is the render itself.
 */
function text(value) {
  return typeof value === 'string' ? value : '';
}

/**
 * The letter a name files under, or `#`.
 *
 * `#` is a real group and not a failure: a name beginning with a digit, a
 * symbol, or a script this alphabet does not cover still has to appear
 * somewhere a reader can find it, and dropping it into "A" would file it
 * under a letter it does not start with. The comparison is the same
 * `localeCompare` the sort uses, so the groups follow the order the list is
 * already in rather than a second, disagreeing rule.
 *
 * @param {string} displayName
 * @returns {string}
 */
export function indexLetter(displayName) {
  const first = (displayName ?? '').trim().slice(0, 1).toLocaleUpperCase();
  return /\p{Letter}/u.test(first) ? first : '#';
}

/**
 * The sorted profiles cut into letter groups, in the list's own order.
 *
 * Takes an ALREADY SORTED list and never re-sorts it: one ordering rule for
 * the page, so a group can never contain a name the sort would have put
 * somewhere else.
 *
 * @param {Array<object>} sorted
 * @returns {Array<{ letter: string, members: object[] }>}
 */
export function groupByLetter(sorted) {
  const groups = [];
  for (const profile of sorted) {
    const letter = indexLetter(profile.displayName);
    const last = groups[groups.length - 1];
    if (last && last.letter === letter) last.members.push(profile);
    else groups.push({ letter, members: [profile] });
  }
  return groups;
}

const homeLink = (
  <Link to="/" className={primaryActionClass}>
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
          <Link to="/signin" className={primaryActionClass}>
            Go to sign in
          </Link>
        }
      />
    );
  }

  return (
    <div className="grid gap-xl lg:grid-cols-[2fr_1fr]">
      <SystemPage pageId="attendees">
        <h1 className="font-heading text-h1 font-semibold text-text-primary">Attendees</h1>
        {status === 'ready' && !attendeeAccess ? (
          <p className="mt-xs max-w-prose text-body text-text-secondary">
            You can see attendees with public profiles. The full directory opens up once your
            registration is approved.
          </p>
        ) : null}

        {loading ? (
          <div className="mt-lg">
            <LoadingState label="Loading the attendee directory…" />
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
          // The index: letter groups, compact entries, nothing boxed.
          <div className="attendee-index mt-lg">
            {groupByLetter(sorted).map((group) => (
              <section
                key={group.letter}
                aria-labelledby={`attendee-letter-${group.letter}`}
                className="mt-lg first:mt-0"
              >
                {/* The letter as a standing head, sticking while its group
                    is on screen. `#` files the names this alphabet does not
                    cover, and it says so rather than pretending. */}
                <SectionHead
                  className="attendee-index__letter"
                  variant="folio"
                  level={2}
                  id={`attendee-letter-${group.letter}`}
                  title={group.letter}
                  rule="hairline"
                  folio={group.members.length === 1 ? '1 person' : `${group.members.length} people`}
                />
                <ul>
                  {group.members.map((profile) => {
                    const badges = features.badges
                      ? visibleBadgeIds(profile.badges, badgesConfig)
                      : [];
                    const affiliation = [text(profile.jobTitle), text(profile.organization)]
                      .filter(Boolean)
                      .join(' · ');
                    return (
                      <li
                        key={profile.id}
                        className="attendee-index__entry flex flex-wrap items-baseline gap-x-sm gap-y-3xs"
                      >
                        {/* The index's own size: one line per person, so
                            a card-sized frame would set the row height and
                            undo the compactness this page is for. */}
                        <ProfilePhoto
                          size="sm"
                          photoPath={profile.photoPath}
                          displayName={profile.displayName}
                          className="self-center"
                        />
                        <h3 className="font-heading text-body font-semibold text-text-primary">
                          <Link to={`/attendees/${profile.id}`} className="hover:underline">
                            {profile.displayName}
                          </Link>
                        </h3>
                        {text(profile.pronouns) ? (
                          <span className="font-data text-caption text-text-secondary">
                            {text(profile.pronouns)}
                          </span>
                        ) : null}
                        {/* How you tell two people with the same name
                            apart — so it stays, on the same line, in the
                            data face rather than in a column of its own. */}
                        {affiliation ? (
                          <span className="min-w-0 font-data text-caption text-text-secondary">
                            {affiliation}
                          </span>
                        ) : null}
                        {profile.speakerId || badges.length > 0 ? (
                          <ul className="flex flex-wrap gap-2xs">
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
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </SystemPage>
      <ProfileSidebar />
    </div>
  );
}
