// Move the window, without animating (M7 issue 6).
//
// Both callers — the route reset beside the router and the back-to-top
// control in the shell — are wayfinding, which is instant for everybody
// (docs/interface-guidelines.md, Animation). `behavior: 'instant'` is the
// value that refuses a smooth scroll OUTRIGHT rather than deferring to
// whatever CSS `scroll-behavior` is in force, so there is no motion for
// `prefers-reduced-motion` to have to switch off.
//
// EVERY CALL IS GUARDED, twice over and for two different reasons:
//
//   • 'instant' is newer than the browsers the build still targets. An
//     engine that does not know the enum value rejects the whole call, and
//     an exception thrown from an effect would take the page down over a
//     scroll position. Those engines have no smooth scroll to refuse, so
//     the older form is already instant there.
//   • jsdom implements neither scrollTo nor scrollIntoView, and a host with
//     no scroller at all has nothing to move.

/** Scroll the window to the top. Safe to call on a host with no scroller. */
export function scrollToTop() {
  if (typeof window === 'undefined' || typeof window.scrollTo !== 'function') return;
  try {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  } catch {
    window.scrollTo(0, 0);
  }
}

/**
 * Scroll an element to the top of the viewport.
 *
 * `block: 'start'` puts the element's own top edge at the top of the
 * viewport, which the base stylesheet's `[id] { scroll-margin-top: 5rem }`
 * then offsets so an anchored heading clears the header rather than sitting
 * under it — the same allowance every in-page fragment on this site gets.
 *
 * @param {Element|null|undefined} element
 */
export function scrollToElement(element) {
  if (!element || typeof element.scrollIntoView !== 'function') return;
  try {
    element.scrollIntoView({ behavior: 'instant', block: 'start' });
  } catch {
    // The boolean form is the pre-options signature: true means "align to
    // the top", and it never animates.
    element.scrollIntoView(true);
  }
}

/**
 * The attribute that says "focus was put here by a control, draw the ring".
 *
 * `:focus-visible` is a heuristic about how the reader is working, and a
 * reader who pressed a button with a pointer fails it — so the one person
 * who just asked to be moved would be moved with nothing on screen saying
 * where to. A bare `:focus` rule is not the answer either: the elements
 * worth landing on are landmarks carrying `tabindex="-1"`, and those take
 * focus from a click ANYWHERE inside them, so `:focus` would outline the
 * whole header the moment a reader clicked the nameplate. The ring is keyed
 * to this attribute instead, which only {@link focusAsDestination} sets and
 * which clears itself on blur — see the rule in index.css.
 */
export const FOCUS_RING_ATTRIBUTE = 'data-focus-ring';

/**
 * Move focus to an element a control is sending the reader to, and mark it
 * so the ring is drawn however the reader got there.
 *
 * `tabindex="-1"` is set when the element does not already carry one: it is
 * what lets a landmark accept focus at all, and it keeps the element out of
 * the tab order, so leaving it in place changes nothing a reader observes.
 *
 * preventScroll, because the caller has already put the element where it
 * belongs and letting focus scroll again would undo that.
 *
 * @param {HTMLElement|null|undefined} element
 * @returns {boolean} whether focus was moved
 */
export function focusAsDestination(element) {
  if (!element || typeof element.focus !== 'function') return false;
  if (!element.hasAttribute('tabindex')) element.setAttribute('tabindex', '-1');
  element.setAttribute(FOCUS_RING_ATTRIBUTE, '');
  element.addEventListener(
    'blur',
    () => element.removeAttribute(FOCUS_RING_ATTRIBUTE),
    { once: true },
  );
  element.focus({ preventScroll: true });
  return true;
}
