// faq_item: a question with its rich-text answer (BLOCK_TYPES.faq_item).
// Native <details>/<summary> — keyboard-operable disclosure for free, no
// scripted accordion. The answer passes through the same sanitizer as every
// richtext value.
//
// Colors read the tier 2 role names, the question sits on the type scale's
// lead step, and the padding uses the named spacing steps (design brief
// §3.1, §3.7) — the same vocabulary SessionCard and the restyled pages use.
// The boundary is the hairline rule token at the hairline width, so the
// disclosure is bounded by a rule rather than an ink-derived border.
import { sanitizeHtml } from '../../lib/sanitizeHtml.js';

export default function FaqItemBlock({ block }) {
  if (!block?.question) return null;
  const answer = sanitizeHtml(block.answer);
  return (
    <details className="rounded-brand-lg border-hairline border-rule-hairline bg-surface-alt">
      <summary className="touch-target flex cursor-pointer items-center px-md py-sm font-heading text-lead text-text-primary">
        {block.question}
      </summary>
      {answer ? (
        <div
          className="rich-text max-w-prose px-md pb-md"
          // Sanitized above — allowlisted tags and attributes only.
          dangerouslySetInnerHTML={{ __html: answer }}
        />
      ) : null}
    </details>
  );
}
