// The schedule as plain text (issue #166).
//
// ONE PROGRAMME, EVERY CONFIGURED DAY. The screen shows one day at a time;
// the text view is the whole run — the thing a run-of-show doc, a mail to
// volunteers, or a paste into any tool needs. It mirrors the printed
// handout's completeness: every day, every session, every calling point,
// the line and the room — and it adds nothing the page does not state.
import { formatDayDate, formatSessionStart, formatSessionTimeRange } from './eventTime.js';
import { withCallingPoints } from './scheduleGrid.js';

/** "A · Practice", or null where the session runs on no line. */
function lineLabel(session, columns) {
  const letter = typeof session?.track === 'string' ? session.track.trim().toUpperCase() : '';
  const column = columns.find((one) => one.letter === letter);
  return column ? `${column.letter} · ${column.name}` : null;
}

/**
 * The full programme as plain text.
 *
 * @param {{
 *   days: object[],
 *   sessionsByDay: Map<string, object[]>,
 *   columns: Array<{ letter: string, name: string }>,
 *   eventConfig: object,
 *   speakerNamesById?: Map<string, string>,
 *   heading?: string,
 * }} args
 * @returns {string}
 */
export function schedulePlainText({
  days,
  sessionsByDay,
  columns,
  eventConfig,
  speakerNamesById = null,
  heading = 'Full programme',
}) {
  const safeDays = Array.isArray(days) ? days : [];
  const safeColumns = Array.isArray(columns) ? columns : [];
  const eventName =
    typeof eventConfig?.name === 'string' && eventConfig.name.trim()
      ? eventConfig.name.trim()
      : null;
  const out = [];
  out.push(eventName ? `${eventName} — ${heading}` : heading);

  for (const day of safeDays) {
    const date = formatDayDate(day, eventConfig?.timezone);
    out.push('');
    out.push(date ? `${day.label} · ${date}` : String(day.label ?? ''));

    const entries = withCallingPoints(sessionsByDay?.get(day.id) ?? []);
    if (entries.length === 0) {
      out.push('  No sessions are announced for this day.');
      continue;
    }

    for (const entry of entries) {
      const { session, children } = entry;
      const range = formatSessionTimeRange(eventConfig, session);
      const time = range ? `${range.startLabel}–${range.endLabel}` : 'Time to be announced';
      out.push('');
      out.push(`${time}  ${session.title}`);
      const meta = [lineLabel(session, safeColumns), session.location].filter(Boolean).join(' · ');
      if (meta) out.push(`  ${meta}`);
      if (speakerNamesById instanceof Map && Array.isArray(session.speakerIds)) {
        const names = session.speakerIds
          .map((id) => speakerNamesById.get(id))
          .filter(Boolean)
          .join(', ');
        if (names) out.push(`  Speakers: ${names}`);
      }

      for (const child of children) {
        const start = formatSessionStart(eventConfig, child);
        out.push(`    ${start ? start.startLabel : '—'}  ${child.title} (part of ${session.title})`);
      }
    }
  }

  return out.join('\n');
}
