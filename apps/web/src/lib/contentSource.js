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

/**
 * Subscribe to one published cms collection (or its _drafts sibling).
 * Calls onNext(docs) with an array of `{ id, ...data }` on every snapshot.
 * A listener error leaves the committed build-time snapshot in charge
 * (fail soft — first paint already rendered from it). Returns unsubscribe.
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
  return onSnapshot(
    target,
    (snapshot) => {
      onNext(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    },
    (error) => {
      // Fail soft: the generated snapshot keeps rendering.
      console.warn(
        `${name} (${readSource}) subscription failed; keeping snapshot values.`,
        error,
      );
    },
  );
}
