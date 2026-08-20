// link_group: a titled link within a named group (BLOCK_TYPES.link_group).
// SectionBlocks groups items by `group` and renders the group heading; each
// item is one descriptive link (interface guidelines: links say where they
// go, hit areas stay comfortable).
//
// url is CMS-authored data (unvalidated server-side beyond reserved-key
// checks), so it goes through the same href allowlist as richtext links.
import { isSafeHref } from '../../lib/sanitizeHtml.js';

export default function LinkGroupBlock({ block }) {
  if (!block?.url || !block?.label || !isSafeHref(block.url)) return null;
  return (
    <li>
      <a
        href={block.url}
        className="touch-target inline-flex items-center text-brand-primary underline decoration-brand-primary/40 underline-offset-2 hover:text-brand-primary-dark"
      >
        {block.label}
      </a>
    </li>
  );
}
