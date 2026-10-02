// Public site-wide announcements. The collection is public-readable and
// server-written; callers sanitize every row again before rendering it.
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase.js';
import { subscribeWithRetry } from './retrySubscription.js';
import { IS_DEMO } from './demoMode.js';

export function subscribeAnnouncements(onNext) {
  if (IS_DEMO) return () => {};
  return subscribeWithRetry(
    (onError) => onSnapshot(
      collection(db, 'announcements'),
      (snapshot) => onNext(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))),
      onError,
    ),
    (error) => {
      console.warn('announcements subscription failed; keeping last-known rows and retrying.', error);
    },
  );
}
