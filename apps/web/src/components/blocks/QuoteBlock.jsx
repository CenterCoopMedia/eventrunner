// quote: a quoted sentence with its attribution (BLOCK_TYPES.quote).
//
// The block carries the sentence (`text`) and who said it (`attribution`,
// optional), and renders through the pull quote device (expansion record
// §3.1): the sentence is the callout, so Zine's handwritten line and every
// other style's ruled quote are one block and one component. The record
// allows one pull quote per page at most; the section that admits the
// block carries that cap.
import PullQuote from '../editorial/PullQuote.jsx';

/** A string field with something in it, or null. */
function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export default function QuoteBlock({ block }) {
  const line = text(block?.text);
  if (!line) return null;
  return <PullQuote attribution={text(block.attribution) ?? undefined}>{line}</PullQuote>;
}
