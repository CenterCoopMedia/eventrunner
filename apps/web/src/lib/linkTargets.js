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
import { SYSTEM_PAGE_ROUTES, systemPageIdForPath } from 'shared/routing';

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
  if (!features || typeof url !== 'string') return null;
  if (!url.startsWith('/') || url.startsWith('//')) return null;
  const path = url.split(/[?#]/, 1)[0].replace(/\/+$/, '') || '/';
  const id = systemPageIdForPath(path);
  if (!id) return null;
  const gate = SYSTEM_PAGE_ROUTES[id].feature;
  if (gate === null || features[gate]) return null;
  return gate;
}

/**
 * The blocks a reader can use: every block except a cta or link_group that
 * leads to a section that is off. Callers filter before they decide whether
 * a section has anything to draw, so a section left with no block draws no
 * heading either.
 *
 * @param {Array<object>|null|undefined} blocks
 * @param {Record<string, boolean>|null|undefined} features
 * @returns {Array<object>}
 */
export function withoutSwitchedOffLinks(blocks, features) {
  return (blocks ?? []).filter(
    (block) => !LINK_BLOCK_TYPES.has(block?.blockType) || !switchedOffSectionFor(block.url, features),
  );
}
