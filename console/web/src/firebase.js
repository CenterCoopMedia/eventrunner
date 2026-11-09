// Firebase client for the console project (ADR 0007 §1). These values are
// public client settings of the console project, never of a client event
// project. Tests mock this module (src/test/setup.js).
import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';

const config = {
  apiKey: import.meta.env.VITE_CONSOLE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_CONSOLE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_CONSOLE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_CONSOLE_FIREBASE_APP_ID,
};

const app = initializeApp(config);
export const auth = getAuth(app);

if (import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS === 'true') {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
}
