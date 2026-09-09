// The two calls that need the Firebase Storage SDK, kept in their own module
// so the SDK stays out of the chunk every visitor downloads.
//
// This is a route boundary, not a bookkeeping one. Reading media does not
// touch the Storage service at all: lib/mediaSource.js builds object URLs as
// strings from the bucket name (see its header for why getDownloadURL is not
// used), which is what every page — Layout's logo included — actually needs.
// WRITING is different, and only one surface writes: an attendee replacing or
// removing their own photo on /profile. That route is already lazy, so
// importing the SDK from here and nowhere else moves roughly 34 kB out of the
// initial graph (docs/performance/public-bundle-budget.md).
//
// `profile-photos/{uid}/**` is owner-bound in storage.rules (§8.5): the uid in
// the path must equal the uid on the token. The checks in mediaSource's
// checkFile() are a courtesy that turns a rules rejection into a sentence
// someone can act on; the rules are the boundary.
import { connectStorageEmulator, deleteObject, getStorage, ref, uploadBytes } from 'firebase/storage';
import { app, useEmulators } from '../firebase.js';
import { PROFILE_PHOTO_MAX_BYTES, PROFILE_PHOTO_TYPES, checkFile } from './mediaSource.js';

let client = null;

/** The Storage client, made on first use so importing this module is cheap. */
function storageClient() {
  if (!client) {
    client = getStorage(app);
    if (useEmulators) connectStorageEmulator(client, '127.0.0.1', 9199);
  }
  return client;
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
  await uploadBytes(ref(storageClient(), path), file, { contentType: file.type });
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
    await deleteObject(ref(storageClient(), path));
  } catch {
    // An object that is already gone, or a rules refusal on somebody else's
    // path, both end the same way: nothing to clean up here.
  }
}
