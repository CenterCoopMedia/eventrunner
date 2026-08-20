// Runtime content subscriptions (spec §2.4 path 3).
//
// ContentProvider overlays the committed snapshot with the published cms
// collections. The published collection is queried with visible == true —
// firestore.rules only allow anonymous reads of visible docs, and Firestore
// queries must be provably within rules, so the clause is load-bearing, not
// a filter nicety. readSource 'draft' points at the `<name>_drafts` sibling
// (admin-only per rules; ?preview=1 is convenience, the rules are the
// control) with no visibility clause so preview can show hidden drafts'
// metadata — renderers still skip visible === false.
//
// This is the one seam between ContentProvider and Firebase: tests mock this
// module instead of the SDK, and the provider stays free of Firestore types.
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebase.js';
import { subscribeWithRetry } from './retrySubscription.js';

/**
 * Subscribe to one published cms collection (or its _drafts sibling).
 * Calls onNext(docs) with an array of `{ id, ...data }` on every snapshot.
 * A listener error leaves the committed build-time snapshot (or last-known
 * live values) in charge (fail soft — first paint already rendered from it),
 * then re-attaches a fresh listener after a delay (subscribeWithRetry) so a
 * transient error doesn't permanently freeze content updates for the rest of
 * the session. Returns the unsubscribe function, which also cancels any
 * pending retry.
 *
 * @param {string} name       Publishable collection name, e.g. 'cmsContent'.
 * @param {'published'|'draft'} readSource
 * @param {(docs: Array<object>) => void} onNext
 */
export function subscribeContentCollection(name, readSource, onNext) {
  const target =
    readSource === 'draft'
      ? collection(db, `${name}_drafts`)
      : query(collection(db, name), where('visible', '==', true));
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
      // Fail soft: the generated snapshot (or last-known live values) keeps
      // rendering. The SDK has already torn this listener down, so
      // subscribeWithRetry schedules a fresh one rather than staying
      // silently dead.
      console.warn(
        `${name} (${readSource}) subscription failed; keeping snapshot values and retrying.`,
        error,
      );
    },
  );
}
