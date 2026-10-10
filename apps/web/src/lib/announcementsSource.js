// Public site-wide announcements. Visitors read the projection document,
// which holds only rows whose window contains server time. Callers sanitize
// every row again before rendering it.
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase.js';
import { subscribeWithRetry } from './retrySubscription.js';
import { IS_DEMO } from './demoMode.js';

export function subscribeAnnouncements(onNext) {
  if (IS_DEMO) return () => {};
  return subscribeWithRetry(
    (onError) => onSnapshot(
      doc(db, 'announcements_public', 'current'),
      (snapshot) => {
        const rows = snapshot.exists() ? snapshot.data()?.announcements : [];
        onNext(Array.isArray(rows) ? rows : []);
      },
      onError,
    ),
    (error) => {
      console.warn('announcements subscription failed; keeping last-known rows and retrying.', error);
    },
  );
}
