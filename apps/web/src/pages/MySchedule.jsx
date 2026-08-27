// MySchedule — the personal ("my schedule") view at /schedule/mine (issue
// #16, spec §9 personal schedule row). Filters the same published cmsSchedule
// set Schedule.jsx renders down to the signed-in user's bookmarks, grouped
// and sorted the same way. Requires config/features.{schedule,
// sessionBookmarks} AND a signed-in user — bookmarking itself is further
// gated to approved attendees (BookmarkPill in SessionCard.jsx), but a
// signed-out visitor sees a sign-in prompt here rather than an empty list
// that looks like "you have no bookmarks".
//
// Editorial base restyle (design brief §2.1, §5.1): the day head is the same
// folio-on-a-rule SectionHead device Schedule.jsx uses, and the page actions
// are ruled rectangles rather than filled pill buttons.
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useContent } from '../contexts/ContentContext.jsx';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import { useMyBookmarks } from '../hooks/useMyBookmarks.js';
import EmptyState from '../components/EmptyState.jsx';
import LoadingState from '../components/LoadingState.jsx';
import SessionCard from '../components/SessionCard.jsx';
import SectionHead from '../components/editorial/SectionHead.jsx';
import { formatDayDate } from '../lib/eventTime.js';
import { sortSessions } from './Schedule.jsx';
import { buildIcsCalendar, downloadIcs, icsFileName } from '../utils/calendar.js';

// Page actions in the editorial register: a ruled rectangle on the theme
// radius, never a filled pill (design brief §2.4) — the same class
// Schedule.jsx's own page actions use.
const ACTION_CLASS =
  'touch-target inline-flex items-center rounded-brand border-hairline border-rule-hairline px-md py-2xs font-data text-caption font-medium text-text-primary hover:bg-brand-surface-alt';

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
          <Link to="/schedule" className="touch-target inline-flex items-center rounded-brand bg-accent px-md py-xs font-data text-caption font-semibold text-surface">
            Go to the schedule
          </Link>
        }
      />
    );
  }

  if (authLoading) {
    return (
      <div className="mt-lg">
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
          <Link to="/signin" className="touch-target inline-flex items-center rounded-brand bg-accent px-md py-xs font-data text-caption font-semibold text-surface">
            Sign in
          </Link>
        }
      />
    );
  }

  return (
    <article>
      <header className="flex flex-wrap items-baseline justify-between gap-md">
        <div>
          <h1 className="font-heading text-h1 font-semibold text-text-primary">My schedule</h1>
          <p className="mt-2xs font-data text-caption text-text-secondary">
            Sessions you’ve bookmarked, across every day.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-xs">
          <Link to="/schedule" className={ACTION_CLASS}>
            Full schedule
          </Link>
          {features.icsExport && mySessions.length > 0 ? (
            <button
              type="button"
              onClick={() => downloadIcs(icsFileName('my-schedule'), buildIcsCalendar(eventConfig, mySessions))}
              className={ACTION_CLASS}
            >
              Download my schedule (.ics)
            </button>
          ) : null}
        </div>
      </header>

      {loading || bookmarksLoading ? (
        <div className="mt-lg">
          <LoadingState label="Loading your schedule" />
        </div>
      ) : mySessions.length === 0 ? (
        <div className="mt-lg">
          <EmptyState
            title="No bookmarked sessions yet"
            description="Browse the schedule and bookmark the sessions you don’t want to miss."
            action={
              <Link to="/schedule" className="touch-target inline-flex items-center rounded-brand bg-accent px-md py-xs font-data text-caption font-semibold text-surface">
                Browse the schedule
              </Link>
            }
          />
        </div>
      ) : (
        days
          .filter((day) => (myByDay.get(day.id) ?? []).length > 0)
          .map((day) => (
            // The Atlas sheet, on the one surface that holds a programme
            // (owner review, 2026-08-27). See Schedule.jsx for the rule.
            <section key={day.id} aria-labelledby={`my-day-${day.id}`} className="map-grid mt-xl">
              {/* The same folio-on-a-rule day head Schedule.jsx uses (brief
                  §2.1): the standing head of the day, with the date sitting
                  on the same rule rather than stacked above it. */}
              <SectionHead
                variant="folio"
                level={2}
                id={`my-day-${day.id}`}
                title={day.label}
                folio={
                  formatDayDate(day, eventConfig.timezone) ? (
                    <time dateTime={day.date}>{formatDayDate(day, eventConfig.timezone)}</time>
                  ) : null
                }
              />
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
