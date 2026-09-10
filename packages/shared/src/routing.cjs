'use strict';

/**
 * Reserved first path segments for root-level cmsPages routing (issue #52).
 *
 * Generic (non-system) pages are admin-editable at a root-level `path`
 * (e.g. `/scholarships`) instead of the old `/p/:slug` prefix. Every
 * statically mounted route in apps/web/src/App.jsx owns its first path
 * segment outright, so a generic page may never claim one of those
 * segments for itself — this list is the single source of truth for that
 * collision check, imported by BOTH the functions validator
 * (functions/src/cms/pages.cjs) and the web router (apps/web/src/App.jsx).
 *
 * `p` is reserved too, even though the route it names is gone: old
 * `/p/<slug>` links must keep 404ing rather than a new page silently
 * reclaiming that prefix.
 *
 * `profile` and `attendees` are the account and directory routes (issue
 * #17): /profile, /attendees, and /attendees/:uid are statically mounted,
 * so a generic page may not claim either segment.
 *
 * `admin` is reserved ahead of its own route landing: an authenticated
 * `/admin` area is under construction on a parallel branch, and this list
 * also covers system areas that exist on paper before their route does, so
 * a generic page can never squat the prefix first.
 *
 * `updates` is the updates list/detail route (issue #27 follow-up):
 * /updates and /updates/:id are statically mounted, and updatesMeta's
 * self-fetched SSR OG meta links straight at that prefix — a generic page
 * squatting it would break both the route and every previously-shared
 * update link's unfurl.
 *
 * `speaker` (singular) is the invite-acceptance area (issue #21):
 * /speaker/accept is statically mounted and it is the address every speaker
 * invitation email links to. A generic page claiming the segment would
 * break every invitation already in an inbox, including ones sent before
 * the page existed — which is exactly the class of collision this list is
 * for. It is deliberately distinct from the plural `speakers` directory
 * route above; both are reserved.
 *
 * `ticket` is the self-service ticket claim area (issue #33): /ticket/claim
 * is statically mounted, and it is the address `ticket.claim_prompt`'s CTA
 * links to for every provider that resolves one (manual.cjs, eventbrite.cjs
 * getRegistrationPrompt). Same reasoning as `speaker`: mail already sent
 * with this link must keep working.
 *
 * `specimen` is the specimen book (apps/web/src/pages/specimen/): the
 * review page that draws every device in every state. It is mounted only in
 * the demo build and in a development server, so in a client production
 * build the segment is free and the catch-all route would serve a generic
 * page there. Two reasons that must not happen: the segment belongs to a
 * built-in surface, and scripts/write-site-files.cjs refuses to publish a
 * sitemap listing /specimen, so such a page would stop that client's
 * deploy. Its route mounts as path={SPECIMEN_PATH}, an expression rather
 * than a quoted literal, which is why the App.jsx sweep in
 * apps/web/src/lib/siteNavigation.test.js did not report it missing.
 *
 * Keep in sync with the static <Route path="..."> segments in App.jsx by
 * hand — there is no build-time check tying the two together.
 */
const RESERVED_PATH_SEGMENTS = Object.freeze([
  'schedule', 'speakers', 'speaker', 'sponsors', 'signin', 'profile', 'attendees', 'p', 'admin', 'updates',
  'ticket', 'specimen',
]);

/**
 * The first path segment of a route or a stored page path — the part this
 * list is about. `''` for '/' and for anything with no segment at all, so a
 * caller can compare it without a null check.
 *
 * It lives here rather than beside each caller because every caller derives
 * it for the same purpose: to ask isReservedPathSegment about it. Two copies
 * of the same three lines is two places to disagree about what a leading
 * slash, a trailing slash, or an empty path means.
 *
 * @param {string} path a route or page path, e.g. '/travel' or '/p/faq'
 * @returns {string}
 */
function firstPathSegment(path) {
  return String(path ?? '').split('/').filter(Boolean)[0] ?? '';
}

/**
 * True when `segment` (a single path segment, no slashes) collides with a
 * statically mounted route.
 *
 * @param {string} segment
 * @returns {boolean}
 */
function isReservedPathSegment(segment) {
  return RESERVED_PATH_SEGMENTS.includes(segment);
}

/**
 * One normalized path segment: a lowercase slug, no leading or trailing
 * hyphen. This is the shape functions/src/cms/pages.cjs enforces on write,
 * and it lives here so the renderers can ask the same question of data that
 * was written before it did.
 */
const PAGE_PATH_SEGMENT_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * True when `path` is a page path in the ONE shape the system stores: a
 * single leading slash, normalized segments, no trailing slash, no empty
 * segment. '/' is the home page's path and is canonical on its own.
 *
 * The characters the segment pattern allows are the whole guarantee here,
 * and the guarantee is that the value is a PATH and nothing else. A renderer
 * puts this string into an href, where a value that is not a path is not a
 * cosmetic problem: '//example.org' is a protocol-relative URL that sends
 * the reader to another origin, and 'https://evil.example' is an absolute
 * one. Neither starts a segment this pattern accepts, and neither survives
 * the no-empty-segment rule, so a renderer that asks this question before
 * rendering a link cannot be made to point off-site by stored data — whether
 * that data predates the validator or was written straight into Firestore
 * around it.
 *
 * @param {unknown} path
 * @returns {boolean}
 */
function isCanonicalPagePath(path) {
  if (typeof path !== 'string' || path.length === 0) return false;
  if (path === '/') return true;
  if (!path.startsWith('/') || path.endsWith('/')) return false;
  const segments = path.slice(1).split('/');
  return segments.every((segment) => PAGE_PATH_SEGMENT_RE.test(segment));
}

/**
 * THE SYSTEM PAGES, BY THE STABLE DOCUMENT ID THE SEED WRITES.
 *
 * A generic page IS its stored `path`: the catch-all resolves a URL against
 * that field, so the document decides where it is served. A system page is
 * not — the route it renders through is declared in apps/web/src/App.jsx,
 * and the document only describes it. Its `path` is a COPY of a fact that
 * lives in code, and a copy can drift: the server refuses to move it
 * (functions/src/cms/pages.cjs) and the editor renders the field read-only,
 * but a document written before either guard, or written straight into
 * Firestore around them, can still carry a path no route mounts.
 *
 * So every reader that has to turn a system page document into a route, or
 * a route back into a system page document, does it through this map and by
 * `id`. It lives in the shared package because there are three such readers
 * in three runtimes — the navigation (apps/web/src/lib/siteNavigation.js),
 * the sitemap and robots builders (scripts/lib/site-manifest.cjs), and the
 * server-rendered per-route metadata (functions/src/public/og.cjs) — and a
 * second copy of this map is a second answer to "where does the schedule
 * live".
 *
 * For each id: `to` is the route App.jsx mounts, `feature` is the
 * `config/features` key that route checks before rendering anything (null
 * for the home page — the index route is always mounted and no flag turns
 * the event's front door off), and `children` marks a route with
 * descendants (/schedule/:sessionId, /speakers/:slug, /updates/:id,
 * /attendees/:uid).
 *
 * Keep in sync by hand with the static <Route path="..."> list in
 * apps/web/src/App.jsx and with the `systemPage: true` docs in
 * scripts/lib/seed.cjs; apps/web/src/lib/siteNavigation.test.js reads
 * App.jsx and pins both directions.
 */
const SYSTEM_PAGE_ROUTES = Object.freeze({
  home: Object.freeze({ to: '/', feature: null, children: false }),
  schedule: Object.freeze({ to: '/schedule', feature: 'schedule', children: true }),
  speakers: Object.freeze({ to: '/speakers', feature: 'speakers', children: true }),
  sponsors: Object.freeze({ to: '/sponsors', feature: 'sponsors', children: false }),
  attendees: Object.freeze({ to: '/attendees', feature: 'attendeeDirectory', children: true }),
  updates: Object.freeze({ to: '/updates', feature: 'updates', children: true }),
});

/** Route path -> system page id, built once from the map above. */
const SYSTEM_PAGE_ID_BY_ROUTE = Object.freeze(
  Object.fromEntries(Object.entries(SYSTEM_PAGE_ROUTES).map(([id, route]) => [route.to, id])),
);

/**
 * The system page a request path belongs to, by its ROUTE rather than by
 * any stored path: '/' is home, '/schedule' and '/schedule/abc' are both
 * the schedule. Null for anything no system route mounts.
 *
 * A detail path only resolves through a route that declares `children`, so
 * '/sponsors/anything' is not the sponsors page — nothing mounts it.
 *
 * @param {string} path a request path, normalized (no trailing slash)
 * @returns {string|null}
 */
function systemPageIdForPath(path) {
  const value = typeof path === 'string' ? path : '';
  if (Object.prototype.hasOwnProperty.call(SYSTEM_PAGE_ID_BY_ROUTE, value)) {
    return SYSTEM_PAGE_ID_BY_ROUTE[value];
  }
  const segment = firstPathSegment(value);
  if (!segment) return null;
  const id = SYSTEM_PAGE_ID_BY_ROUTE[`/${segment}`];
  if (!id) return null;
  return SYSTEM_PAGE_ROUTES[id].children ? id : null;
}

module.exports = {
  RESERVED_PATH_SEGMENTS,
  PAGE_PATH_SEGMENT_RE,
  SYSTEM_PAGE_ROUTES,
  firstPathSegment,
  isReservedPathSegment,
  isCanonicalPagePath,
  systemPageIdForPath,
};
