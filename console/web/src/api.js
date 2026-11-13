// The console's only server door: one POST per action to /api/<name>,
// with the signed-in user's ID token. console/firebase.json rewrites each
// path to the function of the same name. VITE_CONSOLE_API_BASE points a
// local dev server at the functions emulator instead.
import { auth } from './firebase.js';

const BASE = (import.meta.env.VITE_CONSOLE_API_BASE || '').replace(/\/+$/, '');

export class ApiError extends Error {
  /** `fields` maps a field path to a message, for a form; {} when there are none. */
  constructor(status, code, message, fields = {}, field = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields;
    // The input a refusal is about, when the server names one.
    this.field = field;
  }
}

/**
 * @param {string} name the function name, for example 'getTeam'
 * @param {object} body
 * @returns {Promise<object>} the response body
 * @throws {ApiError} with a message that is safe to show
 */
export async function callApi(name, body = {}, { keepalive = false } = {}) {
  const user = auth.currentUser;
  if (!user) throw new ApiError(401, 'unauthorized', 'Sign in to continue.');
  let token;
  try {
    token = await user.getIdToken();
  } catch (error) {
    if (error?.code === 'auth/network-request-failed') {
      throw new ApiError(0, 'network', 'We could not reach the server. Check your connection and try again.');
    }
    throw new ApiError(401, 'unauthorized', 'We could not confirm your sign-in. Sign out, then sign in again.');
  }
  const serialized = JSON.stringify(body);
  // Fetch keepalive has a shared 64 KiB body budget. The lifecycle handler
  // has already kept the answer; large answers use the ordinary save too.
  const canKeepAlive = keepalive && new TextEncoder().encode(serialized).byteLength <= 64 * 1024;
  let response;
  try {
    response = await fetch(`${BASE}/api/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: serialized,
      ...(canKeepAlive ? { keepalive: true } : {}),
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
    const code = error?.code || 'internal';
    // ConsoleError messages are safe to show at any status.
    const message = code !== 'internal' && typeof error?.message === 'string' && error.message.trim()
      ? error.message : 'We could not complete this action. Try again.';
    throw new ApiError(
      response.status,
      code,
      message,
      error?.fields && typeof error.fields === 'object' ? error.fields : {},
      typeof error?.field === 'string' ? error.field : null,
    );
  }
  return payload;
}
