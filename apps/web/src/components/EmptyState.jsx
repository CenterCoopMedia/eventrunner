// Designed empty state: orients the reader and offers exactly one next
// action (interface guidelines: Writing). Builders pass the action as a
// single link or button element.
export default function EmptyState({ title, description, action = null }) {
  return (
    <div className="rounded-brand-lg border border-brand-ink/10 bg-brand-surface-alt px-6 py-12 text-center">
      <h2 className="font-heading text-xl text-brand-ink">{title}</h2>
      {description ? (
        <p className="mx-auto mt-2 max-w-prose text-brand-ink-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-6 flex justify-center">{action}</div> : null}
    </div>
  );
}
