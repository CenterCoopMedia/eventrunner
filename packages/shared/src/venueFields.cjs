'use strict';

/**
 * The Storage namespaces the media library writes, and therefore the only
 * ones a map image may come out of. Mirrors `functions/src/media/upload.cjs`
 * FOLDERS — keep in step.
 *
 * The other namespaces are not the library's: `profile-photos/` is owner
 * bound, `speakers/` is keyed by speaker, `session-materials/` is closed to
 * public reads. A path into one of those is not a picture an operator picked
 * out of the library, and saying so at the save is the difference between an
 * error message that is true and one that is merely discouraging.
 */
const MEDIA_LIBRARY_PREFIXES = Object.freeze(['cms-images/', 'branding/']);

/**
 * True when `path` names an object inside a media-library namespace.
 *
 * @param {unknown} path a value already through storageObjectPath
 */
function isMediaLibraryPath(path) {
  return typeof path === 'string' && MEDIA_LIBRARY_PREFIXES.some((p) => path.startsWith(p));
}

/**
 * A Storage object path, trimmed, or `null`.
 *
 * The same shapes `apps/web/src/lib/mediaSource.js` refuses before building
 * a URL — an absolute URL, a leading slash, a parent traversal — because a
 * map whose path can only build a nonsense URL is a map that will render as
 * a broken image. The reader treats one as absent and renders nothing; the
 * validator, which shares this function, refuses it at the save, where
 * somebody can still paste the right thing.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
function storageObjectPath(value) {
  if (typeof value !== 'string') return null;
  const path = value.trim();
  if (path.length === 0) return null;
  if (path.startsWith('/') || path.includes('..') || /^[a-z][a-z0-9+.-]*:/i.test(path)) return null;
  return path;
}

/** Full street address from the event venue, with blank parts omitted. */
function venueAddress(venue = {}) {
  const line = [venue.addressLine1, venue.addressLine2].filter(Boolean).join(', ');
  const town = [venue.city, venue.region].filter(Boolean).join(', ');
  const tail = [town, venue.postalCode, venue.country].filter(Boolean).join(' ');
  return [line, tail].filter(Boolean).join(', ');
}

module.exports = { MEDIA_LIBRARY_PREFIXES, isMediaLibraryPath, storageObjectPath, venueAddress };
