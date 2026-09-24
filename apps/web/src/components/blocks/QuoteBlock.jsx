// quote: a quoted sentence with its attribution (BLOCK_TYPES.quote).
//
// The block carries the sentence (`text`) and who said it (`attribution`,
// optional). THE FIRST QUOTE ON A PAGE IS THE PULL QUOTE (expansion record
// §3.1: one per page at most, which the page's budget enforces — see
// pullQuoteBudget.jsx): the sentence is the callout, so Zine's handwritten
// line and every other style's ruled quote are one block and one component.
// ANY QUOTE AFTER IT IS SET AS A PLAIN QUOTATION: the same words in the body
// register, inside a hairline at the inline start, with the attribution
// under them. Nothing an operator wrote is dropped; the second quote just
// does not take the page's one expressive frame.
import PullQuote from '../editorial/PullQuote.jsx';
import { usePullQuoteAllowed } from './pullQuoteBudget.jsx';

/** A string field with something in it, or null. */
function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** The plain quotation: body copy with a rule, for a page's second quote. */
function PlainQuote({ line, attribution }) {
  return (
    <figure className="quote-plain max-w-prose">
      <blockquote>
        <p className="text-body text-text-primary text-pretty">“{line}”</p>
      </blockquote>
      {attribution ? (
        <figcaption className="mt-2xs text-caption text-text-secondary">{attribution}</figcaption>
      ) : null}
    </figure>
  );
}

export default function QuoteBlock({ block }) {
  const pull = usePullQuoteAllowed(block);
  const line = text(block?.text);
  if (!line) return null;
  const attribution = text(block.attribution) ?? undefined;
  if (!pull) return <PlainQuote line={line} attribution={attribution} />;
  return <PullQuote attribution={attribution}>{line}</PullQuote>;
}
