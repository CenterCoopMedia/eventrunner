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
const { SYSTEM_PAGE_ROUTES } = require('shared/routing');
const { isPublicPage, pageFeatureGate } = require('shared/page');

/**
 * A `cmsPages` system page id -> the `config/features` key its own route
 * checks before rendering. Mirrors the `if (!features.x)` guard already in
 * each page component; a system page absent from this map (home) has no
 * gate beyond `visible`.
 *
 * Derived from the one system page map in the shared package rather than
 * restated here: the navigation and the server-rendered per-route metadata
 * read the same map, and a gate that disagreed with the route's own check
 * would put a page in the sitemap that renders "not available". Kept as an
 * exported map because the robots-file reporting names the gate that
 * excluded a route; `shared/page isPublicPage` is what actually applies it.
 */
const SYSTEM_PAGE_FEATURE_GATES = Object.freeze(
  Object.fromEntries(
    Object.entries(SYSTEM_PAGE_ROUTES)
      .filter(([, route]) => route.feature !== null)
      .map(([id, route]) => [id, route.feature]),
  ),
);

/**
 * System page ids whose own React route tree owns further paths under it
 * (apps/web/src/App.jsx): `/schedule/:sessionId` and `/schedule/mine`,
 * `/speakers/:slug`, `/attendees/:uid`, `/updates/:id`. When one of these
 * pages is excluded, robots.txt has to disallow the whole subtree — an
 * exact-path rule for `/schedule` alone would leave every session detail
 * page reachable. `sponsors` and `home` carry no such subtree today.
 *
 * Read off the same shared map, for the same reason as the gates above.
 */
const SYSTEM_PAGES_WITH_CHILDREN = new Set(
  Object.entries(SYSTEM_PAGE_ROUTES)
    .filter(([, route]) => route.children)
    .map(([id]) => id),
);

/**
 * Session ids App.jsx's static route tree already claims under `/schedule`.
 * `/schedule/mine` (the signed-in visitor's personal schedule,
 * MySchedule.jsx) is mounted as its own `<Route>`, ahead of the dynamic
 * `/schedule/:sessionId` route only in the sense that react-router matches
 * declaration order — a session whose id is `mine` does not merely collide
 * with a sitemap entry, it is unreachable as itself, because that path
 * always renders the personal schedule instead. The admin editor derives a
 * new session's id from its title (apps/web/src/admin/sessionDoc.js
 * `sessionIdFromTitle`), so a session titled "Mine" is the ordinary way an
 * operator would produce this id by accident — rejected at the source in
 * functions/src/schedule/sessions.cjs `validateSessionShape`, and filtered
 * here too as a second, independent guard against a document written before
 * that rule existed, or by anything else that writes `cmsSchedule` directly.
 */
const RESERVED_SESSION_IDS = new Set(['mine']);

/**
 * Routes that carry no `cmsPages` document at all, so `classifyPages` can
 * never see or gate them from Firestore alone — either the admin panel's
 * own route tree (apps/web/src/admin), or a signed-in-only or single-use
 * page under the public `Layout` route tree (apps/web/src/App.jsx) whose
 * component itself checks `useAuth()` before rendering (Login.jsx,
 * MySchedule.jsx, Profile.jsx, SpeakerAccept.jsx, SpeakerProfile.jsx,
 * TicketClaim.jsx). None of these has content worth a search result.
 *
 * `tokenBearing` marks the two whose real URL carries a one-time value in
 * the query string — `/speaker/accept?token=...`
 * (functions/src/speakers/inviteTokens.cjs) and, potentially, `/ticket/
 * claim` the same way. robots.txt matches the PATH AND QUERY of a request
 * URL against the rule as a plain prefix (Google's robots.txt extension,
 * which every crawler that matters implements) UNLESS the rule ends in
 * `$`, which anchors it to end exactly there — so an anchored
 * `/speaker/accept$` would refuse to match `/speaker/accept?token=…` at
 * all, defeating the very rule meant to keep that token out of a search
 * index. These two rules are therefore left unanchored on purpose; every
 * other static route here is a plain page with nothing after it, so the
 * anchor stays.
 */
const STATIC_PRIVATE_ROUTES = Object.freeze([
  Object.freeze({
    path: '/admin', access: 'admin', hasChildren: true, tokenBearing: false,
  }),
  Object.freeze({
    path: '/signin', access: 'account', hasChildren: false, tokenBearing: false,
  }),
  Object.freeze({
    path: '/profile', access: 'authenticated', hasChildren: false, tokenBearing: false,
  }),
  Object.freeze({
    path: '/schedule/mine', access: 'authenticated', hasChildren: false, tokenBearing: false,
  }),
  Object.freeze({
    path: '/speaker/profile', access: 'authenticated', hasChildren: false, tokenBearing: false,
  }),
  Object.freeze({
    path: '/speaker/accept', access: 'token', hasChildren: false, tokenBearing: true,
  }),
  Object.freeze({
    path: '/ticket/claim', access: 'token', hasChildren: false, tokenBearing: true,
  }),
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
 * Whether the page is public at all — visible, with its route's feature on
 * — is `shared/page isPublicPage`, the same read the header navigation and
 * the server-rendered route metadata make. A sitemap that listed a page the
 * navigation does not link, or that named a route the server describes as
 * missing, would be three copies of one rule disagreeing. `visible` and
 * `featureOn` are still reported separately here because robots.txt says
 * WHY each excluded route is excluded.
 *
 * `access` is this file's own extra question and stays here: a route that
 * renders a sign-in prompt to a signed-out visitor is still a page the
 * navigation links, but it is not a page to put in a sitemap.
 *
 * @param {{ page: object, features: object }} args
 * @returns {{ id: string, path: string, access: 'public'|'authenticated',
 *             visible: boolean, featureOn: boolean, publishable: boolean,
 *             hasChildren: boolean }}
 */
function classifyPage({ page, features = {} }) {
  const id = page?.id;
  const routePath = page?.path;
  const gate = pageFeatureGate(page);
  const featureOn = gate === null || features[gate] === true;
  const access = routeAccess({ id, features });
  const visible = page?.visible === true;
  return {
    id,
    path: routePath,
    access,
    visible,
    featureOn,
    publishable: isPublicPage(page, features) && access === 'public',
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
 *                                featureOn: boolean, hasChildren: boolean,
 *                                tokenBearing: boolean }> }}
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
        featureOn: c.featureOn, hasChildren: c.hasChildren, tokenBearing: false,
      });
    }
  }
  for (const route of STATIC_PRIVATE_ROUTES) {
    excluded.push({
      id: null, path: route.path, access: route.access, visible: true,
      featureOn: true, hasChildren: route.hasChildren, tokenBearing: route.tokenBearing,
    });
  }
  return { public: publicRoutes, excluded };
}

/**
 * Published session detail routes (`/schedule/:sessionId`,
 * apps/web/src/pages/SessionDetail.jsx).
 *
 * `parentPublic` — whether the `schedule` cmsPages page itself is
 * classified public — is the whole gate, not a feature-flag check of its
 * own: `classifyPage`'s `publishable` already requires `features.schedule`
 * to be on, so re-checking the flag here separately would only invite the
 * two checks to disagree. A page that is `visible: false` while its
 * feature is on is exactly the case this closes: the route is unreachable
 * from anywhere public, robots.txt disallows the whole `/schedule/*`
 * subtree (SYSTEM_PAGES_WITH_CHILDREN), and the sitemap must not
 * contradict that by listing session detail pages under it anyway.
 *
 * `visible` on the session record itself is read STRICTLY `=== true`, the
 * same rule as every other cms* collection. `mine` is refused outright: it
 * is the personal-schedule route, not a session id at all (see
 * RESERVED_SESSION_IDS) — filtered here as well as rejected at the source
 * in functions/src/schedule/sessions.cjs, because a document written
 * before that rule existed must not surface in a sitemap either.
 *
 * @param {{ sessions: object[], parentPublic: boolean }} args
 * @returns {Array<{ id: string, path: string }>}
 */
function buildSessionRoutes({ sessions = [], parentPublic }) {
  if (!parentPublic) return [];
  return sessions
    .filter((s) => (
      s?.visible === true && typeof s?.id === 'string' && s.id && !RESERVED_SESSION_IDS.has(s.id)
    ))
    .map((s) => ({ id: s.id, path: `/schedule/${s.id}` }));
}

/**
 * Approved speaker detail routes (`/speakers/:slug`,
 * apps/web/src/pages/SpeakerDetail.jsx). Gated on the `speakers` cmsPages
 * page being classified public — see `buildSessionRoutes` for why that
 * subsumes a bare feature-flag check. No `status` filter is needed beyond
 * that: `speakers_public` is a one-way projection that exists ONLY for a
 * speaker whose `status` is `approved`
 * (functions/src/speakers/projection.cjs) — a draft, invited,
 * accepted-but-unapproved, or removed speaker has no document there at
 * all, so the caller supplying that collection is what does the filtering.
 *
 * @param {{ speakers: object[], parentPublic: boolean }} args
 * @returns {Array<{ id: string, path: string }>}
 */
function buildSpeakerRoutes({ speakers = [], parentPublic }) {
  if (!parentPublic) return [];
  return speakers
    .filter((s) => typeof s?.slug === 'string' && s.slug)
    .map((s) => ({ id: s.slug, path: `/speakers/${s.slug}` }));
}

/**
 * Published update routes (`/updates/:id`,
 * apps/web/src/pages/UpdateDetail.jsx). Gated on the `updates` cmsPages
 * page being classified public — see `buildSessionRoutes` for why that
 * subsumes a bare feature-flag check. `visible` read STRICTLY `=== true`,
 * the same rule `updatesMeta` applies (functions/src/public/og.cjs).
 *
 * @param {{ updates: object[], parentPublic: boolean }} args
 * @returns {Array<{ id: string, path: string }>}
 */
function buildUpdateRoutes({ updates = [], parentPublic }) {
  if (!parentPublic) return [];
  return updates
    .filter((u) => u?.visible === true && typeof u?.id === 'string' && u.id)
    .map((u) => ({ id: u.id, path: `/updates/${u.id}` }));
}

/**
 * Every route the sitemap may list: the public `cmsPages` routes plus the
 * three detail-record kinds, each gated on its own parent page's
 * classification (see `buildSessionRoutes`).
 *
 * @param {{ pages: object[], features: object, sessions: object[],
 *           speakers: object[], updates: object[] }} args
 * @returns {Array<{ id: string, path: string }>}
 */
function collectPublicRoutes({ pages, features, sessions, speakers, updates }) {
  const { public: pageRoutes } = classifyPages({ pages, features });
  const publicPageIds = new Set(pageRoutes.map((r) => r.id));
  return [
    ...pageRoutes,
    ...buildSessionRoutes({ sessions, parentPublic: publicPageIds.has('schedule') }),
    ...buildSpeakerRoutes({ speakers, parentPublic: publicPageIds.has('speakers') }),
    ...buildUpdateRoutes({ updates, parentPublic: publicPageIds.has('updates') }),
  ];
}

/**
 * The configured public URL, normalized to `origin + pathname` with no
 * trailing slash, tolerant of surrounding whitespace.
 *
 * `EVENT_PUBLIC_URL` is trimmed only FOR VALIDATION by `validateDeployEnv`
 * (packages/shared/src/config/deploy.cjs) — the raw, possibly padded value
 * is what callers actually receive back — so this has to trim it again
 * itself rather than trust it arrives clean. Routing the value through
 * `new URL` also drops a query string or hash a misconfigured value might
 * carry, neither of which belongs in a sitemap or robots.txt base.
 *
 * @param {string} publicUrl
 * @returns {string}
 */
function normalizedBaseUrl(publicUrl) {
  if (typeof publicUrl !== 'string') return '';
  const trimmed = publicUrl.trim();
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed);
    return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
  } catch {
    // Not a parseable URL at all — fall back to the plain trim-and-strip
    // this function always did, rather than silently emptying every
    // artifact's base over a value `validateDeployEnv` already accepted.
    return trimmed.replace(/\/+$/, '');
  }
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
 * Every disallow rule is `$`-anchored to the excluded route's exact path,
 * with two exceptions below — a bare `Disallow: /travel` also blocks
 * `/travel-guide`, since robots.txt matching is a plain prefix test with
 * no implied path boundary, and a bare `Disallow: /` for a hidden HOME
 * page would disallow the entire site (every path starts with `/`).
 * `Disallow: /$` matches only the exact root and nothing else. A route
 * whose own subtree carries further pages (`hasChildren`, e.g.
 * `/schedule/:sessionId` under `/schedule`) gets a second `/path/*` rule
 * so an excluded parent still shields the detail pages under it.
 *
 * A `tokenBearing` route (`/speaker/accept`, `/ticket/claim`) is the
 * opposite problem: its real URL carries a one-time token in the query
 * string, e.g. `/speaker/accept?token=…`
 * (functions/src/speakers/inviteTokens.cjs), and the PATH+QUERY is what a
 * crawler matches a robots rule against — so an anchored `/speaker/
 * accept$` would refuse to match the query-string form at all, letting
 * the exact URL that matters through. These two get the plain, unanchored
 * prefix rule instead, which covers the bare path, the token form, and
 * anything else under it in one line.
 */
function buildRobotsTxt({ publicUrl, pages, features }) {
  const base = normalizedBaseUrl(publicUrl);
  const { excluded } = classifyPages({ pages, features });
  const disallowLines = new Set();
  for (const route of excluded) {
    disallowLines.add(route.tokenBearing ? `Disallow: ${route.path}` : `Disallow: ${route.path}$`);
    if (route.hasChildren) disallowLines.add(`Disallow: ${route.path}/*`);
  }
  const lines = ['User-agent: *', 'Allow: /', ...[...disallowLines].sort()];
  lines.push('', `Sitemap: ${base}/sitemap.xml`, '');
  return lines.join('\n');
}

/**
 * The web app manifest. Every URL in it is written MANIFEST-RELATIVE —
 * `start_url`/`scope` as `./` and each icon `src` with no leading slash —
 * rather than origin-root-relative: a manifest is resolved against its OWN
 * url, not the document's, so an origin-root value (`/`, `/branding/…`)
 * is wrong the moment the manifest is not served from the domain root,
 * which the demo always is not (`/eventrunner/demo/manifest.webmanifest`
 * on GitHub Pages). `./` and a bare relative path resolve correctly
 * whether the manifest sits at the origin root or under a base path,
 * because both stay relative to wherever the manifest itself is.
 *
 * Icons reuse the branding slots every deployment ships —
 * `apps/web/public/branding/mark.svg` and `favicon.svg`
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
    start_url: './',
    scope: './',
    display: 'standalone',
    icons: [
      { src: 'branding/mark.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: 'branding/favicon.svg', sizes: 'any', type: 'image/svg+xml' },
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
  RESERVED_SESSION_IDS,
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
