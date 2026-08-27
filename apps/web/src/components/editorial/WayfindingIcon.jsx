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

/** The six signs, and the only six (public/icons/wayfinding/README.md). */
export const WAYFINDING_ICONS = Object.freeze([
  'venue',
  'room',
  'line',
  'transit',
  'walk',
  'step-free',
]);

/**
 * @param {{ name: string, className?: string }} props
 */
export default function WayfindingIcon({ name, className = '' }) {
  if (!WAYFINDING_ICONS.includes(name)) return null;
  return (
    <span
      aria-hidden="true"
      data-wayfinding-icon={name}
      className={['wayfinding-icon', `wayfinding-icon--${name}`, className]
        .filter(Boolean)
        .join(' ')}
    />
  );
}
