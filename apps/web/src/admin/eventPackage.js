// The browser half of the event data package (issue #329).
//
// `downloadEventPackage` answers a zip, not JSON, so it cannot go through
// adminApi.js's callAdminEndpoint, which always parses the body. A refusal
// still takes AdminApiError's shape and the server's words, the same way
// materialsArchive.js states them. The zip lives only in the response body
// and in the browser's download folder.
import { functionsOrigin } from '../contexts/AuthContext.jsx';
import { saveBlobAs } from '../lib/materialsSource.js';
import { AdminApiError } from './adminApi.js';

/**
 * The parts of a package, in the server's order
 * (functions/src/admin/eventPackage.cjs SECTIONS). A test holds the ids to
 * the server's list.
 */
export const PACKAGE_SECTIONS = Object.freeze([
  { id: 'content', label: 'Site content and settings', hint: 'Event details, pages, content blocks, updates, timeline, announcements, live updates, and the media library index.' },
  { id: 'program', label: 'Program', hint: 'Sessions with their days, times, and speaker links.' },
  { id: 'speakers', label: 'Speakers', hint: 'Speaker records with email addresses and status.' },
  { id: 'organizations', label: 'Organizations and sponsors', hint: 'Names, tiers, websites, and logo paths.' },
  { id: 'materials', label: 'Session materials', hint: 'Each material’s link or file path and its review state. The files stay in Storage.' },
  { id: 'attendees', label: 'Attendees', hint: 'Names, email addresses, profile details, and registration status.' },
  { id: 'orders', label: 'Ticket orders and admissions', hint: 'Purchasers, amounts, payment and refund state, and one row per ticket.' },
  { id: 'billing', label: 'Invoices', hint: 'Every invoice as it was issued, with its payment or void. The invoice settings stay behind.' },
  { id: 'pitches', label: 'Session pitches', hint: 'Submissions with their review status.' },
]);

const NETWORK_MESSAGE = 'We could not reach the server. Check your connection and try again.';
export const STOPPED_MESSAGE = 'The download stopped before it finished. Nothing was saved. Try again.';

/**
 * `event-data-package-2026-10-01.zip`. The server names the file in
 * Content-Disposition, but CORS does not expose that header to a page on
 * another origin, so the same dated name is built here when it is absent.
 */
export function packageFilename(disposition, at = new Date()) {
  const match = typeof disposition === 'string' ? disposition.match(/filename="([A-Za-z0-9._-]+\.zip)"/) : null;
  return match ? match[1] : `event-data-package-${at.toISOString().slice(0, 10)}.zip`;
}

/**
 * POST the choices and save the zip the server sends.
 *
 * @param {{ getIdToken: () => Promise<string>, sections: string[], includeStaffNotes: boolean }} args
 * @returns {Promise<{ filename: string, bytes: number }>}
 * @throws {AdminApiError}
 */
export async function downloadEventPackage({ getIdToken, sections, includeStaffNotes }) {
  let token;
  try {
    token = await getIdToken();
  } catch {
    throw new AdminApiError({ code: 'unauthenticated', status: 401, message: 'Your session has expired. Sign in again.' });
  }

  let response;
  try {
    response = await fetch(`${functionsOrigin()}/downloadEventPackage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ sections, includeStaffNotes }),
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
  const filename = packageFilename(response.headers?.get?.('Content-Disposition'));
  saveBlobAs(blob, filename);
  return { filename, bytes: blob.size };
}
