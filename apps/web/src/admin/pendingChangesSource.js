// The unpublished changes seam (issue #196): the live read the admin's
// pending-changes banner and page share, and nothing else.
//
// A saved draft that is not live is a `<collection>_drafts` document with
// `status == 'dirty'` — the query functions/src/cms/store.cjs listDirty runs,
// and the set cmsPublish `{ all: true }` publishes. Reading the same
// predicate here is what keeps the banner, the page, the overview's
// readiness count and "Publish all" counting one set.
//
// The publish runs (publishRunsSource.js) are read beside them on the page
// only, so they load with it and stay out of the admin entry chunk.
//
// A module of its own rather than more listeners through adminSource.js, so
// a test can steer these reads without taking over the name-keyed
// adminSource mocks other suites hold (src/test/setup.js mocks this module
// for every test file). firestore.rules let either admin tier read every
// `_drafts` collection; a non-admin's listener errors, which is the
// fail-soft path.
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebase.js';
import { subscribeWithRetry } from '../lib/retrySubscription.js';

/**
 * One retried listener over a query, mapping documents to `{ id, ...data }`.
 * The publish run reads (publishRunsSource.js) use it too.
 *
 * @param {string} label named in the warning
 * @param {() => unknown} buildQuery
 * @param {(docs: Array<object>) => void} onNext
 * @param {(error: unknown) => void} [onError]
 * @returns {() => void} unsubscribe
 */
export function listenWithRetry(label, buildQuery, onNext, onError) {
  return subscribeWithRetry(
    (handleError) =>
      onSnapshot(
        buildQuery(),
        (snapshot) => {
          onNext(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
        },
        handleError,
      ),
    (error) => {
      // Fail soft: the caller keeps its last rows and says the list could
      // not be refreshed; subscribeWithRetry re-attaches later.
      console.warn(`${label} admin subscription failed; retrying.`, error);
      onError?.(error);
    },
  );
}

/**
 * Every dirty draft in one publishable collection.
 *
 * @param {string} collectionId e.g. 'cmsContent'
 * @param {(docs: Array<object>) => void} onNext
 * @param {(error: unknown) => void} [onError]
 * @returns {() => void} unsubscribe
 */
export function subscribeDirtyDrafts(collectionId, onNext, onError) {
  const name = `${collectionId}_drafts`;
  return listenWithRetry(
    `${name} dirty`,
    () => query(collection(db, name), where('status', '==', 'dirty')),
    onNext,
    onError,
  );
}
