// Marginalia — the marks someone made on the page afterwards (design brief
// §2.4 "declined from CJS2026"; visual stories, Field Guide part 2 and Zine
// moment 3).
//
// Two presets carry marginalia and four decline it outright. Field Guide
// allows ONE mark: a thin pencil line under a label or a note, "a pencil
// mark in a notebook, never a highlighter and never a flourish". Zine
// allows two drawn marks and one written callout.
//
// Bind (Zine moment 3, Field Guide moment 2):
//   • A drawn mark is decorative: `aria-hidden`, `pointer-events: none`,
//     and it inherits ink from `--marginalia-rgb`.
//   • No mark ever lands on a single word inside a headline. That is the
//     banned headline-underline trick (brief §2.4), and it is held by where
//     these are wired — a mark sits under a whole label or a whole line.
//   • The marks are static. There is no draw-on animation of any kind, in
//     either preset, under any motion preference.
//
// OFF BY DEFAULT, in both presets. `--marginalia-display` is `none` until a
// client turns marginalia on from the theme editor, and that control is
// independent of the block variant — a client may want the stamp without
// the pen. The gate is the token, so this component never asks which theme
// is active and never asks whether the option is on.
//
// The drawings are INLINE SVG reading `currentColor`, which is the second
// form brief §2.3 allows. They are component assets rather than motif-set
// assets on purpose: the four motif slots are `section-mark`, `divider`,
// `nameplate-mark`, and `empty-state` (§3.8), and a pen mark is none of
// those. It belongs to the component that carries it, and the marginalia
// tier-3 contract is what a preset retunes.

/**
 * The marks, drawn in each preset's own hand.
 *
 * `pencil` is Field Guide's: thin, quiet, and nearly straight, the line
 * someone rules under a note while being careful.
 */
const MARKS = {
  pencil: (
    <svg
      viewBox="0 0 120 6"
      preserveAspectRatio="none"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinecap="round"
      vectorEffect="non-scaling-stroke"
      focusable="false"
    >
      <path d="M1,4 C22,2.6 44,3.4 66,2.8 C86,2.3 104,3.1 119,2.4" vectorEffect="non-scaling-stroke" />
    </svg>
  ),
};

/**
 * @param {{ mark?: keyof typeof MARKS, className?: string }} props
 */
export default function Marginalia({ mark = 'pencil', className = '' }) {
  const drawing = MARKS[mark];
  if (!drawing) return null;
  return (
    <span
      aria-hidden="true"
      data-marginalia-mark={mark}
      className={['marginalia', `marginalia--${mark}`, className].filter(Boolean).join(' ')}
    >
      {drawing}
    </span>
  );
}
