'use strict';

/**
 * Publish-time site artifacts: sitemap.xml, robots.txt, and the web app
 * manifest (M7 issue 5, gap table "sitemap.xml, robots.txt, web manifest,
 * icon set").
 *
 * Visibility alone is the wrong test for what belongs in a sitemap. The
 * seed ships every system page `visible: true` (scripts/lib/seed.cjs), but
 * each system page's own React route still refuses to render when its
 * feature flag is off — Schedule.jsx checks `features.schedule`,
 * Speakers.jsx checks `features.speakers`, Sponsors.jsx checks
 * `features.sponsors`, Updates.jsx checks `features.updates` (off by
 * default) — and the attendee directory route (Attendees.jsx) additionally
 * refuses to render for a signed-out visitor whenever
 * `features.publicAttendeeProfiles` is off, which is also the default. A
 * generator that never runs React has to carry that same knowledge, in one
 * place, or it lists pages nobody can actually reach.
 *
 * This module is pure: no filesystem, no network, no Firestore. The caller
 * (scripts/publish-site.cjs) supplies the already-read config/event,
 * config/features, config/theme, and cmsPages documents.
 */

const { configuredThemeColor } = require('./shared-theme.cjs');

/**
 * A `cmsPages` system page id -> the `config/features` key its own route
 * checks before rendering. Mirrors the `if (!features.x)` guard already in
 * each page component; a system page absent from this map (home) has no
 * gate beyond `visible`.
 */
const SYSTEM_PAGE_FEATURE_GATES = Object.freeze({
  schedule: 'schedule',
  speakers: 'speakers',
  sponsors: 'sponsors',
  updates: 'updates',
  attendees: 'attendeeDirectory',
});

/**
 * Routes that carry no `cmsPages` document at all — the admin panel is its
 * own route tree (apps/web/src/admin), never a CMS document — but that a
 * crawler must never index or list all the same.
 */
const STATIC_PRIVATE_ROUTES = Object.freeze([
  Object.freeze({ path: '/admin', access: 'admin' }),
]);

/**
 * The three-way access read for one page doc, applied on top of its own
 * `visible` field and feature gate.
 *
 * `attendees` is the one page in the seed whose route is authenticated by
 * default: Attendees.jsx shows a sign-in prompt instead of the directory to
 * a signed-out visitor whenever `config/features.publicAttendeeProfiles` is
 * off (the default — packages/shared config/schema.cjs `DEFAULT_ON_FEATURES`
 * does not include it), so the route stays authenticated-only until an
 * operator turns that flag on.
 *
 * @param {{ id: string, features: object }} args
 * @returns {'public'|'authenticated'}
 */
function routeAccess({ id, features }) {
  if (id === 'attendees' && features.publicAttendeeProfiles !== true) return 'authenticated';
  return 'public';
}

/**
 * Classify one `cmsPages` document.
 *
 * `visible` is read STRICTLY `=== true`, not `!== false`: a doc with the
 * field merely absent (mid-write, before it is set) must not read as
 * published — the same rule `updatesMeta` applies for the same reason
 * (functions/src/public/og.cjs).
 *
 * @param {{ page: object, features: object }} args
 * @returns {{ id: string, path: string, access: 'public'|'authenticated',
 *             visible: boolean, featureOn: boolean, publishable: boolean }}
 */
function classifyPage({ page, features = {} }) {
  const id = page?.id;
  const routePath = page?.path;
  const gate = SYSTEM_PAGE_FEATURE_GATES[id];
  const featureOn = !gate || features[gate] === true;
  const access = routeAccess({ id, features });
  const visible = page?.visible === true;
  return {
    id,
    path: routePath,
    access,
    visible,
    featureOn,
    publishable: visible && featureOn && access === 'public',
  };
}

/**
 * Split every `cmsPages` document, plus the static private routes, into
 * the routes a sitemap may list and the routes a robots file must name as
 * disallowed.
 *
 * @param {{ pages: object[], features: object }} args
 * @returns {{ public: Array<{ id: string, path: string }>,
 *             excluded: Array<{ id: string|null, path: string,
 *                                access: string, visible: boolean,
 *                                featureOn: boolean }> }}
 */
function classifyPages({ pages = [], features = {} }) {
  const publicRoutes = [];
  const excluded = [];
  for (const page of pages) {
    const c = classifyPage({ page, features });
    if (!c.path) continue;
    if (c.publishable) publicRoutes.push({ id: c.id, path: c.path });
    else {
      excluded.push({
        id: c.id, path: c.path, access: c.access, visible: c.visible, featureOn: c.featureOn,
      });
    }
  }
  for (const route of STATIC_PRIVATE_ROUTES) {
    excluded.push({ id: null, path: route.path, access: route.access, visible: true, featureOn: true });
  }
  return { public: publicRoutes, excluded };
}

/** Strip a trailing slash so `${base}${path}` never doubles one. */
function normalizedBaseUrl(publicUrl) {
  return typeof publicUrl === 'string' ? publicUrl.replace(/\/+$/, '') : '';
}

/**
 * Escape a string for safe interpolation into XML text content. `&` first,
 * so escaping the other characters cannot introduce a second `&` that
 * later decodes wrong — the same order `functions/src/public/og.cjs` uses
 * for HTML.
 *
 * @param {*} value
 * @returns {string}
 */
function escapeXml(value) {
  const s = typeof value === 'string' ? value : '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * @param {{ publicUrl: string, pages: object[], features: object }} args
 * @returns {string} sitemap.xml content
 */
function buildSitemapXml({ publicUrl, pages, features }) {
  const base = normalizedBaseUrl(publicUrl);
  const { public: publicRoutes } = classifyPages({ pages, features });
  const sorted = [...publicRoutes].sort((a, b) => a.path.localeCompare(b.path));
  const urls = sorted.map((route) => {
    const loc = route.path === '/' ? `${base}/` : `${base}${route.path}`;
    return `  <url>\n    <loc>${escapeXml(loc)}</loc>\n  </url>`;
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n');
}

/**
 * @param {{ publicUrl: string, pages: object[], features: object }} args
 * @returns {string} robots.txt content
 */
function buildRobotsTxt({ publicUrl, pages, features }) {
  const base = normalizedBaseUrl(publicUrl);
  const { excluded } = classifyPages({ pages, features });
  const disallowPaths = [...new Set(excluded.map((route) => route.path))].sort();
  const lines = ['User-agent: *', 'Allow: /', ...disallowPaths.map((p) => `Disallow: ${p}`)];
  lines.push('', `Sitemap: ${base}/sitemap.xml`, '');
  return lines.join('\n');
}

/**
 * The web app manifest. Icons reuse the branding slots every deployment
 * ships — `apps/web/public/branding/mark.svg` and `favicon.svg`
 * (scripts/lib/branding.cjs) — never a client's uploaded Storage asset:
 * those slots are the one pair guaranteed to exist in `apps/web/dist` on
 * every deployment, customized or not.
 *
 * `theme_color`/`background_color` are included only when the event has
 * configured them (`config/theme.colors`, via `configuredThemeColor` —
 * packages/shared/src/theme.cjs, both stored spellings), so an
 * unconfigured deployment ships a manifest with no invented color.
 *
 * @param {{ event: object, theme: object }} args
 * @returns {object} the manifest, ready for `JSON.stringify`
 */
function buildWebManifest({ event = {}, theme = {} }) {
  const colors = theme?.colors;
  const themeColor = configuredThemeColor(colors, 'primary');
  const backgroundColor = configuredThemeColor(colors, 'surface');
  const name = typeof event?.name === 'string' && event.name.trim() ? event.name.trim() : 'Event site';
  const shortName = typeof event?.shortName === 'string' && event.shortName.trim()
    ? event.shortName.trim()
    : 'Event';
  const manifest = {
    name,
    short_name: shortName,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    icons: [
      { src: '/branding/mark.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/branding/favicon.svg', sizes: 'any', type: 'image/svg+xml' },
    ],
  };
  if (typeof event?.tagline === 'string' && event.tagline.trim()) {
    manifest.description = event.tagline.trim();
  }
  if (themeColor) manifest.theme_color = themeColor;
  if (backgroundColor) manifest.background_color = backgroundColor;
  return manifest;
}

/**
 * All three artifacts, from one read of the deployment's config and pages.
 *
 * @param {{ event: object, features: object, theme: object,
 *           pages: object[], publicUrl: string }} args
 * @returns {{ sitemapXml: string, robotsTxt: string, manifest: object }}
 */
function buildSiteArtifacts({ event, features, theme, pages, publicUrl }) {
  return {
    sitemapXml: buildSitemapXml({ publicUrl, pages, features }),
    robotsTxt: buildRobotsTxt({ publicUrl, pages, features }),
    manifest: buildWebManifest({ event, theme }),
  };
}

module.exports = {
  SYSTEM_PAGE_FEATURE_GATES,
  STATIC_PRIVATE_ROUTES,
  classifyPage,
  classifyPages,
  buildSitemapXml,
  buildRobotsTxt,
  buildWebManifest,
  buildSiteArtifacts,
  internals: { escapeXml, normalizedBaseUrl, routeAccess },
};
