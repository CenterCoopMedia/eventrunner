// The browser half of the invoice PDF (issue #209).
//
// `invoicePdf` answers a PDF, not JSON, so it cannot go through
// adminApi.js's callAdminEndpoint, which always parses the body. A refusal
// still takes AdminApiError's shape and the server's words, the same way
// materialsArchive.js states them. The file lives only in the response body
// and in the browser's download folder.
import { functionsOrigin } from '../contexts/AuthContext.jsx';
import { saveBlobAs } from '../lib/materialsSource.js';
import { AdminApiError } from './adminApi.js';

const NETWORK_MESSAGE = 'We could not reach the server. Check your connection and try again.';
export const STOPPED_MESSAGE = 'The download stopped before it finished. Nothing was saved. Try again.';

/** `INV-0004.pdf`. The number is capitals, digits and hyphens; anything else is replaced. */
export function invoicePdfFilename(number) {
  const safe = String(number ?? '').replace(/[^A-Za-z0-9-]/g, '_');
  return `${safe || 'invoice'}.pdf`;
}

/**
 * POST the invoice id and save the PDF the server sends.
 *
 * @param {{ getIdToken: () => Promise<string>, invoiceId: string, number: string }} args
 * @returns {Promise<void>} resolves once the browser has the file
 * @throws {AdminApiError}
 */
export async function downloadInvoicePdf({ getIdToken, invoiceId, number }) {
  let token;
  try {
    token = await getIdToken();
  } catch {
    throw new AdminApiError({ code: 'unauthenticated', status: 401, message: 'Your session has expired. Sign in again.' });
  }

  let response;
  try {
    response = await fetch(`${functionsOrigin()}/invoicePdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ invoiceId }),
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
  saveBlobAs(blob, invoicePdfFilename(number));
}
