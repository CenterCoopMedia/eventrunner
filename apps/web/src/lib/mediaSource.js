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
// READING does not use getDownloadURL(). That call resolves the
// `firebaseStorageDownloadTokens` metadata field, and only a client SDK
// upload mints one: objects written by the Admin SDK — which is every
// cms-images and branding file, plus the four placeholders init seeds — have
// no token, so getDownloadURL rejects with storage/no-download-url and the
// library would report every freshly uploaded file as missing.
//
// The fix is not to mint tokens server-side. A tokenized URL is honoured
// WITHOUT evaluating storage.rules and cannot be withdrawn except by
// rotating the token, so minting one turns every asset into a permanent
// public link regardless of what the rules say later — and every future
// Admin-SDK writer would have to remember to mint one. Instead this module
// builds the token-free media URL, which the Storage service serves subject
// to the rules. `allow get: if true` on the public namespaces is what makes
// it work for anonymous visitors, `session-materials/` stays closed, and a
// thumbnail costs no metadata round trip.
import { deleteObject, ref, uploadBytes } from 'firebase/storage';
import { storage, storageBucketName, storageDownloadOrigin } from '../firebase.js';
import { IS_DEMO } from './demoMode.js';

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
 * `exclusive` matches the bound on the OTHER side of the wire, so the
 * pre-check and the enforcement agree on the edge case. storage.rules says
 * `request.resource.size < 2 * 1024 * 1024` for profile photos — strictly
 * less — so a file of exactly the cap is refused there and must be refused
 * here too, or the upload fails after the bytes have been sent. The media
 * endpoint's own cap is inclusive (`size > MAX_UPLOAD_BYTES` rejects), so
 * that path passes `exclusive: false`.
 *
 * @param {File} file
 * @param {{ types: readonly string[], maxBytes: number, exclusive?: boolean }} limits
 * @returns {string|null} an error message, or null when the file is fine
 */
export function checkFile(file, { types, maxBytes, exclusive = false }) {
  if (!file) return 'Choose a file to upload.';
  if (!types.includes(file.type)) {
    return `That file is a ${file.type || 'unknown type'}. Use ${types.map(typeLabel).join(', ')}.`;
  }
  const tooBig = exclusive ? file.size >= maxBytes : file.size > maxBytes;
  if (tooBig) {
    return `That file is ${formatBytes(file.size)}. The limit is ${
      exclusive ? 'under ' : ''
    }${formatBytes(maxBytes)}.`;
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
 * A Storage object path, or null. Rejects the shapes that would build a
 * nonsense URL — a non-string from an unvalidated Firestore doc, an
 * absolute URL, a leading slash, a parent traversal — so every caller can
 * treat "not a path" and "no path" the same way.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
export function storagePath(value) {
  if (typeof value !== 'string') return null;
  const path = value.trim();
  if (path.length === 0) return null;
  if (path.startsWith('/') || path.includes('..') || /^[a-z][a-z0-9+.-]*:/i.test(path)) return null;
  return path;
}

/**
 * A displayable URL for a Storage object path, built rather than fetched
 * (see the module header). Cache-busting is not needed: an upload always
 * lands on a fresh `{folder}/{assetId}/{name}` path, and a replaced profile
 * photo keeps its path but is fetched with normal HTTP caching.
 *
 * @param {unknown} path e.g. 'cms-images/abc/hero.png'
 * @returns {string|null} null when the value is not a usable object path
 */
export function assetUrl(path) {
  const object = storagePath(path);
  if (!object) return null;
  // Static demo build: there is no Storage bucket behind the site, so a
  // built URL would be a request to firebasestorage.googleapis.com that can
  // only fail. The only object paths the synthetic snapshot uses are the
  // flat `branding/*` placeholders, and identical copies ship in the bundle
  // under public/branding — resolve those bundle-relative (the same thing
  // brandingSrc() does for them) and treat everything else as absent.
  if (IS_DEMO) {
    return object.startsWith('branding/') && object.split('/').length === 2
      ? `${import.meta.env.BASE_URL}${object}`
      : null;
  }
  if (!storageBucketName) return null;
  return `${storageDownloadOrigin}/v0/b/${encodeURIComponent(
    storageBucketName,
  )}/o/${encodeURIComponent(object)}?alt=media`;
}

/**
 * The `src` for a `config/theme.logos` slot (spec §7.2).
 *
 * Two shapes live in those slots and they resolve differently:
 *
 *   • `branding/logo.svg` — a FLAT path. These are the four placeholders
 *     init seeds, and identical copies ship in the bundle under
 *     `apps/web/public/branding/`, so they resolve Hosting-relative and
 *     render even before Storage has been provisioned.
 *   • `branding/{assetId}/{name}` — an uploaded asset picked in the admin
 *     Branding tab. It exists ONLY in the bucket; serving it Hosting-relative
 *     (which is what this app did before the media library) 404s.
 *
 * The segment count is the discriminator. Anything that is not a usable
 * path resolves to null and the caller renders no image at all, which is
 * the fail-soft the runtime config overlay requires (§2.4).
 *
 * @param {unknown} value
 * @returns {string|null}
 */
export function brandingSrc(value) {
  const path = storagePath(value);
  if (!path) return null;
  // BASE_URL is '/' for every Hosting deploy (Vite's default base), so this
  // is the same `/branding/…` path it has always been; it only differs for a
  // build deployed under a subpath, such as the static demo.
  return path.split('/').length > 2
    ? assetUrl(path)
    : `${import.meta.env.BASE_URL}${path}`;
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
    exclusive: true,
  });
  if (problem) throw new Error(problem);
  const extension = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const path = `profile-photos/${uid}/photo.${extension}`;
  await uploadBytes(ref(storage, path), file, { contentType: file.type });
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
}
