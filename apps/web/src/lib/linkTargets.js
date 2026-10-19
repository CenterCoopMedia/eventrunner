// Links that lead to a section the operator has switched off.
//
// A system route checks its own feature flag and, with the flag off, says
// "This event doesn't have a public schedule". The navigation never offers
// such a route (lib/siteNavigation.js), but a cta or link_group block is
// free text: the launch rehearsal saved "Explore the program → /schedule"
// with the schedule off, and the home page drew it as the lead's second
// action. A reader who pressed it reached a dead end.
//
// So the public site does not draw a cta or link_group block whose target
// is a system page with its feature off, and the block editor warns when an
// operator types one. Both read the same question from here, and both
// answer it from the shared route map (shared/routing SYSTEM_PAGE_ROUTES),
// the one place that says which feature each system route checks.
//
// The block stays stored and published. Switching the feature on draws the
// link again with no edit.
//
// A link to a generic page is the same question asked of `visible`. A fresh
// site seeds Recap, Guidelines and City guide hidden (scripts/lib/seed.cjs),
// and the catch-all route answers a hidden page, or an address no page has,
// with the 404 page (ContentPage.jsx). So a cta or link_group whose target
// is a page address that no public page holds is not drawn either. An app
// route (its first segment is reserved: /tickets, /pitch) and a file (its
// address is not a page address: /files/kit.pdf) are never this question.
import {
  SYSTEM_PAGE_ROUTES,
  firstPathSegment,
  isCanonicalPagePath,
  isReservedPathSegment,
  systemPageIdForPath,
} from 'shared/routing';
import { isPublicPage } from 'shared/page';

/** The block types whose `url` is a link a reader follows. */
const LINK_BLOCK_TYPES = new Set(['cta', 'link_group']);

/**
 * The `config/features` key that is off and that `url` needs, or null.
 *
 * Only an in-site path can lead to a system route. A link off the site, a
 * protocol-relative URL, and mailto: are never this question. A query or a
 * fragment does not change the route, so it is set aside first.
 *
 * Unknown flags (null or undefined) keep the link: the public site always
 * has a flag set, from the build snapshot or the live document, so this
 * case is a test or a surface that has not loaded them.
 *
 * @param {unknown} url
 * @param {Record<string, boolean>|null|undefined} features
 * @returns {string|null}
 */
export function switchedOffSectionFor(url, features) {
  if (!features) return null;
  const path = inSitePath(url);
  if (path === null) return null;
  const id = systemPageIdForPath(path);
  if (!id) return null;
  const gate = SYSTEM_PAGE_ROUTES[id].feature;
  if (gate === null || features[gate]) return null;
  return gate;
}

/**
 * The route path an in-site link leads to, with its query, fragment and
 * trailing slash set aside, or null for a link off the site.
 *
 * @param {unknown} url
 * @returns {string|null}
 */
function inSitePath(url) {
  if (typeof url !== 'string') return null;
  if (!url.startsWith('/') || url.startsWith('//')) return null;
  return url.split(/[?#]/, 1)[0].replace(/\/+$/, '') || '/';
}

/**
 * Whether `url` is a page address that no public page holds, so the
 * catch-all route answers it with the 404 page.
 *
 * `pages` is the list to look in: the public site's page documents, or
 * null while they are not known, which keeps the link. Each is tested with
 * the same predicate the route applies (shared/page isPublicPage).
 *
 * @param {unknown} url
 * @param {Array<object>|null|undefined} pages
 * @param {Record<string, boolean>|null|undefined} features
 * @returns {boolean}
 */
export function leadsToNoPublicPage(url, pages, features) {
  if (!Array.isArray(pages)) return false;
  const path = inSitePath(url);
  if (path === null || path === '/' || !isCanonicalPagePath(path)) return false;
  if (systemPageIdForPath(path) || isReservedPathSegment(firstPathSegment(path))) return false;
  return !pages.some((page) => page?.path === path && isPublicPage(page, features));
}

/**
 * The blocks a reader can use: every block except a cta or link_group that
 * leads to a section that is off, or to a page address no public page
 * holds. Callers filter before they decide whether a section has anything
 * to draw, so a section left with no block draws no heading either.
 *
 * @param {Array<object>|null|undefined} blocks
 * @param {Record<string, boolean>|null|undefined} features
 * @param {Array<object>|null|undefined} [pages] the public page documents;
 *   omitted, no link is dropped for its page
 * @returns {Array<object>}
 */
export function withoutSwitchedOffLinks(blocks, features, pages) {
  return (blocks ?? []).filter(
    (block) => !LINK_BLOCK_TYPES.has(block?.blockType)
      || (!switchedOffSectionFor(block.url, features) && !leadsToNoPublicPage(block.url, pages, features)),
  );
}
