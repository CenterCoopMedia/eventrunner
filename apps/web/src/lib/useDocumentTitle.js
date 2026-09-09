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
import { SYSTEM_PAGE_ROUTES, isCanonicalPagePath, systemPageIdForPath } from 'shared/routing';

// TWO LAYERS, AND THE MORE SPECIFIC ONE WINS.
//
// `claimed` is a page naming ITSELF — a session, a speaker, a content page.
// It is the only one that knows what record it is showing.
//
// `derived` is the answer for every other route, resolved centrally from
// the page documents (RouteTitle.jsx). The listing routes — /schedule,
// /speakers, /sponsors, /updates, /attendees — render their own components
// and have no record to name, so without this layer a direct load would
// show the server's title and then drop to the bare event name the moment
// the app booted. That is exactly the flicker the server-set title exists
// to avoid.
let claimedPart = null;
let derivedPart = null;
const subscribers = new Set();

/** The part in force: what a page claimed, else what the route derives. */
export function getRouteTitlePart() {
  return claimedPart ?? derivedPart;
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

/** A part, normalized: trimmed, and blank means none. */
function normalize(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function publish(previous) {
  const next = getRouteTitlePart();
  if (next === previous) return next;
  subscribers.forEach((listener) => listener(next));
  return next;
}

function setClaimedPart(value) {
  const before = getRouteTitlePart();
  claimedPart = normalize(value);
  publish(before);
  return claimedPart;
}

function setDerivedPart(value) {
  const before = getRouteTitlePart();
  derivedPart = normalize(value);
  publish(before);
  return derivedPart;
}

/** Test hook: forget both parts and every listener between tests. */
export function resetRouteTitleForTest() {
  claimedPart = null;
  derivedPart = null;
  subscribers.clear();
}

/**
 * Name the current route from the page showing the record — a session, a
 * speaker, a content page. The part is cleared on unmount, so a page that
 * has nothing to add, or one whose record does not resolve, falls back to
 * whatever the route derives rather than keeping the previous page's name.
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
    const applied = setClaimedPart(part);
    return () => {
      if (claimedPart === applied) setClaimedPart(null);
    };
  }, [part]);
}

/**
 * The part a route derives from the page documents alone, with no record
 * of its own to name.
 *
 * It answers the same question the server answers for the same URL
 * (functions/src/public/og.cjs `resolveRouteSubject`) and by the same
 * rules, so the tab does not change when the app boots: a SYSTEM page is
 * found by its stable id through the shared route map, never by its stored
 * path, and a generic page is found by its path. A route whose feature is
 * off, or whose page is hidden, names nothing — the same routes the server
 * leaves at the bare event name.
 *
 * @param {{ pathname: string, pages?: Array<object>|null, features?: object|null }} args
 * @returns {string|null}
 */
export function routeTitlePartFor({ pathname, pages, features }) {
  const path = typeof pathname === 'string' && pathname.length > 1
    ? pathname.replace(/\/+$/, '')
    : '/';
  const all = Array.isArray(pages) ? pages : [];
  const visible = (page) => page && page.visible !== false;

  // The home page names nothing, exactly as the server titles '/' with the
  // event name alone: "Home page" names the document for an editor, not
  // the site for a reader.
  if (path === '/') return null;

  const systemId = systemPageIdForPath(path);
  if (systemId) {
    const gate = SYSTEM_PAGE_ROUTES[systemId].feature;
    if (gate !== null && !features?.[gate]) return null;
    const page = all.find((candidate) => candidate?.id === systemId && candidate?.systemPage === true);
    return visible(page) ? normalize(page.label) : null;
  }

  if (!isCanonicalPagePath(path)) return null;
  const page = all.find((candidate) => candidate?.path === path && candidate?.systemPage !== true);
  return visible(page) ? normalize(page.label) : null;
}

/**
 * Publish the derived part for the current route. One caller — the
 * component that sits inside the content provider and watches the location
 * (apps/web/src/components/RouteTitle.jsx).
 *
 * @param {string|null} part
 */
export function useDerivedDocumentTitle(part) {
  useEffect(() => {
    setDerivedPart(part);
    return () => setDerivedPart(null);
  }, [part]);
}
