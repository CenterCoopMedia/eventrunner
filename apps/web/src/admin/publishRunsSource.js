// The publish runs the Unpublished changes page lists beside the drafts
// (issue #196): the cmsPublishQueue rows cmsPublish writes. They are the
// progress and failure record of each publish, never the count of
// unpublished work, and only the page reads them, so this module loads with
// the page rather than in the admin entry chunk.
//
// firestore.rules let either admin tier read cmsPublishQueue; a
// non-admin's listener errors, which is the fail-soft path.
import { collection, limit, orderBy, query, where } from 'firebase/firestore';
import { db } from '../firebase.js';
import { listenWithRetry } from './pendingChangesSource.js';

/**
 * The most recent publish runs, newest first.
 *
 * @param {number} count
 * @param {(rows: Array<object>) => void} onNext
 * @param {(error: unknown) => void} [onError]
 * @returns {() => void} unsubscribe
 */
export function subscribeRecentPublishRuns(count, onNext, onError) {
  return listenWithRetry(
    'cmsPublishQueue recent',
    () => query(collection(db, 'cmsPublishQueue'), orderBy('requestedAt', 'desc'), limit(count)),
    onNext,
    onError,
  );
}

/**
 * The newest publish runs still marked failed, newest first, so a failed
 * run stays in view until it is resumed however many finished runs follow
 * it. Needs the (status, requestedAt desc) index in firestore.indexes.json.
 *
 * @param {number} count
 * @param {(rows: Array<object>) => void} onNext
 * @param {(error: unknown) => void} [onError]
 * @returns {() => void} unsubscribe
 */
export function subscribeFailedPublishRuns(count, onNext, onError) {
  return listenWithRetry(
    'cmsPublishQueue failed',
    () =>
      query(
        collection(db, 'cmsPublishQueue'),
        where('status', '==', 'failed'),
        orderBy('requestedAt', 'desc'),
        limit(count),
      ),
    onNext,
    onError,
  );
}
