// DefinitionList — term and description pairs (expansion record §3.1).
//
// Venue, dates, format, room: a fact is a term and a description, and this
// is the device that states one. It is a REAL <dl>, so a screen reader
// announces each pair as a term and its definition, and it is ruled between
// pairs the way every list in the system is ruled — never boxed, never a
// card.
//
// THIS IS THE ANSWER TO A NON-NUMERIC FACT (#234). A stat block carries the
// four-part evidence contract because it presents a number as evidence; a
// venue name has no source line and nothing it counts. So a fact renders
// here, through `DefinitionPair`, and the stat block keeps its contract for
// the figures that need one.
//
// The pair is exported on its own because two callers already hold the
// <dl>: SectionBlocks batches a run of fact blocks into one list, and
// InfoCards puts one pair inside the card it opens. A pair rendered outside
// a <dl> is invalid markup, so a caller composes one or the other and never
// a bare pair.

/** A string field with something in it, or null. */
function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * One term and its description, with an optional line under the description.
 *
 * @param {{
 *   term: import('react').ReactNode,
 *   children: import('react').ReactNode,   // the description
 *   note?: import('react').ReactNode,      // one line under it, in the data face
 *   className?: string,
 * }} props
 */
export function DefinitionPair({ term, children, note = null, className = '' }) {
  return (
    <div className={['definition-list__pair', className].filter(Boolean).join(' ')}>
      <dt className="definition-list__term font-semibold text-text-primary">{term}</dt>
      <dd className="text-body text-text-primary text-pretty">{children}</dd>
      {note ? <dd className="font-data text-caption text-text-secondary text-pretty">{note}</dd> : null}
    </div>
  );
}

/**
 * @param {{
 *   items: Array<{ term: string, description: string, note?: string }>,
 *   className?: string,
 * }} props
 */
export default function DefinitionList({ items, className = '' }) {
  const rows = (Array.isArray(items) ? items : []).filter(
    (item) => item && text(item.term) && text(item.description),
  );
  if (rows.length === 0) return null;
  return (
    <dl className={['definition-list', className].filter(Boolean).join(' ')}>
      {rows.map((item, index) => (
        <DefinitionPair key={`${item.term}-${index}`} term={item.term} note={text(item.note)}>
          {item.description}
        </DefinitionPair>
      ))}
    </dl>
  );
}
