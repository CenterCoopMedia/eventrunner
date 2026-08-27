// Loading state (design brief §2.2): loading is a stated line, not a loop.
// Ambient animation — anything that pulses, drifts, or breathes on its own —
// is banned outright, a skeleton included, so this renders the label as
// plain text and nothing more. It still announces via role="status".
//
// Every label trails off, and it trails off the same way everywhere: One
// ellipsis CHARACTER, closed up against the last word — never a space before
// it, never three full stops (interface guidelines, Typography: smart
// punctuation, the single ellipsis character). Callers pass the whole label,
// so the convention lives at every call site and this is the note that keeps
// them in step.
export default function LoadingState({ label = 'Loading…' }) {
  return (
    <p role="status" aria-label={label} className="py-xl font-data text-caption text-text-secondary">
      {label}
    </p>
  );
}
