import { subscribeToFirebase } from './firebaseLoader.js';
import { subscribeWithRetry } from './retrySubscription.js';

// Missing or unreadable config never opens intake from a stale build snapshot.
export function subscribePitchCall(onNext, onError) {
  return subscribeToFirebase(({ db, doc, onSnapshot }) => {
    return subscribeWithRetry((fail) => onSnapshot(doc(db, 'config', 'pitch_call'),
      (snapshot) => onNext(snapshot.exists() ? snapshot.data() : { enabled: false }), fail), onError);
  }, onError);
}
