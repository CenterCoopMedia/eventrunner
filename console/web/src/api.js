// The console's only server door: one POST per action to /api/<name>,
// with the signed-in user's ID token. console/firebase.json rewrites each
// path to the function of the same name. VITE_CONSOLE_API_BASE points a
// local dev server at the functions emulator instead.
import { auth } from './firebase.js';

const BASE = (import.meta.env.VITE_CONSOLE_API_BASE || '').replace(/\/+$/, '');

export class ApiError extends Error {
  /** `fields` maps a field path to a message, for a form; {} when there are none. */
  constructor(status, code, message, fields = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

/**
 * @param {string} name the function name, for example 'getTeam'
 * @param {object} body
 * @returns {Promise<object>} the response body
 * @throws {ApiError} with a message that is safe to show
 */
export async function callApi(name, body = {}) {
  const user = auth.currentUser;
  if (!user) throw new ApiError(401, 'unauthorized', 'Sign in to continue.');
  const token = await user.getIdToken();
  let response;
  try {
    response = await fetch(`${BASE}/api/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network', 'We could not reach the server. Check your connection and try again.');
  }
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const error = payload?.error;
    throw new ApiError(
      response.status,
      error?.code || 'internal',
      typeof error?.message === 'string' ? error.message : 'Something went wrong. Try again.',
      error?.fields && typeof error.fields === 'object' ? error.fields : {},
    );
  }
  return payload;
}
