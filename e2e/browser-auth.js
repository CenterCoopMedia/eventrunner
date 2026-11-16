import { signInWithCustomToken } from 'firebase/auth';
import { auth } from '../apps/web/src/firebase.js';
import { useEmulators } from '../apps/web/src/lib/firebaseSettings.js';

// Browser fixture for content tests. It retains the app's real auth observer
// and grant checks while the auth journeys cover the email-code flow.
export function signInWithEmulatorToken(token) {
  if (!useEmulators) throw new Error('This fixture requires the Auth emulator.');
  return signInWithCustomToken(auth, token);
}

/** The signed-in uid once the Auth SDK has restored its state, or null. */
export async function signedInUid() {
  await auth.authStateReady();
  return auth.currentUser?.uid ?? null;
}
