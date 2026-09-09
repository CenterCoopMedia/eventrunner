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
 * Keep in sync with the static <Route path="..."> segments in App.jsx by
 * hand — there is no build-time check tying the two together.
 */
const RESERVED_PATH_SEGMENTS = Object.freeze([
  'schedule', 'speakers', 'speaker', 'sponsors', 'signin', 'profile', 'attendees', 'p', 'admin', 'updates',
  'ticket',
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

module.exports = {
  RESERVED_PATH_SEGMENTS,
  PAGE_PATH_SEGMENT_RE,
  firstPathSegment,
  isReservedPathSegment,
  isCanonicalPagePath,
};
