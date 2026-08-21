// Live-updates dashboard feed subscription (issue #28, spec §9 "Live updates
// card"). `live_updates` is a plain public-readable admin-authored feed — no
// two-revision model, no `visible` filter (firestore.rules: read: if true) —
// so this seam only needs to subscribe, order, and cap the page size.
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../firebase.js';
import { subscribeWithRetry } from './retrySubscription.js';

const MAX_ROWS = 20;

/**
 * @param {(docs: Array<object>) => void} onNext receives `{ id, ...data }`,
 *   newest first
 * @returns {() => void} unsubscribe
 */
export function subscribeLiveUpdates(onNext) {
  const target = query(collection(db, 'live_updates'), orderBy('postedAt', 'desc'), limit(MAX_ROWS));
  return subscribeWithRetry(
    (onError) =>
      onSnapshot(
        target,
        (snapshot) => {
          onNext(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
        },
        onError,
      ),
    (error) => {
      // Fail soft: the caller keeps its last-known rows; subscribeWithRetry
      // re-attaches a fresh listener after a delay.
      console.warn('live_updates subscription failed; keeping last-known rows and retrying.', error);
    },
  );
}
