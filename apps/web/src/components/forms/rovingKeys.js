// Where an arrow key moves inside a set of controls that share one tab stop.
//
// A radio group and a tab list both use a roving tab index: the set holds
// ONE place in the tab order, and the arrow keys move inside it. That rule
// is the same for both, so it is written once, as a pure function, and both
// components read it.
//
// Wrapping is deliberate. In both patterns the set is a closed ring: the end
// leads back to the start, so a reader never has to know how long the set is
// to reach the item before the one they are on.
//
// Both axes move. A radio group answers all four arrows by specification,
// and a tab list here wraps to a second line at a narrow viewport, so a
// reader who reads it as rows and presses Down is asking for the next tab.

/** @type {Record<string, -1 | 1>} */
const STEP = {
  ArrowLeft: -1,
  ArrowUp: -1,
  ArrowRight: 1,
  ArrowDown: 1,
};

/**
 * The index an arrow, Home, or End key moves to.
 *
 * @param {string} key the KeyboardEvent key
 * @param {number} current the index the reader is on
 * @param {number} count how many controls are in the set
 * @returns {number|null} the new index, or null when the key does not move
 */
export function nextRovingIndex(key, current, count) {
  if (count <= 0) return null;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  const step = STEP[key];
  if (!step) return null;
  return (current + step + count) % count;
}
