// Session reactions: the client's two seams to the backend (issue #25, spec
// §9 "Session reactions"). All WRITES go through reactToSession — the
// firestore.rules for sessionReactions/{sessionId} (and its users/{uid}
// dedup subcollection) deny every client write, so there is no direct-write
// path to bypass. Reads of the public aggregate go straight to Firestore
// (rules: public read), the same "server writes, client reads" split
// bookmarksSource.js uses for the bookmark count.
//
// This is the one module that talks to Firestore/fetch for reactions; tests
// mock this module rather than the SDK, matching lib/bookmarksSource.js.
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase.js';
import { functionsOrigin } from '../contexts/AuthContext.jsx';
import { subscribeWithRetry } from './retrySubscription.js';

/** The fixed reaction vocabulary — must match functions/src/schedule/reactions.cjs REACTION_KINDS. */
export const REACTION_KINDS = Object.freeze(['👍', '❤️', '🎉', '💡', '👏']);

function emptyCounts() {
  const counts = {};
  for (const kind of REACTION_KINDS) counts[kind] = 0;
  return counts;
}

/**
 * Subscribe to a session's public reaction-count aggregate
 * (sessionReactions/{sessionId}). Calls onNext(counts) on every snapshot,
 * where counts is always a full REACTION_KINDS-keyed object (missing/zero
 * counts filled in) — never `null` or partial, so a caller never has to
 * guard `counts?.['👍'] ?? 0` itself. Returns the unsubscribe function.
 *
 * A listener error never touches `onNext` (fail soft, same as
 * bookmarksSource.js's subscribeMyBookmarks) — `onError` exists only so a
 * caller can unblock its own `loading` state.
 *
 * @param {string} sessionId
 * @param {(counts: Record<string, number>) => void} onNext
 * @param {(error: unknown) => void} [onError]
 */
export function subscribeSessionReactions(sessionId, onNext, onError) {
  if (!sessionId) {
    onNext(emptyCounts());
    return () => {};
  }
  return subscribeWithRetry(
    (onListenerError) =>
      onSnapshot(
        doc(db, 'sessionReactions', sessionId),
        (snapshot) => {
          const stored = snapshot.exists() ? snapshot.data()?.counts : null;
          onNext({ ...emptyCounts(), ...stored });
        },
        onListenerError,
      ),
    (error) => {
      console.warn(`sessionReactions/${sessionId} subscription failed; keeping last-known counts.`, error);
      onError?.(error);
    },
  );
}

/**
 * Subscribe to the signed-in user's own reaction on one session
 * (sessionReactions/{sessionId}/users/{uid}). Calls onNext(emoji|null).
 * Returns the unsubscribe function. Fail-soft on listener error, same
 * pattern as subscribeSessionReactions above.
 *
 * @param {string} sessionId
 * @param {string|null|undefined} uid
 * @param {(emoji: string|null) => void} onNext
 * @param {(error: unknown) => void} [onError]
 */
export function subscribeMySessionReaction(sessionId, uid, onNext, onError) {
  if (!sessionId || !uid) {
    onNext(null);
    return () => {};
  }
  return subscribeWithRetry(
    (onListenerError) =>
      onSnapshot(
        doc(db, 'sessionReactions', sessionId, 'users', uid),
        (snapshot) => onNext(snapshot.exists() ? snapshot.data()?.emoji ?? null : null),
        onListenerError,
      ),
    (error) => {
      console.warn(
        `sessionReactions/${sessionId}/users/${uid} subscription failed; keeping last-known reaction.`,
        error,
      );
      onError?.(error);
    },
  );
}

/** Thrown by {@link setSessionReaction} on any non-2xx response. */
export class ReactionRequestError extends Error {
  constructor({ code, message, status }) {
    super(message);
    this.name = 'ReactionRequestError';
    this.code = code;
    this.status = status;
  }
}

/**
 * Set (or clear, with `emoji: null`) a session reaction via the
 * reactToSession Cloud Function (functions/src/schedule/reactions.cjs).
 * Idempotent on the server, so a retried call after a network hiccup is
 * safe.
 *
 * @param {{ user: import('firebase/auth').User, sessionId: string, emoji: string|null }} args
 * @returns {Promise<{ emoji: string|null, counts: Record<string, number> }>}
 */
export async function setSessionReaction({ user, sessionId, emoji }) {
  if (!user) {
    throw new ReactionRequestError({
      code: 'unauthorized',
      status: 401,
      message: 'Sign in to react to sessions.',
    });
  }
  const token = await user.getIdToken();
  let response;
  try {
    response = await fetch(`${functionsOrigin()}/reactToSession`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ sessionId, emoji }),
    });
  } catch {
    throw new ReactionRequestError({
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
    throw new ReactionRequestError({
      code: typeof error.code === 'string' ? error.code : 'unknown',
      status: response.status,
      message: typeof error.message === 'string' ? error.message : 'The reaction could not be saved.',
    });
  }
  return payload;
}
