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
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
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
import SearchField from '../components/forms/SearchField.jsx';
import FilterGroup from '../components/forms/FilterGroup.jsx';
import SortControl from '../components/forms/SortControl.jsx';
import ScheduleGrid from '../components/ScheduleGrid.jsx';
import SchedulePrint from '../components/SchedulePrint.jsx';
import HorizontalScrollRegion from '../components/HorizontalScrollRegion.jsx';
import { resolveTracks } from '../lib/scheduleGrid.js';
import {
  buildSearchIndex,
  collectFormats,
  filterEntries,
  matchesFilters,
  matchesQuery,
  readScheduleView,
  sortEntries,
  writeScheduleView,
} from '../lib/scheduleView.js';
import { eventIsArchived, isBackIssue } from '../lib/backIssue.js';
import { useMediaQuery, WIDE_VIEWPORT } from '../lib/viewport.js';
import { formatDayDate, zonedDateTime, zoneLabel } from '../lib/eventTime.js';
import { buildIcsCalendar, downloadIcs, icsFileName } from '../utils/calendar.js';
import { primaryActionClass, quietActionClass } from '../components/controlClasses.js';

// One day of the programme. The active day is marked twice over — heavier
// weight plus a strong rule under the word — because color alone never
// signals state (§8.1). The press is the shared one: transform only, at
// --motion-slow, and the whole of it sits behind `motion-safe:`, so a reader
// who asked for less motion gets the control already in its end state rather
// than a shortened move (expansion record §2.2).
function dayClass(isActive) {
  return [
    'touch-target inline-flex items-center border-b-strong px-2xs py-xs font-data text-caption '
    + 'active:scale-[0.98] motion-safe:transition-transform motion-safe:duration-slow '
    + 'motion-safe:ease-motion',
    isActive
      ? 'border-b-rule-strong font-semibold text-text-primary'
      : 'border-b-transparent text-text-secondary hover:text-text-primary',
  ].join(' ');
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
  const { scheduleData, speakers, loading } = useContent();
  const { user } = useAuth();
  const { attendeeAccess } = useProfile();
  const { bookmarkedIds } = useMyBookmarks();
  // Which of the two views is in the document at all (lib/viewport.js). The
  // list is the answer until the viewport is measured and found wide, so a
  // browser that cannot be asked gets the accessible baseline rather than a
  // grid it has no room for.
  const wide = useMediaQuery(WIDE_VIEWPORT);

  // The whole view lives in the URL (issue #164): the search, the facet
  // filters, the day, and the sort all round trip through query parameters,
  // so a filtered view is a link a reader can hand to somebody else, and
  // the back button walks the changes back. The URL is untrusted input —
  // readScheduleView falls back to the default for every unknown value.
  const [searchParams, setSearchParams] = useSearchParams();

  // Days are runtime config — a live config/event write could deliver a
  // malformed entry; drop anything without a usable string id rather than
  // let day.id/day.label dereferences below throw and blank the page.
  const days = useMemo(
    () =>
      Array.isArray(eventConfig.days)
        ? eventConfig.days.filter((d) => d && typeof d.id === 'string')
        : [],
    [eventConfig.days],
  );

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

  // The resolved display name of every published speaker, once: the search
  // text a reader types has to meet the speaker's name, not the id the
  // session stores (lib/scheduleView.js).
  const speakerNamesById = useMemo(() => {
    const names = new Map();
    for (const speaker of Array.isArray(speakers) ? speakers : []) {
      if (speaker && typeof speaker.id === 'string' && typeof speaker.displayName === 'string') {
        names.set(speaker.id, speaker.displayName);
      }
    }
    return names;
  }, [speakers]);

  // The folded search text of every visible session, once per data change.
  const searchIndex = useMemo(
    () => buildSearchIndex(scheduleData, speakerNamesById, resolveTracks(eventConfig)),
    [scheduleData, speakerNamesById, eventConfig],
  );

  // One filter group per facet, and neither list is fixed in code: the
  // formats come from the session records (issue #163), the tracks from
  // config/event.tracks. Counts describe the whole programme, so a count is
  // true whichever day is open.
  const formatOptions = useMemo(() => collectFormats(visibleSessions), [visibleSessions]);
  const trackOptions = useMemo(
    () =>
      resolveTracks(eventConfig).map((column) => ({
        value: column.letter,
        label: `${column.letter} · ${column.name}`,
        count: visibleSessions.filter(
          (session) => String(session?.track ?? '').trim().toUpperCase() === column.letter,
        ).length,
      })),
    [eventConfig, visibleSessions],
  );

  // The view, read once per URL and facet-set change. Everything above the
  // feature branch is a hook or a pure read of runtime data.
  const knownView = useMemo(
    () => ({
      dayIds: new Set(days.map((day) => day.id)),
      formats: formatOptions.map((option) => option.value),
      tracks: trackOptions.map((option) => option.value),
    }),
    [days, formatOptions, trackOptions],
  );
  const view = useMemo(() => readScheduleView(searchParams, knownView), [searchParams, knownView]);
  // The sort control offers most saved only where bookmarking exists, so a
  // stale URL cannot select an order the page never offered.
  const sort = view.sort === 'saved' && features.sessionBookmarks ? 'saved' : 'time';
  const sortOptions = [
    { value: 'time', label: 'By time' },
    ...(features.sessionBookmarks ? [{ value: 'saved', label: 'Most saved' }] : []),
  ];
  const query = view.q;
  const formats = view.formats;
  const tracks = view.tracks;
  // The URL's day, or the first configured day. An id the event no longer
  // carries already fell back at read time.
  const activeDayId = view.day ?? days[0]?.id ?? null;

  /**
   * Patch the view in the URL. Discrete control changes (a day, a filter, a
   * sort) push a history entry, so the back button undoes them; typing in
   * the search field replaces, so it does not spend a history entry per
   * keystroke.
   */
  function updateView(patch, { replace = false } = {}) {
    setSearchParams(
      (prev) =>
        writeScheduleView(
          { ...readScheduleView(prev, knownView), ...patch },
          { firstDayId: days[0]?.id ?? null },
        ),
      { replace },
    );
  }

  // Every hook sits above this point: the branch below can end the
  // component before any of the work further down runs.
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
  // The day narrowed by the search and the facets (issues #162, #163), then
  // ordered by the chosen sort (#164). An empty query and empty facets keep
  // the whole day, so clearing restores it by construction. A calling point
  // a predicate matches keeps its parent's row, and a matched parent keeps
  // all of its calling points — lib/scheduleView.js owns those rules.
  const entries = sortEntries(
    filterEntries(activeSessions, (session) => {
      if (query.trim() && !matchesQuery(searchIndex.get(session.id) ?? '', query)) return false;
      return matchesFilters(session, { formats, tracks });
    }),
    sort,
    // The bookmark counts land with the counts row; until then most saved
    // degrades to programme order (sortEntries).
    null,
  );
  // What the count sentence says: every session still in the document,
  // calling points included — they are sessions a reader can pick too.
  const matchedCount = entries.reduce((count, entry) => count + 1 + entry.children.length, 0);
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
            <Link to="/schedule/mine" className={quietActionClass}>
              My schedule
            </Link>
          ) : null}
          {features.icsExport && !archived && visibleSessions.length > 0 ? (
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
          <LoadingState label="Loading the schedule…" />
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
                      onClick={() => updateView({ day: day.id })}
                      className={dayClass(isActive)}
                    >
                      {day.label}
                    </button>
                  );
                })}
              </div>
            ) : null}

          {/* The controls that narrow and order what the day shows. Controls
              do not print: a button on paper is a lie (index.css, the print
              block), and so is a search box. */}
          <div className="no-print mt-md flex flex-wrap items-start gap-lg">
            <div className="w-full max-w-prose lg:w-auto lg:flex-1">
              <SearchField
                label="Search this day"
                value={query}
                onChange={(next) => updateView({ q: next }, { replace: true })}
                status={
                  query.trim() ? `${matchedCount} sessions match “${query.trim()}”` : undefined
                }
                placeholder="Title, room, speaker…"
              />
            </div>
            {/* A group renders only when its facet has something to offer:
                a filter over nothing is a dead control. */}
            {formatOptions.length > 0 ? (
              <div className="flex-1">
                <FilterGroup
                  legend="Format"
                  options={formatOptions}
                  selected={formats}
                  onChange={(next) => updateView({ formats: next })}
                  clearLabel="Clear format filter"
                />
              </div>
            ) : null}
            {trackOptions.length > 0 ? (
              <div className="flex-1">
                <FilterGroup
                  legend="Track"
                  options={trackOptions}
                  selected={tracks}
                  onChange={(next) => updateView({ tracks: next })}
                  clearLabel="Clear track filter"
                />
              </div>
            ) : null}
            {sortOptions.length > 1 ? (
              <div className="flex-1">
                <SortControl
                  label="Sort sessions"
                  options={sortOptions}
                  value={sort}
                  onChange={(next) => updateView({ sort: next })}
                />
              </div>
            ) : null}
          </div>

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
              className={backIssue ? 'back-issue map-grid mt-xl' : 'map-grid mt-xl'}
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
              ) : entries.length === 0 ? (
                // An empty result states what was searched (issue #162), so
                // an empty page is never mistaken for an empty day.
                <p className="mt-md max-w-prose text-body text-text-secondary">
                  No sessions on {activeDay.label} match “{query.trim()}”. Clear the search to see
                  the whole day.
                </p>
              ) : showGrid ? (
                // The programme page: time down, lettered lines across (brief
                // §2.1). It scrolls inside its own box rather than pushing
                // the page sideways.
                <HorizontalScrollRegion
                  label={`${activeDay.label} schedule grid`}
                  className="mt-sm overflow-x-auto"
                >
                  <ScheduleGrid
                    day={activeDay}
                    entries={entries}
                    columns={columns}
                    eventConfig={eventConfig}
                  />
                </HorizontalScrollRegion>
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
                      callingPoints={entry.children}
                      // The session's real place in the day, counted from
                      // one: the numbered-agenda Schedule style prints it,
                      // and the lead-and-rest style sets the first row
                      // larger. It counts ENTRIES, so a calling point does
                      // not take a number of its own — it is a stop inside
                      // its parent, not a row in the programme.
                      position={index + 1}
                      lead={index === 0}
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
