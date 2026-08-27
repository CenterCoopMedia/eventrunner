// Calling points: a parent session's children (design brief §4.6; visual
// story, Atlas, moment 2 — "child sessions list under their parent as
// calling points").
//
// The children sit under the parent and inherit its time context: a clinic
// inside a workshop is not a second entry in the programme, it is a stop on
// the way through one. So they never render as rows of their own — in the
// grid or in the list — and the relationship is stated in words rather than
// carried by the indent alone (visual story, Civic, moment 1: "a stated
// relationship, such as 'Part of: Opening plenary'", so it survives a
// screen reader).
//
// A CALLING POINT IS THE ONE ROW THAT CAN STATE A MOVE (brief §4.6;
// shared/venue.cjs). Everywhere else on the schedule, a transfer between
// two consecutive entries would be a guess: the reader skipped that
// session, or is following one track out of five. Here the sequence is the
// data — a child runs INSIDE its parent, so a reader at the calling point
// was in the parent's room a moment ago. When the child sits in a different
// place and somebody recorded that exact move, the site states it. When
// nobody recorded it, the site says nothing.
//
// THE DISCLOSURE IS FUNCTIONAL MOTION, AND ONLY THAT (brief §2.2; visual
// story, Newsroom, moment 3). The list opens by default, because a
// programme that hides half of itself is not a programme. The control is a
// real button with `aria-expanded`, the marker turns on `transform` alone
// at --motion-base, and the whole rule sits inside a no-preference query so
// a reader who asked for less motion gets a marker that does not move. The
// schedule's one EXPRESSIVE moment is the grid's column, never this.
import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { sessionMovement } from 'shared/venue';
import TransferLine from './TransferLine.jsx';
import { formatSessionStart } from '../lib/eventTime.js';

/**
 * @param {{
 *   parent: object,
 *   points: object[],   // the parent's children, in programme order
 *   eventConfig: object,
 *   className?: string,
 * }} props
 */
export default function CallingPoints({ parent, points, eventConfig, className = '' }) {
  const [open, setOpen] = useState(true);
  const { search } = useLocation();
  if (!Array.isArray(points) || points.length === 0) return null;
  const listId = `calling-points-${parent.id}`;

  return (
    <div className={['calling-points', className].filter(Boolean).join(' ')}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((was) => !was)}
        className="touch-target inline-flex items-center gap-2xs font-data text-caption text-text-secondary hover:text-text-primary"
      >
        <span aria-hidden="true" className="calling-points__marker" />
        {points.length === 1 ? '1 calling point' : `${points.length} calling points`}
      </button>
      {open ? (
        <ul id={listId} aria-label={`Calling points of ${parent.title}`} className="mt-2xs">
          {points.map((child) => {
            const range = formatSessionStart(eventConfig, child);
            // The move from the parent's place to this child's, if anyone
            // recorded it. Null when either states no place, when both are
            // in the same one, and when the pair has no record — which is
            // most calling points, and renders as nothing at all.
            const movement = sessionMovement(eventConfig, parent, child);
            return (
              <li key={child.id} className="calling-points__item">
                <p className="font-mono text-caption text-text-secondary">
                  {range ? (
                    <time dateTime={range.startIso}>{range.startLabel}</time>
                  ) : (
                    <span>Time to be announced</span>
                  )}
                </p>
                <p className="text-body text-text-primary">
                  <Link
                    to={{ pathname: `/schedule/${child.id}`, search }}
                    className="hover:underline"
                  >
                    {child.title}
                  </Link>
                  {/* The relationship, in words. The indent says it to a
                      reader who can see it; this says it to everyone
                      else. */}
                  <span className="sr-only">{` — part of ${parent.title}`}</span>
                </p>
                <TransferLine movement={movement} />
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
