// Runtime config subscriptions (spec §2.4 path 2).
//
// The config/{event,features,theme,badges} docs are anonymously readable
// (firestore.rules), so this attaches plain onSnapshot listeners — no auth
// gate. This is the one seam between EventConfigProvider and Firebase:
// tests mock this module instead of the SDK, and the provider itself stays
// free of Firestore types.
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase.js';

// Per the Firestore SDK contract, once a listener's error callback fires the
// listener is terminated for good — it will not recover on its own. A public
// config doc rarely errors, but a tab left open all day (e.g. an attendee's
// schedule page) that hits one transient stream error would otherwise stop
// receiving feature/theme/event updates for the rest of the session with no
// indication and no retry. Re-attach on a fixed delay instead.
const RETRY_DELAY_MS = 15_000;

/**
 * Subscribe to one config/{docId} document. Calls onNext(data) on every
 * snapshot where the doc exists; a missing doc leaves the committed
 * build-time snapshot in charge (fail soft — first paint already rendered
 * from it). A listener error also fails soft to the snapshot, then
 * re-attaches a fresh listener after RETRY_DELAY_MS so a transient error
 * doesn't permanently freeze runtime config for the rest of the session.
 * Returns the unsubscribe function, which also cancels any pending retry.
 */
export function subscribeConfigDoc(docId, onNext) {
  let detachCurrent = null;
  let retryTimer = null;
  let stopped = false;

  function attach() {
    detachCurrent = onSnapshot(
      doc(db, 'config', docId),
      (snapshot) => {
        if (snapshot.exists()) onNext(snapshot.data());
      },
      (error) => {
        // Fail soft: the generated snapshot (or last-known overlay) keeps
        // rendering. The SDK has already torn this listener down, so
        // schedule a fresh one rather than staying silently dead.
        console.warn(
          `config/${docId} subscription failed; keeping snapshot values and retrying.`,
          error,
        );
        if (stopped) return;
        retryTimer = setTimeout(() => {
          retryTimer = null;
          if (!stopped) attach();
        }, RETRY_DELAY_MS);
      },
    );
  }

  attach();

  return () => {
    stopped = true;
    if (retryTimer) clearTimeout(retryTimer);
    if (typeof detachCurrent === 'function') detachCurrent();
  };
}
