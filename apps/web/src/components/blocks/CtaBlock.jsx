// cta: a prominent action link (BLOCK_TYPES.cta). Rendered as <a> — it
// navigates — styled as the primary button. External links open a new tab
// with the opener relationship severed.
//
// url is CMS-authored data (the published collection is world-readable and
// unvalidated server-side beyond reserved-key checks), so it goes through
// the same href allowlist as richtext links before it ever reaches the DOM.
//
// The shape is the site's one filled action, so it reads that class string
// from controlClasses.js rather than restating it. Restating it is exactly
// how the drift that module's header describes got started.
import { isSafeHref } from '../../lib/sanitizeHtml.js';
import { primaryActionClass } from '../controlClasses.js';

export default function CtaBlock({ block }) {
  if (!block?.url || !block?.label || !isSafeHref(block.url)) return null;
  return (
    <a
      href={block.url}
      {...(block.external ? { target: '_blank', rel: 'noreferrer' } : {})}
      className={primaryActionClass}
    >
      {block.label}
    </a>
  );
}
