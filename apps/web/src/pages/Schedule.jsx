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
import SystemPage from '../components/SystemPage.jsx';
import SessionCard from '../components/SessionCard.jsx';
import SectionHead from '../components/editorial/SectionHead.jsx';
import { PlateNumber } from '../components/editorial/Plate.jsx';
import Marginalia from '../components/editorial/Marginalia.jsx';
import ScheduleGrid from '../components/ScheduleGrid.jsx';
import SchedulePrint from '../components/SchedulePrint.jsx';
import { resolveTracks, withCallingPoints } from '../lib/scheduleGrid.js';
import { eventIsArchived, isBackIssue } from '../lib/backIssue.js';
import { useMediaQuery, WIDE_VIEWPORT } from '../lib/viewport.js';
import { formatDayDate, zonedDateTime, zoneLabel } from '../lib/eventTime.js';
import { buildIcsCalendar, downloadIcs, icsFileName } from '../utils/calendar.js';

// Page actions in the editorial register: a ruled rectangle on the theme
// radius, never a pill (design brief §2.4).
const ACTION_CLASS =
  'touch-target inline-flex items-center rounded-brand border-hairline border-rule-hairline px-md py-2xs font-data text-caption font-medium text-text-primary hover:bg-brand-surface-alt';

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
  // Which of the two views is in the document at all (lib/viewport.js). The
  // list is the answer until the viewport is measured and found wide, so a
  // browser that cannot be asked gets the accessible baseline rather than a
  // grid it has no room for.
  const wide = useMediaQuery(WIDE_VIEWPORT);

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
            className="touch-target inline-flex items-center rounded-brand bg-accent px-md py-xs font-data text-caption font-semibold text-surface"
          >
            Go to the home page
          </Link>
        }
      />
    );
  }

  const activeDay = days.find((d) => d.id === activeDayId) ?? null;
  const activeSessions = activeDayId ? (sessionsByDay.get(activeDayId) ?? []) : [];
  // The day as top-level entries, each carrying its calling points. Both
  // views render from this, so a child session appears under its parent in
  // the grid and in the list, and never as a row of its own.
  const entries = withCallingPoints(activeSessions);
  // The top-level sessions in programme order. A transfer is a move between
  // two of THESE: a calling point is inside its parent, not a room change
  // after it.
  const entrySessions = entries.map((entry) => entry.session);
  // The event's lines, in the client's own order (config/event.tracks). No
  // lines means no second axis, so there is nothing for a grid to be.
  const columns = resolveTracks(eventConfig);
  const showGrid = wide && columns.length > 0 && entries.length > 0;
  // The back issue (brief §2.1): a day the event has moved past, or a whole
  // event the operator has archived. Nothing is hidden — the palette drops
  // to the archive tokens, the day head says so, and the controls that act
  // on a live event go away because there is nothing left to act on.
  const archived = eventIsArchived(eventConfig);
  const backIssue = activeDay ? isBackIssue(activeDay, eventConfig) : false;
  const hasAnySession = sessionsByDay.size > 0;
  const eventZoneLabel = activeDay
    ? zoneLabel(
        eventConfig.timezone,
        zonedDateTime(activeDay.date, '12:00', eventConfig.timezone) ?? undefined,
      )
    : null;

  return (
    <SystemPage pageId="schedule">
      <header className="flex flex-wrap items-baseline justify-between gap-md">
        <div>
          <h1 className="font-heading text-h1 font-semibold text-text-primary">Schedule</h1>
          {eventZoneLabel ? (
            <p className="mt-2xs font-data text-caption text-text-secondary">
              All times are shown in {eventZoneLabel}.
            </p>
          ) : null}
        </div>
        {/* Controls do not print: a button on paper is a lie (index.css,
            the print block). */}
        <div className="no-print flex flex-wrap items-center gap-xs">
          {features.sessionBookmarks && user && attendeeAccess ? (
            <Link to="/schedule/mine" className={ACTION_CLASS}>
              My schedule
            </Link>
          ) : null}
          {features.icsExport && !archived && visibleSessions.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                downloadIcs(icsFileName(eventConfig.shortName || eventConfig.name), buildIcsCalendar(eventConfig, visibleSessions));
              }}
              className={ACTION_CLASS}
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
          {/* The screen view and the printed programme are two views of the
              same day, and exactly one of them is ever in the layout — and
              in the accessibility tree — at a time. */}
          <div className="schedule-screen">
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

            <section
              key={activeDay.id}
              aria-labelledby={`day-${activeDay.id}`}
              className={backIssue ? 'back-issue mt-xl' : 'mt-xl'}
              {...(backIssue ? { 'data-back-issue': 'true' } : null)}
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
                  <>
                    {/* "PLATE III · SATURDAY 14 MARCH" (visual story, Field
                        Guide, moment 1). The number is the day's real
                        position in the programme, so it is sequence data and
                        never a decorative 01/02/03 (brief §2.4). It is set
                        only where the page is a plate book: the token, not a
                        theme test in here, decides that. */}
                    <PlateNumber position={days.indexOf(activeDay) + 1} />
                    {formatDayDate(activeDay, eventConfig.timezone) ? (
                      <time dateTime={activeDay.date}>
                        {formatDayDate(activeDay, eventConfig.timezone)}
                      </time>
                    ) : null}
                    {/* The "Back issue" folio the device asks for, beside the
                        day it labels — a folio never sits above a heading
                        (brief §2.4). */}
                    {backIssue ? (
                      <>
                        {formatDayDate(activeDay, eventConfig.timezone) ? ' · ' : null}
                        Back issue
                      </>
                    ) : null}
                  </>
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
              ) : showGrid ? (
                // The programme page: time down, lettered lines across (brief
                // §2.1). It scrolls inside its own box rather than pushing
                // the page sideways.
                <div className="mt-sm overflow-x-auto">
                  <ScheduleGrid
                    day={activeDay}
                    entries={entries}
                    columns={columns}
                    eventConfig={eventConfig}
                  />
                </div>
              ) : (
                // The time-ordered list. It is the other first-class view,
                // not a lesser one (visual story, Civic, moment 1): fixed
                // column order, tabular figures, every relationship stated.
                // No gap: every row opens with its own hairline, so the rules
                // are the separation a card border used to be.
                <ul className="mt-sm">
                  {entries.map((entry, index) => (
                    <SessionCard
                      key={entry.session.id}
                      session={entry.session}
                      eventConfig={eventConfig}
                      features={features}
                      bookmarked={bookmarkedIds.has(entry.session.id)}
                      backIssue={backIssue}
                      transferTo={transferTarget(entrySessions, index)}
                      callingPoints={entry.children}
                    />
                  ))}
                </ul>
              )}
            </section>
          </div>
          {/* The handout: every day, every session, every calling point,
              no controls (visual stories, part 2, "Print view"). */}
          <SchedulePrint
            days={days}
            sessionsByDay={sessionsByDay}
            columns={columns}
            eventConfig={eventConfig}
          />
        </>
      )}
    </SystemPage>
  );
}
