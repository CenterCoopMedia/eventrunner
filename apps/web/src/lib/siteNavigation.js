// The site navigation, built from page documents (spec §5.2).
//
// The navigation used to be a fixed list in the shell, so the six seeded
// content pages — travel, FAQ, conduct, contact, privacy, terms — existed,
// rendered, and were reachable only by typing their URL. Every cmsPages doc
// already carries what a nav item needs (`label`, `path`, `order`,
// `visible`), so the list is data now: an operator who adds a page gets a
// link, and one who hides a page loses it, with no code change either way.
//
// TWO GATES, NOT ONE. `visible` is the editor's answer and it covers every
// page. A SYSTEM page — one with a dedicated React route — is additionally
// gated on the feature flag that route already checks for itself: the seed
// ships every system page `visible: true` while `features.updates` is off by
// default, so visibility alone would offer a link to a route that renders
// "not available". The feature map below is the same set of flags the routes
// check (apps/web/src/pages/Schedule.jsx and friends), keyed by the route
// each system page owns.
//
// The builder is forgiving in the way every reader in this app is forgiving:
// it meets whatever is stored, including documents written before the path
// rules landed and documents hand-edited straight in Firestore. Anything it
// cannot turn into a working link — a system page at a path no route mounts,
// a content page squatting a reserved segment, a page with no label — is
// dropped rather than rendered as a link to a 404.
import { firstPathSegment, isReservedPathSegment } from 'shared/routing';

/**
 * The routes system pages own, and the feature flag each one is gated on.
 *
 * `null` for the home page: the index route is always mounted and there is
 * no flag that turns the event's front door off.
 *
 * Keep in sync by hand with the static <Route path="..."> list in
 * apps/web/src/App.jsx and with the `systemPage: true` docs in
 * scripts/lib/seed.cjs. A system page whose stored path is not a key here
 * has no route to link to, so it is left out of the navigation entirely.
 */
export const SYSTEM_PAGE_FEATURES = Object.freeze({
  '/': null,
  '/schedule': 'schedule',
  '/speakers': 'speakers',
  '/sponsors': 'sponsors',
  '/attendees': 'attendeeDirectory',
  '/updates': 'updates',
});

/** @param {unknown} v @returns {boolean} */
function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * Whether this document can be offered as a link at all — the same rules the
 * renderers apply when they meet it at its own URL.
 *
 * @param {unknown} page a cmsPages document
 * @param {object} features config/features
 * @returns {boolean}
 */
function isNavigable(page, features) {
  if (!page || typeof page !== 'object') return false;
  // `visible !== false` rather than `visible === true`: a document written
  // before the field existed is visible, which is what getPage assumes too.
  if (page.visible === false) return false;
  if (!isNonEmptyString(page.label)) return false;
  if (!isNonEmptyString(page.path) || !page.path.startsWith('/')) return false;

  if (page.systemPage === true) {
    // Only the routes App.jsx actually mounts, and only while the feature
    // behind the route is on.
    if (!Object.prototype.hasOwnProperty.call(SYSTEM_PAGE_FEATURES, page.path)) return false;
    const feature = SYSTEM_PAGE_FEATURES[page.path];
    return feature === null || Boolean(features?.[feature]);
  }

  // A generic page at a reserved segment is pre-#52 or hand-edited data:
  // ContentPage 404s it, so the navigation must not offer it.
  return !isReservedPathSegment(firstPathSegment(page.path));
}

/**
 * The navigation, in reading order.
 *
 * Sorted by `order`, then by label so two pages that share a number (or
 * carry none) still land in a stable, human order rather than in whatever
 * order the listener happened to deliver them.
 *
 * @param {Array<object>|null|undefined} pages cmsPages documents
 * @param {object|null|undefined} features config/features
 * @returns {Array<{ to: string, label: string, end: boolean }>}
 */
export function buildNavItems(pages, features) {
  const seen = new Set();
  return (pages ?? [])
    .filter((page) => isNavigable(page, features))
    .sort(
      (a, b) =>
        (a.order ?? 0) - (b.order ?? 0) || String(a.label).localeCompare(String(b.label)),
    )
    .filter((page) => {
      // Two documents can claim one route (a duplicate written straight into
      // Firestore). Render the first in reading order; a repeated link is
      // noise a reader has to resolve.
      if (seen.has(page.path)) return false;
      seen.add(page.path);
      return true;
    })
    .map((page) => ({
      to: page.path,
      label: page.label,
      // `end` only for the home page: without it '/' matches every URL, and
      // with it '/schedule' would stop being current on '/schedule/:id'.
      end: page.path === '/',
    }));
}
