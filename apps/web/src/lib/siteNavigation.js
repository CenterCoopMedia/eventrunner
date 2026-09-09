// The site navigation, built from page documents (spec §5.2).
//
// The navigation used to be a fixed list in the shell, so the six seeded
// content pages — travel, FAQ, conduct, contact, privacy, terms — existed,
// rendered, and were reachable only by typing their URL. Every cmsPages doc
// already carries what a nav item needs (`label`, `order`, `visible`), so
// the list is data now: an operator who adds a page gets a link, and one who
// hides a page loses it, with no code change either way.
//
// A SYSTEM PAGE IS ADDRESSED BY IDENTITY, NOT BY ITS PATH.
//
// The two kinds of page answer "where does this live" in opposite
// directions. A generic page IS its path: the catch-all route resolves the
// URL against the stored `path`, so the document decides where it is served.
// A system page is not — the route it renders through is declared in
// App.jsx, and the document only describes it. Its `path` is therefore a
// copy of a fact that lives in code, and a copy can drift: the server now
// refuses to move it (functions/src/cms/pages.cjs) and the editor renders
// the field read-only, but documents written before either guard existed,
// and documents written straight into Firestore, can still carry a path no
// route mounts. So system pages are looked up HERE by their stable `id` and
// linked to the route SYSTEM_PAGES names, with only the label taken from
// the document. A renamed system page renames its link; a system page whose
// path was edited still points at the schedule.
//
// TWO GATES, NOT ONE. `visible` is the editor's answer and it covers every
// page. A system page is additionally gated on the feature flag that its
// route already checks for itself: the seed ships every system page
// `visible: true` while `features.updates` is off by default, so visibility
// alone would offer a link to a route that renders "not available".
//
// The builder is forgiving in the way every reader in this app is forgiving:
// it meets whatever is stored, including documents written before the path
// rules landed and documents hand-edited straight in Firestore. Anything it
// cannot turn into a working link — an unknown system id, a generic page on
// a reserved segment, a path that is not a path at all — is dropped rather
// than rendered as a link to a 404 or, worse, off the site.
import {
  SYSTEM_PAGE_ROUTES,
  firstPathSegment,
  isCanonicalPagePath,
  isReservedPathSegment,
} from 'shared/routing';

/**
 * The system pages, by the stable document id the seed writes, and for each
 * one: the route App.jsx mounts, the feature flag that route checks, and
 * whether the route owns children.
 *
 * The map itself lives in the shared package, because the sitemap builders
 * (scripts/lib/site-manifest.cjs) and the server-rendered per-route
 * metadata (functions/src/public/og.cjs) have to answer the same question
 * in two other runtimes, and three copies would be three answers. This name
 * is the navigation's own way of saying it.
 */
export const SYSTEM_PAGES = SYSTEM_PAGE_ROUTES;

/** @param {unknown} v @returns {boolean} */
function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * The nav item a page document becomes, or null when it cannot become one.
 *
 * @param {unknown} page a cmsPages document
 * @param {object|null|undefined} features config/features
 * @returns {{ to: string, label: string, end: boolean }|null}
 */
function navItemFor(page, features) {
  if (!page || typeof page !== 'object') return null;
  // `visible !== false` rather than `visible === true`: a document written
  // before the field existed is visible, which is what getPage assumes too.
  if (page.visible === false) return null;
  if (!isNonEmptyString(page.label)) return null;

  if (page.systemPage === true) {
    // By id, not by path — see the note at the top of this file.
    const system = Object.prototype.hasOwnProperty.call(SYSTEM_PAGES, page.id)
      ? SYSTEM_PAGES[page.id]
      : null;
    // A systemPage doc with an id no route answers to has nothing to link
    // to. That is hand-written data, not something the editor can produce.
    if (!system) return null;
    if (system.feature !== null && !features?.[system.feature]) return null;
    return { to: system.to, label: page.label, end: !system.children };
  }

  // A generic page IS its stored path, so the path has to hold up on its
  // own. isCanonicalPagePath is the shape the validator writes, asked again
  // here because a renderer meets data the validator never saw: '/travel'
  // passes, '//example.org' and 'https://example.org' are not paths at all
  // and would take a reader off the site from inside the site's own nav.
  if (!isCanonicalPagePath(page.path) || page.path === '/') return null;
  // A generic page on a reserved segment is pre-#52 or hand-edited data:
  // ContentPage 404s it, so the navigation must not offer it.
  if (isReservedPathSegment(firstPathSegment(page.path))) return null;

  // `end: true`, always. A generic page owns no child routes, so prefix
  // matching would mark /about as current while the reader is on
  // /about/team — two items claiming aria-current at once, which is worse
  // than none: it tells a screen reader the reader is in two places.
  return { to: page.path, label: page.label, end: true };
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
    .map((page) => ({ order: page?.order, item: navItemFor(page, features) }))
    .filter((entry) => entry.item !== null)
    .sort(
      (a, b) =>
        (a.order ?? 0) - (b.order ?? 0) || a.item.label.localeCompare(b.item.label),
    )
    .map((entry) => entry.item)
    .filter((item) => {
      // Two documents can resolve to one route: a duplicate path written
      // straight into Firestore, or two docs claiming the same system id.
      // Render the first in reading order; a repeated link is noise a reader
      // has to resolve.
      if (seen.has(item.to)) return false;
      seen.add(item.to);
      return true;
    });
}
