// richtext: formatted body copy (BLOCK_TYPES.richtext).
//
// The value is CMS-authored HTML; it reaches the DOM only through
// sanitizeHtml's allowlist (no script/style/iframe/event handlers — see
// src/lib/sanitizeHtml.js). Typography for the subset lives in the
// .rich-text component class (PublicRichText.css).
import PublicRichText from '../PublicRichText.jsx';

export default function RichTextBlock({ block }) {
  return <PublicRichText value={block?.value} lang={block?.publicLanguage} className="rich-text max-w-prose" />;
}
