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
 *
 * `squiggle` and `circle` are Zine's, and they are the whole marginalia
 * budget: "two drawn marks per page, one callout, and no mark on a headline
 * word" (visual story, Zine, part 5). The squiggle underlines a folio or a
 * callout line; the circle goes around one label. Both are drawn with the
 * overshoot and the uneven pressure of a pen going over a photocopy — the
 * hand-drawn register brief §2.3 assigns Zine — rather than as tidy
 * geometry, which would read as an icon instead of a mark.
 *
 * These three were drawn for this repository rather than shipped as motif
 * assets, because a pen mark is not one of the four motif slots.
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
  squiggle: (
    <svg
      viewBox="0 0 120 8"
      preserveAspectRatio="none"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      focusable="false"
    >
      <path
        d="M2,5.6 C14,2 26,7.6 38,4.4 C50,1.4 62,7.4 74,4.2 C86,1.4 99,7 118,3.2"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  ),
  circle: (
    <svg
      viewBox="0 0 120 40"
      preserveAspectRatio="none"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      focusable="false"
    >
      {/* One stroke that goes round and overshoots where it started, the
          way a pen does when someone rings a word without lifting it. */}
      <path
        d="M97,8 C78,2 40,1 20,7 C5,11.5 3,23 13,30 C25,38 63,39 87,34.5 C105,31 115,23.5 110,14.5 C107,9.5 99,6 90,4.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  ),
};

/**
 * Mark → the class that sizes and places it.
 *
 * Written out rather than built from the mark name: Tailwind tree-shakes
 * anything in `@layer components` whose class name it cannot find as a
 * literal string in the source it scans, and a class assembled from a
 * template literal is not one.
 */
const MARK_CLASS = Object.freeze({
  pencil: 'marginalia--pencil',
  squiggle: 'marginalia--squiggle',
  circle: 'marginalia--circle',
});

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
      className={['marginalia', MARK_CLASS[mark], className].filter(Boolean).join(' ')}
    >
      {drawing}
    </span>
  );
}
