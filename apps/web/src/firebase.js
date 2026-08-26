// Firebase client init from Tier A deploy-time env (spec §2.1, §8.1).
// VITE_FIREBASE_* values are non-secret client config; CI supplies dummy
// values so the credential-free build succeeds. Emulator connection is
// dev-only and opt-in via VITE_USE_EMULATORS=true.
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import {
  getFirestore,
  connectFirestoreEmulator,
  disableNetwork,
} from 'firebase/firestore';
import { getStorage, connectStorageEmulator } from 'firebase/storage';
import { IS_DEMO } from './lib/demoMode.js';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

const useEmulators = import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS === 'true';

// --- Demo mode (VITE_DEMO_MODE=1, lib/demoMode.js) --------------------------
// The static GitHub Pages demo has no Firebase project behind it, so every
// Firestore listener the providers attach would fail and spam the console.
// Taking the client offline before any of them attaches is the smallest
// intervention that makes the whole app inert: `disableNetwork` is queued on
// the SDK's internal async queue ahead of every later onSnapshot/getDocs, so
// each of them is answered from the (empty) local cache instead of the
// network. Listeners then simply never report a document, which is exactly
// the "no runtime doc yet" state every provider already renders from the
// committed snapshot (spec §2.4 fail-soft first paint) — no error path, no
// retry loop, no request. Writes reject locally, which the read-only demo
// never attempts. Auth stays signed out: with no persisted user the SDK
// issues no request either, and sign-in is disabled in the UI
// (components/SignInPanel.jsx).
if (IS_DEMO) {
  disableNetwork(db).catch(() => {
    // Nothing to fall back to and nothing to report: the demo renders from
    // the snapshot whether or not the SDK acknowledged going offline.
  });
}

if (useEmulators) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectStorageEmulator(storage, '127.0.0.1', 9199);
}

// --- Storage download origin ------------------------------------------------
// lib/mediaSource.js builds object URLs itself rather than calling
// getDownloadURL(), so it needs the bucket and the origin serving it. Both
// hosts below expose the same REST shape:
//
//   {origin}/v0/b/{bucket}/o/{encoded object path}?alt=media
//
// A request to that endpoint WITHOUT a download token is evaluated against
// storage.rules, which is exactly the property the media library wants (see
// lib/mediaSource.js for why tokens are not used).
export const storageBucketName = firebaseConfig.storageBucket ?? '';
export const storageDownloadOrigin = useEmulators
  ? 'http://127.0.0.1:9199'
  : 'https://firebasestorage.googleapis.com';

// --- App Check (issue #45) ---------------------------------------------------
// Attests that OTP requests come from this web app rather than from a script,
// so the unauthenticated sendOtpCode/verifyOtpCode endpoints are not an open
// email-bomb and provider-cost amplifier. The server half is the deploy-time
// EVENT_APP_CHECK_ENFORCED flag; enable the key here first, then the flag.
//
// Entirely opt-in: with no site key the SDK is never even fetched (the import
// is dynamic, so it stays out of the main chunk) and every request goes out
// exactly as before. A failure to obtain a token is never fatal here either —
// the request is sent unattested and the server decides, which keeps a
// misconfigured reCAPTCHA from becoming a client-side sign-in outage with no
// server-side trace.
// Never in the demo build: reCAPTCHA is a third-party network fetch, and the
// demo has no OTP endpoint to attest to in the first place.
const appCheckSiteKey = IS_DEMO
  ? ''
  : (import.meta.env.VITE_FIREBASE_APP_CHECK_SITE_KEY || '').trim();

export const appCheckEnabled = Boolean(appCheckSiteKey);

const appCheckReady = appCheckSiteKey
  ? import('firebase/app-check')
      .then(({ initializeAppCheck, ReCaptchaV3Provider }) => {
        // Must be set before initializeAppCheck. Dev-only: a debug token in
        // a production bundle is a published bypass of the whole control.
        if (import.meta.env.DEV && import.meta.env.VITE_APP_CHECK_DEBUG_TOKEN) {
          self.FIREBASE_APPCHECK_DEBUG_TOKEN = import.meta.env.VITE_APP_CHECK_DEBUG_TOKEN;
        }
        return initializeAppCheck(app, {
          provider: new ReCaptchaV3Provider(appCheckSiteKey),
          isTokenAutoRefreshEnabled: true,
        });
      })
      .catch((error) => {
        console.error('App Check initialization failed; requests go out unattested.', error);
        return null;
      })
  : null;

/**
 * Request headers carrying the App Check attestation, or `{}` when App Check
 * is not configured or the token could not be obtained.
 * @returns {Promise<Record<string, string>>}
 */
export async function appCheckHeaders() {
  if (!appCheckReady) return {};
  try {
    const instance = await appCheckReady;
    if (!instance) return {};
    const { getToken } = await import('firebase/app-check');
    const { token } = await getToken(instance, /* forceRefresh */ false);
    return token ? { 'X-Firebase-AppCheck': token } : {};
  } catch (error) {
    console.warn('App Check token unavailable; sending the request unattested.', error);
    return {};
  }
}
