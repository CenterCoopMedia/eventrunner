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
 * `admin` is reserved ahead of its own route landing: an authenticated
 * `/admin` area is under construction on a parallel branch, and this list
 * also covers system areas that exist on paper before their route does, so
 * a generic page can never squat the prefix first.
 *
 * Keep in sync with the static <Route path="..."> segments in App.jsx by
 * hand — there is no build-time check tying the two together.
 */
const RESERVED_PATH_SEGMENTS = Object.freeze(['schedule', 'speakers', 'sponsors', 'signin', 'p', 'admin']);

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

module.exports = { RESERVED_PATH_SEGMENTS, isReservedPathSegment };
