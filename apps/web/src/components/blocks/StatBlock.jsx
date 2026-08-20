// stat: a headline number with its caption (BLOCK_TYPES.stat). Definition
// pair markup; the figure reads in tabular figures via data-numeric
// (index.css).
export default function StatBlock({ block }) {
  if (!block?.value || !block?.label) return null;
  return (
    <div className="rounded-brand-lg border border-brand-ink/10 bg-brand-surface-alt p-5">
      <dt className="order-last mt-1 text-sm text-brand-ink-muted">{block.label}</dt>
      <dd
        data-numeric
        className="font-heading text-4xl font-semibold text-brand-primary"
      >
        {block.value}
      </dd>
    </div>
  );
}
