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
 * Keep in sync with the static <Route path="..."> segments in App.jsx by
 * hand — there is no build-time check tying the two together.
 */
const RESERVED_PATH_SEGMENTS = Object.freeze([
  'schedule', 'speakers', 'speaker', 'sponsors', 'signin', 'profile', 'attendees', 'p', 'admin', 'updates',
]);

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
