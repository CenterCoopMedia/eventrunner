import { IS_DEMO } from './demoMode.js';
import { withContentLanguage } from 'shared/languageUrls';

/** Public route URL, independent of query state and stale canonical markup. */
export function publicUrl(path, {
  origin = globalThis.location?.origin,
  base = import.meta.env.BASE_URL || '/',
  demo = IS_DEMO,
  language,
} = {}) {
  const route = new URL(path, origin).pathname;
  const target = withContentLanguage(route, language);
  const appPath = new URL(base, origin).pathname.replace(/\/?$/, '/');
  const url = new URL(appPath, origin);
  if (demo) url.hash = target;
  else {
    const [pathname, query] = target.split('?');
    url.pathname += pathname.replace(/^\//, '');
    if (query) url.search = query;
  }
  return url.href;
}
