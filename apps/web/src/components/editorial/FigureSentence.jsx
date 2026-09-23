// FigureSentence — a line of copy whose figures are set as figures
// (expansion record §3.4): "412 registered, 38 in the last day, read at
// 09:14", in place of a tile.
//
// A DASHBOARD TILE SAYS ONE NUMBER LOUDLY AND NOTHING ABOUT IT. A sentence
// says the number, what it counts, over what period, and when it was read,
// in the order a person would say them. Each figure sits in the mono face
// with tabular figures so a reader's eye finds it, and the words around it
// carry the meaning. The sentence is body copy: it reads at the body step
// in the body face, through the `figure-sentence` contract.
//
// `SentenceFigure` marks a figure inside the sentence. It is exported so a
// caller composes the sentence in its own words, with as many figures as
// the fact has.

/** One figure inside the sentence. */
export function SentenceFigure({ children }) {
  return (
    <span data-numeric className="figure-sentence__figure text-text-primary">
      {children}
    </span>
  );
}

/**
 * @param {{
 *   children: import('react').ReactNode,   // the sentence, with SentenceFigure marks
 *   className?: string,
 *   as?: 'p' | 'span',
 * }} props
 */
export default function FigureSentence({ children, className = '', as: Tag = 'p' }) {
  if (children === null || children === undefined || children === '') return null;
  return (
    <Tag className={['figure-sentence max-w-prose text-text-secondary', className].filter(Boolean).join(' ')}>
      {children}
    </Tag>
  );
}
