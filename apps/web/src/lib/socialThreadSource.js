// One thread of the private attendee feed, browser side (issue #511;
// backend #510). The thread page is the only importer.
//
// READS. The root is one live document. Replies are every row whose
// `parentPostId` is the root, active or removed, oldest first by the
// server's `createdAt`; Firestore breaks a tie by document id in the same
// direction, so the order is total and stable (index: parentPostId,
// createdAt, __name__, all ascending). Every request is bounded:
//
//   - the live listener starts as the first THREAD_PAGE_SIZE replies;
//   - "Show more replies" fetches the next THREAD_PAGE_SIZE after the
//     newest loaded reply (`startAfter`), and the listener then
//     re-attaches through the new newest reply (`endAt`).
//
// So every loaded reply stays live (a removal turns it into a placeholder).
// The rules (firestore.rules, social_posts) are the boundary. Only
// server-confirmed snapshots reach the page (`fromCache` is false), so a
// cached result can never be shown to a different reader.
import {
  collection,
  doc,
  endAt,
  getDocsFromServer,
  limit,
  onSnapshot,
  orderBy,
  query,
  startAfter,
  where,
} from 'firebase/firestore';
import { MAX_SOCIAL_THREAD_PAGE_SIZE } from 'shared/socialPost';
import { db } from '../firebase.js';
import { subscribeWithRetry } from './retrySubscription.js';

const POSTS = 'social_posts';

/** Replies per page; the backend's bound. */
export const THREAD_PAGE_SIZE = MAX_SOCIAL_THREAD_PAGE_SIZE;

/** A post id the page may ask for: bounded, one path segment. */
export function isPostId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 128
    && !value.includes('/') && value !== '.' && value !== '..';
}

/**
 * A thread row as the page renders it, or null. A removed row keeps
 * nothing but its id and time. A row whose parent is not `parentPostId`
 * is dropped.
 *
 * @returns {{ id: string, removed: false, authorUid: string|null, text: string, createdAt: unknown }
 *   | { id: string, removed: true, createdAt: unknown } | null}
 */
export function toThreadEntry(id, data, parentPostId) {
  if (!data || data.parentPostId !== parentPostId) return null;
  if (data.state === 'removed') return { id, removed: true, createdAt: data.createdAt ?? null };
  if (data.state !== 'active' || typeof data.text !== 'string') return null;
  return {
    id,
    removed: false,
    authorUid: typeof data.authorUid === 'string' && data.authorUid ? data.authorUid : null,
    text: data.text,
    createdAt: data.createdAt ?? null,
  };
}

/**
 * Subscribe to the root post. `onNext(null)` means missing, removed, or not
 * a root: the page shows "Original post removed".
 *
 * @returns {() => void} unsubscribe; it also cancels a pending retry
 */
export function subscribeThreadRoot(postId, onNext, onFail) {
  return subscribeWithRetry(
    (onError) =>
      onSnapshot(
        doc(db, POSTS, postId),
        { includeMetadataChanges: true },
        (snapshot) => {
          if (snapshot.metadata?.fromCache !== false) return;
          const entry = snapshot.exists() ? toThreadEntry(snapshot.id, snapshot.data(), null) : null;
          onNext(entry && !entry.removed ? entry : null);
        },
        onError,
      ),
    (error) => {
      console.warn('thread post subscription failed; retrying.', error);
      onFail?.(error);
    },
  );
}

/** Replies to one root, oldest first; the clauses every reply read shares. */
function replies(rootId, ...bounds) {
  return query(
    collection(db, POSTS),
    where('parentPostId', '==', rootId),
    orderBy('createdAt', 'asc'),
    ...bounds,
  );
}

/**
 * Subscribe to the loaded replies: the first THREAD_PAGE_SIZE, or, once
 * more are loaded, every reply up to and including `through`.
 *
 * @param {(entries: Array<object>, page: { last: object|null, size: number }) => void} onNext
 * @returns {() => void}
 */
export function subscribeReplies({ rootId, through }, onNext, onFail) {
  const target = through ? replies(rootId, endAt(through)) : replies(rootId, limit(THREAD_PAGE_SIZE));
  return subscribeWithRetry(
    (onError) =>
      onSnapshot(
        target,
        { includeMetadataChanges: true },
        (snapshot) => {
          if (snapshot.metadata?.fromCache !== false) return;
          onNext(
            snapshot.docs.map((d) => toThreadEntry(d.id, d.data(), rootId)).filter(Boolean),
            { last: snapshot.docs.at(-1) ?? null, size: snapshot.docs.length },
          );
        },
        onError,
      ),
    (error) => {
      console.warn('thread replies subscription failed; retrying.', error);
      onFail?.(error);
    },
  );
}

/**
 * The next page after `after`, from the server only. Only its size and its
 * newest document are used: the listener re-attaches through it.
 *
 * @returns {Promise<{ ok: true, last: object|null, size: number } | { ok: false }>}
 */
export async function fetchMoreReplies(rootId, after) {
  try {
    const snapshot = await getDocsFromServer(replies(rootId, startAfter(after), limit(THREAD_PAGE_SIZE)));
    return { ok: true, last: snapshot.docs.at(-1) ?? null, size: snapshot.docs.length };
  } catch (error) {
    console.warn('more thread replies failed to load.', error);
    return { ok: false };
  }
}
