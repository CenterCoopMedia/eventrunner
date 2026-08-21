// Admin Firestore subscriptions — the admin area's one seam to Firebase
// (tests mock this module instead of the SDK, same convention as
// lib/contentSource.js and lib/configSource.js).
//
// Unlike the public content seam, these read collections UNFILTERED: an
// admin needs to see hidden pages and unpublished drafts, and
// firestore.rules already allow an admin to read both the live collection
// and its `_drafts` sibling (a non-admin's listener simply errors, which is
// the fail-soft path below). Errors do not blank the UI — the caller keeps
// its last-known rows and the retry wrapper re-attaches a fresh listener.
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase.js';
import { subscribeWithRetry } from '../lib/retrySubscription.js';

/**
 * Subscribe to one admin-readable collection, unfiltered.
 *
 * @param {string} name e.g. 'cmsPages' or 'cmsPages_drafts'
 * @param {(docs: Array<object>) => void} onNext receives `{ id, ...data }`
 * @param {(error: unknown) => void} [onError] fail-soft notification
 * @returns {() => void} unsubscribe
 */
export function subscribeAdminCollection(name, onNext, onError) {
  return subscribeWithRetry(
    (handleError) =>
      onSnapshot(
        collection(db, name),
        (snapshot) => {
          onNext(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
        },
        handleError,
      ),
    (error) => {
      // Fail soft: keep whatever rows the caller already has and surface a
      // non-blocking notice; subscribeWithRetry re-attaches later.
      console.warn(`${name} admin subscription failed; retrying.`, error);
      onError?.(error);
    },
  );
}
