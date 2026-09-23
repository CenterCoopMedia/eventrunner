// PullQuote — a quoted sentence from a speaker or a session, with its
// attribution (expansion record §3.1).
//
// ONE PER PAGE AT MOST. That is a wiring rule the quote block's section cap
// carries; this component draws whatever it is handed.
//
// THE SENTENCE IS THE CALLOUT. Zine's handwritten line (brief §4.3) had a
// contract, a stylesheet and a test, and no call site, because the CMS had
// no field that meant "a line a visitor needs". A quoted sentence is that
// line. So the quote's text renders through Callout.jsx in every style: the
// face, the size, the ink and the angle come from the callout contract,
// which Zine points at the script face at its fixed tilt and every other
// style holds at the heading face and a zero angle. One text device, six
// looks, and the callout finally has its call site.
//
// The frame around the sentence is this device's own contract: the rules
// above and below, the optional rule at the inline start, the optional
// large opening mark, and the attribution's face. The attribution sits
// BELOW the quote, in the data face, and never above it.
//
// A <figure> with a <blockquote> and a <figcaption>, which is the markup a
// quotation with a source has. The opening mark is drawn by the stylesheet
// and hidden from assistive technology, so a reader hears the sentence and
// not a quotation mark read aloud.
import Callout from './Callout.jsx';

/** A string with something in it, or null. */
function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * @param {{
 *   children: import('react').ReactNode,   // the quoted sentence
 *   attribution?: string,                  // who said it, and in what role
 *   className?: string,
 * }} props
 */
export default function PullQuote({ children, attribution, className = '' }) {
  if (children === null || children === undefined || children === '') return null;
  const credit = text(attribution);
  return (
    <figure className={['pull-quote', className].filter(Boolean).join(' ')}>
      <span aria-hidden="true" className="pull-quote__mark">
        “
      </span>
      <blockquote>
        <Callout>{children}</Callout>
      </blockquote>
      {credit ? (
        <figcaption className="pull-quote__attribution mt-sm text-caption text-text-secondary">
          {credit}
        </figcaption>
      ) : null}
    </figure>
  );
}
