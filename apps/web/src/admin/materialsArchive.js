// The browser half of the materials archive (issue #189).
//
// `downloadSessionMaterialsArchive` answers a zip, not JSON, so it cannot go
// through adminApi.js's callAdminEndpoint, which always parses the body. The
// errors still take AdminApiError's shape and the server's words, so the page
// states them the way it states every other refusal.
//
// The server streams the archive and, when a file fails part way, destroys
// the response instead of ending it. The body read below then rejects, and
// nothing is saved: a cut-off zip saved under the archive's name would look
// whole until somebody opened it.
import { functionsOrigin } from '../contexts/AuthContext.jsx';
import { saveBlobAs } from '../lib/materialsSource.js';
import { AdminApiError } from './adminApi.js';

/** The name the server gives the archive, and the name the browser saves. */
export const ARCHIVE_FILENAME = 'session-materials.zip';

/** Most files one archive holds (functions/src/materials/bulk.cjs). */
export const MAX_ARCHIVE_FILES = 50;

const NETWORK_MESSAGE = 'We could not reach the server. Check your connection and try again.';
export const STOPPED_MESSAGE =
  'The archive stopped before it finished. Nothing was saved. Try again, or select fewer files.';

/**
 * POST the selected ids and save the zip the server streams back.
 *
 * @param {{ getIdToken: () => Promise<string>, materialIds: string[] }} args
 * @returns {Promise<void>} resolves once the browser has the file
 * @throws {AdminApiError}
 */
export async function downloadMaterialsArchive({ getIdToken, materialIds }) {
  let token;
  try {
    token = await getIdToken();
  } catch {
    throw new AdminApiError({
      code: 'unauthenticated',
      status: 401,
      message: 'Your session has expired. Sign in again.',
    });
  }

  let response;
  try {
    response = await fetch(`${functionsOrigin()}/downloadSessionMaterialsArchive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ materialIds }),
    });
  } catch {
    throw new AdminApiError({ code: 'network', status: 0, message: NETWORK_MESSAGE });
  }

  if (!response.ok) {
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    const error = payload?.error ?? {};
    throw new AdminApiError({
      code: typeof error.code === 'string' ? error.code : 'unknown',
      status: response.status,
      message: typeof error.message === 'string' && error.message ? error.message : 'Something went wrong. Try again.',
    });
  }

  let blob;
  try {
    blob = await response.blob();
  } catch {
    throw new AdminApiError({ code: 'network', status: response.status, message: STOPPED_MESSAGE });
  }
  saveBlobAs(blob, ARCHIVE_FILENAME);
}
