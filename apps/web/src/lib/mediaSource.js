// Storage access for the media library and profile photos — the one seam
// between the media UI and Firebase Storage (tests mock this module, same
// convention as lib/profileSource.js and lib/contentSource.js).
//
// Two upload paths, because storage.rules grants exactly one of them to a
// client (spec §8.5):
//
//   • PROFILE PHOTOS go straight to the bucket. `profile-photos/{uid}/**` is
//     owner-bound in the rules, so the browser can PUT there itself and the
//     rules — not this file — are what stop one attendee overwriting
//     another's photo. The checks below are courtesy: they turn a rules
//     rejection into a sentence someone can act on, before a byte is sent.
//   • EVERYTHING ELSE (cms-images, branding) is server-authorized: the file
//     is base64-encoded and POSTed to `mediaUpload`, which verifies the
//     admin token and writes through the Admin SDK. A client SDK upload to
//     those namespaces is denied by the rules by design.
//
// Reading is uniform: every namespace the library touches is publicly
// readable, so a download URL works for signed-out visitors too.
import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { storage } from '../firebase.js';

/** Mirrors storage.rules for `profile-photos/{uid}/**` — keep in step. */
export const PROFILE_PHOTO_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/webp']);
export const PROFILE_PHOTO_MAX_BYTES = 2 * 1024 * 1024;

/** Mirrors functions/src/media/upload.cjs FOLDERS — keep in step. */
export const MEDIA_FOLDERS = Object.freeze({
  'cms-images': Object.freeze(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
  branding: Object.freeze(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']),
});
export const MEDIA_MAX_BYTES = 5 * 1024 * 1024;

/** `image/png` → `PNG`, for an accept hint a person can read. */
export function typeLabel(contentType) {
  return String(contentType).replace(/^image\//, '').replace('+xml', '').toUpperCase();
}

/** A size a person can read: `840 KB`, `1.4 MB`. */
export function formatBytes(size) {
  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Client-side pre-check for one upload. Never the boundary — the rules and
 * the endpoint are — but a person choosing a 12 MB TIFF deserves to hear
 * why before a slow upload fails.
 *
 * @param {File} file
 * @param {{ types: readonly string[], maxBytes: number }} limits
 * @returns {string|null} an error message, or null when the file is fine
 */
export function checkFile(file, { types, maxBytes }) {
  if (!file) return 'Choose a file to upload.';
  if (!types.includes(file.type)) {
    return `That file is a ${file.type || 'unknown type'}. Use ${types.map(typeLabel).join(', ')}.`;
  }
  if (file.size > maxBytes) {
    return `That file is ${formatBytes(file.size)}. The limit is ${formatBytes(maxBytes)}.`;
  }
  return null;
}

/**
 * Read a File as base64 with no data: prefix (the endpoint accepts either;
 * sending the bare payload keeps the request smaller).
 *
 * @param {File} file
 * @returns {Promise<string>}
 */
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read.'));
    reader.onload = () => {
      const result = String(reader.result ?? '');
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.readAsDataURL(file);
  });
}

/**
 * A displayable URL for a Storage object path. Resolved URLs are memoized
 * for the page's lifetime: a library grid asks for the same paths on every
 * render, and each miss is a network round trip.
 *
 * @param {string} path e.g. 'cms-images/abc/hero.png'
 * @returns {Promise<string|null>} null when the object is missing/unreadable
 */
const urlCache = new Map();
export function assetUrl(path) {
  if (typeof path !== 'string' || path.length === 0) return Promise.resolve(null);
  if (urlCache.has(path)) return urlCache.get(path);
  const pending = getDownloadURL(ref(storage, path)).catch(() => {
    // Miss the cache on failure so a later render can retry: an object may
    // simply not have finished uploading.
    urlCache.delete(path);
    return null;
  });
  urlCache.set(path, pending);
  return pending;
}

/** Forget one memoized URL (after a delete, or a replaced photo). */
export function forgetAssetUrl(path) {
  urlCache.delete(path);
}

/**
 * Upload an attendee's own photo directly to their owner-bound prefix.
 * The filename is fixed per content type rather than taken from the file, so
 * a person replacing their photo overwrites one object instead of
 * accumulating every avatar they have ever picked.
 *
 * @param {{ uid: string, file: File }} args
 * @returns {Promise<{ path: string }>}
 */
export async function uploadProfilePhoto({ uid, file }) {
  const problem = checkFile(file, {
    types: PROFILE_PHOTO_TYPES,
    maxBytes: PROFILE_PHOTO_MAX_BYTES,
  });
  if (problem) throw new Error(problem);
  const extension = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const path = `profile-photos/${uid}/photo.${extension}`;
  await uploadBytes(ref(storage, path), file, { contentType: file.type });
  forgetAssetUrl(path);
  return { path };
}

/**
 * Delete an attendee's own photo object. Best-effort: clearing `photoPath`
 * on the profile is what actually removes the photo from the site, and a
 * failed object delete must not block that save.
 *
 * @param {string} path
 * @returns {Promise<void>}
 */
export async function deleteOwnPhoto(path) {
  if (typeof path !== 'string' || !path.startsWith('profile-photos/')) return;
  try {
    await deleteObject(ref(storage, path));
  } catch {
    // An object that is already gone, or a rules refusal on somebody else's
    // path, both end the same way: nothing to clean up here.
  }
  forgetAssetUrl(path);
}
