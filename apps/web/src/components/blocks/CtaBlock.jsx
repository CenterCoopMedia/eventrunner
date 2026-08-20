// cta: a prominent action link (BLOCK_TYPES.cta). Rendered as <a> — it
// navigates — styled as the primary button. External links open a new tab
// with the opener relationship severed.
//
// url is CMS-authored data (the published collection is world-readable and
// unvalidated server-side beyond reserved-key checks), so it goes through
// the same href allowlist as richtext links before it ever reaches the DOM.
import { isSafeHref } from '../../lib/sanitizeHtml.js';

export default function CtaBlock({ block }) {
  if (!block?.url || !block?.label || !isSafeHref(block.url)) return null;
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
