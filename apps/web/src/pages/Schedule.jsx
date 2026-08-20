// Schedule page — read-only first slice of issue #16.
//
// Days come from config/event.days (arbitrary length, config-driven);
// sessions come from ContentProvider (published cmsSchedule overlaying the
// committed snapshot), grouped by dayId and sorted by start time. Times
// render on the EVENT's wall clock from config.timezone (lib/eventTime.js).
// Feature-gated by config/features.schedule. Bookmarks and ICS export are
// later slices (features.sessionBookmarks / features.icsExport).
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useContent } from '../contexts/ContentContext.jsx';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import EmptyState from '../components/EmptyState.jsx';
import LoadingState from '../components/LoadingState.jsx';
import {
  formatDayDate,
  formatSessionTimeRange,
  zonedDateTime,
  zoneLabel,
} from '../lib/eventTime.js';

// TODO(m3-speakers): resolve speakerIds to speaker names (and links to the
// speakers page) once the speaker directory tranche lands in M3. Kept as a
// hook called from SessionCard's top level so the card markup gains speaker
// rows without restructuring; useContent().speakers already carries the
// snapshot shape this will read from.
function useSessionSpeakerNames() {
  return null;
}

function TypeBadge({ type }) {
  if (typeof type !== 'string' || !type) return null;
  // Session types are CMS vocabulary — presented, never interpreted, except
  // the platform-level keynote emphasis token from config/theme (spec §7.2).
  const isKeynote = type === 'keynote';
  return (
    <span
      className={[
        'inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize text-brand-ink',
        isKeynote ? 'border-keynote/40 bg-keynote/15' : 'border-brand-ink/15 bg-brand-ink/5',
      ].join(' ')}
    >
      {type}
    </span>
  );
}

function SessionCard({ session, eventConfig }) {
  const speakerNames = useSessionSpeakerNames(session.speakerIds);
  const range = formatSessionTimeRange(eventConfig, session);

  return (
    <li>
      <article
        className={[
          'grid gap-2 rounded-brand border border-brand-ink/10 bg-brand-surface-alt p-4 sm:grid-cols-[9.5rem,1fr] sm:gap-4',
          session.type === 'keynote' ? 'border-s-4 border-s-keynote' : '',
        ].join(' ')}
      >
        <p className="text-sm text-brand-ink-muted">
          {range ? (
            <>
              <time dateTime={range.startIso}>{range.startLabel}</time>
              {range.endLabel ? (
                <>
                  –<time dateTime={range.endIso}>{range.endLabel}</time>
                </>
              ) : null}
              {range.zone ? <span className="ms-1">{range.zone}</span> : null}
            </>
          ) : (
            <span>Time to be announced</span>
          )}
        </p>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-brand-ink">{session.title}</h3>
            <TypeBadge type={session.type} />
          </div>
          {session.location ? (
            <p className="mt-1 text-sm text-brand-ink-muted">{session.location}</p>
          ) : null}
          {session.description ? (
            <p className="mt-2 max-w-prose text-brand-ink-muted" style={{ textWrap: 'pretty' }}>
              {session.description}
            </p>
          ) : null}
          {speakerNames ? (
            <p className="mt-2 text-sm text-brand-ink-muted">{speakerNames}</p>
          ) : null}
        </div>
      </article>
    </li>
  );
}

export default function Schedule() {
  const { eventConfig, features } = useEventConfig();
  const { scheduleData, loading } = useContent();

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
    for (const list of grouped.values()) {
      list.sort(
        (a, b) =>
          String(a.startTime).localeCompare(String(b.startTime)) ||
          (a.order ?? 0) - (b.order ?? 0) ||
          String(a.title).localeCompare(String(b.title)),
      );
    }
    return grouped;
  }, [scheduleData]);

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
      <header>
        <h1 className="font-heading text-3xl font-semibold text-brand-ink">Schedule</h1>
        {eventZoneLabel ? (
          <p className="mt-1 text-sm text-brand-ink-muted">
            All times are shown in {eventZoneLabel}.
          </p>
        ) : null}
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
                  <SessionCard key={session.id} session={session} eventConfig={eventConfig} />
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </article>
  );
}
