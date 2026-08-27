// MySchedule — the personal ("my schedule") view at /schedule/mine (issue
// #16, spec §9 personal schedule row). Filters the same published cmsSchedule
// set Schedule.jsx renders down to the signed-in user's bookmarks, grouped
// and sorted the same way. Requires config/features.{schedule,
// sessionBookmarks} AND a signed-in user — bookmarking itself is further
// gated to approved attendees (BookmarkPill in SessionCard.jsx), but a
// signed-out visitor sees a sign-in prompt here rather than an empty list
// that looks like "you have no bookmarks".
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useContent } from '../contexts/ContentContext.jsx';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import { useMyBookmarks } from '../hooks/useMyBookmarks.js';
import EmptyState from '../components/EmptyState.jsx';
import LoadingState from '../components/LoadingState.jsx';
import SessionCard from '../components/SessionCard.jsx';
import { formatDayDate } from '../lib/eventTime.js';
import { sortSessions } from './Schedule.jsx';
import { buildIcsCalendar, downloadIcs, icsFileName } from '../utils/calendar.js';

export default function MySchedule() {
  const { eventConfig, features } = useEventConfig();
  const { scheduleData, loading } = useContent();
  const { user, loading: authLoading } = useAuth();
  const { bookmarkedIds, loading: bookmarksLoading } = useMyBookmarks();

  const days = useMemo(
    () =>
      Array.isArray(eventConfig.days)
        ? eventConfig.days.filter((d) => d && typeof d.id === 'string')
        : [],
    [eventConfig.days],
  );
  const dayIds = useMemo(() => new Set(days.map((d) => d.id)), [days]);

  const myByDay = useMemo(() => {
    const grouped = new Map();
    for (const session of scheduleData) {
      if (!session.visible || !bookmarkedIds.has(session.id)) continue;
      // A bookmarked session whose configured day was since removed from
      // config/event.days (an admin edit, independent of the session's own
      // dayId) is orphaned: grouping it under a day id nothing in `days`
      // matches would make it count toward `mySessions.length` — skipping
      // the "no bookmarks" empty state — while never being rendered under
      // any <section>, since the render below iterates `days`, not this
      // map's keys. That combination is a blank page under the header, not
      // a soft failure. Drop it here instead, so "has bookmarks" and
      // "renders bookmarks" stay the same fact.
      if (!dayIds.has(session.dayId)) continue;
      const list = grouped.get(session.dayId) ?? [];
      list.push(session);
      grouped.set(session.dayId, list);
    }
    for (const [dayId, list] of grouped) grouped.set(dayId, sortSessions(list));
    return grouped;
  }, [scheduleData, bookmarkedIds, dayIds]);

  // Flattened for bulk ICS export — day order doesn't matter there, so this
  // reads straight off myByDay's values rather than depending on `days`
  // (recomputed each render; keeping it out of this memo's deps avoids that
  // churn without needing its own memo).
  const mySessions = useMemo(() => Array.from(myByDay.values()).flat(), [myByDay]);

  if (!features.schedule || !features.sessionBookmarks) {
    return (
      <EmptyState
        title="This event doesn’t have a personal schedule"
        description="Everything else about the event is on the schedule page."
        action={
          <Link
            to="/schedule"
            className="touch-target inline-flex items-center rounded-brand bg-brand-primary px-4 py-2 font-semibold text-brand-surface"
          >
            Go to the schedule
          </Link>
        }
      />
    );
  }

  if (authLoading) {
    return (
      <div className="mt-6">
        <LoadingState label="Loading your schedule" />
      </div>
    );
  }

  if (!user) {
    return (
      <EmptyState
        title="Sign in to see your schedule"
        description="Bookmark sessions from the schedule page and they’ll show up here."
        action={
          <Link
            to="/signin"
            className="touch-target inline-flex items-center rounded-brand bg-brand-primary px-4 py-2 font-semibold text-brand-surface"
          >
            Sign in
          </Link>
        }
      />
    );
  }

  return (
    <article>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-semibold text-brand-ink">My schedule</h1>
          <p className="mt-1 text-sm text-brand-ink-muted">
            Sessions you’ve bookmarked, across every day.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/schedule"
            className="touch-target inline-flex items-center rounded-brand border border-brand-ink/15 px-4 py-2 text-sm font-semibold text-brand-ink hover:bg-brand-surface-alt"
          >
            Full schedule
          </Link>
          {features.icsExport && mySessions.length > 0 ? (
            <button
              type="button"
              onClick={() => downloadIcs(icsFileName('my-schedule'), buildIcsCalendar(eventConfig, mySessions))}
              className="touch-target inline-flex items-center rounded-brand border border-brand-ink/15 px-4 py-2 text-sm font-semibold text-brand-ink hover:bg-brand-surface-alt"
            >
              Download my schedule (.ics)
            </button>
          ) : null}
        </div>
      </header>

      {loading || bookmarksLoading ? (
        <div className="mt-6">
          <LoadingState label="Loading your schedule" />
        </div>
      ) : mySessions.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="No bookmarked sessions yet"
            description="Browse the schedule and bookmark the sessions you don’t want to miss."
            action={
              <Link
                to="/schedule"
                className="touch-target inline-flex items-center rounded-brand bg-brand-primary px-4 py-2 font-semibold text-brand-surface"
              >
                Browse the schedule
              </Link>
            }
          />
        </div>
      ) : (
        days
          .filter((day) => (myByDay.get(day.id) ?? []).length > 0)
          .map((day) => (
            <section key={day.id} aria-labelledby={`my-day-${day.id}`} className="mt-8">
              <h2 id={`my-day-${day.id}`} className="font-heading text-xl text-brand-ink">
                {day.label}
                {formatDayDate(day, eventConfig.timezone) ? (
                  <>
                    {' · '}
                    <time dateTime={day.date} className="font-normal text-brand-ink-muted">
                      {formatDayDate(day, eventConfig.timezone)}
                    </time>
                  </>
                ) : null}
              </h2>
              {/* No gap between rows: each SessionCard opens with its own
                  hairline, so the rules ARE the separation (brief §2.1). */}
              <ul className="mt-sm">
                {(myByDay.get(day.id) ?? []).map((session) => (
                  <SessionCard
                    key={session.id}
                    session={session}
                    eventConfig={eventConfig}
                    features={features}
                    bookmarked
                  />
                ))}
              </ul>
            </section>
          ))
      )}
    </article>
  );
}
