// The public shared schedule page at /schedule/user/:uid (issue #173).
//
// IT READS THE PROJECTION AND NOTHING ELSE. The schedule is authorized by
// schedule_shares/{uid}'s own scheduleVisibility — never by the profile's
// visibility, and never from users_public, because a public profile says
// nothing about whether the person ever consented to share their sessions.
// A viewer permitted by the projection's own field gets the sessions,
// rendered as the same ruled rows the schedule draws. Anyone else gets the
// reason, stated as the privacy fact it is.
//
// NOTHING AT ALL FOR THE UNCONSENTED. A uid with no projection document —
// an owner who never consented, a mistyped link, an account that does not
// exist — renders no schedule and no reason: an empty page cannot confirm
// that the account exists, and an answer that reads as privacy for the
// denied case would read as a fact about the owner for this one. The
// listener's refusal (the rules deny a read the projection withholds)
// lands on the same denial path as a private schedule: the reason, never
// the sessions.
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useContent } from '../contexts/ContentContext.jsx';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import { useProfile } from '../contexts/ProfileContext.jsx';
import { useMyBookmarks } from '../hooks/useMyBookmarks.js';
import { subscribeScheduleShare } from '../lib/scheduleShareSource.js';
import EmptyState from '../components/EmptyState.jsx';
import LoadingState from '../components/LoadingState.jsx';
import SessionCard from '../components/SessionCard.jsx';
import SectionHead from '../components/editorial/SectionHead.jsx';
import { formatDayDate } from '../lib/eventTime.js';
import { sortSessions } from './Schedule.jsx';
import { primaryActionClass } from '../components/controlClasses.js';

export default function SharedSchedule() {
  const { uid } = useParams();
  const { user } = useAuth();
  const { eventConfig, features } = useEventConfig();
  const { scheduleData, loading } = useContent();
  const { attendeeAccess } = useProfile();
  const { bookmarkedIds } = useMyBookmarks();
  // undefined = still loading; null = no projection document at all.
  const [share, setShare] = useState(undefined);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    setShare(undefined);
    setDenied(false);
    if (!uid) return undefined;
    return subscribeScheduleShare(
      uid,
      (next) => {
        setShare(next);
        setDenied(false);
      },
      () => {
        // The rules refused this viewer: the same answer privacy gives.
        setDenied(true);
      },
    );
  }, [uid]);

  const days = useMemo(
    () =>
      Array.isArray(eventConfig.days)
        ? eventConfig.days.filter((day) => day && typeof day.id === 'string')
        : [],
    [eventConfig.days],
  );

  const byDay = useMemo(() => {
    if (!share || !Array.isArray(share.sessionIds) || share.sessionIds.length === 0) {
      return new Map();
    }
    const wanted = new Set(share.sessionIds);
    const grouped = new Map();
    for (const session of scheduleData) {
      if (!session.visible || !wanted.has(session.id)) continue;
      const list = grouped.get(session.dayId) ?? [];
      list.push(session);
      grouped.set(session.dayId, list);
    }
    for (const [dayId, list] of grouped) grouped.set(dayId, sortSessions(list));
    return grouped;
  }, [share, scheduleData]);

  if (!features.schedule) {
    return (
      <EmptyState
        title="This event doesn’t have a public schedule"
        description="Everything else about the event is on the home page."
        action={
          <Link to="/" className={primaryActionClass}>
            Go to the home page
          </Link>
        }
      />
    );
  }

  if (share === undefined && !denied) {
    return (
      <div className="mt-lg">
        <LoadingState label="Loading the shared schedule…" />
      </div>
    );
  }

  // No projection document: an owner who never consented, a mistyped link,
  // or an account that does not exist — all render nothing at all, so the
  // page cannot confirm that the account exists.
  if (share === null) {
    return null;
  }

  // A refusal from the rules is privacy's own answer, whatever the
  // document would have said.
  if (denied || share === undefined) {
    return (
      <EmptyState
        title="This schedule is private"
        description="The person who shared this link has kept their schedule private."
      />
    );
  }

  const visibility = typeof share.scheduleVisibility === 'string' ? share.scheduleVisibility : 'private';
  const permitted =
    !denied &&
    (visibility === 'public' ||
      (visibility === 'attendees_only' && Boolean(user) && attendeeAccess));

  if (!permitted) {
    return (
      <EmptyState
        title={visibility === 'attendees_only' ? 'This schedule is shared with attendees' : 'This schedule is private'}
        description={
          visibility === 'attendees_only'
            ? user
              ? 'Your registration does not have attendee access, so this schedule is not shared with you.'
              : 'Sign in with your attendee account to see it.'
            : 'The person who shared this link has kept their schedule private.'
        }
        action={
          visibility === 'attendees_only' && !user ? (
            <Link to="/signin" className={primaryActionClass}>
              Sign in
            </Link>
          ) : null
        }
      />
    );
  }

  const ownerName = typeof share.displayName === 'string' && share.displayName ? share.displayName : 'This attendee';
  const sharedDays = days.filter((day) => (byDay.get(day.id) ?? []).length > 0);

  return (
    <article>
      <header>
        <h1 className="font-heading text-h1 font-semibold text-text-primary">
          {ownerName === 'This attendee' ? ownerName : `${ownerName}’s schedule`}
        </h1>
        <p className="mt-2xs font-data text-caption text-text-secondary">
          The sessions this attendee saved, shared by them.
        </p>
      </header>

      {loading ? (
        <div className="mt-lg">
          <LoadingState label="Loading the shared schedule…" />
        </div>
      ) : sharedDays.length === 0 ? (
        <div className="mt-lg">
          <EmptyState
            title="No saved sessions to show"
            description="This attendee hasn’t saved any published sessions yet."
          />
        </div>
      ) : (
        sharedDays.map((day) => (
          <section key={day.id} aria-labelledby={`shared-day-${day.id}`} className="mt-xl">
            <SectionHead
              variant="folio"
              level={2}
              id={`shared-day-${day.id}`}
              title={day.label}
              folio={
                formatDayDate(day, eventConfig.timezone) ? (
                  <time dateTime={day.date}>{formatDayDate(day, eventConfig.timezone)}</time>
                ) : null
              }
            />
            {/* The same rows the schedule draws (issue #173): one session
                card per saved session, with the viewer's own bookmark
                state, and no gap because every row carries its rule. */}
            <ul className="mt-sm">
              {(byDay.get(day.id) ?? []).map((session) => (
                <SessionCard
                  key={session.id}
                  session={session}
                  eventConfig={eventConfig}
                  features={features}
                  bookmarked={bookmarkedIds.has(session.id)}
                />
              ))}
            </ul>
          </section>
        ))
      )}
    </article>
  );
}
