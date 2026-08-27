// The one shape a session control takes.
//
// A schedule row used to end in a shelf of bordered rectangles: a bookmark,
// a materials count, five reaction chips, and three separate calendar
// buttons, each drawn as a box. Six or eight boxes under every row is a
// second grid competing with the programme itself, and none of the boxes
// was the thing the reader came for.
//
// So a row control is now TEXT in the data face — the same weight the
// speaker names and the room already carry — and the reader's eye keeps
// running down the time column instead of stopping at a fence. Nothing on
// the row is boxed.
//
// `chipActionClass` is the boxed form, and it survives in exactly one
// place: the reaction group on a session's DETAIL page, where a set of
// small pressed/unpressed targets needs a visible edge to be legible as a
// set. It never appears on a row.
export const rowActionClass =
  'touch-target inline-flex items-center gap-2xs font-data text-caption text-text-secondary underline-offset-2 hover:text-text-primary hover:underline';

export const chipActionClass =
  'touch-target inline-flex items-center gap-2xs rounded-brand border-hairline border-rule-hairline px-sm py-2xs font-data text-caption text-text-primary transition-colors duration-fast ease-motion hover:bg-brand-surface-alt disabled:cursor-not-allowed disabled:opacity-50';
