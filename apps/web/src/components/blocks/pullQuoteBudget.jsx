// The one pull quote a page may carry (expansion record §3.1).
//
// THE RECORD SAYS ONE PER PAGE AT MOST, AND THE PAGE ENFORCES IT (adversarial
// review of the 2026-09-10 wave: the rule was stated in comments and docs and
// held by nothing). A section's block cap and the operator held it between
// them, which is to say a second quote block rendered as a second pull
// quote. Now the page decides: the FIRST quote block in reading order, with
// a sentence in it, is the pull quote, and every quote block after it is
// set as a plain quotation in the body register (components/blocks/
// QuoteBlock.jsx draws both). The words are kept; only the device changes.
//
// A page shell (components/SystemPage.jsx, pages/ContentPage.jsx) provides
// the budget from its sections in reading order. A quote block rendered
// with no budget above it — a test, a preview of one block — is the pull
// quote, because there is nothing else on that page for it to yield to.
import { createContext, useContext, useMemo } from 'react';

const PullQuoteBudgetContext = createContext(undefined);

/** A string with something in it, or null. */
function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** The key a block is known by: its document id, or its section and field. */
export function quoteKey(block) {
  return block?.id ?? `${block?.section}__${block?.field}`;
}

/**
 * The key of the first quote block on the page that has a sentence, or null.
 *
 * @param {Array<{ id: string }>} sections the page's sections, in reading order
 * @param {(id: string) => object[]} getSectionBlocks the section's visible blocks, in order
 * @returns {string|null}
 */
export function firstQuoteKey(sections, getSectionBlocks) {
  for (const section of sections ?? []) {
    for (const block of getSectionBlocks(section.id) ?? []) {
      if (block?.blockType === 'quote' && text(block.text)) return quoteKey(block);
    }
  }
  return null;
}

/**
 * @param {{
 *   sections: Array<{ id: string }>,
 *   getSectionBlocks: (id: string) => object[],
 *   children: import('react').ReactNode,
 * }} props
 */
export function PullQuoteBudget({ sections, getSectionBlocks, children }) {
  const first = useMemo(() => firstQuoteKey(sections, getSectionBlocks), [sections, getSectionBlocks]);
  const value = useMemo(() => ({ first }), [first]);
  return <PullQuoteBudgetContext.Provider value={value}>{children}</PullQuoteBudgetContext.Provider>;
}

/**
 * Whether this quote block is the page's pull quote.
 *
 * @param {object} block
 * @returns {boolean}
 */
export function usePullQuoteAllowed(block) {
  const budget = useContext(PullQuoteBudgetContext);
  if (budget === undefined) return true;
  return budget.first === quoteKey(block);
}
