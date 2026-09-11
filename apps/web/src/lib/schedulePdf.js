// The public schedule PDF (issue #166, spec §9).
//
// The programme is public, so `buildSchedulePdf` is an unauthenticated GET
// — the same correctness the schedule page itself rests on. The response is
// a PDF document; it reaches the browser through a throwaway download
// anchor, the way downloadIcs and downloadSessionMaterialFile hand over
// bytes. This is the control the flag gates: features.schedulePdf off means
// the endpoint answers 404 and no button renders anywhere.

/** Thrown by {@link downloadSchedulePdf} when the server refuses or fails. */
export class SchedulePdfError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SchedulePdfError';
  }
}

/**
 * Download the whole-event schedule PDF.
 *
 * @param {{
 *   origin: string,
 *   fetchImpl?: typeof fetch,
 *   documentRef?: Document,
 * }} args
 * @returns {Promise<void>}
 */
export async function downloadSchedulePdf({ origin, fetchImpl, documentRef }) {
  const doFetch = fetchImpl ?? (typeof fetch === 'function' ? fetch : null);
  const doc = documentRef ?? (typeof document === 'undefined' ? null : document);
  if (!doFetch || !doc) {
    throw new SchedulePdfError('The schedule PDF could not be generated.');
  }
  let response;
  try {
    response = await doFetch(`${origin}/buildSchedulePdf`);
  } catch {
    throw new SchedulePdfError('We could not reach the server. Check your connection and try again.');
  }
  if (!response.ok) {
    throw new SchedulePdfError('The schedule PDF is not available for this event.');
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = doc.createElement('a');
  anchor.href = url;
  anchor.download = 'schedule.pdf';
  doc.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Deferred: revoking immediately can race the browser's own read of the
  // blob URL in some engines.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Download the signed-in caller's OWN schedule PDF (issue #171).
 *
 * The endpoint reads the caller's bookmarks from the verified token and
 * refuses a body that names another uid — the client passes none anyway.
 * The Authorization header rides on a POST, the same shape the other
 * authenticated endpoints use (fetchSessionMaterialUrl, bookmarkSession),
 * so the CORS preflight is the one those already answer.
 *
 * @param {{
 *   origin: string,
 *   user: import('firebase/auth').User,
 *   fetchImpl?: typeof fetch,
 *   documentRef?: Document,
 * }} args
 * @returns {Promise<void>}
 */
export async function downloadMySchedulePdf({ origin, user, fetchImpl, documentRef }) {
  const doFetch = fetchImpl ?? (typeof fetch === 'function' ? fetch : null);
  const doc = documentRef ?? (typeof document === 'undefined' ? null : document);
  if (!doFetch || !doc) {
    throw new SchedulePdfError('The schedule PDF could not be generated.');
  }
  if (!user) {
    throw new SchedulePdfError('Sign in to download your schedule.');
  }
  let response;
  try {
    response = await doFetch(`${origin}/buildMySchedulePdf`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${await user.getIdToken()}`,
      },
      body: JSON.stringify({}),
    });
  } catch {
    throw new SchedulePdfError('We could not reach the server. Check your connection and try again.');
  }
  if (!response.ok) {
    throw new SchedulePdfError('Your schedule PDF is not available right now.');
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = doc.createElement('a');
  anchor.href = url;
  anchor.download = 'my-schedule.pdf';
  doc.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
