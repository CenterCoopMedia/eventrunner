// A CMS-authored `url` field (cta, link_group — BLOCK_TYPES in
// functions/src/cms/blockTypes.cjs) can point either at the site itself
// ('/schedule') or off it ('https://example.org'). Rendering the first kind
// as a plain <a> is a real bug, not just a missed optimization: the public
// click-through demo runs under HashRouter (apps/web/src/main.jsx, because
// GitHub Pages serves no rewrite rules), so a raw href="/schedule" reloads
// the static shell at "/eventrunner/demo/schedule" — a 404 — instead of
// navigating within the app the way a router <Link> does. A real client
// deployment (BrowserRouter, real rewrites) hides the bug; the demo is
// where it surfaces.
//
// `packages/shared/src/routing.cjs` does not carry an `isCanonicalPagePath`
// export on this branch, so this is the local check the block renderers
// use instead — deliberately the same shape `validatePageDoc`'s
// `PATH_SEGMENT_RE` accepts for a page's own `path` (functions/src/cms/
// pages.cjs): lowercase letters, digits, and hyphens per segment, no
// leading/trailing hyphen, no query string or fragment, no trailing slash.
// A CMS-authored value that does not match that shape — an external URL,
// a mailto:, a bare '#anchor', anything with '?' or '#' — is not "close
// enough"; it renders as a normal anchor, because a Link the router cannot
// resolve is worse than a plain link that works.
const PATH_SEGMENT_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * @param {unknown} value a block's `url` field
 * @returns {boolean} true when `value` is an in-app route path a router
 *   <Link> can navigate to directly (e.g. '/schedule', '/speakers/jane-doe')
 */
export function isCanonicalPagePath(value) {
  if (typeof value !== 'string') return false;
  if (value === '/') return true;
  if (!value.startsWith('/') || value.startsWith('//')) return false;
  if (value.endsWith('/')) return false;
  if (value.includes('?') || value.includes('#')) return false;
  const segments = value.slice(1).split('/');
  return segments.every((segment) => PATH_SEGMENT_RE.test(segment));
}
