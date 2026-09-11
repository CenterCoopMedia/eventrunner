// The public bookmark counts (issue #165, spec §9).
//
// `sessionBookmarks/{sessionId}` is a plain aggregate — `{ count,
// updatedAt }` per session, written only by the bookmarkSession Cloud
// Function, read by anyone (firestore.rules). It answers "how many
// attendees saved this session" and nothing else: no identities, no per
// attendee rows in the public document. One listener over the whole
// collection, ref-counted the way materialsSource.js does it — a schedule
// page draws every session at once, so a listener per row would scale with
// the programme rather than with the page.
//
// Tests mock this module rather than the SDK (lib/contentSource.js rule).
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase.js';
import { subscribeWithRetry } from './retrySubscription.js';

/**
 * Subscribe to every session's aggregate bookmark count. Calls
 * onNext(Map<sessionId, count>) immediately with the current answer (an
 * empty map before the first snapshot), then again on every change.
 * Returns the unsubscribe function. A count that is not a number reads as
 * zero rather than poisoning the sort.
 *
 * @param {(counts: Map<string, number>) => void} onNext
 * @param {(error: unknown) => void} [onError]
 */
export function subscribeBookmarkCounts(onNext, onError) {
  return subscribeWithRetry(
    (onListenerError) =>
      onSnapshot(
        collection(db, 'sessionBookmarks'),
        (snapshot) => {
          const counts = new Map();
          for (const doc of snapshot.docs) {
            const value = doc.data()?.count;
            counts.set(doc.id, typeof value === 'number' && Number.isFinite(value) ? value : 0);
          }
          onNext(counts);
        },
        onListenerError,
      ),
    (error) => {
      console.warn('sessionBookmarks subscription failed; keeping last-known counts.', error);
      onError?.(error);
    },
  );
}
