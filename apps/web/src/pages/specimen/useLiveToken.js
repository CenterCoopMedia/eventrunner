// Read a live value from the document, and read it again when the look
// changes.
//
// The book measures live values: the family each type role resolves to, and
// the contrast each colour token holds against the ground right now. Those
// values move when the demo banner changes the site style or the display
// mode, and nothing in React's tree re-renders when they do — the provider
// writes an attribute on the document element and replaces the runtime
// style block, both outside the tree.
//
// So watch the document element's attributes and the runtime style block,
// and read again on every change.
import { useEffect, useState } from 'react';
import { measureContrast, readToken } from './tokens.js';

const RUNTIME_STYLE_ID = 'event-theme-runtime';

/**
 * One value, read from the document and kept current.
 *
 * `compute` must be a module-level function, so the effect below runs on a
 * change of look rather than on every render.
 *
 * @template T
 * @param {(name: string) => T} compute
 * @param {string} name the token name to read
 * @returns {T | null}
 */
export function useLiveValue(compute, name) {
  const [value, setValue] = useState(null);

  useEffect(() => {
    const apply = () => setValue(compute(name));
    apply();
    if (typeof MutationObserver !== 'function') return undefined;
    const observer = new MutationObserver(apply);
    observer.observe(document.documentElement, { attributes: true });
    const runtime = document.getElementById(RUNTIME_STYLE_ID);
    if (runtime) {
      observer.observe(runtime, { childList: true, characterData: true, subtree: true });
    }
    return () => observer.disconnect();
  }, [compute, name]);

  return value;
}

/** One custom property's resolved value. */
export function useLiveToken(name) {
  return useLiveValue(readToken, name);
}

/** One colour token's measured contrast against the page ground. */
export function useLiveContrast(name) {
  return useLiveValue(measureContrast, name);
}

export default useLiveValue;
