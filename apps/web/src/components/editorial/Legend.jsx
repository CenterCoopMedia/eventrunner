// Legend — names what a marker or a count means on a page (expansion record
// §3.2): one line at the head of the list, in the data face.
//
// A NUMBER IS NOT SELF-DESCRIBING, and neither is a word like "Now" on a
// row. The legend says what each one means, once, where the list begins,
// so the rows can carry the mark alone. It is one sentence per item —
// "“Saved” is how many attendees bookmarked a session." — because a table
// of symbols is a device from a map key, and this is a line of prose a
// reader takes in as they arrive.
//
// It reads the `legend` contract: the face, the case, and the rule Zine
// strikes above it.

/**
 * @param {{
 *   items: Array<{ term: string, meaning: string }>,
 *   className?: string,
 * }} props
 */
export default function Legend({ items, className = '' }) {
  const rows = (Array.isArray(items) ? items : []).filter(
    (item) => item && typeof item.term === 'string' && item.term && typeof item.meaning === 'string' && item.meaning,
  );
  if (rows.length === 0) return null;
  return (
    <p className={['legend text-text-secondary', className].filter(Boolean).join(' ')}>
      {rows.map((item, index) => (
        <span key={item.term}>
          {index > 0 ? ' ' : ''}
          <span className="legend__term">“{item.term}”</span> is {item.meaning.replace(/\.?$/u, '.')}
        </span>
      ))}
    </p>
  );
}
