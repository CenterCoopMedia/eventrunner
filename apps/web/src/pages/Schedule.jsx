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
import SectionHead from '../components/editorial/SectionHead.jsx';
import { PlateNumber } from '../components/editorial/Plate.jsx';
import Marginalia from '../components/editorial/Marginalia.jsx';
import { formatDayDate, zonedDateTime, zoneLabel } from '../lib/eventTime.js';
import { buildIcsCalendar, downloadIcs, icsFileName } from '../utils/calendar.js';
import { primaryActionClass, quietActionClass } from '../components/controlClasses.js';

// One day of the programme. The active day is marked twice over — heavier
// weight plus a strong rule under the word — because color alone never
// signals state (§8.1). The press is functional motion: transform only,
// inside the 120–200ms band, and the global reduced-motion block in
// index.css takes it out entirely for a reader who asked for that.
function dayClass(isActive) {
  return [
    'touch-target inline-flex items-center border-b-strong px-2xs py-xs font-data text-caption transition-transform duration-fast ease-motion active:scale-[0.98]',
    isActive
      ? 'border-b-rule-strong font-semibold text-text-primary'
      : 'border-b-transparent text-text-secondary hover:text-text-primary',
  ].join(' ');
}

/**
 * The room a reader moves to, for the session at `index` of a sorted day
 * (design brief §4.6; visual story, Atlas, moment 2).
 *
 * A transfer is a real move: it exists only when this session sits in a
 * different room from the one before it, and only when both rooms are
 * stated. The first session of a day is an arrival, not a transfer, and two
 * sessions in the same room are not a move at all.
 *
 * Both are runtime CMS values, so a non-string room is treated as absent
 * rather than compared.
 *
 * @param {object[]} sessions the day's sessions, already sorted
 * @param {number} index
 * @returns {string|null}
 */
export function transferTarget(sessions, index) {
  const room = (session) =>
    typeof session?.location === 'string' && session.location.trim()
      ? session.location.trim()
      : null;
  if (index < 1) return null;
  const here = room(sessions[index]);
  const before = room(sessions[index - 1]);
  if (!here || !before || here === before) return null;
  return here;
}

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
          <Link to="/" className={primaryActionClass}>
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
      <header className="flex flex-wrap items-baseline justify-between gap-md">
        <div>
          <h1 className="font-heading text-h1 font-semibold text-text-primary">Schedule</h1>
          {eventZoneLabel ? (
            <p className="mt-2xs font-data text-caption text-text-secondary">
              All times are shown in {eventZoneLabel}.
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-xs">
          {features.sessionBookmarks && user && attendeeAccess ? (
            <Link to="/schedule/mine" className={quietActionClass}>
              My schedule
            </Link>
          ) : null}
          {features.icsExport && visibleSessions.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                downloadIcs(icsFileName(eventConfig.shortName || eventConfig.name), buildIcsCalendar(eventConfig, visibleSessions));
              }}
              className={quietActionClass}
            >
              Download schedule (.ics)
            </button>
          ) : null}
        </div>
      </header>

      {loading ? (
        <div className="mt-lg">
          <LoadingState label="Loading the schedule" />
        </div>
      ) : !hasAnySession || !activeDay ? (
        <div className="mt-lg">
          <EmptyState
            title="The schedule isn’t published yet"
            description="Sessions appear here as soon as they’re announced — check back closer to the event."
          />
        </div>
      ) : (
        <>
          {days.length > 1 ? (
            <div
              role="group"
              aria-label="Event days"
              className="mt-lg flex flex-wrap gap-x-md border-b-hairline border-b-rule-hairline"
            >
              {days.map((day) => {
                const isActive = day.id === activeDayId;
                return (
                  <button
                    key={day.id}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => setSelectedDayId(day.id)}
                    className={dayClass(isActive)}
                  >
                    {day.label}
                  </button>
                );
              })}
            </div>
          ) : null}

          {/* The sheet the programme is drawn on (brief §4.6): a faint
              coordinate grid, below hairline contrast and inert to the
              pointer. It lives HERE and not on the shell, because a
              coordinate grid is a device for reading a timetable (owner
              review, 2026-08-27). --map-grid-size is zero in every preset
              but Atlas, and a zero-size background paints nothing, so the
              sheet appears only where the story has one. */}
          <section
            key={activeDay.id}
            aria-labelledby={`day-${activeDay.id}`}
            className="map-grid mt-xl"
          >
            {/* The day head is a folio on a rule (brief §2.1): the standing
                head of the day, with the date sitting on the same rule. It is
                never stacked above the heading — it IS the heading. */}
            <SectionHead
              variant="folio"
              level={2}
              id={`day-${activeDay.id}`}
              title={activeDay.label}
              folio={
                formatDayDate(activeDay, eventConfig.timezone) ? (
                  <>
                    {/* "PLATE III · SATURDAY 14 MARCH" (visual story, Field
                        Guide, moment 1). The number is the day's real
                        position in the programme, so it is sequence data and
                        never a decorative 01/02/03 (brief §2.4). It is set
                        only where the page is a plate book: the token, not a
                        theme test in here, decides that. */}
                    <PlateNumber position={days.indexOf(activeDay) + 1} />
                    <time dateTime={activeDay.date}>
                      {formatDayDate(activeDay, eventConfig.timezone)}
                    </time>
                  </>
                ) : null
              }
            />
            {/* The pen mark under the day head (visual story, Zine, moment
                3): "a squiggle underline under a folio". It is one of the
                two drawn marks a page may carry, it never lands on a word
                inside a headline, and it is off until a client turns
                marginalia on. */}
            <Marginalia mark="squiggle" className="mt-3xs" />
            {activeSessions.length === 0 ? (
              <p className="mt-md max-w-prose text-body text-text-secondary">
                No sessions are announced for {activeDay.label} yet.
              </p>
            ) : (
              // No gap: every row opens with its own hairline, so the rules
              // are the separation a card border used to be.
              <ul className="mt-sm">
                {activeSessions.map((session, index) => (
                  <SessionCard
                    key={session.id}
                    session={session}
                    eventConfig={eventConfig}
                    features={features}
                    bookmarked={bookmarkedIds.has(session.id)}
                    transferTo={transferTarget(activeSessions, index)}
                    // The session's real place in the day, counted from one:
                    // the numbered-agenda Schedule style prints it, and the
                    // lead-and-rest style sets the first row larger.
                    position={index + 1}
                    lead={index === 0}
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
