// WayfindingIcon — the sign set (design brief §4.6; visual story, Atlas).
//
// These six drawings are ICONS, NOT MOTIFS. The line between the two is
// meaning, not shape (§3.8): a mark that names a specific venue, room, or
// line carries meaning, so it is an icon, it lives under
// `public/icons/wayfinding/`, and it never renders through the motif layer.
// `--motif-*` and `data-motif-set` do not reach it, and the three-per-page
// motif density rule does not apply to it — a sign set is not ornament.
//
// ALWAYS WITH A LABEL. "A route mark or wayfinding icon without a text label
// is a puzzle, not a sign" (visual story, Atlas, part 5). This component
// therefore renders the drawing `aria-hidden` and REQUIRES the caller to
// have put the word beside it: every call site here sits inside a line that
// already says what the icon names. Nothing signals status by colour alone,
// and the drawing inherits the ink of the text it sits beside.
//
// The asset is applied as a mask over `currentColor`, which is what lets one
// file serve both modes. An external <img> would carry its own colour and
// fail in dark mode; a url() fill would do the same.

/**
 * Sign → the class that carries its drawing.
 *
 * Written out rather than built from the name: Tailwind tree-shakes
 * anything in `@layer components` whose class name it cannot find as a
 * literal string in the source it scans, and a class assembled from a
 * template literal is not one. An icon whose mask was purged would paint as
 * a solid square of ink.
 */
const ICON_CLASS = Object.freeze({
  venue: 'wayfinding-icon--venue',
  room: 'wayfinding-icon--room',
  line: 'wayfinding-icon--line',
  transit: 'wayfinding-icon--transit',
  walk: 'wayfinding-icon--walk',
  'step-free': 'wayfinding-icon--step-free',
});

/** The six signs, and the only six (public/icons/wayfinding/README.md). */
export const WAYFINDING_ICONS = Object.freeze(Object.keys(ICON_CLASS));

/**
 * @param {{ name: string, className?: string }} props
 */
export default function WayfindingIcon({ name, className = '' }) {
  const iconClass = ICON_CLASS[name];
  if (!iconClass) return null;
  return (
    <span
      aria-hidden="true"
      data-wayfinding-icon={name}
      className={['wayfinding-icon', iconClass, className].filter(Boolean).join(' ')}
    />
  );
}
