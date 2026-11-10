// The private attendee feed, browser side (issue #788; backend #506 in
// functions/src/social/feed.cjs). The one seam between the feed UI and
// Firebase: the component imports this module and holds no Firestore type.
//
// READS. The feed is newest first by the server's `createdAt`, and
// Firestore breaks a tie by document id, so the order is total and stable.
// Every request is bounded:
//
//   - the live listener starts as the newest FEED_PAGE_SIZE active root
//     posts (`limit`);
//   - "Show older posts" fetches the next FEED_PAGE_SIZE after the oldest
//     loaded post (`startAfter` that document, `limit`), and the listener
//     then re-attaches through the new oldest post (`endAt` that document).
//
// So every loaded post stays live (a removal drops it), a new post cannot
// push a loaded one out of view, and history is never cut off. The rules
// (firestore.rules, social_posts) are the boundary: an attendee query
// succeeds only while both flags are on and the reader holds a current
// grant. Only server-confirmed snapshots reach the feed (`fromCache` is
// false), so a cached result can never be shown to a different reader. A
// removed post is a tombstone with `state: 'removed'` and never
// matches; an active reply has a parent id and never matches either.
//
// REPORTS. reportSocialPost takes `{ postId }` and nothing else. The server
// decides access and idempotency on every call: a repeated report returns
// 200 with the same body as the first one's 201. This module never throws;
// every failure comes back as `{ ok: false, error }` for the feed to state.
import {
  collection,
  doc,
  endAt,
  getDocFromServer,
  getDocsFromServer,
  limit,
  onSnapshot,
  orderBy,
  query,
  startAfter,
  where,
} from 'firebase/firestore';
import { db } from '../firebase.js';
import { IS_DEMO } from './demoMode.js';
import { resolveFunctionsOrigin } from './errorReporting.js';
import { subscribeWithRetry } from './retrySubscription.js';

const POSTS = 'social_posts';

/** The newest posts shown at first, and the step "Show older posts" adds. */
export const FEED_PAGE_SIZE = 20;

/**
 * A post row as the feed renders it, or null for anything that is not an
 * active root post with text. The query already excludes the rest; this is
 * the render-side check, so a malformed row is dropped instead of drawn.
 *
 * @param {string} id
 * @param {object} data
 * @returns {{ id: string, authorUid: string|null, text: string, createdAt: unknown } | null}
 */
export function toFeedPost(id, data) {
  if (!data || data.state !== 'active' || data.parentPostId !== null) return null;
  if (typeof data.text !== 'string') return null;
  return {
    id,
    authorUid: typeof data.authorUid === 'string' && data.authorUid ? data.authorUid : null,
    text: data.text,
    createdAt: data.createdAt ?? null,
  };
}

/** Active root posts, newest first; the clauses every feed read shares. */
function rootPosts(...bounds) {
  return query(
    collection(db, POSTS),
    where('state', '==', 'active'),
    where('parentPostId', '==', null),
    orderBy('createdAt', 'desc'),
    ...bounds,
  );
}

/**
 * Subscribe to the loaded part of the feed: the newest FEED_PAGE_SIZE
 * posts, or, once older posts are loaded, every post down to and including
 * `through`.
 *
 * @param {{ through: object|null }} options a document from fetchOlderPage
 * @param {(posts: Array<object>, page: { last: object|null, size: number }) => void} onNext
 *   `last` is the oldest document, the cursor for the next older page
 * @param {(error: unknown) => void} [onFail] called on every listener error
 * @returns {() => void} unsubscribe; it also cancels a pending retry
 */
export function subscribeRootFeed({ through }, onNext, onFail) {
  const target = through ? rootPosts(endAt(through)) : rootPosts(limit(FEED_PAGE_SIZE));
  return subscribeWithRetry(
    (onError) =>
      onSnapshot(
        target,
        // Without metadata changes the SDK emits nothing when a cached
        // answer is merely confirmed by the server, and the feed would
        // wait on the dropped cache snapshot forever.
        { includeMetadataChanges: true },
        (snapshot) => {
          // Only what the server returned under the current sign-in. A
          // cache answer was authorized for whoever read it before, and
          // after an account switch while offline that was another reader.
          if (snapshot.metadata?.fromCache !== false) return;
          onNext(
            snapshot.docs.map((d) => toFeedPost(d.id, d.data())).filter(Boolean),
            { last: snapshot.docs.at(-1) ?? null, size: snapshot.docs.length },
          );
        },
        onError,
      ),
    (error) => {
      console.warn('attendee feed subscription failed; retrying.', error);
      onFail?.(error);
    },
  );
}

/**
 * Find the next older page after `after`. Only its size and its oldest
 * document are used: the listener re-attaches through that document.
 *
 * @param {object} after the oldest loaded document, or the retained cursor
 * @returns {Promise<{ ok: true, last: object|null, size: number } | { ok: false }>}
 */
export async function fetchOlderPage(after) {
  try {
    // From the server only: an offline cache answer can be empty while
    // older posts exist, and an empty page ends pagination.
    const snapshot = await getDocsFromServer(rootPosts(startAfter(after), limit(FEED_PAGE_SIZE)));
    return { ok: true, last: snapshot.docs.at(-1) ?? null, size: snapshot.docs.length };
  } catch (error) {
    console.warn('older attendee feed posts failed to load.', error);
    return { ok: false };
  }
}

/**
 * The display name on one author's users_public projection, read from the
 * server under the current sign-in, or null. A private, missing or
 * unreadable profile, an offline read, or a malformed name is null, and
 * the feed shows its neutral fallback. Never a cache answer: a cached
 * projection may have been readable only to a previous reader.
 *
 * @param {string} uid
 * @returns {Promise<string|null>}
 */
export async function fetchAuthorName(uid) {
  try {
    const snapshot = await getDocFromServer(doc(db, 'users_public', uid));
    if (!snapshot.exists()) return null;
    const name = snapshot.data()?.displayName;
    return typeof name === 'string' && name.trim() ? name.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Report one post. Sends only the post id; the server takes the reporter
 * from the ID token.
 *
 * @param {{ user: { getIdToken: () => Promise<string> }|null, postId: string,
 *           env?: object, fetchImpl?: typeof fetch }} input
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export async function reportSocialPost({ user, postId, env = import.meta.env, fetchImpl }) {
  if (IS_DEMO) return { ok: false, error: 'Reports are off in this read-only demo.' };
  if (!user || typeof user.getIdToken !== 'function') {
    return { ok: false, error: 'Sign in to report a post.' };
  }
  const send = fetchImpl ?? (typeof fetch === 'function' ? fetch : null);
  const origin = resolveFunctionsOrigin(env);
  if (!send || !origin) {
    return { ok: false, error: 'Reports are not available right now. Try again later.' };
  }
  let token;
  try {
    token = await user.getIdToken();
  } catch {
    return { ok: false, error: 'Your session has expired. Sign in again.' };
  }
  let response;
  try {
    response = await send(`${origin}/reportSocialPost`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ postId }),
    });
  } catch {
    return { ok: false, error: 'We could not reach the server. Check your connection and try again.' };
  }
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (response.ok && body?.reported === true) return { ok: true };
  const message = typeof body?.error?.message === 'string' ? body.error.message : null;
  return { ok: false, error: message || 'The report could not be sent. Try again.' };
}
