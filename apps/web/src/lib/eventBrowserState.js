import { IS_DEMO } from './demoMode.js';

// Only mounted events share an origin with sibling events. Keep the existing
// keys and default Firebase app at root and in the static demo. Mounted apps
// never read unscoped keys that might belong to another event on the host.
export const mountedProjectId = !IS_DEMO && import.meta.env.BASE_URL !== '/'
  ? import.meta.env.VITE_FIREBASE_PROJECT_ID
  : null;

export function eventStorageKey(key) {
  return mountedProjectId ? `eventrunner:project:${mountedProjectId}:${key}` : key;
}
