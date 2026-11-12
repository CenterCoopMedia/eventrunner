import { IS_DEMO } from './demoMode.js';

/** Public route URL, independent of query state and stale canonical markup. */
export function publicUrl(path, {
  origin = globalThis.location?.origin,
  base = import.meta.env.BASE_URL || '/',
  demo = IS_DEMO,
} = {}) {
  const route = new URL(path, origin).pathname;
  const appPath = new URL(base, origin).pathname.replace(/\/?$/, '/');
  const url = new URL(appPath, origin);
  if (demo) url.hash = route;
  else url.pathname += route.replace(/^\//, '');
  return url.href;
}
