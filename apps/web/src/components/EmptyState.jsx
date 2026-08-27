// Designed empty state: orients the reader with one plain sentence under a
// hairline rule, then offers exactly one next action (interface guidelines:
// Writing). The rule opens the block the way it opens any other section
// (design brief §2.1) — never a card, never an illustration (motifs land in
// a later phase). Builders pass the action as a single link or button
// element.
import Rule from './editorial/Rule.jsx';

export default function EmptyState({ title, description, action = null }) {
  return (
    <div className="py-2xl">
      <Rule />
      <h2 className="mt-lg font-heading text-h3 font-semibold text-text-primary">{title}</h2>
      {description ? (
        <p className="mt-xs max-w-prose text-body text-text-secondary">{description}</p>
      ) : null}
      {action ? <div className="mt-md">{action}</div> : null}
    </div>
  );
}
