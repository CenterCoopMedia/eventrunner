// Count — a labelled figure beside the thing it counts (expansion record
// §3.2): "12 saved".
//
// THE LABEL IS ALWAYS PRESENT. A number is not self-describing, and a bubble
// with a number in it is the badge this system refuses. The figure is set in
// the mono face with tabular figures so a column of counts lines up, and the
// label in the data face beside it, through the `count` contract a style
// remaps.
//
// A count of nothing is the caller's decision: a row of zeros is noise on a
// programme (SavedCount draws nothing for zero), and a filter that matched
// nothing is a fact worth stating ("0 sessions"). So this draws whatever
// number it is handed.

/**
 * @param {{
 *   value: number | string,
 *   label: string,
 *   className?: string,
 * }} props
 */
export default function Count({ value, label, className = '' }) {
  if (value === null || value === undefined || !label) return null;
  return (
    <span className={['count', className].filter(Boolean).join(' ')}>
      <span data-numeric className="count__figure">
        {value}
      </span>{' '}
      <span className="count__label">{label}</span>
    </span>
  );
}
