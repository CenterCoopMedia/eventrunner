// cta: a prominent action link (BLOCK_TYPES.cta). Rendered as <a> — it
// navigates — styled as the primary button. External links open a new tab
// with the opener relationship severed.
export default function CtaBlock({ block }) {
  if (!block?.url || !block?.label) return null;
  return (
    <a
      href={block.url}
      {...(block.external ? { target: '_blank', rel: 'noreferrer' } : {})}
      className="touch-target inline-flex items-center rounded-brand bg-brand-primary px-6 py-3 font-semibold text-brand-surface hover:bg-brand-primary-dark"
    >
      {block.label}
    </a>
  );
}
