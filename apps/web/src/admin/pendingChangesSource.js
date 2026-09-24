// The unpublished changes seam (issue #196): the three live reads the
// admin's pending-changes banner and page make, and nothing else.
//
// A saved draft that is not live is a `<collection>_drafts` document with
// `status == 'dirty'` — the query functions/src/cms/store.cjs listDirty runs,
// and the set cmsPublish `{ all: true }` publishes. Reading the same
// predicate here is what keeps the banner, the page, the overview's
// readiness count and "Publish all" counting one set.
//
// The publish runs are the cmsPublishQueue rows cmsPublish writes: they are
// the progress and failure record, never the count of unpublished work.
//
// A module of its own rather than more listeners through adminSource.js, so
// a test can steer these reads without taking over the name-keyed
// adminSource mocks other suites hold (src/test/setup.js mocks this module
// for every test file). firestore.rules let either admin tier read both
// collections; a non-admin's listener errors, which is the fail-soft path.
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { db } from '../firebase.js';
import { subscribeWithRetry } from '../lib/retrySubscription.js';

/**
 * One retried listener over a query, mapping documents to `{ id, ...data }`.
 *
 * @param {string} label named in the warning
 * @param {() => unknown} buildQuery
 * @param {(docs: Array<object>) => void} onNext
 * @param {(error: unknown) => void} [onError]
 * @returns {() => void} unsubscribe
 */
function listen(label, buildQuery, onNext, onError) {
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
  return listen(
    `${name} dirty`,
    () => query(collection(db, name), where('status', '==', 'dirty')),
    onNext,
    onError,
  );
}

/**
 * The most recent publish runs, newest first.
 *
 * @param {number} count
 * @param {(rows: Array<object>) => void} onNext
 * @param {(error: unknown) => void} [onError]
 * @returns {() => void} unsubscribe
 */
export function subscribeRecentPublishRuns(count, onNext, onError) {
  return listen(
    'cmsPublishQueue recent',
    () => query(collection(db, 'cmsPublishQueue'), orderBy('requestedAt', 'desc'), limit(count)),
    onNext,
    onError,
  );
}

/**
 * Publish runs still marked failed, however old, so a failed run stays in
 * view until it is resumed. A single-field filter: no composite index.
 *
 * @param {number} count
 * @param {(rows: Array<object>) => void} onNext
 * @param {(error: unknown) => void} [onError]
 * @returns {() => void} unsubscribe
 */
export function subscribeFailedPublishRuns(count, onNext, onError) {
  return listen(
    'cmsPublishQueue failed',
    () => query(collection(db, 'cmsPublishQueue'), where('status', '==', 'failed'), limit(count)),
    onNext,
    onError,
  );
}
