// Public deployment settings; reading a URL never initializes an SDK.
import { IS_DEMO } from './demoMode.js';

export const appCheckSiteKey = IS_DEMO ? '' : (import.meta.env.VITE_FIREBASE_APP_CHECK_SITE_KEY || '').trim();
export const appCheckEnabled = Boolean(appCheckSiteKey);
export const useEmulators = import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS === 'true';
export const storageBucketName = import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? '';
export const storageDownloadOrigin = useEmulators
  ? 'http://127.0.0.1:9199'
  : 'https://firebasestorage.googleapis.com';

export function functionsOrigin() {
  const override = import.meta.env.VITE_FUNCTIONS_ORIGIN;
  if (override) return override.replace(/\/+$/, '');
  const region = import.meta.env.VITE_FIREBASE_REGION || 'us-central1';
  const project = import.meta.env.VITE_FIREBASE_PROJECT_ID;
  if (!project) console.error('VITE_FIREBASE_PROJECT_ID is not set; cannot build the functions origin.');
  return `https://${region}-${project}.cloudfunctions.net`;
}
