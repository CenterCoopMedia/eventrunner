// Firebase client init from Tier A deploy-time env (spec §2.1, §8.1).
// VITE_FIREBASE_* values are non-secret client config; CI supplies dummy
// values so the credential-free build succeeds. Emulator connection is
// dev-only and opt-in via VITE_USE_EMULATORS=true.
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getStorage, connectStorageEmulator } from 'firebase/storage';

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
const appCheckSiteKey = (import.meta.env.VITE_FIREBASE_APP_CHECK_SITE_KEY || '').trim();

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
