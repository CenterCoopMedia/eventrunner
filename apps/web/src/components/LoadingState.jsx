// Loading state (design brief §2.2): loading is a stated line, not a loop.
// Ambient animation — anything that pulses, drifts, or breathes on its own —
// is banned outright, a skeleton included, so this renders the label as
// plain text and nothing more. It still announces via role="status".
export default function LoadingState({ label = 'Loading …' }) {
  return (
    <p role="status" aria-label={label} className="py-8 font-data text-caption text-text-secondary">
      {label}
    </p>
  );
}
