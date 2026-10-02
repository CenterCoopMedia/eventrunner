// Speaker session materials use the same authenticated POST wire contract as
// the admin client, but every authorization decision remains on the server.
// The browser sends file bytes to the function because storage.rules keeps
// session-materials closed to direct client reads and writes.
import { callAdminEndpoint, AdminApiError } from '../admin/adminApi.js';
import { fileToBase64, formatBytes } from './mediaSource.js';

export const MAX_SPEAKER_MATERIAL_FILE_BYTES = 9 * 1024 * 1024;

export { AdminApiError };

function idTokenGetter(user) {
  return () => {
    if (!user || typeof user.getIdToken !== 'function') {
      return Promise.reject(new Error('not signed in'));
    }
    return user.getIdToken();
  };
}

export function listSpeakerSessionMaterials({ user, sessionId }) {
  return callAdminEndpoint(
    'listSessionMaterials',
    { sessionId },
    idTokenGetter(user),
  ).then((payload) => (Array.isArray(payload.materials) ? payload.materials : []));
}

export function addSpeakerMaterialLink({ user, sessionId, url, label }) {
  return callAdminEndpoint(
    'addSessionMaterialLink',
    { sessionId, url, label },
    idTokenGetter(user),
  );
}

export async function uploadSpeakerMaterialFile({ user, sessionId, file }) {
  if (!file) throw new Error('Choose a file to upload.');
  if (!Number.isFinite(file.size) || file.size <= 0) throw new Error('Choose a file that is not empty.');
  if (file.size > MAX_SPEAKER_MATERIAL_FILE_BYTES) {
    throw new Error(
      `That file is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_SPEAKER_MATERIAL_FILE_BYTES)}.`,
    );
  }
  const data = await fileToBase64(file);
  return callAdminEndpoint(
    'uploadSessionMaterial',
    {
      sessionId,
      filename: file.name,
      contentType: file.type || 'application/octet-stream',
      data,
    },
    idTokenGetter(user),
  );
}

export function updateSpeakerMaterial({ user, materialId, filename, url }) {
  return callAdminEndpoint(
    'updateSessionMaterial',
    {
      materialId,
      filename,
      ...(url == null ? {} : { url }),
    },
    idTokenGetter(user),
  );
}
