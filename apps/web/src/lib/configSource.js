// Runtime config subscriptions (spec §2.4 path 2).
//
// The config/{event,features,theme,badges} docs are anonymously readable
// (firestore.rules), so this attaches plain onSnapshot listeners — no auth
// gate. This is the one seam between EventConfigProvider and Firebase:
// tests mock this module instead of the SDK, and the provider itself stays
// free of Firestore types.
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase.js';

/**
 * Subscribe to one config/{docId} document. Calls onNext(data) on every
 * snapshot where the doc exists; a missing doc or a listener error leaves the
 * committed build-time snapshot in charge (fail soft — first paint already
 * rendered from it). Returns the unsubscribe function.
 */
export function subscribeConfigDoc(docId, onNext) {
  return onSnapshot(
    doc(db, 'config', docId),
    (snapshot) => {
      if (snapshot.exists()) onNext(snapshot.data());
    },
    (error) => {
      // Fail soft: the generated snapshot keeps rendering.
      console.warn(
        `config/${docId} subscription failed; keeping snapshot values.`,
        error,
      );
    },
  );
}
