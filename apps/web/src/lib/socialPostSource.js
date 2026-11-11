// Post and reply creation, browser side (issue #511; backend #510,
// functions/src/social/feed.cjs createSocialPost). Only the composer
// imports this module, and the composer is lazy, so none of it loads with
// the feed or the first page.
//
// The server decides access, the author and idempotency on every call:
//   201 / 200   { postId, state: 'active' }  stored / an exact replay
//   400         the request failed shared/socialPost readSocialPost
//   401 / 403   no session / no approved or speaker account
//   404         the feed is closed, or the parent root is not active
//   409         this submission key was used for another payload
//   410         the post under this key was removed by staff (terminal)
// Anything else, and a request that never answered, is retryable with the
// same key. This module never throws.
import { IS_DEMO } from './demoMode.js';
import { resolveFunctionsOrigin } from './errorReporting.js';

const RETRY_MESSAGE =
  'Your post was not confirmed. Check your connection, then select the button again. Your text is kept, and sending it again does not post it twice.';

/**
 * @param {{ user: { getIdToken: () => Promise<string> }|null, text: string,
 *           parentPostId: string|null, submissionKey: string,
 *           env?: object, fetchImpl?: typeof fetch }} input
 * @returns {Promise<{ ok: true, postId: string }
 *   | { ok: false, kind: 'invalid'|'auth'|'forbidden'|'closed'|'conflict'|'removed'|'retry', error: string }>}
 */
export async function createSocialPost({ user, text, parentPostId, submissionKey, env = import.meta.env, fetchImpl }) {
  if (IS_DEMO) return { ok: false, kind: 'closed', error: 'Posting is off in this read-only demo.' };
  if (!user || typeof user.getIdToken !== 'function') {
    return { ok: false, kind: 'auth', error: 'Sign in to post.' };
  }
  const send = fetchImpl ?? (typeof fetch === 'function' ? fetch : null);
  const origin = resolveFunctionsOrigin(env);
  if (!send || !origin) {
    return { ok: false, kind: 'retry', error: 'Posting is not available right now. Your text is kept. Try again later.' };
  }
  let token;
  try {
    token = await user.getIdToken();
  } catch {
    return { ok: false, kind: 'auth', error: 'Your session has expired. Sign in again to post.' };
  }
  const body = { text, submissionKey };
  if (parentPostId !== null) body.parentPostId = parentPostId;
  let response;
  try {
    response = await send(`${origin}/createSocialPost`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, kind: 'retry', error: RETRY_MESSAGE };
  }
  let answer = null;
  try {
    answer = await response.json();
  } catch {
    answer = null;
  }
  if ((response.status === 201 || response.status === 200)
      && answer?.state === 'active' && typeof answer.postId === 'string') {
    return { ok: true, postId: answer.postId };
  }
  const code = answer?.error?.code;
  const message = typeof answer?.error?.message === 'string' ? answer.error.message : '';
  switch (response.status) {
    case 400:
      // The shared validator names the field first ("text: ...").
      return { ok: false, kind: 'invalid', error: message.replace(/^text:\s*/, '') || 'Check the post and try again.' };
    case 401:
      return { ok: false, kind: 'auth', error: 'Your session has expired. Sign in again to post.' };
    case 403:
      return { ok: false, kind: 'forbidden', error: 'Posting is open to approved attendees and speakers.' };
    case 404:
      return parentPostId !== null
        ? { ok: false, kind: 'closed', error: 'Replies are closed right now. Your text was not sent.' }
        : { ok: false, kind: 'closed', error: 'The attendee feed is closed right now. Your text was not sent.' };
    case 409:
      if (code === 'submission-conflict') {
        return { ok: false, kind: 'conflict', error: 'This send did not match your earlier one. Your text is kept. Select the button again to send it as a new post.' };
      }
      break;
    case 410:
      if (code === 'post-removed') {
        return { ok: false, kind: 'removed', error: 'Event staff removed the post you sent earlier, so it was not sent again. Your text is kept. Edit it, or select the button again to send it as a new post.' };
      }
      break;
    default:
      break;
  }
  return { ok: false, kind: 'retry', error: RETRY_MESSAGE };
}
