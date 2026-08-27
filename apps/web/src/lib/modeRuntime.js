// Light and dark mode at runtime (design brief §3.3).
//
// The generated stylesheet defines every color token twice: once under
// `:root[data-mode='light']` and once under `:root[data-mode='dark']`. This
// module owns the attribute that picks between them.
//
// `config/theme.mode` states the policy:
//
//   light   always light
//   dark    always dark
//   system  follow `prefers-color-scheme`, and follow it when it changes
//
// A document with no `mode` field predates the design system, so it renders
// light — exactly what it rendered before.
//
// Switching the mode swaps most colors on the page at once. Transitions are
// disabled for the length of the swap (interface guidelines, Animation), so
// the change reads as one instant repaint rather than as a wave of
// independent fades.
import { DEFAULT_MODE_POLICY, resolveMode } from 'shared/theme';

const SUPPRESS_STYLE_ID = 'event-mode-switch';
const DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * Ask the browser whether the reader prefers dark. Returns false where
 * `matchMedia` is missing (jsdom without a stub, an old browser), which is
 * the same answer as "no preference".
 *
 * @param {{ matchMedia?: Function }} [view]
 * @returns {boolean}
 */
export function prefersDark(view = typeof window === 'undefined' ? undefined : window) {
  if (!view || typeof view.matchMedia !== 'function') return false;
  try {
    return view.matchMedia(DARK_QUERY).matches === true;
  } catch {
    return false;
  }
}

/**
 * Turn transitions and animations off, run the swap, and turn them back on
 * one frame later.
 *
 * The style element is removed after a forced reflow so the browser has
 * already recomputed the new colors with transitions off. Without the
 * reflow the removal could be batched with the attribute change and the
 * suppression would do nothing.
 *
 * @param {Document} doc
 * @param {() => void} swap
 */
function withoutTransitions(doc, swap) {
  const style = doc.createElement('style');
  style.id = SUPPRESS_STYLE_ID;
  style.textContent =
    '*, *::before, *::after { transition: none !important; animation: none !important; }';
  doc.head.appendChild(style);

  swap();

  // Reading a layout property forces the style recalculation to happen now.
  void doc.documentElement.offsetHeight;

  const remove = () => style.remove();
  const view = doc.defaultView;
  if (view && typeof view.requestAnimationFrame === 'function') {
    view.requestAnimationFrame(() => view.requestAnimationFrame(remove));
  } else {
    remove();
  }
}

/**
 * Write one mode onto the document element.
 *
 * @param {'light'|'dark'} mode
 * @param {{ doc?: Document }} [options]
 */
export function applyMode(mode, { doc = typeof document === 'undefined' ? undefined : document } = {}) {
  if (!doc) return;
  const root = doc.documentElement;
  if (root.dataset.mode === mode) return;
  withoutTransitions(doc, () => {
    root.dataset.mode = mode;
    // `color-scheme` is what makes form controls, scrollbars, and the
    // canvas behind the page follow the mode. Without it a dark page keeps
    // white scrollbars and white select menus.
    root.style.colorScheme = mode;
  });
}

/**
 * Apply a mode policy and keep it applied.
 *
 * For `system` this subscribes to the media query and re-applies on every
 * change, so a reader who switches their operating system theme sees the
 * site follow without a reload.
 *
 * @param {unknown} policy config/theme.mode
 * @param {{ doc?: Document, view?: Window }} [options]
 * @returns {() => void} stop following
 */
export function startModeSync(policy, options = {}) {
  const doc = options.doc ?? (typeof document === 'undefined' ? undefined : document);
  const view = options.view ?? (typeof window === 'undefined' ? undefined : window);
  if (!doc) return () => {};

  const chosen = policy ?? DEFAULT_MODE_POLICY;
  applyMode(resolveMode(chosen, prefersDark(view)), { doc });

  if (chosen !== 'system' || !view || typeof view.matchMedia !== 'function') {
    return () => {};
  }

  let query;
  try {
    query = view.matchMedia(DARK_QUERY);
  } catch {
    return () => {};
  }
  const onChange = (event) => {
    applyMode(resolveMode('system', event.matches === true), { doc });
  };
  // addEventListener is the current API; addListener is the Safari 13 and
  // older spelling. Support both rather than dropping the follow silently.
  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }
  if (typeof query.addListener === 'function') {
    query.addListener(onChange);
    return () => query.removeListener(onChange);
  }
  return () => {};
}

export { SUPPRESS_STYLE_ID, DARK_QUERY };
