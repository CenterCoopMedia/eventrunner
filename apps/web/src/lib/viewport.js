// One media query, read from React (design brief §2.1 "Grid schedule").
//
// The schedule grid renders at wide viewports and the time-ordered list
// renders everywhere else. Both could be in the document at once with CSS
// hiding one, but a hidden copy is still a copy: a screen reader would meet
// every session twice, and "the list is the accessible baseline, not a
// fallback of lower quality" would stop being true the moment it was said.
// So the switch happens in the document, not in the stylesheet, and exactly
// one of the two exists at a time.
//
// THE LIST IS THE DEFAULT ANSWER. `matches` starts false and stays false
// wherever `matchMedia` is missing, so a viewport that cannot be measured
// gets the list. That is the same "no preference is the safe answer" rule
// `prefersDark` follows in lib/modeRuntime.js.
import { useEffect, useState } from 'react';

/** Tailwind's `lg` breakpoint, which is where the grid has room to be one. */
export const WIDE_VIEWPORT = '(min-width: 64rem)';

/**
 * Whether a media query matches, kept in step with the browser.
 *
 * @param {string} query a CSS media query
 * @param {{ matchMedia?: Function }} [view] injectable for tests
 * @returns {boolean}
 */
export function useMediaQuery(query, view = typeof window === 'undefined' ? undefined : window) {
  // Read once before the first paint, so a wide viewport draws the grid
  // rather than drawing the list and swapping it a frame later. The answer
  // is still `false` wherever the question cannot be asked.
  const [matches, setMatches] = useState(() => {
    if (!view || typeof view.matchMedia !== 'function') return false;
    try {
      return view.matchMedia(query).matches === true;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (!view || typeof view.matchMedia !== 'function') return undefined;
    let media;
    try {
      media = view.matchMedia(query);
    } catch {
      // An unsupported query string throws in some engines. Answer no.
      return undefined;
    }
    setMatches(media.matches === true);
    const onChange = (event) => setMatches(event.matches === true);
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    }
    // Safari before 14 carries only the deprecated pair.
    media.addListener?.(onChange);
    return () => media.removeListener?.(onChange);
  }, [query, view]);

  return matches;
}
