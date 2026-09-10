// Loading state (design brief §2.2): loading is a stated line, not a loop.
//
// Ambient animation — anything that pulses, drifts, or breathes on its own —
// is banned outright, a shimmering skeleton included. So this states what is
// loading in words, and holds the space the content will take with a block
// of hairline rows that does not move.
//
// THE ROWS ARE NOT A SKELETON. A skeleton imitates the shape of content that
// is not there yet, and it animates so a reader knows it is fake. These rows
// are RULES: the same hairline the rest of the page uses to separate items,
// drawn where the items will be. Nothing pretends to be a heading, nothing
// pretends to be a photograph, and nothing moves.
//
// Reserving the space is the point. Without it the page reflows the moment
// the content lands, and a reader who had started reading loses their place
// (interface guidelines, Animation: nothing that a reader is reading may
// re-wrap under them).
//
// Every label trails off, and it trails off the same way everywhere: One
// ellipsis CHARACTER, closed up against the last word — never a space before
// it, never three full stops (interface guidelines, Typography: smart
// punctuation, the single ellipsis character). Callers pass the whole label,
// so the convention lives at every call site and this is the note that keeps
// them in step.

/**
 * @param {object} props
 * @param {string} [props.label] what is loading, as a sentence
 * @param {number} [props.rows] how many rows of space to hold
 */
export default function LoadingState({ label = 'Loading…', rows = 3 }) {
  return (
    <div className="py-xl">
      <p role="status" className="font-data text-caption text-text-secondary">
        {label}
      </p>
      {/* The reserved block is decoration for a screen reader: the line
          above already says everything there is to say. */}
      <div aria-hidden="true" className="mt-md flex flex-col">
        {Array.from({ length: Math.max(0, rows) }, (_, index) => (
          <span key={index} className="block border-t-hairline border-rule-hairline py-md" />
        ))}
      </div>
    </div>
  );
}
