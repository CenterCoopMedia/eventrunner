// Designed empty state: orients the reader with one plain sentence under a
// hairline rule, then offers exactly one next action (interface guidelines:
// Writing). The rule opens the block the way it opens any other section
// (design brief §2.1) — never a card. Builders pass the action as a single
// link or button element.
//
// The `empty-state` motif slot sits above the sentence (brief §3.8). It is
// the third and last place the public site renders a motif, which is what
// holds the three-per-page density rule (§2.3) without a counter. Under the
// `none` set — four of the six presets — it renders nothing at all, so this
// is the same block it was before. Under `botanical` it is Field Guide's
// unlabeled plate (visual story, Field Guide, moment 3); under
// `cartographic` it is an empty sheet.
//
// The admin has no motif layer at all (admin identity story): the room is
// not a preset, so nothing here is shared with it.
import Motif from './editorial/Motif.jsx';
import Rule from './editorial/Rule.jsx';

export default function EmptyState({ title, description, action = null }) {
  return (
    <div className="py-2xl">
      <Rule />
      <Motif slot="empty-state" className="mt-lg" />
      <h2 className="mt-lg font-heading text-h3 font-semibold text-text-primary">{title}</h2>
      {description ? (
        <p className="mt-xs max-w-prose text-body text-text-secondary">{description}</p>
      ) : null}
      {action ? <div className="mt-md">{action}</div> : null}
    </div>
  );
}
