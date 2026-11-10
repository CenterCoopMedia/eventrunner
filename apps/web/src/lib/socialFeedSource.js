// The private attendee feed, browser side (issue #788; backend #506 in
// functions/src/social/feed.cjs). The one seam between the feed UI and
// Firebase: the component imports this module and holds no Firestore type.
//
// READS. The root feed is one bounded live query: active root posts only
// (`state == 'active'`, `parentPostId == null`), newest first by the
// server's `createdAt`. Firestore breaks a `createdAt` tie by document id,
// so the order is stable and a larger limit only adds older posts after the
// ones already shown. The rules (firestore.rules, social_posts) are the
// boundary: an attendee query succeeds only while both flags are on and the
// reader holds a current grant. A removed post is a tombstone with
// `state: 'removed'` and never matches this query; an active reply has a
// parent id and never matches it either.
//
// REPORTS. reportSocialPost takes `{ postId }` and nothing else. The server
// decides access and idempotency on every call: a repeated report returns
// 200 with the same body as the first one's 201. This module never throws;
// every failure comes back as `{ ok: false, error }` for the feed to state.
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { db } from '../firebase.js';
import { IS_DEMO } from './demoMode.js';
import { resolveFunctionsOrigin } from './errorReporting.js';
import { subscribeWithRetry } from './retrySubscription.js';

const POSTS = 'social_posts';

/** The newest posts shown at first, and the step "Show older posts" adds. */
export const FEED_PAGE_SIZE = 20;
/** The most posts one reader's query asks for. */
export const FEED_MAX_POSTS = 100;

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

/**
 * Subscribe to the newest active root posts.
 *
 * @param {{ max: number }} options how many posts to ask for
 * @param {(posts: Array<object>) => void} onNext
 * @param {(error: unknown) => void} [onFail] called on every listener error
 * @returns {() => void} unsubscribe; it also cancels a pending retry
 */
export function subscribeRootFeed({ max }, onNext, onFail) {
  const size = Math.min(Math.max(1, Math.floor(max) || FEED_PAGE_SIZE), FEED_MAX_POSTS);
  const target = query(
    collection(db, POSTS),
    where('state', '==', 'active'),
    where('parentPostId', '==', null),
    orderBy('createdAt', 'desc'),
    limit(size),
  );
  return subscribeWithRetry(
    (onError) =>
      onSnapshot(
        target,
        (snapshot) => {
          onNext(snapshot.docs.map((d) => toFeedPost(d.id, d.data())).filter(Boolean));
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
