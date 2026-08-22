// Speaker self-service profile wizard — the client seam for
// getOwnSpeakerProfile / updateOwnSpeakerProfile / speakerPhotoUpload
// (functions/src/speakers/profile.cjs, functions/src/media/upload.cjs;
// spec §4.3, §9 "Speaker profile wizard", issue #22).
//
// These are NOT admin endpoints — a signed-in speaker calls them about
// their own record — but the wire shape is identical to the admin API
// (POST <functionsOrigin>/<name> with `Authorization: Bearer <ID token>`,
// { error: { code, message } } on failure), so this reuses
// callAdminEndpoint/AdminApiError rather than inventing a second HTTP
// client. The server is the real gate either way: requireAdmin has no part
// in these handlers, which check `speakers/{id}.uid === caller uid`
// instead (functions/src/speakers/profile.cjs's gateSpeakerSelfOrAdmin).
import { callAdminEndpoint, AdminApiError } from '../admin/adminApi.js';
import { checkFile, fileToBase64, formatBytes, typeLabel } from './mediaSource.js';

/** Mirrors functions/src/media/upload.cjs SPEAKER_PHOTO_TYPES — keep in step. */
export const SPEAKER_PHOTO_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/webp']);
export const SPEAKER_PHOTO_MAX_BYTES = 2 * 1024 * 1024;

export { AdminApiError };

function idTokenGetter(user) {
  return () => {
    if (!user || typeof user.getIdToken !== 'function') {
      return Promise.reject(new Error('not signed in'));
    }
    return user.getIdToken();
  };
}

/**
 * Read the caller's own speaker record (or, for an admin, any record).
 *
 * @param {{ user: object, speakerId: string }} args
 * @returns {Promise<object>} the self-service view (see buildOwnSpeakerView)
 */
export function getOwnSpeakerProfile({ user, speakerId }) {
  return callAdminEndpoint('getOwnSpeakerProfile', { speakerId }, idTokenGetter(user)).then(
    (payload) => payload.speaker,
  );
}

/**
 * Save the self-editable subset of the caller's own speaker record.
 * `fields` should already be limited to SELF_EDITABLE_SPEAKER_FIELDS
 * (shared/speaker) — the server rejects anything else by name, and
 * AdminApiError#fieldErrors turns that rejection into a message a form can
 * point at.
 *
 * @param {{ user: object, speakerId: string, fields: object }} args
 */
export function updateOwnSpeakerProfile({ user, speakerId, fields }) {
  return callAdminEndpoint(
    'updateOwnSpeakerProfile',
    { speakerId, speaker: fields },
    idTokenGetter(user),
  );
}

/**
 * Upload a speaker headshot to a FRESH versioned path under
 * `speaker-photos/{speakerId}/` (issue #22 review finding P1-2). Unlike the
 * attendee profile photo, this namespace is server-authorized (storage.rules
 * `write: if false`), so the bytes travel through speakerPhotoUpload as
 * base64 rather than a direct client SDK PUT — the same shape mediaUpload
 * uses for cms-images/branding, sized down to the profile-photo class of
 * limit. Never the fixed path `speakers.headshotPath` currently points at:
 * picking a file must not overwrite the live public object before Save is
 * even clicked.
 *
 * @param {{ user: object, speakerId: string, file: File }} args
 * @returns {Promise<{ path: string }>}
 */
export async function uploadSpeakerPhoto({ user, speakerId, file }) {
  const problem = checkFile(file, {
    types: SPEAKER_PHOTO_TYPES,
    maxBytes: SPEAKER_PHOTO_MAX_BYTES,
    exclusive: true,
  });
  if (problem) throw new Error(problem);
  const data = await fileToBase64(file);
  const payload = await callAdminEndpoint(
    'speakerPhotoUpload',
    { speakerId, contentType: file.type, filename: file.name, data },
    idTokenGetter(user),
  );
  return { path: payload.path };
}

/**
 * Delete a speaker photo object — the deferred-cleanup half of the upload
 * above (issue #22 review finding P2-3), mirroring ProfilePhotoField's
 * "never delete on click, delete once a save no longer points at it" rule.
 * Best-effort by design: the caller decides whether a failure here matters
 * enough to surface, and typically it does not — an orphaned object costs
 * a few kilobytes and nothing else.
 *
 * @param {{ user: object, speakerId: string, path: string }} args
 * @returns {Promise<void>}
 */
export async function deleteSpeakerPhoto({ user, speakerId, path }) {
  await callAdminEndpoint('speakerPhotoDelete', { speakerId, path }, idTokenGetter(user));
}

export { formatBytes, typeLabel };
