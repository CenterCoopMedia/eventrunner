// The schedule grid: time down the left, lettered tracks across the head
// (design brief §2.1 "Grid schedule", §2.2, §4.6).
//
// IT IS A REAL TABLE, AND THAT IS THE ACCESSIBILITY BASELINE. A two-axis
// schedule is a data table: a session is at the intersection of a time and
// a line. So the times are row headers, the lines are column headers, and a
// screen reader announces "Practice, 10:30" for a cell because the markup
// says so rather than because a label was written twice. Reading order runs
// the way the page reads: the time, then each line in the order the client
// listed them. A plenary spans the width, which is what a plenary is.
//
// The narrow-viewport list is not this component's fallback. It is the
// other first-class view (visual story, Civic, moment 1) and it lives in
// Schedule.jsx; lib/viewport.js decides which of the two is in the document
// at all, so nobody ever meets the same session twice.
//
// THE ONE EXPRESSIVE MOMENT ON THE PUBLIC SITE (brief §2.2). A track column
// comes forward when the reader acts on its head. The rules that bind it:
//
//   - It starts from a user action: a click on the head, or focus reaching
//     it. Nothing here reads scroll position, and nothing loops.
//   - It finishes under 600ms, on --motion-signature.
//   - It animates `transform` and `opacity` only.
//   - The page is readable at every frame: the other columns are not
//     dimmed, and the forward column is marked by a tint of its own ground.
//     Nothing about the state depends on colour alone (§8.1) — the head's
//     button carries `aria-pressed`.
//   - Under `prefers-reduced-motion` the tint still lands and the lift does
//     not, so the state is truly static rather than shortened (index.css).
//
// FOCUS PREVIEWS, THE BUTTON KEEPS. Tabbing across the heads brings each
// column forward as it is reached, which is the keyboard reader's version
// of running a finger down a column. Pressing the head keeps that column
// forward after focus moves on, and `aria-pressed` is the record of that
// choice. The traced line is the same interaction with Atlas's tokens on
// (--schedule-trace-width): the column's cells connect down the sheet.
import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import RouteMark from './editorial/RouteMark.jsx';
import SpecimenLabel from './editorial/SpecimenLabel.jsx';
import CallingPoints from './CallingPoints.jsx';
import { TypeBadge } from './SessionCard.jsx';
import { buildGridRows } from '../lib/scheduleGrid.js';
import { formatSessionStart, formatSessionTimeRange } from '../lib/eventTime.js';

/** One session inside a cell: the title, the room, and its calling points. */
function GridEntry({ entry, eventConfig }) {
  const { search } = useLocation();
  const range = formatSessionTimeRange(eventConfig, entry.session);
  return (
    <div className="schedule-grid__entry">
      <div className="flex flex-wrap items-baseline gap-x-sm gap-y-3xs">
        <h3 className="font-heading text-h3 font-semibold text-text-primary">
          <Link
            to={{ pathname: `/schedule/${entry.session.id}`, search }}
            className="hover:underline"
          >
            {entry.session.title}
          </Link>
        </h3>
        <TypeBadge type={entry.session.type} />
      </div>
      {range?.endLabel ? (
        <p className="mt-3xs font-mono text-caption text-text-secondary">
          {'Ends '}
          <time dateTime={range.endIso}>{range.endLabel}</time>
        </p>
      ) : null}
      <SpecimenLabel
        className="mt-2xs"
        fields={[{ key: 'Place', value: entry.session.location }]}
      />
      <CallingPoints
        className="mt-xs"
        parent={entry.session}
        points={entry.children}
        eventConfig={eventConfig}
      />
    </div>
  );
}

/**
 * @param {{
 *   day: object,
 *   entries: Array<{ session: object, children: object[] }>,
 *   columns: Array<{ letter: string, name: string }>,
 *   eventConfig: object,
 * }} props
 */
export default function ScheduleGrid({ day, entries, columns, eventConfig }) {
  // Two states, because the reader is doing two things. `focused` is the
  // preview that follows the keyboard; `pinned` is the choice a press
  // keeps. Focus wins while it lasts, which is what makes tabbing across
  // the heads read as running a finger along them.
  const [pinned, setPinned] = useState(null);
  const [focused, setFocused] = useState(null);
  const forward = focused ?? pinned;
  const rows = buildGridRows(entries, columns);

  return (
    <table className="schedule-grid" data-forward={forward ?? undefined}>
      <caption className="sr-only">{`${day.label}, sessions by track`}</caption>
      <thead>
        <tr>
          <th scope="col" className="schedule-grid__corner">
            <span className="sr-only">Time</span>
          </th>
          {columns.map((column) => (
            <th
              key={column.letter}
              scope="col"
              className="schedule-grid__head"
              data-track={column.letter}
              data-track-forward={forward === column.letter ? 'true' : undefined}
            >
              <button
                type="button"
                aria-pressed={pinned === column.letter}
                onClick={() =>
                  setPinned((was) => (was === column.letter ? null : column.letter))
                }
                onFocus={() => setFocused(column.letter)}
                onBlur={() => setFocused(null)}
                className="touch-target inline-flex w-full items-center"
              >
                <RouteMark letter={column.letter} name={column.name} />
              </button>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const first = (row.span ?? row.cells.flatMap((cell) => cell.entries))[0];
          // The row header is a time standing on its own, so it carries its
          // own AM/PM rather than borrowing the range's (lib/eventTime.js).
          const range = first ? formatSessionStart(eventConfig, first.session) : null;
          return (
            <tr key={row.key}>
              <th scope="row" className="schedule-grid__time font-mono text-caption">
                {range ? (
                  <time dateTime={range.startIso}>{range.startLabel}</time>
                ) : (
                  <span>{row.time || 'Time to be announced'}</span>
                )}
              </th>
              {row.span ? (
                // A session on no line runs across the whole event, so it
                // runs across the whole row.
                <td className="schedule-grid__cell" colSpan={columns.length}>
                  {row.span.map((entry) => (
                    <GridEntry key={entry.session.id} entry={entry} eventConfig={eventConfig} />
                  ))}
                </td>
              ) : (
                row.cells.map((cell) => (
                  <td
                    key={cell.track}
                    className="schedule-grid__cell"
                    data-track={cell.track}
                    data-track-forward={forward === cell.track ? 'true' : undefined}
                  >
                    {cell.entries.map((entry) => (
                      <GridEntry key={entry.session.id} entry={entry} eventConfig={eventConfig} />
                    ))}
                  </td>
                ))
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
