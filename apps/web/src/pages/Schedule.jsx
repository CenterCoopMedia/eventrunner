// Schedule page (issue #16).
//
// Days come from config/event.days (arbitrary length, config-driven);
// sessions come from ContentProvider (published cmsSchedule overlaying the
// committed snapshot), grouped by dayId and sorted by start time. Times
// render on the EVENT's wall clock from config.timezone (lib/eventTime.js).
// Feature-gated by config/features.schedule. Bookmarks (features.
// sessionBookmarks) and ICS/calendar-link export (features.icsExport) are
// wired through SessionCard, which also carries the per-session detail
// link (/schedule/:sessionId, SessionDetail.jsx).
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useContent } from '../contexts/ContentContext.jsx';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import { useProfile } from '../contexts/ProfileContext.jsx';
import { useMyBookmarks } from '../hooks/useMyBookmarks.js';
import EmptyState from '../components/EmptyState.jsx';
import LoadingState from '../components/LoadingState.jsx';
import SessionCard from '../components/SessionCard.jsx';
import { formatDayDate, zonedDateTime, zoneLabel } from '../lib/eventTime.js';
import { buildIcsCalendar, downloadIcs, icsFileName } from '../utils/calendar.js';

/** Sort sessions the same way everywhere they're grouped by day (Schedule
 * and MySchedule both use this). Start time first, then explicit `order`,
 * then title as a stable tiebreaker. */
export function sortSessions(sessions) {
  return [...sessions].sort(
    (a, b) =>
      String(a.startTime).localeCompare(String(b.startTime)) ||
      (a.order ?? 0) - (b.order ?? 0) ||
      String(a.title).localeCompare(String(b.title)),
  );
}

export default function Schedule() {
  const { eventConfig, features } = useEventConfig();
  const { scheduleData, loading } = useContent();
  const { user } = useAuth();
  const { attendeeAccess } = useProfile();
  const { bookmarkedIds } = useMyBookmarks();

  // Days are runtime config — a live config/event write could deliver a
  // malformed entry; drop anything without a usable string id rather than
  // let day.id/day.label dereferences below throw and blank the page.
  const days = Array.isArray(eventConfig.days)
    ? eventConfig.days.filter((d) => d && typeof d.id === 'string')
    : [];
  const [selectedDayId, setSelectedDayId] = useState(null);
  // Days are runtime config — if the selected id disappears, fall back to
  // the first configured day rather than an empty view.
  const activeDayId = days.some((d) => d.id === selectedDayId)
    ? selectedDayId
    : (days[0]?.id ?? null);

  const sessionsByDay = useMemo(() => {
    const grouped = new Map();
    for (const session of scheduleData) {
      if (!session.visible) continue;
      const list = grouped.get(session.dayId) ?? [];
      list.push(session);
      grouped.set(session.dayId, list);
    }
    for (const [dayId, list] of grouped) {
      grouped.set(dayId, sortSessions(list));
    }
    return grouped;
  }, [scheduleData]);

  const visibleSessions = useMemo(
    () => scheduleData.filter((s) => s.visible),
    [scheduleData],
  );

  if (!features.schedule) {
    return (
      <EmptyState
        title="This event doesn’t have a public schedule"
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

  const activeDay = days.find((d) => d.id === activeDayId) ?? null;
  const activeSessions = activeDayId ? (sessionsByDay.get(activeDayId) ?? []) : [];
  const hasAnySession = sessionsByDay.size > 0;
  const eventZoneLabel = activeDay
    ? zoneLabel(
        eventConfig.timezone,
        zonedDateTime(activeDay.date, '12:00', eventConfig.timezone) ?? undefined,
      )
    : null;

  return (
    <article>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-semibold text-brand-ink">Schedule</h1>
          {eventZoneLabel ? (
            <p className="mt-1 text-sm text-brand-ink-muted">
              All times are shown in {eventZoneLabel}.
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {features.sessionBookmarks && user && attendeeAccess ? (
            <Link
              to="/schedule/mine"
              className="touch-target inline-flex items-center rounded-brand border border-brand-ink/15 px-4 py-2 text-sm font-semibold text-brand-ink hover:bg-brand-surface-alt"
            >
              My schedule
            </Link>
          ) : null}
          {features.icsExport && visibleSessions.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                downloadIcs(icsFileName(eventConfig.shortName || eventConfig.name), buildIcsCalendar(eventConfig, visibleSessions));
              }}
              className="touch-target inline-flex items-center rounded-brand border border-brand-ink/15 px-4 py-2 text-sm font-semibold text-brand-ink hover:bg-brand-surface-alt"
            >
              Download schedule (.ics)
            </button>
          ) : null}
        </div>
      </header>

      {loading ? (
        <div className="mt-6">
          <LoadingState label="Loading the schedule" />
        </div>
      ) : !hasAnySession || !activeDay ? (
        <div className="mt-6">
          <EmptyState
            title="The schedule isn’t published yet"
            description="Sessions appear here as soon as they’re announced — check back closer to the event."
          />
        </div>
      ) : (
        <>
          {days.length > 1 ? (
            <div role="group" aria-label="Event days" className="mt-6 flex flex-wrap gap-2">
              {days.map((day) => {
                const isActive = day.id === activeDayId;
                return (
                  <button
                    key={day.id}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => setSelectedDayId(day.id)}
                    className={[
                      'touch-target inline-flex items-center rounded-brand border px-4 py-2 text-sm transition-transform duration-200 ease-out active:scale-[0.98]',
                      isActive
                        ? 'border-brand-primary bg-brand-primary/10 font-semibold text-brand-primary-dark'
                        : 'border-brand-ink/15 text-brand-ink hover:bg-brand-surface-alt',
                    ].join(' ')}
                  >
                    {day.label}
                  </button>
                );
              })}
            </div>
          ) : null}

          <section key={activeDay.id} aria-labelledby={`day-${activeDay.id}`} className="mt-8">
            <h2 id={`day-${activeDay.id}`} className="font-heading text-xl text-brand-ink">
              {activeDay.label}
              {formatDayDate(activeDay, eventConfig.timezone) ? (
                <>
                  {' · '}
                  <time dateTime={activeDay.date} className="font-normal text-brand-ink-muted">
                    {formatDayDate(activeDay, eventConfig.timezone)}
                  </time>
                </>
              ) : null}
            </h2>
            {activeSessions.length === 0 ? (
              <p className="mt-4 max-w-prose text-brand-ink-muted">
                No sessions are announced for {activeDay.label} yet.
              </p>
            ) : (
              <ul className="mt-4 grid gap-3">
                {activeSessions.map((session) => (
                  <SessionCard
                    key={session.id}
                    session={session}
                    eventConfig={eventConfig}
                    features={features}
                    bookmarked={bookmarkedIds.has(session.id)}
                  />
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </article>
  );
}
