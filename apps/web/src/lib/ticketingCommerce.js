import { functionsOrigin } from './firebaseSettings.js';
import { appCheckHeaders } from './firebaseLoader.js';

export const TICKETING_ID_RE = /^[A-Za-z0-9_-]{1,160}$/;

export class TicketingRequestError extends Error {
  constructor(code, message, status = 0) {
    super(message);
    this.name = 'TicketingRequestError';
    this.code = code;
    this.status = status;
  }
}

/** Private order responses must never be cached by the browser or a service worker. */
export async function ticketingRequest(name, { user, body, query, signal } = {}) {
  const headers = { ...await appCheckHeaders() };
  if (user) {
    try {
      headers.Authorization = `Bearer ${await user.getIdToken()}`;
    } catch {
      throw new TicketingRequestError('unauthenticated', 'Your session has expired. Sign in again.', 401);
    }
  }
  if (body) headers['Content-Type'] = 'application/json';
  const suffix = query ? `?${new URLSearchParams(query)}` : '';
  let response;
  try {
    response = await fetch(`${functionsOrigin()}/${name}${suffix}`, {
      method: body ? 'POST' : 'GET', headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
      cache: 'no-store', referrerPolicy: 'no-referrer', signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new TicketingRequestError('network', 'We could not reach ticketing. Check your connection and try again.');
  }
  let payload;
  try { payload = await response.json(); } catch { payload = null; }
  if (!response.ok || !payload) {
    const message = response.status === 404
      ? 'This order is not available to this account. Sign in with the purchaser’s verified email, or contact the organizers.'
      : payload?.error?.message || 'Ticketing could not complete this request. Try again.';
    const error = new TicketingRequestError(payload?.error?.code || 'unknown', message, response.status);
    if (TICKETING_ID_RE.test(payload?.error?.existingOrderId || '')) error.existingOrderId = payload.error.existingOrderId;
    throw error;
  }
  return payload;
}
