// The dashboard's personal schedule card (issue #169).
//
// A SHORT LIST, NOT THE WHOLE ITINERARY. The reader is checking what is
// coming up, not planning their day — the full personal schedule page owns
// that, and the card's one link hands them to it. Five entries is short
// enough to scan and long enough to answer "what's next" on the first
// screen of the event.
//
// No copy lives in this component: the session titles and times are the
// event's own data, the card names itself, and an event with the
// bookmarking feature off draws nothing at all — there is nothing to list.
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useContent } from '../../contexts/ContentContext.jsx';
import { useEventConfig } from '../../contexts/EventConfigContext.jsx';
import { useMyBookmarks } from '../../hooks/useMyBookmarks.js';
import { formatSessionTimeRange } from '../../lib/eventTime.js';

const SHOWN = 5;

const cardClass =
  'rounded-brand-lg border-hairline border-rule-hairline bg-surface-alt p-md';

export default function MySessionsCard() {
  const { eventConfig, features } = useEventConfig();
  const { scheduleData } = useContent();
  const { bookmarkedIds } = useMyBookmarks();

  // Days are runtime config — drop entries without a usable id the same way
  // the schedule page does, so a malformed day can never throw here.
  const days = useMemo(
    () =>
      Array.isArray(eventConfig.days)
        ? eventConfig.days.filter((day) => day && typeof day.id === 'string')
        : [],
    [eventConfig.days],
  );
  const dayIndex = useMemo(() => new Map(days.map((day, index) => [day.id, index])), [days]);
  const dayLabel = useMemo(() => new Map(days.map((day) => [day.id, day.label])), [days]);

  // Programme order: the day's place in config/event.days, then the day's
  // own time order — the same two keys the schedule page sorts by, so the
  // card can never disagree with the pages it links to.
  const upcoming = useMemo(() => {
    if (bookmarkedIds.size === 0) return [];
    return scheduleData
      .filter((session) => session.visible && bookmarkedIds.has(session.id))
      .sort(
        (a, b) =>
          (dayIndex.get(a.dayId) ?? days.length) - (dayIndex.get(b.dayId) ?? days.length) ||
          String(a.startTime).localeCompare(String(b.startTime)) ||
          (a.order ?? 0) - (b.order ?? 0) ||
          String(a.title).localeCompare(String(b.title)),
      )
      .slice(0, SHOWN);
  }, [scheduleData, bookmarkedIds, dayIndex, days.length]);

  if (!features.sessionBookmarks) return null;

  return (
    <section aria-labelledby="my-sessions-heading" className={cardClass}>
      <h2 id="my-sessions-heading" className="font-heading text-h3 font-semibold text-text-primary">
        My sessions
      </h2>
      {upcoming.length === 0 ? (
        <>
          <p className="mt-xs text-body text-text-secondary">
            Bookmark sessions from the schedule and the next ones up show here.
          </p>
          <Link
            to="/schedule"
            className="mt-md inline-block font-medium text-accent hover:underline"
          >
            Browse the schedule
          </Link>
        </>
      ) : (
        <>
          <ul className="mt-sm">
            {upcoming.map((session) => {
              const range = formatSessionTimeRange(eventConfig, session);
              return (
                <li
                  key={session.id}
                  className="border-t-hairline border-t-rule-hairline py-xs first:border-t-0 first:pt-0"
                >
                  <Link
                    to={`/schedule/${session.id}`}
                    className="font-medium text-text-primary hover:underline"
                  >
                    {session.title}
                  </Link>{' '}
                  <span className="font-mono text-caption text-text-secondary">
                    {[dayLabel.get(session.dayId), range ? [range.startLabel, range.endLabel].filter(Boolean).join('–') : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </li>
              );
            })}
          </ul>
          <Link
            to="/schedule/mine"
            className="mt-md inline-block font-medium text-accent hover:underline"
          >
            Your full schedule
          </Link>
        </>
      )}
    </section>
  );
}
