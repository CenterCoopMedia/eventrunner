// Session bookmarks: the client's two seams to the backend (issue #16, spec
// §9 "Bookmarks"). All WRITES go through bookmarkSession — the
// firestore.rules for users/{uid}/bookmarks deny every client write, so
// there is no direct-write path to bypass. Reads of the caller's own
// bookmarks go straight to Firestore (rules: self-read only), the same
// "server writes, client reads its own docs" split contentSource.js and
// configSource.js use for their collections.
//
// This is the one module that talks to Firestore/fetch for bookmarks; tests
// mock this module rather than the SDK, matching lib/contentSource.js.
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase.js';
import { functionsOrigin } from '../contexts/AuthContext.jsx';
import { subscribeWithRetry } from './retrySubscription.js';

/**
 * Subscribe to the signed-in user's bookmarked session ids. Calls
 * onNext(Set<sessionId>) on every snapshot. Returns the unsubscribe
 * function. A listener error (not signed in, rules-denied, offline) leaves
 * the last-known set in place rather than clearing it — fail soft, matches
 * contentSource.js.
 *
 * @param {string} uid
 * @param {(ids: Set<string>) => void} onNext
 */
export function subscribeMyBookmarks(uid, onNext) {
  if (!uid) {
    onNext(new Set());
    return () => {};
  }
  return subscribeWithRetry(
    (onError) =>
      onSnapshot(
        collection(db, `users/${uid}/bookmarks`),
        (snapshot) => onNext(new Set(snapshot.docs.map((d) => d.id))),
        onError,
      ),
    (error) => {
      console.warn('users/{uid}/bookmarks subscription failed; keeping last-known set.', error);
    },
  );
}

/** Thrown by {@link setSessionBookmarked} on any non-2xx response. */
export class BookmarkRequestError extends Error {
  constructor({ code, message, status }) {
    super(message);
    this.name = 'BookmarkRequestError';
    this.code = code;
    this.status = status;
  }
}

/**
 * Toggle a session's bookmark to the desired state via the bookmarkSession
 * Cloud Function (functions/src/schedule/bookmarks.cjs). Idempotent on the
 * server, so a retried call after a network hiccup is safe.
 *
 * @param {{ user: import('firebase/auth').User, sessionId: string, bookmarked: boolean }} args
 * @returns {Promise<{ bookmarked: boolean, count: number }>}
 */
export async function setSessionBookmarked({ user, sessionId, bookmarked }) {
  if (!user) {
    throw new BookmarkRequestError({
      code: 'unauthorized',
      status: 401,
      message: 'Sign in to bookmark sessions.',
    });
  }
  const token = await user.getIdToken();
  let response;
  try {
    response = await fetch(`${functionsOrigin()}/bookmarkSession`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ sessionId, bookmarked }),
    });
  } catch {
    throw new BookmarkRequestError({
      code: 'network',
      status: 0,
      message: 'We could not reach the server. Check your connection and try again.',
    });
  }
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const error = payload?.error ?? {};
    throw new BookmarkRequestError({
      code: typeof error.code === 'string' ? error.code : 'unknown',
      status: response.status,
      message: typeof error.message === 'string' ? error.message : 'The bookmark could not be saved.',
    });
  }
  return payload;
}
