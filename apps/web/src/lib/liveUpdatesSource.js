// Live-updates dashboard feed subscription (issue #28, spec §9 "Live updates
// card"). `live_updates` is an admin-authored feed with no two-revision
// model and no `visible` filter.
//
// AUDIENCE (issue #200). Each row names who may read it, and
// firestore.rules gate the read: a list query succeeds only when every row
// it could return is one the reader may see. So both queries carry
// `where('audience', 'in', audiences)`, and `readableAudiences` below must
// give the same list the rules' readableLiveUpdateAudiences() gives. A
// wider list than the rules allow fails the query; it never leaks a row.
//
// Two listeners, not one: a single `orderBy(postedAt desc) limit(N)` query
// can push an older PINNED entry off the page entirely once N newer unpinned
// entries land, contradicting the "pinned entries always show" promise
// (Codex P2 finding). So pinned rows are queried separately with no
// practical cap and merged with the capped "recent" query;
// LiveUpdatesCard still partitions pinned-first from the merged, id-deduped,
// postedAt-sorted result this module hands it.
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { db } from '../firebase.js';
import { subscribeWithRetry } from './retrySubscription.js';

const RECENT_CAP = 20;
// Generous rather than "unlimited" — a runaway pinned count is an operator
// mistake, not a case worth an uncapped read.
const PINNED_CAP = 100;

/**
 * Who may read a row, widest first. functions/src/admin/liveUpdates.cjs
 * (AUDIENCES) and firestore.rules carry the same three words.
 */
export const LIVE_UPDATE_AUDIENCES = Object.freeze(['everyone', 'attendees', 'speakers']);

/**
 * The audiences this reader may see, as firestore.rules decide them:
 * signed out, `everyone`; an approved attendee, `attendees` as well; a
 * speaker (`speakerId` set on their own account) or an admin, all three.
 * The profile is the reader's own users/{uid} doc, the one the rules read.
 *
 * @param {{ signedIn: boolean, profile?: object | null, isAdmin?: boolean }} reader
 * @returns {string[]}
 */
export function readableAudiences({ signedIn, profile = null, isAdmin = false }) {
  if (!signedIn) return ['everyone'];
  if (isAdmin || (profile?.speakerId ?? null) !== null) return [...LIVE_UPDATE_AUDIENCES];
  if (profile?.registrationStatus === 'approved') return ['everyone', 'attendees'];
  return ['everyone'];
}

/** Firestore Timestamp, Date, or epoch millis — whatever the doc carries. */
function postedAtMs(doc) {
  const value = doc?.postedAt;
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.getTime() : 0;
}

/**
 * @param {string[]} audiences from readableAudiences — the query's predicate
 * @param {(docs: Array<object>) => void} onNext receives `{ id, ...data }`,
 *   newest first, pinned or not — LiveUpdatesCard partitions pinned-first
 * @returns {() => void} unsubscribe
 */
export function subscribeLiveUpdates(audiences, onNext) {
  // null = no snapshot yet from that listener; both must report at least
  // once before emitting, same convention as admin/useAdminPages.js — an
  // empty array is a legitimate answer, a still-null one is not.
  let pinnedDocs = null;
  let recentDocs = null;

  function emit() {
    if (pinnedDocs === null || recentDocs === null) return;
    const merged = new Map();
    for (const d of recentDocs) merged.set(d.id, d);
    for (const d of pinnedDocs) merged.set(d.id, d); // pinned wins on id clash (same doc either way)
    onNext([...merged.values()].sort((a, b) => postedAtMs(b) - postedAtMs(a)));
  }

  // Both queries need a composite index (firestore.indexes.json): the
  // audience `in` filter beside the postedAt order.
  const pinnedQuery = query(
    collection(db, 'live_updates'),
    where('pinned', '==', true),
    where('audience', 'in', audiences),
    orderBy('postedAt', 'desc'),
    limit(PINNED_CAP),
  );
  const recentQuery = query(
    collection(db, 'live_updates'),
    where('audience', 'in', audiences),
    orderBy('postedAt', 'desc'),
    limit(RECENT_CAP),
  );

  const onListenerError = (label) => (error) => {
    // Fail soft: the caller keeps its last-known merged rows;
    // subscribeWithRetry re-attaches a fresh listener after a delay.
    console.warn(`live_updates (${label}) subscription failed; keeping last-known rows and retrying.`, error);
  };

  const unsubPinned = subscribeWithRetry(
    (onError) =>
      onSnapshot(
        pinnedQuery,
        (snapshot) => {
          pinnedDocs = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
          emit();
        },
        onError,
      ),
    onListenerError('pinned'),
  );
  const unsubRecent = subscribeWithRetry(
    (onError) =>
      onSnapshot(
        recentQuery,
        (snapshot) => {
          recentDocs = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
          emit();
        },
        onError,
      ),
    onListenerError('recent'),
  );

  return () => {
    unsubPinned();
    unsubRecent();
  };
}
