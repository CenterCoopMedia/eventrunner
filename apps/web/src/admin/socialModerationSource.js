import { collection, doc, documentId, limit, onSnapshot, orderBy, query, startAfter } from 'firebase/firestore';
import { db } from '../firebase.js';
import { subscribeWithRetry } from '../lib/retrySubscription.js';

export const REPORT_LIMIT = 50;

// Reports stay private. The screen needs the target and time, never the
// reporter's identity or a second copy of the post.
export function subscribeSocialReports(cursor, onNext, onError) {
  return subscribeWithRetry(
    (failed) => onSnapshot(
      query(collection(db, 'social_reports'), orderBy('createdAt', 'desc'), orderBy(documentId(), 'desc'),
        ...(cursor ? [startAfter(cursor.createdAt, cursor.id)] : []), limit(REPORT_LIMIT)),
      { includeMetadataChanges: true },
      (snapshot) => {
        // A previous account's cached rows are not an access verdict.
        if (snapshot.metadata.fromCache) return;
        onNext(snapshot.docs.map((entry) => {
          const data = entry.data();
          return { id: entry.id, postId: data.postId, createdAt: data.createdAt };
        }));
      },
      failed,
    ),
    onError,
  );
}

export function subscribeModerationPost(postId, onNext, onError) {
  return subscribeWithRetry(
    (failed) => onSnapshot(doc(db, 'social_posts', postId), { includeMetadataChanges: true }, (snapshot) => {
      if (snapshot.metadata.fromCache) return;
      const data = snapshot.data();
      if (!data) onNext(null);
      else if (data.state === 'active') onNext({ state: 'active', text: data.text });
      else onNext({ state: 'removed' });
    }, failed),
    onError,
  );
}
