// Runtime config subscriptions (spec §2.4 path 2).
//
// The config/{event,features,theme,badges} docs are anonymously readable
// (firestore.rules), so this attaches plain onSnapshot listeners — no auth
// gate. This is the one seam between EventConfigProvider and Firebase:
// tests mock this module instead of the SDK, and the provider itself stays
// free of Firestore types.
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase.js';
import { subscribeWithRetry } from './retrySubscription.js';

/**
 * Subscribe to one config/{docId} document. Calls onNext(data) on every
 * snapshot where the doc exists; a missing doc leaves the committed
 * build-time snapshot in charge (fail soft — first paint already rendered
 * from it). A listener error also fails soft to the snapshot, then
 * re-attaches a fresh listener after a delay (subscribeWithRetry) so a
 * transient error doesn't permanently freeze runtime config for the rest of
 * the session. Returns the unsubscribe function, which also cancels any
 * pending retry.
 */
export function subscribeConfigDoc(docId, onNext) {
  return subscribeWithRetry(
    (onError) =>
      onSnapshot(
        doc(db, 'config', docId),
        (snapshot) => {
          if (snapshot.exists()) onNext(snapshot.data());
        },
        onError,
      ),
    (error) => {
      // Fail soft: the generated snapshot (or last-known overlay) keeps
      // rendering. The SDK has already torn this listener down, so
      // subscribeWithRetry schedules a fresh one rather than staying
      // silently dead.
      console.warn(
        `config/${docId} subscription failed; keeping snapshot values and retrying.`,
        error,
      );
    },
  );
}
