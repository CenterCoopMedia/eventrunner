// Profile allocation is server-mediated and bounded per account. Keep the
// Storage SDK lazy for owner deletes; reads still use token-free URLs.
import { connectStorageEmulator, deleteObject, getStorage, ref } from 'firebase/storage';
import { app, auth, useEmulators } from '../firebase.js';
import { PROFILE_PHOTO_MAX_BYTES, PROFILE_PHOTO_TYPES, checkFile, fileToBase64 } from './mediaSource.js';

import { callAdminEndpoint } from '../admin/adminApi.js';

let client = null;

/** The Storage client, made on first use so importing this module is cheap. */
function storageClient() {
  if (!client) {
    client = getStorage(app);
    if (useEmulators) connectStorageEmulator(client, '127.0.0.1', 9199);
  }
  return client;
}

/** Upload a fresh object without changing the saved public photo. */
export async function uploadProfilePhoto({ uid, file }) {
  const problem = checkFile(file, {
    types: PROFILE_PHOTO_TYPES,
    maxBytes: PROFILE_PHOTO_MAX_BYTES,
    exclusive: true,
  });
  if (problem) throw new Error(problem);
  const user = auth.currentUser;
  if (!user || user.uid !== uid) throw new Error('Sign in again to upload your photo.');
  const data = await fileToBase64(file);
  const payload = await callAdminEndpoint('profilePhotoUpload', { contentType: file.type, data }, () => user.getIdToken());
  return { path: payload.path, expiresAtMs: payload.expiresAtMs };
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
