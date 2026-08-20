// richtext: formatted body copy (BLOCK_TYPES.richtext).
//
// The value is CMS-authored HTML; it reaches the DOM only through
// sanitizeHtml's allowlist (no script/style/iframe/event handlers — see
// src/lib/sanitizeHtml.js). Typography for the subset lives in the
// .rich-text component class (index.css).
import { sanitizeHtml } from '../../lib/sanitizeHtml.js';

export default function RichTextBlock({ block }) {
  const html = sanitizeHtml(block?.value);
  if (!html) return null;
  return (
    <div
      className="rich-text max-w-prose"
      // Sanitized above — allowlisted tags and attributes only.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
