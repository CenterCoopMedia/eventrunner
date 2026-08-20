// faq_item: a question with its rich-text answer (BLOCK_TYPES.faq_item).
// Native <details>/<summary> — keyboard-operable disclosure for free, no
// scripted accordion. The answer passes through the same sanitizer as every
// richtext value.
import { sanitizeHtml } from '../../lib/sanitizeHtml.js';

export default function FaqItemBlock({ block }) {
  if (!block?.question) return null;
  const answer = sanitizeHtml(block.answer);
  return (
    <details className="rounded-brand-lg border border-brand-ink/10 bg-brand-surface-alt">
      <summary className="touch-target flex cursor-pointer items-center px-5 py-4 font-heading text-lg text-brand-ink">
        {block.question}
      </summary>
      {answer ? (
        <div
          className="rich-text max-w-prose px-5 pb-5"
          // Sanitized above — allowlisted tags and attributes only.
          dangerouslySetInnerHTML={{ __html: answer }}
        />
      ) : null}
    </details>
  );
}
