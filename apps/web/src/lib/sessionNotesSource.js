// Per-session private notes: the client's seam to `users/{uid}/sessionNotes`
// (issue #170). Unlike bookmarks — whose writes go through the Admin SDK —
// a note is the attendee's own words in their own subtree, so the rules let
// the owner read, write, and clear these documents directly. Another account
// can do none of those things (firestore.rules, the sessionNotes match).
//
// Tests mock this module rather than the SDK (lib/contentSource.js rule).
import { doc, onSnapshot, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase.js';
import { subscribeWithRetry } from './retrySubscription.js';

// The same bound the rules enforce: a note is text and only text.
export const SESSION_NOTE_MAX_LENGTH = 10000;

/**
 * Subscribe to one session's private note. Calls onNext(text) immediately
 * with the current answer ('' before the first snapshot), then again on
 * every change. A document the owner has not written yet is an empty note,
 * not an error.
 *
 * @param {string} uid
 * @param {string} sessionId
 * @param {(text: string) => void} onNext
 * @param {(error: unknown) => void} [onError]
 */
export function subscribeSessionNote(uid, sessionId, onNext, onError) {
  if (!uid || !sessionId) {
    onNext('');
    return () => {};
  }
  return subscribeWithRetry(
    (onListenerError) =>
      onSnapshot(
        doc(db, `users/${uid}/sessionNotes/${sessionId}`),
        (snapshot) => {
          const text = snapshot.exists() ? snapshot.data()?.text : '';
          onNext(typeof text === 'string' ? text : '');
        },
        onListenerError,
      ),
    (error) => {
      console.warn('session note subscription failed; keeping last-known text.', error);
      onError?.(error);
    },
  );
}

/**
 * Save one session's note. An empty text clears the document outright — a
 * note the reader emptied is a note the reader deleted, so nothing lingers.
 *
 * @param {string} uid
 * @param {string} sessionId
 * @param {string} text
 * @returns {Promise<void>}
 */
export async function saveSessionNote(uid, sessionId, text) {
  if (!uid || !sessionId) return;
  const safe = typeof text === 'string' ? text.slice(0, SESSION_NOTE_MAX_LENGTH) : '';
  const ref = doc(db, `users/${uid}/sessionNotes/${sessionId}`);
  if (safe.length === 0) {
    await deleteDoc(ref);
    return;
  }
  await setDoc(ref, { text: safe });
}
