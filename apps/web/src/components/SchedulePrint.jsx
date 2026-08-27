// The printed programme (design brief §2.1; every visual story, part 2,
// "Print view").
//
// A registration desk hands this out. So it is not the screen with the
// controls hidden — it is its own view, written for paper: every day of
// the event rather than the one on screen, every session and every calling
// point listed, each line named by its letter and its name, and no control
// anywhere, because a button on paper is a lie.
//
// ONE PRINT VIEW, SIX REGISTERS. Each story asks for a different printed
// object — Broadsheet's ruled programme page, Civic's posted agenda,
// Field Guide's dated observation sheet, Atlas's pocket timetable — and
// those are differences of type and tone, not of structure. They ride the
// active preset automatically here: the faces are the four role tokens and
// the rules are the rule tokens, so the same markup prints as whichever
// object the client's preset is. Nothing in this file asks which theme is
// active.
//
// IT IS NOT A SECOND COPY OF THE PAGE ON SCREEN. `display: none` outside
// print media keeps it out of the layout AND out of the accessibility
// tree, so a screen reader never meets a session twice (index.css).
import { formatDayDate, formatSessionStart, formatSessionTimeRange } from '../lib/eventTime.js';
import { withCallingPoints } from '../lib/scheduleGrid.js';

/** "A · Practice", or nothing where the session runs on no line. */
function lineLabel(session, columns) {
  const letter = typeof session?.track === 'string' ? session.track.trim().toUpperCase() : '';
  const column = columns.find((one) => one.letter === letter);
  return column ? `${column.letter} · ${column.name}` : null;
}

/** One session's line, room, and speakers, in a fixed order. */
function metaLine(session, columns) {
  return [lineLabel(session, columns), session?.location].filter(Boolean).join(' · ');
}

/**
 * @param {{
 *   days: object[],
 *   sessionsByDay: Map<string, object[]>,
 *   columns: Array<{ letter: string, name: string }>,
 *   eventConfig: object,
 * }} props
 */
export default function SchedulePrint({ days, sessionsByDay, columns, eventConfig }) {
  return (
    <div className="schedule-print">
      {days.map((day) => {
        const entries = withCallingPoints(sessionsByDay.get(day.id) ?? []);
        const date = formatDayDate(day, eventConfig.timezone);
        return (
          <section key={day.id} className="schedule-print__day">
            <h2 className="schedule-print__day-head">
              {day.label}
              {date ? <span className="schedule-print__date">{date}</span> : null}
            </h2>
            {entries.length === 0 ? (
              <p className="schedule-print__row">No sessions are announced for this day.</p>
            ) : (
              <ul>
                {entries.map((entry) => {
                  const range = formatSessionTimeRange(eventConfig, entry.session);
                  const meta = metaLine(entry.session, columns);
                  return (
                    <li key={entry.session.id} className="schedule-print__row">
                      <p className="schedule-print__time font-mono">
                        {range ? (
                          <>
                            {range.startLabel}
                            {range.endLabel ? `–${range.endLabel}` : null}
                          </>
                        ) : (
                          'Time to be announced'
                        )}
                      </p>
                      <div>
                        <p className="schedule-print__title font-heading">{entry.session.title}</p>
                        {meta ? <p className="font-data">{meta}</p> : null}
                        {entry.children.length > 0 ? (
                          <ul className="schedule-print__calls">
                            {entry.children.map((child) => {
                              const start = formatSessionStart(eventConfig, child);
                              return (
                                <li key={child.id}>
                                  <span className="schedule-print__time font-mono">
                                    {start ? start.startLabel : '—'}
                                  </span>
                                  <span>
                                    {child.title}
                                    {/* The relationship in words, on paper
                                        as on screen: an indent alone does
                                        not survive a photocopier either. */}
                                    <span className="font-data">
                                      {` (part of ${entry.session.title})`}
                                    </span>
                                  </span>
                                </li>
                              );
                            })}
                          </ul>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
