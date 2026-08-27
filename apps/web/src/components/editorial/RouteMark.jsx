// RouteMark — the mark a line carries (design brief §4.6; visual story,
// Atlas).
//
// "Concurrent tracks are lines, lettered A, B, C. Each line carries a route
// mark: the letter in the sign face inside a simple survey-drawn shape,
// always with the line's name beside it."
//
// THE LABEL IS NOT OPTIONAL. A mark on its own is a puzzle, not a sign, so
// this component always renders a word beside the letter and never offers a
// way not to: with no name given it falls back to "Line A", which is the
// line's name in the plainest form the story allows. The drawn shape is
// `aria-hidden` because the label already says it — a screen reader hears
// the line once, not twice.
//
// COLOUR IS NEVER THE ONLY SIGNAL (brief §8.1, §4.6). A line is told apart
// by its letter and its name first. Where a client sets a line colour it is
// a second signal, which is why the shape reads `--route-mark-rgb` and the
// letter and the name are the statement.
//
// NEVER A PILL. `--route-mark-radius` follows the theme's own radius scale,
// which is sharp in Atlas; §2.4 rejects the fully rounded shape outright and
// this device gets no exception.
//
// NOT YET WIRED. The schedule's data model carries no track or line field
// today — a session has a day, a time, a title, a room, and its speakers —
// so nothing on the public site can name a line honestly yet. The device
// ships with its contract and its tests, and the departure board that reads
// it lands with the schedule grid in PR3.

/**
 * @param {{ letter: string, name?: string, className?: string }} props
 */
export default function RouteMark({ letter, name = null, className = '' }) {
  const mark = typeof letter === 'string' ? letter.trim() : '';
  if (!mark) return null;
  return (
    <span className={['inline-flex items-center gap-2xs', className].filter(Boolean).join(' ')}>
      <span aria-hidden="true" className="route-mark font-heading font-semibold">
        {mark}
      </span>
      <span className="font-data text-caption text-text-primary">{name || `Line ${mark}`}</span>
    </span>
  );
}
