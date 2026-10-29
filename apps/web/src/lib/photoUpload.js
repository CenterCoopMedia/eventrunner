import { callAdminEndpoint } from '../admin/adminApi.js';
import { connectStorageEmulator, deleteObject, getStorage, ref } from 'firebase/storage';
import { app, auth, useEmulators } from '../firebase.js';
import { PROFILE_PHOTO_MAX_BYTES, PROFILE_PHOTO_TYPES, checkFile, fileToBase64 } from './mediaSource.js';

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
 * Upload through trusted decoding; only the bounded WebP is stored.
 * Each choice gets a new object id. The saved profile still points at the
 * previous object, and that object stays the public photo until the save
 * writes the new path. A fixed name would replace the public photo while
 * the form is still open.
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
  if (!auth.currentUser || auth.currentUser.uid !== uid) throw new Error('not signed in');
  const payload = await callAdminEndpoint(
    'profilePhotoUpload',
    { data: await fileToBase64(file) },
    () => auth.currentUser.getIdToken(),
  );
  return { path: payload.path };
}

/**
 * Delete an attendee's own photo object. The caller is a failed profile
 * save whose new object is already public. An object that is already gone
 * is success. Any other failure is thrown so the caller can retry this
 * same object instead of uploading another public file.
 *
 * @param {string} path
 * @returns {Promise<void>}
 */
export async function deleteOwnPhoto(path) {
  if (typeof path !== 'string' || !path.startsWith('profile-photos/')) return;
  try {
    await deleteObject(ref(storageClient(), path));
  } catch (error) {
    if (error && error.code === 'storage/object-not-found') return;
    throw error;
  }
}
