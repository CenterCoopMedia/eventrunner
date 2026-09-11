// SavedCount — the aggregate bookmark figure beside a session row (issue
// #165).
//
// A LABELLED FIGURE, NOT A BADGE. The number is a fact about the programme
// — how many attendees saved this session — and it says so in words, in the
// data face, beside the number in the mono face. It is aggregate only by
// construction: the collection it reads holds a count per session and
// nothing else, so the figure cannot name anybody.
//
// A session nobody has saved draws no figure at all. A row of zeros is
// noise, and the legend on the schedule header already explains the figure
// for the rows that carry one.
/**
 * @param {{ count?: number, className?: string }} props
 */
export default function SavedCount({ count, className = '' }) {
  if (!Number.isFinite(count) || count <= 0) return null;
  return (
    <p
      className={`font-data text-caption text-text-secondary ${className}`.trim()}
    >
      <span data-numeric className="font-mono">
        {count}
      </span>{' '}
      saved
    </p>
  );
}
