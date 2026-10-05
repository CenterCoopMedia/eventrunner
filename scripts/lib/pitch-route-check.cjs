'use strict';

function assertNoPitchPageCollisions(pages) {
  // Older deployments could store generic pages on this newly reserved
  // segment. Refuse a code/content publish before it can hide those pages.
  const collisions = (pages ?? []).filter((page) => typeof page?.path === 'string' && (page.path === '/pitch' || page.path.startsWith('/pitch/')));
  if (collisions.length) {
    throw new Error(`Session pitch route collision: Rename the CMS page paths ${collisions.map((page) => page.path).join(', ')} before deploying. Existing content was not changed.`);
  }
}

module.exports = { assertNoPitchPageCollisions };
