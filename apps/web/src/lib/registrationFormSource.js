// config/registration_form (ADR 0008 §4): the attendee registration
// questions. `config/*` is publicly readable, so this is a plain listener.
// A missing document reads as null: no questions are asked.
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase.js';
import { subscribeWithRetry } from './retrySubscription.js';

export function subscribeRegistrationForm(onNext, onError) {
  return subscribeWithRetry((fail) => onSnapshot(doc(db, 'config', 'registration_form'),
    (snapshot) => onNext(snapshot.exists() ? snapshot.data() : null), fail), onError);
}
