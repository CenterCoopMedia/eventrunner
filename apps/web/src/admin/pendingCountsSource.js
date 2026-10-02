import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase.js';
import { subscribeWithRetry } from '../lib/retrySubscription.js';
import { COLLECTION_CHOICES } from './collectionWords.js';

function readCounts(data) {
  if (data?.schemaVersion !== 1 || !data.counts) return null;
  const counts = {};
  for (const { id } of COLLECTION_CHOICES) {
    const count = data.counts[id];
    if (!Number.isSafeInteger(count) || count < 0) return null;
    counts[id] = count;
  }
  return counts;
}

/**
 * One document listener, with an authenticated bootstrap for an existing
 * site that has no count yet. Missing or malformed counts are never zero.
 */
export function subscribePendingCounts(initialize, onNext, onError) {
  return subscribeWithRetry(
    (handleError) => {
      let stopped = false;
      let initializing = false;
      let detach;
      const fail = (error) => {
        if (stopped) return;
        stopped = true;
        // Bootstrap failures do not terminate Firestore's listener. Detach
        // it before the retry wrapper opens another one.
        detach?.();
        handleError(error);
      };
      detach = onSnapshot(
        doc(db, 'cmsMeta', 'pending'),
        (snapshot) => {
          if (stopped) return;
          const counts = readCounts(snapshot.exists() ? snapshot.data() : null);
          if (counts) {
            onNext(counts);
          } else if (!initializing) {
            initializing = true;
            Promise.resolve().then(() => {
              if (!stopped) return initialize();
            }).catch(fail).finally(() => {
              initializing = false;
            });
          }
        },
        fail,
      );
      if (stopped) detach?.();
      return () => {
        stopped = true;
        detach?.();
      };
    },
    (error) => {
      console.warn('Unpublished changes count subscription failed; retrying.', error);
      onError?.(error);
    },
  );
}
