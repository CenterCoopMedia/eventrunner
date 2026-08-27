// Plate — the framed opener of a Field Guide page or section (design brief
// §4.5; visual story, Field Guide).
//
// "A framed drawing with a double rule at the frame and a plate number in
// the folio style. It opens a page or a section. It is never a hero image
// and never carries a photo." The frame is two hairlines, drawn as a border
// and an outline at the same token width, so the doubling costs no extra
// element and no extra property name.
//
// The device is TOKEN-DRIVEN, not theme-conditional: `--plate-frame-width`
// and `--plate-pad` are zero in every preset that is not a plate book, so
// this component is an inert wrapper there — no frame, no padding, no
// reflow. Field Guide sets both, and the same markup becomes the plate.
// That is why nothing here asks which theme is active.
//
// A plate holds drawn linework and words. It never holds a photograph: the
// moment a photo appears the register collapses into a wellness template
// (visual story, Field Guide, part 5).

/**
 * The plate number as a Roman numeral (visual story, Field Guide, moment 1).
 *
 * The number counts a real position in the programme — day three is PLATE
 * III — so it is sequence data, never ornament. That is what keeps it clear
 * of the banned decorative `01 / 02 / 03` pattern (brief §2.4), and it is
 * also why nothing here zero-pads.
 *
 * @param {number} position 1-based position
 * @returns {string|null} the numeral, or null when there is no real position
 */
export function romanNumeral(position) {
  if (!Number.isInteger(position) || position < 1 || position > 3999) return null;
  const table = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
    [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
    [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let left = position;
  let out = '';
  for (const [value, numeral] of table) {
    while (left >= value) {
      out += numeral;
      left -= value;
    }
  }
  return out;
}

/**
 * The plate number, for a folio at a section boundary.
 *
 * It renders as real text in the document, and `--plate-number-display`
 * decides whether it is set at all. Every preset but Field Guide holds
 * `none`, which keeps it out of the page AND out of the accessibility tree
 * — a screen reader announces a plate number only where the page is a plate
 * book. The separator travels with it, so nothing is left dangling.
 *
 * @param {{ position: number }} props
 */
export function PlateNumber({ position }) {
  const numeral = romanNumeral(position);
  if (!numeral) return null;
  return <span className="plate-number">Plate {numeral} · </span>;
}

/**
 * @param {{ children: import('react').ReactNode, className?: string }} props
 */
export default function Plate({ children, className = '' }) {
  return <div className={['plate', className].filter(Boolean).join(' ')}>{children}</div>;
}
