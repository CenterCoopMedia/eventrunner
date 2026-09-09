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
 * config/features, config/theme, cmsPages, cmsSchedule, speakers_public,
 * and cmsUpdates documents.
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
 * System page ids whose own React route tree owns further paths under it
 * (apps/web/src/App.jsx): `/schedule/:sessionId` and `/schedule/mine`,
 * `/speakers/:slug`, `/attendees/:uid`, `/updates/:id`. When one of these
 * pages is excluded, robots.txt has to disallow the whole subtree — an
 * exact-path rule for `/schedule` alone would leave every session detail
 * page reachable. `sponsors` and `home` carry no such subtree today.
 */
const SYSTEM_PAGES_WITH_CHILDREN = new Set(['schedule', 'speakers', 'attendees', 'updates']);

/**
 * Routes that carry no `cmsPages` document at all, so `classifyPages` can
 * never see or gate them from Firestore alone — either the admin panel's
 * own route tree (apps/web/src/admin), or a signed-in-only or single-use
 * page under the public `Layout` route tree (apps/web/src/App.jsx) whose
 * component itself checks `useAuth()` before rendering (Login.jsx,
 * MySchedule.jsx, Profile.jsx, SpeakerAccept.jsx, SpeakerProfile.jsx,
 * TicketClaim.jsx). None of these has content worth a search result, and
 * `/speaker/accept` and `/ticket/claim` additionally carry a one-time
 * token in the query string that a search index must never retain.
 */
const STATIC_PRIVATE_ROUTES = Object.freeze([
  Object.freeze({ path: '/admin', access: 'admin', hasChildren: true }),
  Object.freeze({ path: '/signin', access: 'account', hasChildren: false }),
  Object.freeze({ path: '/profile', access: 'authenticated', hasChildren: false }),
  Object.freeze({ path: '/schedule/mine', access: 'authenticated', hasChildren: false }),
  Object.freeze({ path: '/speaker/profile', access: 'authenticated', hasChildren: false }),
  Object.freeze({ path: '/speaker/accept', access: 'token', hasChildren: false }),
  Object.freeze({ path: '/ticket/claim', access: 'token', hasChildren: false }),
]);

/**
 * The three-way access read for one page doc, applied on top of its own
 * `visible` field and feature gate.
 *
 * `attendees` is the one page in the seed whose route is authenticated by
 * default: Attendees.jsx shows a sign-in prompt instead of the directory to
 * a signed-out visitor whenever `config/features.publicAttendeeProfiles` is
 * off (the default — scripts/lib/answers.cjs `DEFAULT_ON_FEATURES` does not
 * include it), so the route stays authenticated-only until an operator
 * turns that flag on.
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
 *             visible: boolean, featureOn: boolean, publishable: boolean,
 *             hasChildren: boolean }}
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
    hasChildren: SYSTEM_PAGES_WITH_CHILDREN.has(id),
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
 *                                featureOn: boolean, hasChildren: boolean }> }}
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
        id: c.id, path: c.path, access: c.access, visible: c.visible,
        featureOn: c.featureOn, hasChildren: c.hasChildren,
      });
    }
  }
  for (const route of STATIC_PRIVATE_ROUTES) {
    excluded.push({
      id: null, path: route.path, access: route.access, visible: true,
      featureOn: true, hasChildren: route.hasChildren,
    });
  }
  return { public: publicRoutes, excluded };
}

/**
 * Published session detail routes (`/schedule/:sessionId`,
 * apps/web/src/pages/SessionDetail.jsx). Gated on `features.schedule`
 * alone — the detail route checks nothing about the `schedule` cmsPages
 * doc's own `visible` field, so neither does this. `visible` on the
 * session record itself is read STRICTLY `=== true`, the same rule as
 * every other cms* collection.
 *
 * @param {{ sessions: object[], features: object }} args
 * @returns {Array<{ id: string, path: string }>}
 */
function buildSessionRoutes({ sessions = [], features = {} }) {
  if (features.schedule !== true) return [];
  return sessions
    .filter((s) => s?.visible === true && typeof s?.id === 'string' && s.id)
    .map((s) => ({ id: s.id, path: `/schedule/${s.id}` }));
}

/**
 * Approved speaker detail routes (`/speakers/:slug`,
 * apps/web/src/pages/SpeakerDetail.jsx). Gated on `features.speakers`
 * alone. No `status` filter is needed beyond that: `speakers_public` is a
 * one-way projection that exists ONLY for a speaker whose `status` is
 * `approved` (functions/src/speakers/projection.cjs) — a draft, invited,
 * accepted-but-unapproved, or removed speaker has no document there at
 * all, so the caller supplying that collection is what does the filtering.
 *
 * @param {{ speakers: object[], features: object }} args
 * @returns {Array<{ id: string, path: string }>}
 */
function buildSpeakerRoutes({ speakers = [], features = {} }) {
  if (features.speakers !== true) return [];
  return speakers
    .filter((s) => typeof s?.slug === 'string' && s.slug)
    .map((s) => ({ id: s.slug, path: `/speakers/${s.slug}` }));
}

/**
 * Published update routes (`/updates/:id`,
 * apps/web/src/pages/UpdateDetail.jsx). Gated on `features.updates` alone,
 * same as the `updates` list page. `visible` read STRICTLY `=== true`,
 * the same rule `updatesMeta` applies (functions/src/public/og.cjs).
 *
 * @param {{ updates: object[], features: object }} args
 * @returns {Array<{ id: string, path: string }>}
 */
function buildUpdateRoutes({ updates = [], features = {} }) {
  if (features.updates !== true) return [];
  return updates
    .filter((u) => u?.visible === true && typeof u?.id === 'string' && u.id)
    .map((u) => ({ id: u.id, path: `/updates/${u.id}` }));
}

/**
 * Every route the sitemap may list: the public `cmsPages` routes plus the
 * three detail-record kinds.
 *
 * @param {{ pages: object[], features: object, sessions: object[],
 *           speakers: object[], updates: object[] }} args
 * @returns {Array<{ id: string, path: string }>}
 */
function collectPublicRoutes({ pages, features, sessions, speakers, updates }) {
  const { public: pageRoutes } = classifyPages({ pages, features });
  return [
    ...pageRoutes,
    ...buildSessionRoutes({ sessions, features }),
    ...buildSpeakerRoutes({ speakers, features }),
    ...buildUpdateRoutes({ updates, features }),
  ];
}

/** Strip a trailing slash so `${base}${path}` never doubles one. */
function normalizedBaseUrl(publicUrl) {
  return typeof publicUrl === 'string' ? publicUrl.replace(/\/+$/, '') : '';
}

/**
 * Percent-encode a route path one segment at a time, so a session id,
 * speaker slug, or update id containing a space, `&`, or a non-ASCII
 * character produces a valid URL instead of a broken or double-escaped
 * one. The leading/trailing empty segments around each `/` are left as
 * `/` — only segment CONTENT is encoded, never the separator.
 *
 * @param {string} routePath
 * @returns {string}
 */
function encodeRoutePath(routePath) {
  if (typeof routePath !== 'string') return '';
  return routePath.split('/').map((segment) => (segment === '' ? '' : encodeURIComponent(segment))).join('/');
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
 * @param {{ publicUrl: string, pages: object[], features: object,
 *           sessions?: object[], speakers?: object[], updates?: object[] }} args
 * @returns {string} sitemap.xml content
 */
function buildSitemapXml({
  publicUrl, pages, features, sessions = [], speakers = [], updates = [],
}) {
  const base = normalizedBaseUrl(publicUrl);
  const publicRoutes = collectPublicRoutes({
    pages, features, sessions, speakers, updates,
  });
  const sorted = [...publicRoutes].sort((a, b) => a.path.localeCompare(b.path));
  const urls = sorted.map((route) => {
    const encoded = encodeRoutePath(route.path);
    const loc = route.path === '/' ? `${base}/` : `${base}${encoded}`;
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
 *
 * Every disallow rule is `$`-anchored to the excluded route's exact path —
 * a bare `Disallow: /travel` also blocks `/travel-guide`, since robots.txt
 * matching is a plain prefix test with no implied path boundary, and a
 * bare `Disallow: /` for a hidden HOME page would disallow the entire
 * site (every path starts with `/`). `Disallow: /$` matches only the
 * exact root and nothing else. A route whose own subtree carries further
 * pages (`hasChildren`, e.g. `/schedule/:sessionId` under `/schedule`)
 * gets a second `/path/*` rule so an excluded parent still shields the
 * detail pages under it.
 */
function buildRobotsTxt({ publicUrl, pages, features }) {
  const base = normalizedBaseUrl(publicUrl);
  const { excluded } = classifyPages({ pages, features });
  const disallowLines = new Set();
  for (const route of excluded) {
    disallowLines.add(`Disallow: ${route.path}$`);
    if (route.hasChildren) disallowLines.add(`Disallow: ${route.path}/*`);
  }
  const lines = ['User-agent: *', 'Allow: /', ...[...disallowLines].sort()];
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
 * This is also, field for field, the shape of the checked-in fallback at
 * `apps/web/public/manifest.webmanifest` (see its own test) — the neutral
 * placeholder Vite ships when a build never runs the publisher.
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
 * All three artifacts, from one read of the deployment's config, pages,
 * and published detail records.
 *
 * @param {{ event: object, features: object, theme: object,
 *           pages: object[], sessions?: object[], speakers?: object[],
 *           updates?: object[], publicUrl: string }} args
 * @returns {{ sitemapXml: string, robotsTxt: string, manifest: object }}
 */
function buildSiteArtifacts({
  event, features, theme, pages, sessions = [], speakers = [], updates = [], publicUrl,
}) {
  return {
    sitemapXml: buildSitemapXml({
      publicUrl, pages, features, sessions, speakers, updates,
    }),
    robotsTxt: buildRobotsTxt({ publicUrl, pages, features }),
    manifest: buildWebManifest({ event, theme }),
  };
}

module.exports = {
  SYSTEM_PAGE_FEATURE_GATES,
  SYSTEM_PAGES_WITH_CHILDREN,
  STATIC_PRIVATE_ROUTES,
  classifyPage,
  classifyPages,
  buildSessionRoutes,
  buildSpeakerRoutes,
  buildUpdateRoutes,
  collectPublicRoutes,
  buildSitemapXml,
  buildRobotsTxt,
  buildWebManifest,
  buildSiteArtifacts,
  internals: {
    escapeXml, normalizedBaseUrl, routeAccess, encodeRoutePath,
  },
};
