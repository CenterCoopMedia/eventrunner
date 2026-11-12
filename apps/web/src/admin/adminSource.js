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
import { collection, doc, getDocs, limit, onSnapshot, orderBy, query, startAfter, where } from 'firebase/firestore';
import { db } from '../firebase.js';
import { subscribeWithRetry } from '../lib/retrySubscription.js';

const VERSION_PAGE_SIZE = 25;

/** Bound each read; a docPath-only cursor skips older versions already represented. */
export async function readAdminVersions(name, cursor = null) {
  const snapshot = await getDocs(query(collection(db, 'cmsVersionHistory'),
    where('docPath', '>=', `${name}/`), where('docPath', '<', `${name}0`),
    orderBy('docPath'), orderBy('revision', 'desc'),
    ...(cursor ? [startAfter(cursor)] : []), limit(VERSION_PAGE_SIZE + 1)));
  return {
    entries: snapshot.docs.slice(0, VERSION_PAGE_SIZE).map((entry) => entry.data()),
    // The first version for each docPath is its newest. Resume after the
    // whole final record rather than paging through its older revisions.
    nextCursor: snapshot.docs.length > VERSION_PAGE_SIZE ? snapshot.docs[VERSION_PAGE_SIZE - 1].data().docPath : null,
  };
}

/**
 * Subscribe to one admin-readable collection, unfiltered.
 *
 * @param {string} name e.g. 'cmsPages' or 'cmsPages_drafts'
 * @param {(docs: Array<object>, metadata: object) => void} onNext receives `{ id, ...data }` and snapshot metadata
 * @param {(error: unknown) => void} [onError] fail-soft notification
 * @returns {() => void} unsubscribe
 */
export function subscribeAdminCollection(name, onNext, onError) {
  return subscribeWithRetry(
    (handleError) =>
      onSnapshot(
        collection(db, name),
        { includeMetadataChanges: true },
        (snapshot) => {
          onNext(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })), snapshot.metadata);
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

/**
 * Subscribe to one admin-readable document. A missing document reads as
 * null.
 *
 * @param {string} path e.g. 'speaker_logistics/rae'
 * @param {(data: object|null) => void} onNext
 * @param {(error: unknown) => void} [onError] fail-soft notification
 * @returns {() => void} unsubscribe
 */
export function subscribeAdminDoc(path, onNext, onError) {
  return subscribeWithRetry(
    (handleError) =>
      onSnapshot(
        doc(db, path),
        (snapshot) => onNext(snapshot.exists() ? snapshot.data() : null),
        handleError,
      ),
    (error) => {
      console.warn(`${path} admin subscription failed; retrying.`, error);
      onError?.(error);
    },
  );
}
