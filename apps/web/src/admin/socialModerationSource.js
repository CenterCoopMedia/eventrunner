import {
  collection, connectFirestoreEmulator, doc, documentId, getDoc, getDocs,
  getFirestore, limit, orderBy, query, startAfter,
} from 'firebase/firestore/lite';
import { app, useEmulators } from '../firebase.js';

// This lazy staff screen needs fresh reads, not an offline store. Keeping
// its query APIs in the Lite module also keeps them out of the public SDK
// chunk. The same app supplies Auth; Firestore rules enforce each read.
const moderationDb = getFirestore(app);
if (useEmulators) connectFirestoreEmulator(moderationDb, '127.0.0.1', 8080);

export const REPORT_LIMIT = 50;

export async function loadSocialReports(cursor) {
  const snapshot = await getDocs(query(
    collection(moderationDb, 'social_reports'), orderBy('createdAt', 'desc'), orderBy(documentId(), 'desc'),
    ...(cursor ? [startAfter(cursor.createdAt, cursor.id)] : []), limit(REPORT_LIMIT),
  ));
  // The screen needs the target and time, never the reporter's identity.
  return snapshot.docs.map((entry) => {
    const data = entry.data();
    return { id: entry.id, postId: data.postId, createdAt: data.createdAt };
  });
}

export async function loadModerationPost(postId) {
  const snapshot = await getDoc(doc(moderationDb, 'social_posts', postId));
  const data = snapshot.data();
  if (!data) return null;
  if (data.state === 'active') return { state: 'active', text: data.text };
  return { state: 'removed' };
}
