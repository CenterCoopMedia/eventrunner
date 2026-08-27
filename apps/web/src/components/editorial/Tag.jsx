// Tag — the small ruled rectangle that labels a thing (design brief §2.1,
// §2.4, issue #113).
//
// This is the one tag shape the system has. It is NOT a pill: the fully
// rounded shape is a rejected pattern (§2.4), and the radius reads
// `--radius-base`, so the concentric radius rule keeps it in step with
// everything else the theme draws (interface guidelines, User interface).
// It is not a folio either — a folio is text on a rule and carries no box,
// so reach for Folio.jsx at a section boundary and for this only where a
// label attaches to a specific item.
//
// The copy stays in natural case in the DOM and the small caps are CSS's
// job (interface guidelines, Typography), so a screen reader reads the word
// an editor typed.
//
// A tag never signals status by color alone (§8.1): the word inside it is
// the signal, and `tone` only adds emphasis to a word that already says
// what it means.

/**
 * Tone → the border and fill that draw it. `keynote` is the one emphasis
 * the platform grants, and it reads the `--semantic-keynote` token rather
 * than a color of its own.
 */
const TONE_CLASS = {
  default: 'border-rule-hairline bg-surface-alt',
  keynote: 'border-keynote/40 bg-keynote/10',
};

const BASE_CLASS =
  'inline-flex items-center whitespace-nowrap rounded-brand border-hairline px-2xs py-3xs ' +
  'font-data text-folio font-medium uppercase text-text-primary';

/**
 * @param {{
 *   children: import('react').ReactNode,
 *   tone?: 'default' | 'keynote',
 *   className?: string,
 * }} props
 */
export default function Tag({ children, tone = 'default', className = '' }) {
  return (
    <span className={[BASE_CLASS, TONE_CLASS[tone] ?? TONE_CLASS.default, className].filter(Boolean).join(' ')}>
      {children}
    </span>
  );
}
