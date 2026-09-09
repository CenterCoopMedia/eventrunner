// The route's half of the document title (M7 issue 4).
//
// The server already puts the whole title in the HTML it serves
// (functions/src/public/og.cjs), which is what a crawler and a link
// unfurler read. This is the other half of that: once the app has booted,
// client-side navigation changes the URL without asking the server
// anything, so the tab has to be kept in step here — and the composed
// shape has to match what the server sent, or the title visibly changes
// on the first in-app navigation.
//
// Why a module-level value with subscribers rather than a context: the
// title is one string on one document, the page component knows the part
// and nothing else, and EventConfigContext knows the event name and owns
// the write. A context would make every page re-render to carry a value
// only one effect reads.

import { useEffect } from 'react';

let routeTitlePart = null;
const subscribers = new Set();

/** The part the current route contributes, or null. */
export function getRouteTitlePart() {
  return routeTitlePart;
}

/**
 * Watch the route part. Returns the unsubscribe function, so an effect can
 * return it directly.
 *
 * @param {(part: string|null) => void} listener
 * @returns {() => void}
 */
export function subscribeRouteTitle(listener) {
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
}

function setRouteTitlePart(value) {
  const next = typeof value === 'string' && value.trim() ? value.trim() : null;
  if (next === routeTitlePart) return next;
  routeTitlePart = next;
  subscribers.forEach((listener) => listener(routeTitlePart));
  return next;
}

/** Test hook: forget the part and every listener between tests. */
export function resetRouteTitleForTest() {
  routeTitlePart = null;
  subscribers.clear();
}

/**
 * Name the current route. The part is cleared on unmount, so a page that
 * has nothing to add — or a route that fails to resolve one — leaves the
 * event name standing alone rather than the previous page's name.
 *
 * An empty or absent part is the same as no part: a record still loading
 * must not write `undefined` into the tab.
 *
 * The cleanup clears only the part this effect set. If a route has already
 * named itself by the time the previous route unmounts, the departing page
 * must not wipe the arriving one's name.
 *
 * @param {string|null|undefined} part
 */
export function useDocumentTitle(part) {
  useEffect(() => {
    const applied = setRouteTitlePart(part);
    return () => {
      if (routeTitlePart === applied) setRouteTitlePart(null);
    };
  }, [part]);
}
